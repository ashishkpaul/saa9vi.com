import { Injectable, Logger } from "@nestjs/common";
import { TransactionalConnection, ID } from "@vendure/core";
import { SubscriptionBillingAttempt, BillingAttemptStatus } from "../entities/subscription-billing-attempt.entity";

const loggerCtx = "SubscriptionBillingAttemptService";

/**
 * Fallback currency for billing attempts.
 *
 * `subscription_billing_attempt.currency` is NOT NULL, so EVERY insert path
 * must supply a value. The provider payload is authoritative when present
 * (Razorpay carries `payload.payment.entity.currency`). The renewal worker
 * records an attempt BEFORE the provider charge exists, so no provider
 * currency is available on that path and this platform default applies.
 */
export const DEFAULT_BILLING_CURRENCY = "INR";

/**
 * Provider-neutral billing attempt service.
 *
 * This is the ONLY service allowed to mutate a SubscriptionBillingAttempt.
 * Both the renewal worker and the webhook processor use exactly these methods.
 *
 * The terminal transition (initiated → succeeded | failed) is a CAS-guarded
 * UPDATE so it wins exactly once regardless of writer:
 *
 *   UPDATE subscription_billing_attempt
 *      SET status = :target, ...
 *    WHERE id = :id AND status = 'initiated'
 *
 * A lost race (affected = 0) means another writer already moved the attempt
 * to terminal — the caller must treat that as a no-op, never a retry and
 * never a second financial write.
 *
 * Attempt rows are created here (status 'initiated') BEFORE the provider
 * call. A retry is always a NEW row.
 */
@Injectable()
export class SubscriptionBillingAttemptService {
    constructor(private readonly connection: TransactionalConnection) {}

    /**
     * Creates an 'initiated' attempt row BEFORE the provider call.
     */
    async recordAttemptInitiated(params: {
        subscriptionId: ID;
        channelId: string;
        invoiceId: string;
        billingPeriodStart: string; // YYYY-MM-DD
        amountPaise: number;
        provider: string;
        providerSubscriptionId?: string;
        providerAttemptId?: string;
        /** ISO-4217 currency. Required by the NOT NULL column; defaults to INR. */
        currency?: string;
    }): Promise<SubscriptionBillingAttempt> {
        const repo = this.connection.rawConnection.getRepository(SubscriptionBillingAttempt);
        const created = (await repo.save(
            repo.create({
                subscription: { id: params.subscriptionId } as any,
                channelId: params.channelId,
                invoiceId: params.invoiceId,
                billingPeriodStart: params.billingPeriodStart,
                amountPaise: params.amountPaise,
                currency: params.currency ?? DEFAULT_BILLING_CURRENCY,
                provider: params.provider,
                providerSubscriptionId: params.providerSubscriptionId,
                providerAttemptId: params.providerAttemptId,
                status: "initiated",
            } as any),
        )) as unknown as SubscriptionBillingAttempt;
        return Array.isArray(created) ? created[0] : created;
    }

    /** Guards the initiated → succeeded transition. Returns false if it lost the CAS. */
    async recordAttemptSuccess(
        attemptId: ID,
        providerPaymentId?: string,
        providerEventId?: string,
        providerInvoiceId?: string,
    ): Promise<boolean> {
        return this.transition(attemptId, "succeeded", {
            providerPaymentId,
            providerEventId,
            providerInvoiceId,
        });
    }

    /** Guards the initiated → failed transition. Returns false if it lost the CAS. */
    async recordAttemptFailure(
        attemptId: ID,
        reason: string,
        providerPaymentId?: string,
        providerEventId?: string,
        providerInvoiceId?: string,
    ): Promise<boolean> {
        return this.transition(attemptId, "failed", {
            providerPaymentId,
            providerEventId,
            providerInvoiceId,
            failureReason: reason,
        });
    }

    private async transition(
        attemptId: ID,
        target: "succeeded" | "failed",
        opts: { providerPaymentId?: string; failureReason?: string; providerEventId?: string; providerInvoiceId?: string },
    ): Promise<boolean> {
        const result = await this.connection.rawConnection
            .createQueryBuilder()
            .update(SubscriptionBillingAttempt)
            .set({
                status: target,
                providerPaymentId: opts.providerPaymentId ?? undefined,
                ...(opts.providerEventId ? { providerEventId: opts.providerEventId } : {}),
                ...(opts.providerInvoiceId ? { providerInvoiceId: opts.providerInvoiceId } : {}),
                failureReason: opts.failureReason ?? undefined,
            })
            .where("id = :id AND status = 'initiated'", { id: attemptId })
            .execute();
        return result.affected === 1;
    }

