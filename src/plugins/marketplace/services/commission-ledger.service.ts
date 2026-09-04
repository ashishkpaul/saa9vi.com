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

export type RecordMarketplaceOrderResult =
  | 'inserted'
  | 'duplicate_ref'
  | 'duplicate_order'
  | 'error';

/**
 * Writes CommissionLedger rows for server-classified marketplace orders.
 * INV-002/DL-030: append-only; rows are never updated or deleted here.
 * DL-030: a row is written for EVERY marketplace order, even at 0 percent
 * (commissionAmountInPaise = 0) so GMV history survives rate changes.
 *
 * Single-use is enforced ATOMICALLY by the UNIQUE (marketplaceRef) index:
 * recordMarketplaceOrder() inserts FIRST and lets the DB arbitrate the
 * Decision-6 replay race (two concurrent orders presenting the same ref
 * cannot both win the insert). The composite (marketplaceRef, orderId)
 * unique index remains only as same-order idempotency for retried events.
 */
@Injectable()
export class CommissionLedgerService {
  private readonly logger = new Logger(loggerCtx);
  private readonly commissionPercent: number;

  constructor(private readonly connection: TransactionalConnection) {
    // Fail-closed financial config: malformed percent aborts boot rather than
    // silently mis-computing commission (parseInt('10garbage') === 10 is not acceptable).
    const raw = process.env.MARKETPLACE_COMMISSION_PERCENT;
    if (raw === undefined || raw.trim() === '') {
      this.commissionPercent = 0;
      return;
    }
    const trimmed = raw.trim();
    if (!/^\d+$/.test(trimmed)) {
      throw new Error(
        `CommissionLedgerService: MARKETPLACE_COMMISSION_PERCENT must be an integer 0..100 (got '${raw}').`
      );
    }
    const parsed = parseInt(trimmed, 10);
    if (parsed > 100) {
      throw new Error(
        `CommissionLedgerService: MARKETPLACE_COMMISSION_PERCENT must be an integer 0..100 (got ${parsed}).`
      );
    }
    this.commissionPercent = parsed;
  }

  getCommissionPercent(): number {
    return this.commissionPercent;
  }

  computeCommissionAmount(grossInPaise: number, percent: number): number {
    return Math.floor((grossInPaise * percent) / 100);
  }

  /**
   * Atomic single-use arbiter (Decision 6). Insert-first; the UNIQUE
   * (marketplaceRef) index decides. `duplicate_ref` = the ref was already
   * consumed by a different order (true replay -> classify direct).
   * `duplicate_order` = retried event for the same order (idempotent; the
   * earlier attempt already classified marketplace). `error` = non-duplicate
   * persistence failure; the caller MUST treat the missing ledger row as a
   * reconciliation incident (observable via the error log; recoverable via the
   * tracked commission reconciliation task) — the financial fact is missing
   * even though the order was classified marketplace.
   */
  async recordMarketplaceOrder(input: RecordMarketplaceOrderInput): Promise<RecordMarketplaceOrderResult> {
    // Use the transactional connection (request-scoped) so that concurrent
    // calls each get their own transaction. The UNIQUE (marketplaceRef) index
    // then serializes concurrent inserts: exactly one wins, the other gets
    // a 23505 which we detect as a replay (duplicate_ref).
    const repo = this.connection.getRepository(input.ctx, CommissionLedger);
    const percent = this.commissionPercent;
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
      return 'inserted';
    } catch (err: any) {
      if (err && err.code === '23505') {
        // Disambiguate which unique constraint lost: ref consumed by another
        // order (replay) vs same-order retry.
        const existing = await repo.find({ where: { marketplaceRef: input.marketplaceRef } });
        const other = existing.some((r) => String(r.orderId) !== String(input.orderId));
        if (other) {
          this.logger.warn(`Replay: marketplaceRef already consumed by another order (incoming order ${input.orderId}).`);
          return 'duplicate_ref';
        }
        this.logger.warn(`CommissionLedger row already exists for order ${input.orderId}; idempotent no-op.`);
        return 'duplicate_order';
      }
      this.logger.error(
        `RECONCILIATION-REQUIRED: failed to persist CommissionLedger row for classified marketplace order ${input.orderId}: ${err?.message}`,
        err?.stack
      );
      return 'error';
    }
  }
}
