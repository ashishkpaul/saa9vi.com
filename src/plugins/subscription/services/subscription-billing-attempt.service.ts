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
 * ADR-041 G3: the terminal transition also reconciles billingPeriodStart and
 * billingPeriodEnd to the authoritative provider cycle values. The attempt row
 * is the durable carrier of the provider cycle — finalizeAfterPayment() reads
 * it from here on every replay without needing the original webhook payload.
 *
 * Attempt rows are created here (status 'initiated') BEFORE the provider
 * call. A retry is always a NEW row.
 */
@Injectable()
export class SubscriptionBillingAttemptService {
    constructor(private readonly connection: TransactionalConnection) {}

    /**
     * Creates an 'initiated' attempt row BEFORE the provider call.
     *
     * ADR-041 G3 / uniform-NULL decision:
     * billingPeriodStart and billingPeriodEnd are both optional. The renewal
     * worker MUST NOT pass a provisional local date for billingPeriodStart —
     * the authoritative provider cycle (current_start / current_end) is only
     * known when the charge webhook arrives. Passing undefined stores NULL,
     * which is the correct initiated-row semantics: "cycle identity unknown,
     * awaiting provider webhook."
     *
     * The terminal CAS in recordAttemptSuccess() writes the authoritative
     * billingPeriodStart + billingPeriodEnd from the webhook. The terminal CAS
     * in recordAttemptFailure() writes NULL for both when no provider cycle is
     * available (uniform NULL for failed attempts without cycle identity).
     */
    async recordAttemptInitiated(params: {
        subscriptionId: ID;
        channelId: string;
        invoiceId: string;
        /** YYYY-MM-DD, UTC. Optional: pass undefined for NULL (awaiting provider cycle). */
        billingPeriodStart?: string;
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
                // billingPeriodEnd intentionally null — unknown until the provider webhook
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

    /**
     * Guards the initiated → succeeded transition.
     *
     * ADR-041 G3: also reconciles billingPeriodStart and billingPeriodEnd to
     * the authoritative provider cycle inside the same atomic CAS UPDATE.
     * The attempt row then carries the durable provider cycle for replay.
     *
     * Returns false if it lost the CAS (another writer already transitioned).
     */
    async recordAttemptSuccess(
        attemptId: ID,
        providerPaymentId?: string,
        providerEventId?: string,
        providerInvoiceId?: string,
        billingPeriodStart?: string,
        billingPeriodEnd?: string,
    ): Promise<boolean> {
        return this.transition(attemptId, "succeeded", {
            providerPaymentId,
            providerEventId,
            providerInvoiceId,
            billingPeriodStart,
            billingPeriodEnd,
        });
    }

    /**
     * Guards the initiated → failed transition.
     *
     * ADR-041 G3 / INV-020 (decided): billingPeriodStart semantics for failures.
     *
     * Three cases:
     *   1. Provider cycle present (billingPeriodStart + billingPeriodEnd supplied):
     *      overwrite inside the CAS — the attempt carries the authoritative cycle.
     *   2. Provider cycle absent (nothing supplied):
     *      clear both period fields to NULL — the attempt is a failure record
     *      without cycle identity. Preserving the worker's provisional estimate
     *      would leave the field with a value that does not represent a provider
     *      cycle, contradicting INV-020's definition.
     *
     * This makes `billingPeriodStart` uniformly either:
     *   - NULL      → cycle identity unknown / not applicable
     *   - YYYY-MM-DD → authoritative provider cycle (succeeded) or confirmed
     *                  provider cycle (failed with known cycle)
     *
     * Returns false if it lost the CAS.
     */
    async recordAttemptFailure(
        attemptId: ID,
        reason: string,
        providerPaymentId?: string,
        providerEventId?: string,
        providerInvoiceId?: string,
        billingPeriodStart?: string,
        billingPeriodEnd?: string,
    ): Promise<boolean> {
        return this.transition(attemptId, "failed", {
            providerPaymentId,
            providerEventId,
            providerInvoiceId,
            failureReason: reason,
            billingPeriodStart,
            billingPeriodEnd,
        });
    }

    private async transition(
        attemptId: ID,
        target: "succeeded" | "failed",
        opts: {
            providerPaymentId?: string;
            failureReason?: string;
            providerEventId?: string;
            providerInvoiceId?: string;
            /**
             * ADR-041 G3 / INV-020: authoritative provider cycle start (YYYY-MM-DD).
             * For succeeded transitions: always present (caller asserted cycle).
             * For failed transitions with known cycle: present.
             * For failed transitions without cycle: undefined → set to NULL (see below).
             */
            billingPeriodStart?: string;
            /** ADR-041 G3 / INV-020: authoritative provider cycle end (YYYY-MM-DD). */
            billingPeriodEnd?: string;
        },
    ): Promise<boolean> {
        const setClause: Record<string, any> = {
            status: target,
            providerPaymentId: opts.providerPaymentId ?? undefined,
            failureReason: opts.failureReason ?? undefined,
        };

        if (opts.providerEventId) {
            setClause['providerEventId'] = opts.providerEventId;
        }
        if (opts.providerInvoiceId) {
            setClause['providerInvoiceId'] = opts.providerInvoiceId;
        }

        // ADR-041 G3 / INV-020: period identity inside the terminal CAS.
        //
        // Succeeded path: billingPeriodStart is always supplied (assertProviderCyclePresent
        //   enforced it before reaching here). Overwrite unconditionally.
        //
        // Failed path with provider cycle: billingPeriodStart/End both supplied.
        //   Overwrite — the attempt carries the confirmed provider failure cycle.
        //
        // Failed path without provider cycle: both are undefined.
        //   Explicitly NULL both fields. INV-020 defines billingPeriodStart as
        //   cycle identity, not a provisional estimate. Leaving the worker's
        //   provisional value in a terminal failed row would produce a field
        //   value that does not represent an authoritative provider cycle.
        if (target === 'failed' && !opts.billingPeriodStart) {
            // Clear both period fields — no authoritative cycle for this failure.
            setClause['billingPeriodStart'] = null;
            setClause['billingPeriodEnd'] = null;
        } else {
            if (opts.billingPeriodStart) {
                setClause['billingPeriodStart'] = opts.billingPeriodStart;
            }
            if (opts.billingPeriodEnd) {
                setClause['billingPeriodEnd'] = opts.billingPeriodEnd;
            }
        }

        const result = await this.connection.rawConnection
            .createQueryBuilder()
            .update(SubscriptionBillingAttempt)
            .set(setClause)
            .where("id = :id AND status = 'initiated'", { id: attemptId })
            .execute();
        return result.affected === 1;
    }

    /**
     * Lookup by provider + provider event ID (any status).
     *
     * Provider-qualified to match the UNIQUE(provider, providerEventId) index
     * and the provider-neutral architecture contract. The application lookup
     * identity must be identical to the database identity.
     *
     * Used by the webhook processor's replay boundary: a TERMINAL attempt
     * carrying this event ID does NOT by itself mean "done" — for a
     * 'succeeded' attempt the finalization may not have completed (crash
     * between terminal write and finalize). The processor must replay the
     * finalize in that case rather than short-circuiting.
     */
    async findAttemptByProviderEventId(
        provider: string,
        providerEventId: string,
    ): Promise<SubscriptionBillingAttempt | null> {
        if (!providerEventId) return null;
        const repo = this.connection.rawConnection.getRepository(SubscriptionBillingAttempt);
        return await repo.findOne({
            where: { provider, providerEventId },
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
     * reconciled first.
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
     * ADR-041 G3: billingPeriodEnd is now accepted and stored. This path is
     * used when no 'initiated' attempt was pre-created by the renewal worker
     * (e.g. the Razorpay 'subscription.activated' initial-payment event that
     * fires outside the renewal scan window).
     */
    async recordAttemptFromWebhook(params: {
        subscriptionId: ID;
        channelId: string;
        invoiceId: string;
        /**
         * Provider billing-cycle start (YYYY-MM-DD, UTC).
         * NULL for failed webhook-only attempts that carry no provider cycle
         * (INV-020: the field is cycle identity, not a generic audit timestamp).
         */
        billingPeriodStart?: string;
        /** ADR-041 G3: provider cycle end date (YYYY-MM-DD). */
        billingPeriodEnd?: string;
        amountPaise: number;
        /**
         * ISO-4217 currency from the provider payload. Required by the NOT NULL
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
                billingPeriodEnd: params.billingPeriodEnd ?? null,
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
