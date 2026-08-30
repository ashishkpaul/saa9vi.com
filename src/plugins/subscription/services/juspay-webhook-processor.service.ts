import { Injectable, Logger } from "@nestjs/common";
import { RequestContextService, TransactionalConnection } from "@vendure/core";
import { JuspayWebhookEvent } from "../entities/juspay-webhook-event.entity";
import { JuspaySubscriptionMandate } from "../entities/juspay-subscription-mandate.entity";
import { JuspayPaymentAttempt } from "../entities/juspay-payment-attempt.entity";
import { JuspayPaymentAttemptService } from "./juspay-payment-attempt.service";
import { SubscriptionRenewalService } from "./subscription-renewal.service";
import type { JuspayWebhookPayload } from "../types";

const loggerCtx = "JuspayWebhookProcessorService";

/**
 * Reconciliation failure. Thrown when an event cannot be matched to an
 * existing Saa9vi row with certainty. The event row is marked FAILED and
 * BullMQ retries — but the failure is never resolved by guessing or by
 * creating new financial rows (INV-019: the webhook reconciles; it does
 * not create).
 */
export class JuspayReconciliationError extends Error {}

/**
 * Juspay webhook processor.
 *
 * STATE MACHINE (per persisted event):
 *   PENDING → PROCESSING → PROCESSED
 *                       ↘ FAILED (rethrow → BullMQ retry → re-enter at
 *                         FAILED, which is treated as processable)
 *
 * IDEMPOTENCY (both layers enforced here):
 *   - PROCESSED events are no-ops (processing durability layer).
 *   - Financial transitions are guarded: charge events reconcile the
 *     EXISTING 'initiated' attempt via the provider order_id; terminal
 *     attempts are never overwritten (INV-019). Mandate FSM transitions
 *     are idempotent (same-status → no-op).
 *
 * NO SECOND PAYMENT ENGINE: this processor NEVER creates a
 * JuspayPaymentAttempt. charge_succeeded / charge_failed locate the
 * attempt created by the renewal worker. If no attempt can be matched
 * with certainty, reconciliation FAILS — it never guesses and never
 * creates.
 *
 * CHANNEL ISOLATION: reconciliation lookups use globally-unique provider
 * identifiers (juspay order_id, mandate_id) — not unscoped list queries.
 * Tenant context for any downstream work derives from the matched row's
 * own channelId; no new tenant identifier is introduced.
 */
@Injectable()
export class JuspayWebhookProcessorService {
    private readonly logger = new Logger(loggerCtx);

    constructor(
        private readonly connection: TransactionalConnection,
        private readonly ctxService: RequestContextService,
        private readonly attemptService: JuspayPaymentAttemptService,
        private readonly renewalService: SubscriptionRenewalService,
    ) {}

    async processEvent(eventId: string): Promise<void> {
        const ctx = await this.ctxService.create({ apiType: "admin" });
        const eventRepo = this.connection.getRepository(ctx, JuspayWebhookEvent);
        const event = await eventRepo.findOne({ where: { id: eventId as any } });

        if (!event) {
            this.logger.warn(`Webhook event ${eventId} not found (deleted?) — skipping`);
            return;
        }

        // Processing-durability layer: already fully processed → no-op.
        if (event.status === "PROCESSED") {
            this.logger.log(`Webhook event ${event.id} already PROCESSED — no-op`);
            return;
        }

        // PENDING, FAILED (retry), or stale PROCESSING (previous worker crash)
        // are all (re)processable. Mark PROCESSING first.
        event.status = "PROCESSING";
        await eventRepo.save(event);

        const payload = (event.payload ?? {}) as JuspayWebhookPayload;
        try {
            switch (event.eventName) {
                case "MANDATE_ACTIVATED":
                case "MANDATE_PAUSED":
                case "MANDATE_REVOKED":
                    await this.reconcileMandate(payload, event.eventName, event.channelId);
                    break;
                case "CHARGE_SUCCEEDED":
                case "CHARGE_FAILED":
                    await this.reconcileChargeAttempt(payload, event.eventName, event.channelId);
                    break;
                default:
                    // Unknown event types are persisted history, not failures.
                    this.logger.log(`Unhandled Juspay event type ${event.eventName} — marking PROCESSED (no-op)`);
            }
            event.status = "PROCESSED";
            event.processedAt = new Date();
            await eventRepo.save(event);
            this.logger.log(`Webhook event ${event.id} (${event.eventName}) PROCESSED`);
        } catch (err) {
            event.status = "FAILED";
            event.failureReason = (err as Error).message.slice(0, 500);
            await eventRepo.save(event);
            this.logger.error(`Webhook event ${event.id} FAILED: ${(err as Error).message}`, loggerCtx);
            // Rethrow so BullMQ retries; the FAILED row makes the failure
            // durable and operator-visible across attempts.
            throw err;
        }
    }

