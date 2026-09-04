import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { EventBus, Order, OrderPlacedEvent, TransactionalConnection } from '@vendure/core';
import { MarketplaceAttributionService, MarketplaceAttributionRef } from '../services/marketplace-attribution.service';
import { CommissionLedgerService } from '../services/commission-ledger.service';

const loggerCtx = 'CommissionListener';

/**
 * Server-side marketplace commission classification (ADR-021 Decision 5-8; INV-008).
 *
 * Pipeline on every OrderPlacedEvent (all failures NON-BLOCKING; a failed
 * attribution degrades to orderSource='direct' and must never break checkout):
 *  1. Re-verify the stored marketplaceRef (HMAC + TTL + channel) at placement
 *     time — the listener NEVER trusts the stored ref merely because the
 *     resolver saved it (stale/mutated order state defense).
 *  2. Resource-in-order (Decision 8): the referenced resource must actually be
 *     on the final order (session -> productVariantId on a line; 'plan' has no
 *     order-line representation in the commerce MVP yet -> treated as absent).
 *  3. Single-use replay (Decision 6): ref already consumed on a different
 *     order -> direct. The (marketplaceRef, orderId) unique index on
 *     CommissionLedger is the DB-level backstop.
 *  4. Stamp order.server-side only: orderSource = 'marketplace' | 'direct'
 *     (INV-008: the client can never write this field).
 *  5. Record the CommissionLedger row (DL-030: always for marketplace orders,
 *     even at 0 percent -> $0-row).
 */
@Injectable()
export class CommissionListener implements OnApplicationBootstrap {
  private readonly logger = new Logger(loggerCtx);

  constructor(
    private readonly eventBus: EventBus,
    private readonly connection: TransactionalConnection,
    private readonly attributionService: MarketplaceAttributionService,
    private readonly ledgerService: CommissionLedgerService,
  ) {}

  onApplicationBootstrap(): void {
    this.eventBus.ofType(OrderPlacedEvent).subscribe((event) => {
      this.handleOrderPlaced(event).catch((err: Error) => {
        this.logger.error(`Commission classification failed for order: ${err.message}`, err.stack);
      });
    });
  }

  private async handleOrderPlaced(event: OrderPlacedEvent): Promise<void> {
    const { ctx, order } = event;
    const ref: string | null = (order.customFields?.marketplaceRef as string | undefined) ?? null;
    let outcome: 'marketplace' | 'direct' = 'direct';
    if (ref) {
      // HMAC channel binding uses ctx.channel.token — the SAME value the 3B.2
      // resolver verified against when storing the ref. Never mix token/id here.
      const channelToken = ctx.channel?.token;
      const verified: MarketplaceAttributionRef | null = channelToken
        ? this.attributionService.resolveRef(ref, channelToken)
        : null;
      if (verified && this.resourceInOrder(order, verified)) {
        // Insert-first: the UNIQUE (marketplaceRef) index is the atomic
        // Decision-6 arbiter (no app-level check-then-insert race).
        const result = await this.ledgerService.recordMarketplaceOrder({
          orderId: String(order.id),
          channelId: String(ctx.channelId), // actual channel id for reconciliation/reporting (NOT the public token)
          marketplaceRef: ref,
          grossAmountInPaise: order.totalWithTax,
          currency: order.currencyCode,
        });
        if (result === 'inserted') {
          outcome = 'marketplace';
        } else if (result === 'duplicate_order') {
          // Retried OrderPlacedEvent for the same order: the earlier attempt
          // already recorded the row and classified marketplace.
          outcome = 'marketplace';
        } else if (result === 'duplicate_ref') {
          this.logger.warn(`Replay: marketplaceRef already consumed by another order (order ${String(order.id)}); classifying direct.`);
          outcome = 'direct';
        } else {
          // Persistence failure: classification truth is 'marketplace', but the
          // immutable financial fact is MISSING (RECONCILIATION-REQUIRED logged
          // by the service). Recoverable via the tracked commission
          // reconciliation/reporting task (Phase 3B.4/8).
          this.logger.error(
            `CommissionLedger row missing for classified marketplace order ${String(order.id)}; reconciliation required.`
          );
          outcome = 'marketplace';
        }
      }
    }

    // Server-side classification stamp (INV-008). Always settles the field.
    order.customFields = order.customFields ?? {};
    order.customFields.orderSource = outcome;
    await this.connection.getRepository(ctx, Order).save(order);
  }

  /**
   * Decision 8: the referenced resource must be present on the final order.
   * Session refs bind to the clicked result's productVariantId (Decision 1).
   * Plan refs have no order-line representation in the commerce MVP
   * (RFC-001 C-2) and are therefore treated as absent -> direct.
   */
  private resourceInOrder(order: Order, verified: MarketplaceAttributionRef): boolean {
    if (verified.resourceType === 'session') {
      return order.lines.some((line) => String(line.productVariantId) === verified.resourceId);
    }
    return false;
  }
}