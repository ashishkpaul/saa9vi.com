import { Injectable, Inject, forwardRef } from "@nestjs/common";
import {
  Channel,
  EventBus,
  Logger,
  RequestContextService,
  TransactionalConnection,
} from "@vendure/core";
import { LessThan, In } from "typeorm";
import { OrganizationSubscription } from "../entities/organization-subscription.entity";
import { JuspaySubscriptionMandate } from "../entities/juspay-subscription-mandate.entity";
import { RenewalPaymentReconciliationRequired } from "../entities/juspay-reconciliation-required.entity";
import { SubscriptionRenewedEvent, SubscriptionInvoicePaidEvent } from "../events/subscription.events";
import { SubscriptionRenewalQueueService } from "./subscription-renewal-queue.service";
import { JuspayPaymentAttemptService } from "./juspay-payment-attempt.service";
import { JuspayBillingService } from "./juspay-billing.service";
import { RenewalResult } from "../types";

const loggerCtx = "SubscriptionRenewalService";

/**
 * Handles the periodic renewal logic for organization-level SaaS subscriptions.
 * 
 * Separation of Concerns (ADR-037):
 * - processRenewals(): Discovery of pending renewals (ScheduledTask entry point).
 * - executeRenewal(): Execution of a single renewal (JobQueue worker entry point).
 */
@Injectable()
export class SubscriptionRenewalService {
  constructor(
    private readonly connection: TransactionalConnection,
    private readonly eventBus: EventBus,
    private readonly requestContextService: RequestContextService,
    @Inject(forwardRef(() => SubscriptionRenewalQueueService))
    private readonly queueService: SubscriptionRenewalQueueService,
    private readonly attemptService: JuspayPaymentAttemptService,
    private readonly billingService: JuspayBillingService,
  ) {}

  /**
   * Scans for subscriptions that have passed their currentPeriodEnd and
   * enqueues them for background processing.
   */
  async processRenewals(): Promise<{ enqueued: number; failures: number }> {
    const now = new Date();
    
    // Find subscriptions that are due for renewal.
    const subscriptionsToRenew = await this.connection.rawConnection
      .getRepository(OrganizationSubscription)
      .find({
        where: {
          currentPeriodEnd: LessThan(now),
          status: In(["active", "trialing"]),
        },
        select: ["id"],
      });

    let enqueued = 0;
    let failures = 0;

    for (const sub of subscriptionsToRenew) {
      try {
        await this.queueService.addRenewalJob(sub.id as string);
        enqueued++;
      } catch (err: any) {
        failures++;
        Logger.error(
          `Failed to enqueue renewal for subscription ${sub.id}: ${err.message}`,
          loggerCtx,
        );
      }
    }

    return { enqueued, failures };
  }

