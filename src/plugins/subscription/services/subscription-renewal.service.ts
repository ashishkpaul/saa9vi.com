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
import { SubscriptionBillingAttemptService, DEFAULT_BILLING_CURRENCY } from "./subscription-billing-attempt.service";
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

    // ── ADR-044: a subscription scheduled to cancel at period end must NOT be
    // billed again. The sweep fires precisely when currentPeriodEnd passes,
    // which is exactly when the scheduled cancellation completes, so the
    // discovery predicate picks these rows up: without this branch the sweep
    // would record a NEW billing attempt for a subscription the tenant already
    // cancelled.
    //
    // Completion order is intentionally whichever-arrives-first: for
    // provider-wired rows the provider's `subscription.cancelled` webhook
    // normally lands first (markCancelledFromWebhook, CAS-guarded); this branch
    // is the idempotent safety net for webhook loss and for provider-free rows.
    //
    // NOTE: scheduled-cancel rows are deliberately LEFT IN the discovery query
    // (no `cancelAtPeriodEnd = false` exclusion there) — excluding them would
    // remove exactly this safety net and leave the local FSM dependent on
    // webhook delivery.
    if (sub.cancelAtPeriodEnd) {
      const completeResult = await this.connection.rawConnection
        .createQueryBuilder()
        .update(OrganizationSubscription)
        .set({
          status: "cancelled",
          cancelledAt: new Date(),
          cancelAtPeriodEnd: false,
          version: sub.version + 1,
        })
        .where("id = :id AND version = :version AND status != 'cancelled'", {
          id: sub.id,
          version: sub.version,
        })
        .execute();

      if (completeResult.affected === 1) {
        this.logger.info(
          `Subscription ${sub.id} (channel ${sub.channelId}): completed scheduled ` +
            `cancellation at period end (ADR-044); no billing attempt created`,
          loggerCtx,
        );
      } else {
        this.logger.info(
          `Subscription ${sub.id}: scheduled-cancellation completion lost the CAS ` +
            `(concurrent completion) — idempotent no-op`,
          loggerCtx,
        );
      }
      return RenewalResult.SUCCESS;
    }

    const oldVersion = sub.version;
    const claimedVersion = oldVersion + 1;

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
    //
    // ADR-041 G3 / uniform-NULL decision:
    // The renewal worker does NOT know the authoritative provider billing cycle
    // at initiation time — Razorpay owns recurring execution and only reveals
    // current_start / current_end in the charge webhook. A provisional local
    // date would violate INV-020 (billingPeriodStart is provider cycle identity,
    // not a local arithmetic estimate).
    //
    // billingPeriodStart = NULL  →  cycle identity unknown (awaiting webhook)
    // billingPeriodEnd   = NULL  →  (not passed → NULL by service default)
    //
    // The terminal CAS in recordAttemptSuccess() overwrites both fields with the
    // authoritative values from the webhook. The terminal CAS in
    // recordAttemptFailure() clears both fields to NULL (failed attempts without
    // a provider cycle carry NULL period, not a manufactured date).
    const invoiceId = `INV-${sub.id}-${Date.now()}`;
    const orderId = `saa9vi-${sub.id}-${Date.now()}`;

    const attempt = await this.attemptService.recordAttemptInitiated({
      subscriptionId: sub.id,
      channelId: sub.channelId,
      invoiceId,
      // ADR-041 G3 / uniform-NULL: billingPeriodStart and billingPeriodEnd are
      // intentionally omitted here. NULL is the correct value for an initiated
      // attempt — the authoritative provider cycle is only known when the
      // subscription.charged webhook arrives and the terminal CAS fires.
      // Passing a provisional local date here would violate INV-020.
      amountPaise: sub.plan.monthlyPriceInPaise,
      // No provider payload exists yet on the renewal path (Razorpay owns
      // recurring execution), so the attempt carries the platform currency.
      currency: DEFAULT_BILLING_CURRENCY,
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
   * Finalizes a subscription renewal after a successful payment reconciliation.
   * Called by the webhook processor after the attempt has been moved to
   * 'succeeded' via the shared INV-019 CAS primitive.
   *
   * ADR-041 G4/G5: reads the authoritative provider cycle from the attempt row
   * (billingPeriodStart / billingPeriodEnd, set by the webhook processor from
   * Razorpay's current_start / current_end). Passes these to finalizeRenewalPeriod()
   * which applies the cycle-monotonic CAS:
   *
   *   UPDATE … WHERE version = :v AND (currentPeriodStart IS NULL OR currentPeriodStart < :targetStart)
   *
   * This makes the finalization idempotent across any number of replays and
   * concurrent workers — only a strictly newer provider cycle can advance the
   * local state.
   *
   * Pre-G2 / missing-cycle rows (billingPeriodEnd = null):
   *   These are NOT auto-finalized. A reconciliation incident is recorded and
   *   the method returns CAS_CONFLICT so the operator can reprocess the original
   *   webhook (which will supply the provider cycle and update the attempt row).
   *   The +1-month arithmetic fallback is explicitly absent — that was the exact
   *   mechanism behind BUG B (ADR-041 option B, INV-020 prohibition).
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

    // INV-019 / INV-020: period advancement requires successful payment.
    // Guard explicitly so future callers cannot accidentally finalize a
    // failed or initiated attempt.
    if (attempt.status !== 'succeeded') {
        this.logger.error(
            `Attempt ${attemptId} has status '${attempt.status}' — finalizeAfterPayment requires 'succeeded'. ` +
                `Period NOT advanced.`,
            loggerCtx,
        );
        return RenewalResult.SUBSCRIPTION_NOT_FOUND;
    }

    const sub = attempt.subscription;
    if (!sub) {
        this.logger.error(`Attempt ${attemptId} has no subscription — cannot finalize`, loggerCtx);
        return RenewalResult.SUBSCRIPTION_NOT_FOUND;
    }

    /**
     * TERMINAL-STATE GUARD (out-of-order webhook protection).
     *
     * 'cancelled' is terminal in Saa9vi (RFC-001). A late successful-charge
     * event arriving after cancellation must not resurrect the subscription.
     * Return SUCCESS (not CAS_CONFLICT) — the charge is not a lost-CAS anomaly,
     * and the operator WARN is the signal for refund review.
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

    // ADR-041 G4: resolve target period from the attempt's provider cycle fields.
    //
    // billingPeriodEnd is present  → authoritative provider cycle from the webhook.
    // billingPeriodEnd is absent   → pre-G2 legacy attempt without authoritative cycle.
    //
    // ADR-041 policy (option B): a legacy attempt without an authoritative provider
    // cycle MUST NOT auto-finalize using +1 month arithmetic — that is the exact
    // mechanism behind BUG B. Instead, record a reconciliation incident so an
    // operator can verify the provider cycle and apply the correct period manually.
    //
    // This is safer than silently perpetuating the prohibited arithmetic for a
    // known-bounded set of legacy rows. Any initiated attempt that genuinely needs
    // finalization and lacks billingPeriodEnd must first be corrected by re-processing
    // its original webhook (which will update the attempt row with the provider cycle).
    if (!attempt.billingPeriodStart || !attempt.billingPeriodEnd) {
        Logger.error(
            `Attempt ${attemptId}: billingPeriodEnd absent — cannot finalize without authoritative ` +
                `provider cycle (ADR-041). Recording reconciliation incident. ` +
                `Re-process the original webhook to supply the provider cycle.`,
            loggerCtx,
        );
        await this.recordReconciliationRequired(
            sub,
            sub.channelId,
            attempt.invoiceId ?? `attempt-${attemptId}`,
            attempt.providerPaymentId ?? attempt.providerAttemptId ?? attemptId,
        );
        return RenewalResult.CAS_CONFLICT;
    }

    // Authoritative provider cycle.
    const newPeriodStart = new Date(attempt.billingPeriodStart);
    const newPeriodEnd   = new Date(attempt.billingPeriodEnd);
    Logger.info(
        `Attempt ${attemptId}: using authoritative provider cycle ` +
            `${attempt.billingPeriodStart} → ${attempt.billingPeriodEnd}`,
        loggerCtx,
    );

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
   * successfully charged subscription. Called by finalizeAfterPayment()
   * (async webhook-driven path).
   *
   * ADR-041 G4: cycle-monotonic CAS.
   *
   * The UPDATE only wins when the local cycle is strictly behind the target cycle:
   *
   *   WHERE id = :id
   *     AND version = :guardVersion
   *     AND (currentPeriodStart IS NULL OR currentPeriodStart < :targetStart)
   *
   * This produces the required outcome table:
   *
   *   local Sep 19 → provider Sep 20  →  advance     ✓
   *   local Sep 20 → provider Sep 20  →  no-op       ✓  (same cycle)
   *   local Nov 16 → provider Sep 20  →  no-op       ✓  (backwards)
   *   local Sep 20 → provider Oct 20  →  advance     ✓
   *
   * ADR-041 G5: bounded retry on version-only CAS loss.
   *
   * When the CAS fails, reload the subscription and classify the failure:
   *
   *   Case C — cancelled:           SUCCESS (terminal, no incident)
   *   Case B — cycle already met:   SUCCESS (idempotent replay)
   *   Case R — version changed, but target cycle still ahead of local:
   *             retry with fresh version (up to MAX_FINALIZE_RETRIES)
   *             This handles the normal concurrency case where the renewal
   *             worker's CLAIM incremented the version between our load and
   *             this UPDATE. Retrying finalization is safe — it does not
   *             initiate a new provider charge.
   *   Case A — retry exhausted or unclassifiable: record reconciliation incident.
   */
  private static readonly MAX_FINALIZE_RETRIES = 3;

  private async finalizeRenewalPeriod(
    sub: OrganizationSubscription,
    guardVersion: number,
    invoiceId: string,
    providerOrderId: string,
    newPeriodStart: Date,
    newPeriodEnd: Date,
    attempt = 0,
  ): Promise<RenewalResult> {
    // ADR-041 G4: cycle-monotonic CAS.
    const finalizeResult = await this.connection.rawConnection
      .createQueryBuilder()
      .update(OrganizationSubscription)
      .set({
        version: guardVersion + 1,
        currentPeriodStart: newPeriodStart,
        currentPeriodEnd: newPeriodEnd,
        status: "active",
      })
      .where(
        "id = :id AND version = :version AND (currentPeriodStart IS NULL OR currentPeriodStart < :targetStart)",
        {
          id: sub.id,
          version: guardVersion,
          targetStart: newPeriodStart,
        },
      )
      .execute();

    if (finalizeResult.affected === 1) {
      return this.publishFinalizeEvents(sub, invoiceId, newPeriodStart, newPeriodEnd);
    }

    // CAS failed — reload and classify.
    const reloaded = await this.connection.rawConnection
      .getRepository(OrganizationSubscription)
      .findOne({ where: { id: sub.id as any } });

    // Case C: cancelled — terminal, not an incident.
    if (reloaded && reloaded.status === "cancelled") {
      Logger.warn(
        `Subscription ${sub.id}: finalize CAS lost to a concurrent cancellation — ` +
          `period NOT advanced; review for refund/reconciliation.`,
        loggerCtx,
      );
      return RenewalResult.SUCCESS;
    }

    // ADR-041 G5 case B: cycle already satisfied — idempotent replay.
    if (reloaded && reloaded.currentPeriodStart >= newPeriodStart) {
      Logger.info(
        `Finalize replay for subscription ${sub.id}: ` +
          `currentPeriodStart (${reloaded.currentPeriodStart?.toISOString()}) ` +
          `>= targetStart (${newPeriodStart.toISOString()}) — cycle already reached, idempotent no-op`,
        loggerCtx,
      );
      return RenewalResult.SUCCESS;
    }

    // ADR-041 G5 case R: version changed but target cycle is still ahead of local.
    // This is normal concurrency — the renewal worker CLAIM or another writer
    // incremented the version between our load and this UPDATE. Retry with the
    // fresh version. Retrying is safe: no provider charge is initiated here.
    //
    // Blocking issue fix: reload with 'plan' relation so publishFinalizeEvents()
    // can access sub.plan.includedBbbMinutes / sub.plan.monthlyPriceInPaise on
    // the retry path. Without this, a CAS win on the retry attempt would fail
    // with sub.plan === undefined after the period was already advanced.
    if (reloaded && attempt < SubscriptionRenewalService.MAX_FINALIZE_RETRIES) {
      const reloadedWithPlan = await this.connection.rawConnection
        .getRepository(OrganizationSubscription)
        .findOne({ where: { id: sub.id as any }, relations: ['plan'] });
      if (!reloadedWithPlan) {
        // Subscription disappeared between the two reloads — treat as conflict.
        await this.recordReconciliationRequired(sub, sub.channelId, invoiceId, providerOrderId);
        this.logger.error(
          `FINALIZE CONFLICT for subscription ${sub.id}: subscription row not found on retry reload. MANUAL RECONCILIATION REQUIRED.`,
          loggerCtx,
        );
        return RenewalResult.CAS_CONFLICT;
      }
      Logger.info(
        `Finalize version-race for subscription ${sub.id} (attempt ${attempt + 1}/${SubscriptionRenewalService.MAX_FINALIZE_RETRIES}) — ` +
          `local currentPeriodStart (${reloadedWithPlan.currentPeriodStart?.toISOString() ?? 'null'}) < ` +
          `targetStart (${newPeriodStart.toISOString()}), retrying with version ${reloadedWithPlan.version}`,
        loggerCtx,
      );
      return this.finalizeRenewalPeriod(
        reloadedWithPlan,
        reloadedWithPlan.version,
        invoiceId,
        providerOrderId,
        newPeriodStart,
        newPeriodEnd,
        attempt + 1,
      );
    }

    // Case A: retry exhausted or no reloaded row — genuine conflict or anomaly.
    await this.recordReconciliationRequired(sub, sub.channelId, invoiceId, providerOrderId);
    this.logger.error(
      `FINALIZE CONFLICT for subscription ${sub.id}: charge ${invoiceId} succeeded but period was not advanced ` +
        `after ${attempt + 1} attempt(s). MANUAL RECONCILIATION REQUIRED.`,
      loggerCtx,
    );
    return RenewalResult.CAS_CONFLICT;
  }

  /**
   * Publish the post-finalization domain events.
   * Extracted from finalizeRenewalPeriod to keep the retry logic readable.
   *
   * P1 reliability: eventBus.publish() is awaited so that handler failures
   * surface to the caller rather than being silently swallowed. A handler
   * failure after a successful CAS is a post-finalization event-delivery gap;
   * the reconciliation incident path handles that case.
   *
   * Note: period idempotency (cycle-monotonic CAS) is fully independent of
   * event delivery. A replay via reconcileTerminalAttempt() will re-enter
   * finalizeAfterPayment() → finalizeRenewalPeriod() → here, but the CAS
   * will return case-B (cycle already satisfied) and this method will not
   * be called again. Full event-delivery recovery requires an explicit
   * outbox mechanism (tracked as P1 follow-up).
   */
  private async publishFinalizeEvents(
    subIn: OrganizationSubscription,
    invoiceId: string,
    newPeriodStart: Date,
    newPeriodEnd: Date,
  ): Promise<RenewalResult> {
    let sub = subIn;
    const channel = await this.connection.rawConnection
      .getRepository(Channel)
      .findOne({ where: { id: sub.channelId } });

    if (!channel) {
      await this.recordReconciliationRequired(sub, sub.channelId, invoiceId, sub.id as string);
      this.logger.error(
        `Channel ${sub.channelId} not found for subscription ${sub.id} AFTER finalize CAS won — ` +
          `period advanced but events not published. MANUAL RECONCILIATION REQUIRED.`,
        loggerCtx,
      );
      return RenewalResult.CHANNEL_NOT_FOUND;
    }

    // Ensure plan relation is loaded — the retry path reloads with 'plan', but
    // the first-attempt path loads from finalizeAfterPayment which includes 'plan'
    // via its findOne(relations: ['subscription', 'subscription.plan']). Defensive
    // check in case the object arrives without plan populated.
    if (!sub.plan) {
      const withPlan = await this.connection.rawConnection
        .getRepository(OrganizationSubscription)
        .findOne({ where: { id: sub.id as any }, relations: ['plan'] });
      if (!withPlan?.plan) {
        await this.recordReconciliationRequired(sub, sub.channelId, invoiceId, sub.id as string);
        this.logger.error(
          `Plan not found for subscription ${sub.id} AFTER finalize CAS won — ` +
            `period advanced but events not published. MANUAL RECONCILIATION REQUIRED.`,
          loggerCtx,
        );
        return RenewalResult.CHANNEL_NOT_FOUND;
      }
      sub = withPlan;
    }

    const ctx = await this.requestContextService.create({
      apiType: "admin",
      channelOrToken: channel,
    });

    // P1: awaited so handler failures surface to the caller.
    await this.eventBus.publish(
      new SubscriptionRenewedEvent(
        ctx,
        sub,
        sub.channelId,
        newPeriodStart,
        newPeriodEnd,
        sub.plan.includedBbbMinutes,
      ),
    );

    await this.eventBus.publish(
      new SubscriptionInvoicePaidEvent(
        ctx,
        sub,
        invoiceId,
        sub.plan.monthlyPriceInPaise,
      ),
    );

    Logger.info(
      `Finalized renewal for subscription ${sub.id} channel ${sub.channelId} ` +
        `(${newPeriodStart.toISOString()} → ${newPeriodEnd.toISOString()})`,
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
   * ADR-041 G6: cycle-identity freshness guard.
   *
   * The old guard compared currentPeriodEnd > new Date() (wall clock), which
   * is not a valid provider-cycle freshness rule. The new guard compares the
   * incoming event's provider cycle start against the locally finalized cycle:
   *
   *   providerCycleStart <= localCurrentPeriodStart
   *       → failure event is for a cycle that is already finalized (or in progress)
   *       → stale, no-op
   *
   *   providerCycleStart > localCurrentPeriodStart
   *       → failure event describes a genuinely newer unpaid cycle
   *       → eligible for past_due transition
   *
   * providerCycleStart is optional: when absent (legacy callers or non-charge
   * failure events without a cycle), the guard is skipped and the CAS proceeds.
   * This preserves the previous behaviour for events that have no cycle context.
   *
   * Uses CAS on version to avoid clobbering concurrent state changes.
   * Idempotent no-op when the subscription is already past_due/cancelled.
   *
   * The billing period is NOT advanced — dunning retry with a new attempt
   * row handles recovery.
   */
  async markPastDueFromWebhook(subscriptionId: string, providerCycleStart?: Date): Promise<void> {
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

    // ADR-041 G6: cycle-identity freshness guard.
    // A failure event whose provider cycle start is at or before the locally
    // finalized period start is stale — a successful charge for this cycle
    // has already been finalized. Only apply past_due for a genuinely newer
    // unpaid cycle.
    if (providerCycleStart && sub.currentPeriodStart) {
      if (providerCycleStart <= sub.currentPeriodStart) {
        Logger.info(
          `Subscription ${subscriptionId}: failure event cycle start ` +
            `(${providerCycleStart.toISOString()}) <= local currentPeriodStart ` +
            `(${sub.currentPeriodStart.toISOString()}) — stale failure event, skipping past_due transition`,
          loggerCtx,
        );
        return;
      }
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
