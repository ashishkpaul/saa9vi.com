import { Injectable, Inject, forwardRef } from "@nestjs/common";
import {
  Channel,
  EventBus,
  Logger,
  RequestContextService,
  TransactionalConnection,
} from "@vendure/core";
import { OrganizationSubscription } from "../entities/organization-subscription.entity";
import { SubscriptionBillingAttempt } from "../entities/subscription-billing-attempt.entity";
import { RenewalPaymentReconciliationRequired } from "../entities/renewal-reconciliation-required.entity";
import { SubscriptionRenewedEvent, SubscriptionInvoicePaidEvent } from "../events/subscription.events";
import { SubscriptionRenewalQueueService } from "./subscription-renewal-queue.service";
import { SubscriptionBillingAttemptService } from "./subscription-billing-attempt.service";
import { RecurringBillingProvider } from "../providers/recurring-billing.provider";
import { RenewalResult } from "../types";
import { RECURRING_BILLING_PROVIDER } from "../constants";

const loggerCtx = "SubscriptionRenewalService";

/**
 * Handles the periodic renewal logic for organization-level SaaS subscriptions.
 * 
 * Separation of Concerns (ADR-038):
 * - processRenewals(): Discovery of pending renewals (ScheduledTask entry point).
 * - executeRenewal(): Execution of a single renewal (JobQueue worker entry point).
 *
 * Provider-neutral: depends on RecurringBillingProvider interface, not any specific provider.
 * Razorpay owns recurring execution. Saa9vi owns business state.
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
    private readonly attemptService: SubscriptionBillingAttemptService,
    @Inject(forwardRef(() => RECURRING_BILLING_PROVIDER))
    private readonly billingProvider: RecurringBillingProvider | null,
  ) {}

  /**
   * How long the discovery scan waits before considering an in-flight
   * ("initiated") charge attempt "abandoned" and re-discovering the
   * subscription for a retry charge.
   *
   * Default is 1 hour — well beyond normal provider webhook latency (seconds
   * to a few minutes). This is the subscription-billing equivalent of
   * BbbReconciliationService.stuckProvisioningTimeoutMs (5 min for BBB).
   * Configurable via SUBSCRIPTION_CHARGE_ABANDON_TIMEOUT_MS.
   */
  private get chargeAbandonmentTimeoutMs(): number {
    return Number(process.env.SUBSCRIPTION_CHARGE_ABANDON_TIMEOUT_MS ?? 3_600_000);
  }

  /**
   * Scans for subscriptions that have passed their currentPeriodEnd and
   * enqueues them for background processing.
   *
   * SCOPE NOTE: subscriptions in "past_due" are intentionally excluded —
   * recovery from past_due (dunning retry, grace-period notification,
   * eventual cancellation) is deferred to a separate dunning job per
   * RFC-001 §4.2. This scan only discovers "active"/"trialing" subscriptions
   * that need their billing period advanced or re-attempted for the
   * upcoming cycle.
   */
  async processRenewals(): Promise<{ enqueued: number; failures: number }> {
    const now = new Date();
    const chargeTimeout = new Date(now.getTime() - this.chargeAbandonmentTimeoutMs);

    /**
     * Discovery exclusion: do NOT rediscover subscriptions that already have
     * an in-flight ("initiated") charge attempt within the abandonment window.
     *
     * This prevents the 10-minute scan from re-firing a charge while a webhook
     * is still outstanding to confirm (or deny) the first one. The CLAIM CAS
     * in executeRenewal() provides the hard anti-double-charge guarantee; this
     * filter avoids unnecessary BullMQ job enqueues and misleading CAS_CONFLICT
     * log noise.
     *
     * Pattern mirrors BbbReconciliationService.reconcileProvisioning(): a
     * resource still progressing toward a terminal status within the timeout
     * is left alone; one that has exceeded the timeout is eligible for
     * re-processing (treated as abandoned).
     */
    const inFlightAttemptRows = await this.connection.rawConnection
      .getRepository(SubscriptionBillingAttempt)
      .createQueryBuilder("attempt")
      .select("DISTINCT attempt.subscriptionId", "subscriptionId")
      .where("attempt.status = :status", { status: "initiated" })
      .andWhere("attempt.attemptedAt >= :chargeTimeout", { chargeTimeout })
      .getRawMany();

    const inFlightSubIds = inFlightAttemptRows
      .map((row) => row.subscriptionId)
      .filter((id): id is string => id != null);

    let query = this.connection.rawConnection
      .getRepository(OrganizationSubscription)
      .createQueryBuilder("sub")
      .select(["sub.id"])
      .where("sub.currentPeriodEnd < :now", { now })
      .andWhere("sub.status IN (:...statuses)", {
        statuses: ["active", "trialing"],
      });

    if (inFlightSubIds.length > 0) {
      query = query.andWhere("sub.id NOT IN (:...inFlightIds)", {
        inFlightIds: inFlightSubIds,
      });
    }

    const subscriptionsToRenew = await query.getMany();

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
     *   Phase 2 ATTEMPT (INV-019): a SubscriptionBillingAttempt row records the
     *     charge attempt. In the Razorpay model, the provider owns recurring
     *     execution — Saa9vi records the attempt and waits for the webhook.
     *   Phase 3 CHARGE: NO Saa9vi-side call. Razorpay executes the recurring
     *     charge autonomously; the outcome arrives as a webhook.
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
      provider: "razorpay",
      providerAttemptId: orderId,
    });

    // Note: In the Razorpay model, charges are NOT initiated by Saa9vi.
    // This method records the attempt and waits for the provider webhook.
    // The chargeSubscription() call has been removed — Razorpay owns recurring execution.

    // Record the attempt as initiated. The webhook processor will update it
    // to succeeded/failed when the provider webhook arrives.
    Logger.info(
        `Billing attempt recorded for subscription ${sub.id} (provider attempt ${orderId}) — awaiting provider webhook for terminal outcome`,
        loggerCtx,
    );
    return RenewalResult.CHARGE_INITIATED;
  }

  /**
   * Finalizes the subscription period after confirmed payment success.
   * Called by the webhook processor (not the renewal worker) in the Razorpay model.
   * Uses CAS on version to avoid clobbering concurrent state changes.
   */

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
        .getRepository(SubscriptionBillingAttempt)
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
    /**
     * TERMINAL-STATE GUARD (out-of-order webhook protection) — the exact
     * mirror of the guard in markPastDueFromWebhook().
     *
     * Razorpay does not guarantee webhook ordering. A late successful-charge
     * event (subscription.charged / subscription.activated) can arrive AFTER
     * subscription.cancelled has already terminated the subscription:
     *
     *   subscription.cancelled → status='cancelled', version V→V+1
     *   late subscription.charged → loads version V+1 (the CURRENT version)
     *                             → CAS below WINS
     *                             → status='active'   ← RESURRECTED
     *
     * The CAS guards only on `version`, and the late event reads the version
     * that markCancelledFromWebhook() already bumped — so the CAS cannot
     * detect the ordering problem. 'cancelled' is terminal in Saa9vi
     * (RFC-001): a terminated subscription must never be silently
     * resurrected. Refuse the finalize and leave the terminal state intact.
     *
     * We return SUCCESS (not CAS_CONFLICT) deliberately: the charge itself is
     * not a lost-CAS anomaly needing an incident row, and recording one would
     * also fire on every idempotent webhook replay for a cancelled row. The
     * WARN below carries the operator signal instead (a charge that landed
     * against an already-terminated subscription may warrant a refund review).
     */
    if (sub.status === "cancelled") {
      Logger.warn(
        `Subscription ${sub.id}: finalize skipped — subscription is 'cancelled' (terminal). ` +
          `A successful-charge event arrived after cancellation (out-of-order delivery, or a charge ` +
          `against a terminated mandate). Period NOT advanced; review for refund/reconciliation.`,
        loggerCtx,
      );
      return RenewalResult.SUCCESS;
    }

    const oldVersion = sub.version;
    const oldPeriodEnd = sub.currentPeriodEnd;

    const newPeriodStart = new Date(oldPeriodEnd);
    const newPeriodEnd = new Date(oldPeriodEnd);
    newPeriodEnd.setMonth(newPeriodEnd.getMonth() + 1);

    // FINALIZE CAS: shared handler — both worker and webhook paths delegate
    // to finalizeRenewalPeriod(). The webhook path guards on the loaded
    // sub.version (= V+1 after the worker's Phase 1 CLAIM) and advances to V+2.
    return this.finalizeRenewalPeriod(
        sub,
        oldVersion,
        attempt.invoiceId,
        attempt.providerPaymentId ?? attempt.providerAttemptId ?? "",
        newPeriodStart,
        newPeriodEnd,
    );
  }

  /**
   * Shared Phase 4 FINALIZE CAS handler — advances the billing period on a
   * successfully charged subscription. Called by both:
   * - finalizeAfterPayment() (async webhook-driven path).
   *
   * WHY SHARED: the worker and webhook paths were previously duplicated here
   * line-for-line, which is exactly the drift pattern that birthed the INV-019
   * "stateful attempt record" model (see SubscriptionBillingAttemptService.transition).
   * Both call sites now delegate to this single method to guarantee identical
   * finalization semantics regardless of which writer wins the CAS.
   *
   * The caller passes `guardVersion` — the version it expects to find in the
   * DB. For the worker this is `claimedVersion` (= V+1 after Phase 1 CLAIM);
   * for the webhook this is the freshly-loaded `sub.version` (also V+1). Both
   * advance to V+2. Only one wins; the loser gets affected=0 and a
   * reconciliation incident is recorded (Step 4D).
   */
  private async finalizeRenewalPeriod(
    sub: OrganizationSubscription,
    guardVersion: number,
    invoiceId: string,
    providerOrderId: string,
    newPeriodStart: Date,
    newPeriodEnd: Date,
  ): Promise<RenewalResult> {
    const finalizeResult = await this.connection.rawConnection
      .createQueryBuilder()
      .update(OrganizationSubscription)
      .set({
        version: guardVersion + 1,
        currentPeriodStart: newPeriodStart,
        currentPeriodEnd: newPeriodEnd,
        status: "active",
      })
      .where("id = :id AND version = :version", {
        id: sub.id,
        version: guardVersion,
      })
      .execute();

    if (finalizeResult.affected !== 1) {
      /**
       * Replay-safety: distinguish "finalization already completed" from a
       * genuine lost CAS. If the period has ALREADY advanced to (or past) the
       * target end, this call is an idempotent replay of a finalize that a
       * previous writer already won (e.g. a replayed webhook after a crash
       * between terminal-attempt write and finalization) — a no-op success,
       * NOT a reconciliation incident. A concurrent writer moving the period
       * somewhere else still records the incident below.
       */
      const reloaded = await this.connection.rawConnection
        .getRepository(OrganizationSubscription)
        .findOne({ where: { id: sub.id as any } });
      /**
       * Race counterpart of the terminal-state guard above: subscription.cancelled
       * won the version CAS between our load and this update (it bumped the
       * version, so our CAS lost). Only the WRITER that lost the race can see
       * this — and a deliberate cancellation must not be reported as a
       * reconciliation incident (the charge was not lost to a bug; the
       * subscription was terminated).
       */
      if (reloaded && reloaded.status === "cancelled") {
        Logger.warn(
          `Subscription ${sub.id}: finalize CAS lost to a concurrent cancellation (status='cancelled', terminal) — ` +
            `period NOT advanced; review for refund/reconciliation.`,
          loggerCtx,
        );
        return RenewalResult.SUCCESS;
      }
      if (reloaded && reloaded.currentPeriodEnd >= newPeriodEnd) {
        Logger.info(
          `Finalize replay for subscription ${sub.id}: period already advanced to ${reloaded.currentPeriodEnd.toISOString()} — idempotent no-op`,
          loggerCtx,
        );
        return RenewalResult.SUCCESS;
      }
      /**
       * DANGEROUS WINDOW HIT (Step 4D): the charge succeeded but the finalize
       * CAS lost (another worker finalized between phases, or manual state edit).
       * Money has moved; the period has not advanced. Record an operator-visible
       * reconciliation incident — never an automatic retry (that would
       * double-charge).
       */
      await this.recordReconciliationRequired(sub, sub.channelId, invoiceId, providerOrderId);
      this.logger.error(
        `FINALIZE CONFLICT for subscription ${sub.id}: charge ${invoiceId} succeeded but period was not advanced. MANUAL RECONCILIATION REQUIRED.`,
        loggerCtx,
      );
      return RenewalResult.CAS_CONFLICT;
    }

    // Resolve the channel for RequestContext creation (BUG-021 fix):
    // create() expects a token or entity, not a raw ID.
    const channel = await this.connection.rawConnection
      .getRepository(Channel)
      .findOne({ where: { id: sub.channelId } });

    if (!channel) {
      /**
       * CRITICAL: Channel missing (INV-018 / BUG-021 class). The period WAS
       * advanced (version incremented), but the event-publishing context
       * cannot be constructed. This is a reconciliation gap — the subscription
       * is now in 'active' with an advanced period but no SubscriptionRenewedEvent
       * was emitted (so BBB minutes were not granted). The next scan will NOT
       * reprocess this (currentPeriodEnd is in the future), so this requires
       * an operator-visible reconciliation incident.
       */
      await this.recordReconciliationRequired(
        sub,
        sub.channelId,
        invoiceId,
        providerOrderId,
      );
      this.logger.error(
        `Channel ${sub.channelId} not found for subscription ${sub.id} AFTER finalize CAS won — period advanced but events not published. MANUAL RECONCILIATION REQUIRED.`,
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

    // 2. Publish Invoice Paid Event (Future-proofing for accounting/tax/provider reconciliation)
    this.eventBus.publish(
      new SubscriptionInvoicePaidEvent(
        ctx,
        sub,
        invoiceId,
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
    providerOrderId: string,
  ): Promise<void> {
    const repo = this.connection.rawConnection.getRepository(RenewalPaymentReconciliationRequired);
    await repo.save(
      repo.create({
        subscription: { id: subscription.id } as any,
        channelId,
        providerOrderId,
        invoiceId,
        status: "PENDING",
        detectedAt: new Date(),
      } as any),
    );
    this.logger.error(
      `Recorded RenewalPaymentReconciliationRequired for subscription ${subscription.id}, order ${providerOrderId}, invoice ${invoiceId}`,
      loggerCtx,
    );
  }
  /**
   * Webhook-driven failure-state bridge (R2-G).
   *
   * Maps provider failure states onto the Saa9vi subscription FSM so the
   * dunning job can discover them:
   *
   *   subscription.pending  → OrganizationSubscription.status = 'past_due'
   *   subscription.halted   → OrganizationSubscription.status = 'past_due'
   *
   * Razorpay semantics: 'pending' = payments are failing and retries are
   * in progress; 'halted' = retry threshold exhausted and the subscription
   * is suspended. Both represent dunning situations on the Saa9vi side
   * (RFC-001 §4.2) — the dunning task discovers subscriptions with
   * status = 'past_due', so WITHOUT this bridge the documented dunning
   * path has no entry point.
   *
   * Uses CAS on version to avoid clobbering concurrent state changes
   * (e.g. a concurrent successful payment finalization).
   * Idempotent no-op when the subscription is already past_due/cancelled.
   *
   * The billing period is NOT advanced — dunning retry with a new attempt
   * row handles recovery.
   */
  async markPastDueFromWebhook(subscriptionId: string): Promise<void> {
    const repo = this.connection.rawConnection.getRepository(OrganizationSubscription);
    const sub = await repo.findOne({ where: { id: subscriptionId as any } });
    if (!sub) {
      Logger.warn(`markPastDueFromWebhook: subscription ${subscriptionId} not found`, loggerCtx);
      return;
    }
    // Only active/trialing subscriptions can transition to past_due.
    if (sub.status !== "active" && sub.status !== "trialing") {
      Logger.info(
        `Subscription ${subscriptionId} status='${sub.status}' — past_due transition not applicable`,
        loggerCtx,
      );
      return;
    }
    // OUT-OF-ORDER EVENT GUARD: Razorpay does not guarantee webhook ordering.
    // A late subscription.pending/halted event can arrive AFTER a successful
    // charge already finalized a NEW period (currentPeriodEnd moved into the
    // future). A successful finalization supersedes older failure states —
    // an event describing a failed charge for a period that has since been
    // paid must not downgrade the subscription back to past_due. If a genuine
    // new failure occurs for the CURRENT period, the provider will deliver a
    // fresh pending/halted event with a newer charge attempt.
    if (sub.currentPeriodEnd > new Date()) {
      Logger.info(
        `Subscription ${subscriptionId}: currentPeriodEnd (${sub.currentPeriodEnd.toISOString()}) is in the future — ` +
          `failure-state event is OUT-OF-ORDER (stale relative to a finalized successful charge), skipping past_due transition`,
        loggerCtx,
      );
      return;
    }
    const result = await this.connection.rawConnection
      .createQueryBuilder()
      .update(OrganizationSubscription)
      .set({ status: "past_due", version: sub.version + 1 })
      .where("id = :id AND version = :version", {
        id: sub.id,
        version: sub.version,
      })
      .execute();
    if (result.affected !== 1) {
      // CAS lost: a concurrent writer (e.g. finalizeAfterPayment) changed the
      // subscription version between load and update. Treat as a no-op —
      // do NOT log success, do NOT retry (per the CAS discipline in
      // SubscriptionBillingAttemptService.transition).
      Logger.warn(
        `markPastDueFromWebhook: CAS lost for subscription ${subscriptionId} (expected version ${sub.version}) — concurrent state change, no-op`,
        loggerCtx,
      );
      return;
    }
    Logger.info(
      `Subscription ${sub.id} (channel ${sub.channelId}) marked past_due from provider webhook failure state`,
      loggerCtx,
    );
  }

  /**
   * Webhook-driven cancellation bridge (R2-G).
   *
   *   subscription.cancelled → OrganizationSubscription.status = 'cancelled'
   *
   * CAS on version; no-op if the subscription is already terminal.
   */
  async markCancelledFromWebhook(subscriptionId: string): Promise<void> {
    const repo = this.connection.rawConnection.getRepository(OrganizationSubscription);
    const sub = await repo.findOne({ where: { id: subscriptionId as any } });
    if (!sub) {
      Logger.warn(`markCancelledFromWebhook: subscription ${subscriptionId} not found`, loggerCtx);
      return;
    }
    if (sub.status === "cancelled") {
      return;
    }
    const result = await this.connection.rawConnection
      .createQueryBuilder()
      .update(OrganizationSubscription)
      .set({ status: "cancelled", version: sub.version + 1 })
      .where("id = :id AND version = :version", {
        id: sub.id,
        version: sub.version,
      })
      .execute();
    if (result.affected !== 1) {
      Logger.warn(
        `markCancelledFromWebhook: CAS lost for subscription ${subscriptionId} (expected version ${sub.version}) — concurrent state change, no-op`,
        loggerCtx,
      );
      return;
    }
    Logger.info(
      `Subscription ${sub.id} (channel ${sub.channelId}) marked cancelled from provider webhook`,
      loggerCtx,
    );
  }

  /**
   * Marks a subscription as past_due after a failed charge. The period is
   * NOT advanced — the next renewal scan will retry with a new attempt.
   * Uses CAS on version to avoid clobbering concurrent state changes.
   *
   * SCOPE NOTE: Once a subscription is past_due, processRenewals() will
   * NOT rediscover it (the discovery query filters on status IN
   * ('active','trialing')). Recovery from past_due — dunning retry schedule,
   * grace-period notification, eventual cancellation — is intentionally
   * deferred to a separate dunning job per RFC-001 §4.2. The
   * "subscription-renewal" scheduled task description mentions "dunning
   * cycles" as an aspirational target; this method does NOT implement
   * dunning. A past_due subscription stays stranded until the dunning job
   * (or an admin action) is built. This is a deliberate scope decision,
   * not an oversight.
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