    /**
     * Mandate FSM transitions — idempotent. Lookup by provider mandate_id
     * (unique). If the mandate is already in the target state → no-op success.
     */
    private async reconcileMandate(payload: JuspayWebhookPayload, eventName: string, channelId: string): Promise<void> {
        const mandateId = payload.content?.mandate?.mandate_id;
        if (!mandateId) {
            throw new JuspayReconciliationError(`${eventName} missing content.mandate.mandate_id`);
        }

        // Channel-scoped: the event's channelId (from the tenant endpoint)
        // bounds the lookup — cross-tenant mandate ids can never match.
        const mandateRepo = this.connection.rawConnection.getRepository(JuspaySubscriptionMandate);
        const mandate = await mandateRepo.findOne({ where: { mandateId, channelId } });

        if (!mandate) {
            // Fail rather than guess: mandate may not be provisioned yet
            // (out-of-order delivery) — retry via BullMQ.
            throw new JuspayReconciliationError(`No JuspaySubscriptionMandate with mandateId=${mandateId} in channel ${channelId} for ${eventName}`);
        }

        const targetStatus = eventName === "MANDATE_ACTIVATED" ? "active" : eventName === "MANDATE_PAUSED" ? "paused" : "revoked";

        // IDEMPOTENT vs VALID (Step 3 review 🟠): an idempotent same-target
        // no-op is allowed, but ANY other transition must obey the documented
        // FSM — idempotence is not a license for invalid transitions.
        //   pending → active
        //   active  → paused | revoked
        //   paused  → active
        //   revoked → (none — terminal)
        // Anything else is a reconciliation failure (misconfigured event or
        // out-of-order provider delivery), surfaced for operator review.
        if (mandate.status === targetStatus) {
            this.logger.log(`Mandate ${mandateId} already ${targetStatus} — no-op`);
            return;
        }
        if (mandate.status === "revoked") {
            // EVENT-ORDERING POLICY (Step 4B): "revoked" is terminal. No
            // provider event can untransition a revoked mandate, so ANY
            // mandate event arriving against a revoked mandate is by
            // definition stale/out-of-order (a revoked mandate cannot be
            // re-activated, paused, or re-revoked). We therefore treat it as
            // a PROCESSED no-op — never resurrecting the mandate — while
            // logging an anomaly for operator visibility. This is codified
            // as the documented event-ordering policy for the revoked state.
            this.logger.warn(
                `Mandate ${mandateId} is revoked (terminal) — ${eventName} is stale/out-of-order; PROCESSED as no-op (event-ordering policy, Step 4B)`,
            );
            return;
        }
        if (!this.isValidMandateTransition(mandate.status as any, targetStatus)) {
            throw new JuspayReconciliationError(
                `Invalid mandate FSM transition ${mandate.status} → ${targetStatus} for mandateId=${mandateId} (${eventName})`,
            );
        }

        mandate.status = targetStatus;
        if (targetStatus === "active") mandate.activatedAt = new Date();
        if (targetStatus === "revoked") mandate.revokedAt = new Date();
        await mandateRepo.save(mandate);
        this.logger.log(`Mandate ${mandateId} → ${targetStatus}`);
    }

    /** Documented mandate FSM edge table. */
    private isValidMandateTransition(from: string, to: string): boolean {
        const edges: Record<string, string[]> = {
            pending: ["active"],
            active: ["paused", "revoked"],
            paused: ["active"],
            revoked: [],
        };
        return (edges[from] ?? []).includes(to);
    }

