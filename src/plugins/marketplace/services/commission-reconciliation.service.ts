import { Injectable } from '@nestjs/common';
import { Order, Permission, RequestContext, TransactionalConnection } from '@vendure/core';
import { CommissionLedger } from '../entities/commission-ledger.entity';

export interface ReconciliationOptions {
  from?: Date;
  to?: Date;
  /** SuperAdmin-only: reconcile all channels instead of ctx.channelId. */
  allChannels?: boolean;
}

export interface ReconciliationFinancials {
  /**
   * Ledger rows found — NOT the marketplace order population.
   * When missingCount > 0, reconciliation.marketplaceOrdersExpected > this.
   */
  commissionLedgerOrderCount: number;
  marketplaceGmvInPaise: number;
  commissionEarnedInPaise: number;
  zeroRateRowCount: number;
  /** commissionEarned / GMV for the population; null when GMV is 0 (never 0 — "no GMV" ≠ "0% rate"). */
  effectiveCommissionPercent: number | null;
}

export interface ReconciliationDiagnostics {
  marketplaceOrdersExpected: number;
  ledgerRowsFound: number;
  missingCount: number;
  replayedRefCount: number;
  amountMismatchCount: number;
  orphanLedgerRowCount: number;
  rateDriftCount: number;
}

export interface ReconciliationReport {
  channelId: string | null;
  period: { from: string | null; to: string | null };
  financials: ReconciliationFinancials;
  reconciliation: ReconciliationDiagnostics;
}

const ZERO_RATE = 0;

/**
 * Gate R2 — read-only commission reconciliation/reporting service.
 *
 * Contract (docs/implementation/commission-reconciliation.md):
 *  - `CommissionLedger` is the SOLE financial authority. This service NEVER
 *    recalculates historical commission from the current env rate, NEVER
 *    mutates Order or CommissionLedger, and NEVER persists anything.
 *  - Population: Order.customFields.orderSource === 'marketplace'
 *    (server-classified only), period via Order.orderPlacedAt.
 *  - Discrepancy classes:
 *      MISSING            — marketplace order with no ledger row (the dangerous one)
 *      REPLAYED_REF       — informational; consumed ref already owned by another order
 *      AMOUNT_MISMATCH    — stored amount ≠ floor(stored gross × stored percent / 100)
 *      ORPHAN_LEDGER_ROW  — ledger row without a marketplace-classified order
 *      RATE_DRIFT         — informational count: stored percent ≠ current env percent
 *  - ZERO_RATE rows (percent = 0, amount = 0) are valid facts, never anomalies.
 *  - Channel isolation: default scope is ctx.channelId; SuperAdmin may pass
 *    allChannels: true (INV-002).
 */
@Injectable()
export class CommissionReconciliationService {
  constructor(private readonly connection: TransactionalConnection) {}

