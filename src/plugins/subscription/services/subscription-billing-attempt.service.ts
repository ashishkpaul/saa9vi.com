import { Injectable, Logger } from "@nestjs/common";
import { TransactionalConnection, ID } from "@vendure/core";
import { SubscriptionBillingAttempt, BillingAttemptStatus } from "../entities/subscription-billing-attempt.entity";

const loggerCtx = "SubscriptionBillingAttemptService";

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
    }): Promise<SubscriptionBillingAttempt> {
        const repo = this.connection.rawConnection.getRepository(SubscriptionBillingAttempt);
        const created = (await repo.save(
            repo.create({
                subscription: { id: params.subscriptionId } as any,
                channelId: params.channelId,
                invoiceId: params.invoiceId,
                billingPeriodStart: params.billingPeriodStart,
                amountPaise: params.amountPaise,
                provider: params.provider,
                providerSubscriptionId: params.providerSubscriptionId,
                providerAttemptId: params.providerAttemptId,
                status: "initiated",
            } as any),
        )) as unknown as SubscriptionBillingAttempt;
        return Array.isArray(created) ? created[0] : created;
    }

    /**
     * Stores provider-issued identifiers on an existing attempt. Called by the
     * webhook processor to match the incoming payment event to this attempt.
     *
     * providerEventId/providerInvoiceId are persisted here so that the
     * renewal-created → webhook-reconciled path produces a COMPLETE ledger
     * fact, identical in provenance to the webhook-only path (where
     * recordAttemptFromWebhook stores them at creation time).
     *
     * This is a metadata-only update on an attempt that is still in 'initiated'
     * state — it does NOT perform the terminal transition.
     */
    async recordProviderPaymentId(
        attemptId: ID,
        providerPaymentId: string,
        providerEventId?: string,
        providerInvoiceId?: string,
    ): Promise<void> {
        await this.connection.rawConnection
            .createQueryBuilder()
            .update(SubscriptionBillingAttempt)
            .set({
                providerPaymentId,
                ...(providerEventId ? { providerEventId } : {}),
                ...(providerInvoiceId ? { providerInvoiceId } : {}),
            })
            .where("id = :id AND status = 'initiated'", { id: attemptId })
            .execute();
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
     * Reconciliation lookup for the webhook processor.
     *
     * Finds an 'initiated' attempt created by the renewal worker for the
     * given provider subscription ID, so the webhook can transition it
     * to its terminal state via the CAS-guarded methods above.
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