    /**
     * Charge reconciliation — reconciles the EXISTING 'initiated' attempt
     * matched by provider order_id. NEVER creates an attempt (INV-019).
     *
     * Trust model (Step 3 review requirement): the relationship is
     * established ONLY through provider identifiers we issued/stored
     * (juspayOrderId on the attempt) — payload-declared billing periods
     * and amounts are NOT trusted. If no initiated attempt matches, or
     * the matched attempt's subscription context cannot be verified,
     * reconciliation FAILS rather than guessing.
     */
    private async reconcileChargeAttempt(payload: JuspayWebhookPayload, eventName: string, channelId: string): Promise<void> {
        const orderId = payload.content?.order?.order_id;
        if (!orderId) {
            throw new JuspayReconciliationError(`${eventName} missing content.order.order_id`);
        }

        const attemptRepo = this.connection.rawConnection.getRepository(JuspayPaymentAttempt);
        // Channel-scoped: only attempts belonging to the event's tenant
        // channel (stamped from the endpoint at ingestion) can reconcile.
        const attempt = await attemptRepo.findOne({
            where: { juspayOrderId: orderId, status: "initiated", channelId },
            relations: ["subscription"],
        });

        if (!attempt) {
            // Distinguish: terminal attempt already exists → redelivery /
            // late duplicate → harmless no-op (terminal protection).
            const terminal = await attemptRepo.findOne({ where: { juspayOrderId: orderId, channelId } });
            if (terminal && terminal.status !== "initiated") {
                this.logger.warn(
                    `Attempt for order ${orderId} (channel ${channelId}) already terminal (${terminal.status}) — ignoring ${eventName} (terminal protection)`,
                );
                return;
            }
            // No attempt at all: fail — the webhook must not become a second
            // payment engine by creating one. Could be out-of-order delivery
            // (retry via BullMQ) or a genuinely unmatched provider event
            // (stays FAILED, operator-visible).
            throw new JuspayReconciliationError(
                `No initiated JuspayPaymentAttempt with juspayOrderId=${orderId} in channel ${channelId} for ${eventName} — reconciliation failed; NOT creating an attempt`,
            );
        }

        // Verify the matched attempt's subscription context before mutating.
        if (!attempt.subscription) {
            throw new JuspayReconciliationError(`Attempt ${attempt.id} has no subscription relation — refusing to reconcile`);
        }

        const txnId = payload.content?.order?.txn_id;
        let won: boolean;
        if (eventName === "CHARGE_SUCCEEDED") {
            won = await this.attemptService.recordAttemptSuccess(attempt.id, txnId);
        } else {
            won = await this.attemptService.recordAttemptFailure(
                attempt.id,
                payload.content?.order?.error_message ??
                    payload.content?.order?.error_code ??
                    "charge_failed_webhook",
                txnId,
            );
        }

        // Shared INV-019 CAS primitive won/lost. A lost race (won === false)
        // means another writer already moved the attempt to terminal → this
        // event is a no-op, NOT a retry and NOT a second financial write.
        if (!won) {
            this.logger.warn(
                `Attempt ${attempt.id} (order ${orderId}) already left 'initiated' — CAS no-op for ${eventName} (INV-019 terminal protection)`,
            );
            return;
        }

        this.logger.log(
            `Attempt ${attempt.id} (order ${orderId}, subscription ${attempt.subscription.id}, channel ${attempt.channelId}) → ${eventName === "CHARGE_SUCCEEDED" ? "succeeded" : "failed"}`,
        );

        // On a successful charge, finalize the subscription: advance the
        // period and publish renewal events. This is the webhook-path
        // equivalent of Phase 4 (FINALIZE CAS) in the renewal worker.
        if (eventName === "CHARGE_SUCCEEDED") {
            const result = await this.renewalService.finalizeAfterPayment(attempt.id as string);
            if (result !== "SUCCESS") {
                // finalizeAfterPayment already logs the specific failure
                // (CAS_CONFLICT → reconciliation incident recorded, etc.).
                this.logger.warn(
                    `Finalize-after-payment for attempt ${attempt.id} returned ${result} — subscription ${attempt.subscription.id} period may need manual reconciliation`,
                );
            }
        } else {
            // CHARGE_FAILED: mark the subscription past_due. The period is
            // NOT advanced — the next renewal scan will retry.
            await this.markSubscriptionPastDue(attempt);
        }
    }

    /**
     * Marks a subscription as past_due after a failed charge. The period is
     * NOT advanced — the next renewal scan will retry with a new attempt.
     */
    private async markSubscriptionPastDue(attempt: JuspayPaymentAttempt): Promise<void> {
        if (!attempt.subscription) {
            return;
        }
        await this.connection.rawConnection
            .createQueryBuilder()
            .update("organization_subscription")
            .set({ status: "past_due" })
            .where("id = :id", { id: attempt.subscription.id })
            .execute();
        this.logger.log(
            `Subscription ${attempt.subscription.id} (channel ${attempt.channelId}) marked past_due after failed charge`,
        );
    }
}