  async reconcile(ctx: RequestContext, options: ReconciliationOptions = {}): Promise<ReconciliationReport> {
    const isSuperAdmin = ctx.userHasPermissions([Permission.SuperAdmin]);
    const allChannels = isSuperAdmin && options.allChannels === true;
    const channelId = allChannels ? null : String(ctx.channelId);

    // ── Phase A: marketplace-classified order population (authoritative commerce state) ──
    const orderRepo = this.connection.getRepository(ctx, Order);
    const qb = orderRepo
      .createQueryBuilder('order')
      .where(`order.customFields ->> 'orderSource' = :source`, { source: 'marketplace' })
      .andWhere('order.orderPlacedAt IS NOT NULL');

    if (!allChannels) {
      qb.andWhere(`EXISTS (SELECT 1 FROM order.channels channel WHERE channel.id = :filterChannelId)`, {
        filterChannelId: channelId,
      });
    }
    if (options.from) {
      qb.andWhere('order.orderPlacedAt >= :from', { from: options.from });
    }
    if (options.to) {
      qb.andWhere('order.orderPlacedAt <= :to', { to: options.to });
    }

    const marketplaceOrders = await qb.getMany();
    const orderIds = new Set(marketplaceOrders.map((o) => String(o.id)));

    // ── Phase B: ledger population (financial authority — read-only) ──
    const ledgerRepo = this.connection.getRepository(ctx, CommissionLedger);
    const ledgerQb = ledgerRepo.createQueryBuilder('ledger');
    if (!allChannels) {
      ledgerQb.where('ledger.channelId = :channelId', { channelId });
    }
    const ledgerRows = await ledgerQb.getMany();
    const rowsByOrderId = new Map(ledgerRows.map((r) => [String(r.orderId), r]));

    // ── Phase C: reconciliation ──
    let ledgerRowsFound = 0;
    let missingCount = 0;
    let marketplaceGmvInPaise = 0;
    let commissionEarnedInPaise = 0;
    let zeroRateRowCount = 0;
    let amountMismatchCount = 0;
    let rateDriftCount = 0;
    const currentEnvPercent = this.readCurrentEnvPercent();

    for (const order of marketplaceOrders) {
      const row = rowsByOrderId.get(String(order.id));
      if (!row) {
        missingCount++;
        continue;
      }
      ledgerRowsFound++;
      marketplaceGmvInPaise += row.grossAmountInPaise;
      commissionEarnedInPaise += row.commissionAmountInPaise;
      if (row.commissionPercent === ZERO_RATE) {
        zeroRateRowCount++;
      }
      // AMOUNT_MISMATCH: stored-row internal consistency ONLY (never the env rate).
      const expectedAmount = Math.floor((row.grossAmountInPaise * row.commissionPercent) / 100);
      if (row.commissionAmountInPaise !== expectedAmount) {
        amountMismatchCount++;
      }
      if (currentEnvPercent !== null && row.commissionPercent !== currentEnvPercent) {
        rateDriftCount++;
      }
    }

    // ── ORPHAN_LEDGER_ROW: ledger rows without a marketplace-classified order ──
    // A row whose order falls outside the selected period is NOT an orphan; only
    // rows whose orderId does not resolve to a marketplace-classified order count.
    let orphanLedgerRowCount = 0;
    const orphanCandidateIds = ledgerRows
      .filter((r) => !orderIds.has(String(r.orderId)))
      .map((r) => String(r.orderId));
    if (orphanCandidateIds.length > 0) {
      const resolved = await orderRepo
        .createQueryBuilder('order')
        .select('order.id', 'id')
        .addSelect(`order.customFields ->> 'orderSource'`, 'source')
        .where('order.id IN (:...ids)', { ids: orphanCandidateIds })
        .getRawMany();
      const sourceById = new Map(resolved.map((r) => [String(r.id), r.source]));
      for (const id of orphanCandidateIds) {
        const source = sourceById.get(id);
        if (source === undefined || source !== 'marketplace') {
          orphanLedgerRowCount++;
        }
      }
    }

    // ── REPLAYED_REF (informational): non-marketplace orders carrying a ref
    // that the ledger shows as consumed by a DIFFERENT order ──
    let replayedRefCount = 0;
    const replayCandidates = await orderRepo
      .createQueryBuilder('order')
      .select('order.id', 'id')
      .addSelect(`order.customFields ->> 'marketplaceRef'`, 'ref')
      .where(`order.customFields ->> 'orderSource' IN (:...sources)`, { sources: ['direct', 'referral'] })
      .andWhere(`order.customFields ->> 'marketplaceRef' IS NOT NULL`)
      .andWhere('order.orderPlacedAt IS NOT NULL');
    // Period-scope (R1 rule: ALL order-derived diagnostics refer to the selected
    // population — replayed refs outside the window belong to another report).
    if (options.from) {
      replayCandidates.andWhere('order.orderPlacedAt >= :rFrom', { rFrom: options.from });
    }
    if (options.to) {
      replayCandidates.andWhere('order.orderPlacedAt <= :rTo', { rTo: options.to });
    }
    if (!allChannels) {
      replayCandidates.andWhere(
        `EXISTS (SELECT 1 FROM order.channels channel WHERE channel.id = :filterChannelId)`,
        { filterChannelId: channelId },
      );
    }
    const replayRows = await replayCandidates.getRawMany();
    if (replayRows.length > 0) {
      const refs = replayRows.map((r) => String(r.ref));
      const owners = await ledgerRepo
        .createQueryBuilder('ledger')
        .select('ledger.marketplaceRef', 'ref')
        .addSelect('ledger.orderId', 'orderId')
        .where('ledger.marketplaceRef IN (:...refs)', { refs })
        .getRawMany();
      const ownerByRef = new Map(owners.map((o) => [String(o.ref), String(o.orderId)]));
      for (const c of replayRows) {
        const owner = ownerByRef.get(String(c.ref));
        if (owner && owner !== String(c.id)) {
          replayedRefCount++;
        }
      }
    }

    // ── Report (pure result object; nothing persisted, nothing mutated) ──
    return {
      channelId,
      period: {
        from: options.from ? options.from.toISOString() : null,
        to: options.to ? options.to.toISOString() : null,
      },
      financials: {
        // Ledger-row count, NOT the marketplace order population —
        // when missingCount > 0 these differ (see reconciliation.marketplaceOrdersExpected).
        commissionLedgerOrderCount: ledgerRowsFound,
        marketplaceGmvInPaise,
        commissionEarnedInPaise,
        zeroRateRowCount,
        // "no GMV" ≠ "0% commission": null when the population has no GMV.
        effectiveCommissionPercent:
          marketplaceGmvInPaise > 0 ? (commissionEarnedInPaise / marketplaceGmvInPaise) * 100 : null,
      },
      reconciliation: {
        marketplaceOrdersExpected: marketplaceOrders.length,
        ledgerRowsFound,
        missingCount,
        replayedRefCount,
        amountMismatchCount,
        orphanLedgerRowCount,
        rateDriftCount,
      },
    };
  }

  /**
   * Current env commission percent — used ONLY for the informational
   * RATE_DRIFT count. Mirrors CommissionLedgerService's fail-closed parsing
   * (empty = 0; malformed/out-of-range = unknown → null → drift not counted).
   * NEVER used to recalculate or invalidate stored rows.
   */
  private readCurrentEnvPercent(): number | null {
    const raw = process.env.MARKETPLACE_COMMISSION_PERCENT;
    if (raw === undefined || raw.trim() === '') {
      return 0;
    }
    const trimmed = raw.trim();
    if (!/^\d+$/.test(trimmed)) {
      return null;
    }
    const parsed = parseInt(trimmed, 10);
    if (parsed > 100) {
      return null;
    }
    return parsed;
  }
}
