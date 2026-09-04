import { Injectable, Logger } from '@nestjs/common';
import { RequestContext, TransactionalConnection } from '@vendure/core';
import { CommissionLedger } from '../entities/commission-ledger.entity';

const loggerCtx = 'CommissionLedgerService';

export interface RecordMarketplaceOrderInput {
  ctx: RequestContext;
  orderId: string;
  channelId: string;
  marketplaceRef: string;
  grossAmountInPaise: number;
  currency: string;
}

/**
 * Writes CommissionLedger rows for server-classified marketplace orders.
 * INV-002/DL-030: append-only; rows are never updated or deleted here.
 * DL-030: a row is written for EVERY marketplace order, even at 0 percent
 * (commissionAmountInPaise = 0) so GMV history survives rate changes.
 */
@Injectable()
export class CommissionLedgerService {
  private readonly logger = new Logger(loggerCtx);

  constructor(private readonly connection: TransactionalConnection) {}

  getCommissionPercent(): number {
    const raw = process.env.MARKETPLACE_COMMISSION_PERCENT ?? '0';
    const parsed = parseInt(raw, 10);
    if (Number.isNaN(parsed) || parsed < 0) {
      return 0;
    }
    return Math.min(parsed, 100);
  }

  computeCommissionAmount(grossInPaise: number, percent: number): number {
    return Math.floor((grossInPaise * percent) / 100);
  }

  /**
   * Decision 6 replay guard: the ref is single-use. Consumed means a row already
   * exists for the same ref on a DIFFERENT order (a retried event for the SAME
   * order is idempotent, not a replay).
   */
  async isRefConsumedOnOtherOrder(marketplaceRef: string, orderId: string): Promise<boolean> {
    const repo = this.connection.rawConnection.getRepository(CommissionLedger);
    const rows = await repo.find({ where: { marketplaceRef } });
    return rows.some((r) => String(r.orderId) !== String(orderId));
  }

  async recordMarketplaceOrder(input: RecordMarketplaceOrderInput): Promise<void> {
    const repo = this.connection.rawConnection.getRepository(CommissionLedger);
    const percent = this.getCommissionPercent();
    const amount = this.computeCommissionAmount(input.grossAmountInPaise, percent);
    const row = repo.create({
      channelId: input.channelId,
      orderId: String(input.orderId),
      orderSource: 'marketplace',
      marketplaceRef: input.marketplaceRef,
      grossAmountInPaise: input.grossAmountInPaise,
      commissionPercent: percent,
      commissionAmountInPaise: amount,
      currency: input.currency,
    });
    try {
      await repo.insert(row);
      this.logger.log(
        `CommissionLedger row recorded: order=${input.orderId} channel=${input.channelId} gross=${input.grossAmountInPaise} percent=${percent} amount=${amount}`
      );
    } catch (err: any) {
      if (err && err.code === '23505') {
        // Unique (marketplaceRef, orderId) violated: retried event for the same
        // order. Idempotent no-op (Decision 6 interplay with retries).
        this.logger.warn(`CommissionLedger row already exists for order ${input.orderId}; idempotent no-op.`);
        return;
      }
      this.logger.error(`Failed to record CommissionLedger row for order ${input.orderId}: ${err?.message}`, err?.stack);
    }
  }
}