  /**
   * Executes the actual renewal for a single subscription.
   * Called by the BullMQ worker.
   */
  async executeRenewal(subscriptionId: string): Promise<RenewalResult> {
    const sub = await this.connection.rawConnection
      .getRepository(OrganizationSubscription)
      .findOne({
        where: { id: subscriptionId },
        relations: ["plan"],
      });

    if (!sub) {
      Logger.error(`Subscription ${subscriptionId} not found for renewal`, loggerCtx);
      return RenewalResult.SUBSCRIPTION_NOT_FOUND;
    }

    const oldVersion = sub.version;
    const claimedVersion = oldVersion + 1;
    const oldPeriodEnd = sub.currentPeriodEnd;
    
    // Default to a 1-month billing cycle.
    const newPeriodStart = new Date(oldPeriodEnd);
    const newPeriodEnd = new Date(oldPeriodEnd);
    newPeriodEnd.setMonth(newPeriodEnd.getMonth() + 1);

    /**
     * STATE MODEL (corrected in Step 2 review — do NOT regress):
     *
     *   Phase 1 CLAIM CAS (INV-017): establishes ownership of this renewal
     *     attempt ONLY. Period is NOT advanced here — period advancement is
     *     NOT equivalent to successful payment.
     *   Phase 2 ATTEMPT (INV-019): a JuspayPaymentAttempt row records the
     *     charge attempt BEFORE the gateway call.
     *   Phase 3 CHARGE: the Juspay call (currently simulated).
     *   Phase 4 FINALIZE CAS: period advancement + status, guarded on the
     *     claimed version, ONLY after payment success.
     *
     * A worker crash after Phase 1 is safe: the period is untouched, the
     * next scan re-reads (new version) and retries cleanly. A crash after a
     * successful Phase 3 but before Phase 4 is the one dangerous window —
     * it is detected by the finalize CAS conflict and logged for manual
     * reconciliation (charge happened, period did not advance).
     */
    const claimResult = await this.connection.rawConnection
      .createQueryBuilder()
      .update(OrganizationSubscription)
      .set({
        version: claimedVersion,
      })
      .where("id = :id AND version = :version", {
        id: sub.id,
        version: oldVersion,
      })
      .execute();

    if (claimResult.affected !== 1) {
      // Another worker already claimed this renewal.
      return RenewalResult.CAS_CONFLICT;
    }

    // Phase 2 — ATTEMPT record (INV-019 stateful attempt semantics).
    const billingPeriodStart = newPeriodStart.toISOString().slice(0, 10);
    const invoiceId = `INV-${sub.id}-${billingPeriodStart}`;
    const orderId = `saa9vi-${sub.id}-${billingPeriodStart}`;

    const attempt = await this.attemptService.recordAttemptInitiated({
      subscriptionId: sub.id,
      channelId: sub.channelId,
      invoiceId,
      billingPeriodStart,
      amountPaise: sub.plan.monthlyPriceInPaise,
      juspayOrderId: orderId,
    });

    // Resolve the current active mandate for the charge (channel-scoped).
    const mandate = await this.connection.rawConnection
      .getRepository(JuspaySubscriptionMandate)
      .findOne({
        where: { channelId: sub.channelId, status: "active", subscription: { id: sub.id } as any },
      });

    /**
     * Phase 3 — CHARGE (INV-019). The Juspay call is isolated inside
     * JuspayBillingService; the renewal worker only sees JuspayChargeResult.
     * When no billing credentials are configured this simulates success
     * (clearly logged), so the state machine still runs in dev/sandbox.
     */
    const charge = await this.billingService.chargeSubscription({
      subscriptionId: sub.id,
      channelId: sub.channelId,
      juspayCustomerId: mandate?.juspayCustomerId ?? "",
      mandateId: mandate?.mandateId ?? "",
      invoiceId,
      amountPaise: sub.plan.monthlyPriceInPaise,
      orderId,
    });

    if (!charge.ok) {
      const reason = charge.errorMessage ?? "charge_failed";
      await this.attemptService.recordAttemptFailure(attempt.id, reason, charge.txnId);
      // Payment failed: subscription becomes past_due, period NOT advanced.
      await this.connection.rawConnection
        .createQueryBuilder()
        .update(OrganizationSubscription)
        .set({ status: "past_due" })
        .where("id = :id AND version = :version", {
          id: sub.id,
          version: claimedVersion,
        })
        .execute();
      return RenewalResult.PAYMENT_FAILED;
    }

    // Terminal attempt result (shared INV-019 CAS primitive).
    await this.attemptService.recordAttemptSuccess(attempt.id, charge.txnId);

    // Phase 4 — FINALIZE CAS: period advancement ONLY on payment success.
    const finalizeResult = await this.connection.rawConnection
      .createQueryBuilder()
      .update(OrganizationSubscription)
      .set({
        version: claimedVersion + 1,
        currentPeriodStart: newPeriodStart,
        currentPeriodEnd: newPeriodEnd,
        status: "active",
      })
      .where("id = :id AND version = :version", {
        id: sub.id,
        version: claimedVersion,
      })
      .execute();

    if (finalizeResult.affected !== 1) {
      /**
       * DANGEROUS WINDOW HIT (Step 4D): the charge succeeded but the finalize
       * CAS lost (another worker claimed between phases, or manual state edit).
       * Money has moved; the period has not advanced. Record an operator-visible
       * reconciliation incident — never an automatic retry (that would double-charge).
       */
      await this.recordReconciliationRequired(sub, sub.channelId, invoiceId, charge.juspayOrderId);
      Logger.error(
        `FINALIZE CONFLICT for subscription ${sub.id}: charge ${invoiceId} succeeded but period was not advanced. MANUAL RECONCILIATION REQUIRED.`,
        loggerCtx,
      );
      return RenewalResult.CAS_CONFLICT;
    }

    // Fix BUG-021-style channel resolution: create() expects token or entity, not raw ID.
    const channel = await this.connection.rawConnection
      .getRepository(Channel)
      .findOne({ where: { id: sub.channelId } });

    if (!channel) {
      /**
       * CRITICAL: Channel missing (INV-018 / BUG-021 class).
       * Ownership was claimed but the period has NOT advanced and no charge
       * was made — the next scan will retry cleanly with the new version.
       */
      Logger.error(
        `Channel ${sub.channelId} not found for subscription ${sub.id}. Renewal claimed but not executed; will retry on next scan.`,
        loggerCtx,
      );
      return RenewalResult.CHANNEL_NOT_FOUND;
    }

    const ctx = await this.requestContextService.create({
      apiType: "admin",
      channelOrToken: channel, // Passing the entity is safe and avoids token-lookup failure
    });

    // 1. Publish Renewed Event (Triggers BbbSubscriptionListener → minutes grant)
    this.eventBus.publish(
      new SubscriptionRenewedEvent(
        ctx,
        sub,
        sub.channelId,
        newPeriodStart,
        newPeriodEnd,
        sub.plan.includedBbbMinutes,
      ),
    );

    // 2. Publish Invoice Paid Event (Future-proofing for accounting/tax/Juspay reconciliation)
    this.eventBus.publish(
      new SubscriptionInvoicePaidEvent(
        ctx,
        sub,
        invoiceId,
        sub.plan.monthlyPriceInPaise,
      ),
    );

    Logger.info(
      `Renewed subscription ${sub.id} for channel ${sub.channelId} (New Period: ${newPeriodStart.toISOString()} -> ${newPeriodEnd.toISOString()})`,
      loggerCtx,
    );

    return RenewalResult.SUCCESS;
  }

  /**
   * Records an operator-visible reconciliation incident (Step 4D) for the
   * charge-succeeded-but-period-not-finalized window. Append-only.
   */
  private async recordReconciliationRequired(
    subscription: OrganizationSubscription,
    channelId: string,
    invoiceId: string,
    juspayOrderId: string,
  ): Promise<void> {
    const repo = this.connection.rawConnection.getRepository(RenewalPaymentReconciliationRequired);
    await repo.save(
      repo.create({
        subscription: { id: subscription.id } as any,
        channelId,
        juspayOrderId,
        invoiceId,
        status: "PENDING",
        detectedAt: new Date(),
      }),
    );
    Logger.error(
      `Recorded RenewalPaymentReconciliationRequired for subscription ${subscription.id}, order ${juspayOrderId}, invoice ${invoiceId}`,
      loggerCtx,
    );
  }
}
