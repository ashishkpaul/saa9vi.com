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
import { JuspayPaymentAttempt } from "../entities/juspay-payment-attempt.entity";
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
  private readonly logger = Logger;

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
        this.logger.error(
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
      this.logger.error(`Subscription ${subscriptionId} not found for renewal`, loggerCtx);
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

    if (charge.status === "failed") {
        const reason = charge.errorMessage ?? "charge_initiation_failed";
        const won = await this.attemptService.recordAttemptFailure(attempt.id, reason, charge.txnId);
        if (!won) {
            // CAS lost — another writer (likely the webhook processor) already
            // moved the attempt to terminal. Re-read the attempt to determine
            // the actual outcome rather than trusting our (possibly stale) charge result.
            const currentAttempt = await this.connection.rawConnection
                .getRepository(JuspayPaymentAttempt)
                .findOne({ where: { id: attempt.id } });
            if (currentAttempt?.status === "succeeded") {
                // The webhook already won the CHARGE_SUCCEEDED CAS and owns
                // finalization — it calls finalizeAfterPayment() synchronously
                // after recording the attempt as succeeded. Returning
                // CHARGE_INITIATED prevents us from clobbering the subscription
                // with past_due. The period will be advanced by the webhook's
                // finalize call, not by us.
                this.logger.warn(
                    `Attempt ${attempt.id} CAS lost on failure-write but attempt is 'succeeded' — webhook owns finalization; returning CHARGE_INITIATED`,
                    loggerCtx,
                );
                return RenewalResult.CHARGE_INITIATED;
            } else {
                // Payment failed: subscription becomes past_due, period NOT advanced.
                await this.markSubscriptionPastDue(sub, claimedVersion);
                return RenewalResult.PAYMENT_FAILED;
            }
        } else {
            // Payment failed: subscription becomes past_due, period NOT advanced.
            await this.markSubscriptionPastDue(sub, claimedVersion);
            return RenewalResult.PAYMENT_FAILED;
        }
    }

    if (charge.status === "initiated") {
        // Charge request accepted by Juspay. Store the provider-issued
        // order ID so the webhook processor can match the incoming
        // CHARGE_SUCCEEDED/FAILED event to this attempt. The period is NOT
        // advanced here — finalization happens only after the webhook
        // confirms the debit (see finalizeAfterPayment()).
        await this.attemptService.recordProviderOrderId(attempt.id, charge.juspayOrderId);
        Logger.info(
            `Charge initiated for subscription ${sub.id} (order ${charge.juspayOrderId}) — awaiting webhook for terminal outcome`,
            loggerCtx,
        );
        return RenewalResult.CHARGE_INITIATED;
    }

    // charge.status === "succeeded" (simulation path only): the full
    // lifecycle is assumed to have succeeded. Record the attempt as
    // succeeded and proceed to finalization.
    const won = await this.attemptService.recordAttemptSuccess(attempt.id, charge.txnId);
    if (!won) {
        // The attempt already left 'initiated' (e.g. webhook raced ahead
        // and already moved it to terminal). Re-read to determine actual status.
        const currentAttempt = await this.connection.rawConnection
            .getRepository(JuspayPaymentAttempt)
            .findOne({ where: { id: attempt.id } });
        if (currentAttempt?.status === "failed") {
            // The webhook already recorded failure — follow the failure path.
            this.logger.warn(
                `Attempt ${attempt.id} CAS lost on success-write but attempt is 'failed' — webhook raced ahead, following failure path`,
                loggerCtx,
            );
            await this.markSubscriptionPastDue(sub, claimedVersion);
            return RenewalResult.PAYMENT_FAILED;
        }
        // Otherwise the attempt is 'succeeded' — another writer already
        // recorded success and owns finalization (Phase 4 FINALIZE by the
        // first worker, or finalizeAfterPayment by the webhook). The period
        // is already being advanced; we just return CHARGE_INITIATED.
        this.logger.warn(
            `Attempt ${attempt.id} for subscription ${sub.id} already left 'initiated' — another writer owns finalization`,
            loggerCtx,
        );
        return RenewalResult.CHARGE_INITIATED;
    }

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
      this.logger.error(
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
      this.logger.error(
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
   * Finalizes a subscription renewal after a successful payment reconciliation.
   * Called by the webhook processor after the attempt has been moved to
   * 'succeeded' via the shared INV-019 CAS primitive.
   *
   * This is the webhook-path equivalent of Phase 4 (FINALIZE CAS) in
   * executeRenewal(). It advances the subscription period and publishes the
   * renewal events, but ONLY if the finalize CAS wins — a lost CAS means
   * another worker already finalized, and this event is a no-op (terminal
   * protection against double-advancement).
   */
  async finalizeAfterPayment(attemptId: string): Promise<RenewalResult> {
    const attempt = await this.connection.rawConnection
        .getRepository(JuspayPaymentAttempt)
        .findOne({
            where: { id: attemptId as any },
            relations: ["subscription", "subscription.plan"],
        });

    if (!attempt) {
        this.logger.error(`Attempt ${attemptId} not found for finalization`, loggerCtx);
        return RenewalResult.SUBSCRIPTION_NOT_FOUND;
    }

    const sub = attempt.subscription;
    if (!sub) {
        this.logger.error(`Attempt ${attemptId} has no subscription — cannot finalize`, loggerCtx);
        return RenewalResult.SUBSCRIPTION_NOT_FOUND;
    }

    /**
     * The renewal worker's Phase 1 CLAIM already incremented `version` from
     * its original value to original+1. finalizeAfterPayment does NOT perform
     * its own CLAIM — it must guard on the loaded version (= original+1, the
     * already-claimed value) and advance it by one (= original+2). Using
     * `oldVersion + 1` as the guard would produce an off-by-one: the guard
     * would expect original+2 but the DB actually has original+1 (from CLAIM),
     * causing the CAS to always fail and triggering false reconciliation
     * incidents for every webhook-driven finalization.
     *
     *   Worker: CLAIM sets V→V+1, then FINALIZE sets V+1→V+2  (guard: V+1)
     *   Webhook: FINALIZE sets V+1→V+2                       (guard: V+1)
     *
     * Both paths converge on the same guard value (V+1) and the same target
     * (V+2). Only one wins; the loser gets affected=0 and records a
     * reconciliation incident.
     */
    const oldVersion = sub.version;
    const oldPeriodEnd = sub.currentPeriodEnd;

    const newPeriodStart = new Date(oldPeriodEnd);
    const newPeriodEnd = new Date(oldPeriodEnd);
    newPeriodEnd.setMonth(newPeriodEnd.getMonth() + 1);

    // FINALIZE CAS: period advancement + status, guarded on the current
    // (already-claimed) version. A lost CAS means another writer already
    // finalized — record a reconciliation incident (Step 4D).
    const finalizeResult = await this.connection.rawConnection
        .createQueryBuilder()
        .update(OrganizationSubscription)
        .set({
            version: oldVersion + 1,
            currentPeriodStart: newPeriodStart,
            currentPeriodEnd: newPeriodEnd,
            status: "active",
        })
        .where("id = :id AND version = :version", {
            id: sub.id,
            version: oldVersion,
        })
        .execute();

    if (finalizeResult.affected !== 1) {
        /**
         * DANGEROUS WINDOW HIT (Step 4D): the charge succeeded but the finalize
         * CAS lost (another worker claimed between phases, or manual state edit).
         * Money has moved; the period has not advanced. Record an operator-visible
         * reconciliation incident — never an automatic retry (that would double-charge).
         */
        await this.recordReconciliationRequired(sub, sub.channelId, attempt.invoiceId, attempt.juspayOrderId ?? "");
        this.logger.error(
            `FINALIZE CONFLICT for subscription ${sub.id}: charge ${attempt.invoiceId} succeeded but period was not advanced. MANUAL RECONCILIATION REQUIRED.`,
            loggerCtx,
        );
        return RenewalResult.CAS_CONFLICT;
    }

    // Resolve the channel for RequestContext creation (BUG-021 fix).
    const channel = await this.connection.rawConnection
        .getRepository(Channel)
        .findOne({ where: { id: sub.channelId } });

    if (!channel) {
        this.logger.error(
            `Channel ${sub.channelId} not found for subscription ${sub.id}. Renewal claimed but not executed; will retry on next scan.`,
            loggerCtx,
        );
        return RenewalResult.CHANNEL_NOT_FOUND;
    }

    const ctx = await this.requestContextService.create({
        apiType: "admin",
        channelOrToken: channel,
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
            attempt.invoiceId,
            sub.plan.monthlyPriceInPaise,
        ),
    );

    Logger.info(
        `Finalized renewal for subscription ${sub.id} for channel ${sub.channelId} (New Period: ${newPeriodStart.toISOString()} -> ${newPeriodEnd.toISOString()})`,
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
    this.logger.error(
      `Recorded RenewalPaymentReconciliationRequired for subscription ${subscription.id}, order ${juspayOrderId}, invoice ${invoiceId}`,
      loggerCtx,
    );
  }

  /**
   * Marks a subscription as past_due after a failed charge. The period is
   * NOT advanced — the next renewal scan will retry with a new attempt.
   * Uses CAS on version to avoid clobbering concurrent state changes.
   */
  private async markSubscriptionPastDue(
    subscription: OrganizationSubscription,
    claimedVersion: number,
  ): Promise<void> {
    await this.connection.rawConnection
      .createQueryBuilder()
      .update(OrganizationSubscription)
      .set({ status: "past_due" })
      .where("id = :id AND version = :version", {
        id: subscription.id,
        version: claimedVersion,
      })
      .execute();
    Logger.info(
      `Subscription ${subscription.id} (channel ${subscription.channelId}) marked past_due after failed charge`,
      loggerCtx,
    );
  }
}