    /**
     * Lookup by provider event ID (any status).
     *
     * Used by the webhook processor's replay boundary: a TERMINAL attempt
     * carrying this event ID does NOT by itself mean "done" — for a
     * 'succeeded' attempt the finalization may not have completed (crash
     * between terminal write and finalize). The processor must replay the
     * finalize in that case rather than short-circuiting.
     */
    async findAttemptByProviderEventId(providerEventId: string): Promise<SubscriptionBillingAttempt | null> {
        if (!providerEventId) return null;
        const repo = this.connection.rawConnection.getRepository(SubscriptionBillingAttempt);
        return await repo.findOne({
            where: { providerEventId },
            relations: ["subscription"],
        });
    }

    /**
     * Reconciliation lookup for the webhook processor.
     *
     * Finds the 'initiated' attempt created by the renewal worker for the
     * given provider subscription ID, so the webhook can transition it
     * to its terminal state via the CAS-guarded methods above.
     *
     * DETERMINISM: retries legitimately create multiple initiated rows for
     * the same (channelId, providerSubscriptionId). The lookup is therefore
     * FIFO-ordered on attemptedAt — the OLDEST unresolved charge attempt is
     * reconciled first. This makes reconciliation deterministic instead of
     * depending on whichever row the database happens to return. Cross-period
     * correctness is enforced downstream: Razorpay's invoice_id (which is a
     * provider identifier, NOT our local INV-* id) is persisted on the
     * attempt for provenance, and finalizeAfterPayment's CAS guarantees the
     * period advances exactly once regardless of which attempt wins.
     *
     * INV-019: only 'initiated' attempts are returned — terminal results
     * are never overwritten.
     */
    async findInitiatedAttemptByProviderSubscriptionId(
        channelId: string,
        providerSubscriptionId: string,
    ): Promise<SubscriptionBillingAttempt | null> {
        const repo = this.connection.rawConnection.getRepository(SubscriptionBillingAttempt);
        return await repo.findOne({
            where: {
                channelId,
                providerSubscriptionId,
                status: "initiated",
            },
            order: { attemptedAt: "ASC" },
            relations: ["subscription"],
        });
    }

    /**
     * Reconciliation lookup by provider payment ID.
     *
     * Returns an attempt (in any state) that already carries the given
     * provider-issued payment ID. Used by the webhook processor to detect
     * duplicate deliveries — if a terminal attempt already exists for this
     * payment ID, the webhook's recordAttempt is a safe no-op.
     */
    async findAttemptByProviderPaymentId(
        channelId: string,
        providerPaymentId: string,
    ): Promise<SubscriptionBillingAttempt | null> {
        const repo = this.connection.rawConnection.getRepository(SubscriptionBillingAttempt);
        return await repo.findOne({
            where: {
                channelId,
                providerPaymentId,
            },
            relations: ["subscription"],
        });
    }

    /**
     * Direct terminal-attempt creation from the webhook processor.
     *
     * This path is used when the webhook carries a charge event for which
     * no 'initiated' attempt was pre-created by the renewal worker — e.g.
     * the Razorpay 'subscription.activated' initial-payment event that
     * fires outside the renewal scan window.
     *
     * The attempt is created directly in its terminal state with all
     * provider identifiers populated, so downstream reconciliation
     * (by providerPaymentId or providerEventId) succeeds on replay.
     */
    async recordAttemptFromWebhook(params: {
        subscriptionId: ID;
        channelId: string;
        invoiceId: string;
        billingPeriodStart: string;
        amountPaise: number;
        /**
         * ISO-4217 currency from the provider payload
         * (`payload.payment.entity.currency`). Required by the NOT NULL
         * column; defaults to INR when the provider omits it.
         */
        currency?: string;
        provider: string;
        providerSubscriptionId: string;
        providerPaymentId?: string;
        providerInvoiceId?: string;
        providerEventId?: string;
        status: BillingAttemptStatus;
        failureReason?: string;
    }): Promise<SubscriptionBillingAttempt> {
        const repo = this.connection.rawConnection.getRepository(SubscriptionBillingAttempt);
        const created = (await repo.save(
            repo.create({
                subscription: { id: params.subscriptionId } as any,
                channelId: params.channelId,
                invoiceId: params.invoiceId,
                billingPeriodStart: params.billingPeriodStart,
                amountPaise: params.amountPaise,
                currency: params.currency ?? DEFAULT_BILLING_CURRENCY,
                provider: params.provider,
                providerSubscriptionId: params.providerSubscriptionId,
                providerPaymentId: params.providerPaymentId,
                providerInvoiceId: params.providerInvoiceId,
                providerEventId: params.providerEventId,
                status: params.status,
                failureReason: params.failureReason,
            } as any),
        )) as unknown as SubscriptionBillingAttempt;
        return Array.isArray(created) ? created[0] : created;
    }
}
