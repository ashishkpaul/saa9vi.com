import { Args, Query, Resolver } from '@nestjs/graphql';
import { Allow, Ctx, RequestContext } from '@vendure/core';
import {
  CommissionReconciliationService,
  ReconciliationReport,
} from '../services/commission-reconciliation.service';
import { ReadCommissionReportPermission } from '../constants';

@Resolver()
export class MarketplaceCommissionReconciliationResolver {
  constructor(private readonly reconciliationService: CommissionReconciliationService) {}

  /**
   * Gate R2 — read-only commission reconciliation & reporting.
   *
   * Channel-scoped by default (INV-002): a tenant admin with the
   * MarketplaceCommission Read permission reconciles only their own channel.
   * `allChannels: true` is honoured ONLY for SuperAdmin (non-SuperAdmin
   * callers are clamped to their own channel rather than rejected, so the
   * query never leaks cross-channel data either way).
   *
   * Read-only by contract: no Order or CommissionLedger mutation, no
   * recalculation from the current env rate, nothing persisted.
   */
  @Query()
  @Allow(ReadCommissionReportPermission)
  async commissionReconciliation(
    @Ctx() ctx: RequestContext,
    @Args('from', { nullable: true, type: () => Date }) from?: Date | null,
    @Args('to', { nullable: true, type: () => Date }) to?: Date | null,
    @Args('allChannels', { nullable: true, type: () => Boolean }) allChannels?: boolean | null,
  ): Promise<ReconciliationReport> {
    return this.reconciliationService.reconcile(ctx, {
      from: from ?? undefined,
      to: to ?? undefined,
      allChannels: allChannels ?? undefined,
    });
  }
}