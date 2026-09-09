import { Injectable } from "@nestjs/common";
import { TransactionalConnection, ID } from "@vendure/core";
import { SubscriptionBillingAttempt } from "../entities/subscription-billing-attempt.entity";

/**
 * Provider-neutral billing attempt service.
 *
 * Replaces the old JuspayPaymentAttemptService. This is the ONLY service
 * allowed to mutate a SubscriptionBillingAttempt. Both the renewal worker
 * and the webhook processor use exactly these methods.
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
     * Stores the provider-issued payment ID on an existing attempt. Called by the
     * webhook processor to match the incoming payment event to this attempt.
     *
     * This is a metadata-only update on an attempt that is still in 'initiated'
     * state — it does NOT perform the terminal transition.
     */
    async recordProviderPaymentId(attemptId: ID, providerPaymentId: string): Promise<void> {
        await this.connection.rawConnection
            .createQueryBuilder()
            .update(SubscriptionBillingAttempt)
            .set({ providerPaymentId })
            .where("id = :id AND status = 'initiated'", { id: attemptId })
            .execute();
    }

    /** Guards the initiated → succeeded transition. Returns false if it lost the CAS. */
    async recordAttemptSuccess(attemptId: ID, providerPaymentId?: string): Promise<boolean> {
        return this.transition(attemptId, "succeeded", { providerPaymentId });
    }

    /** Guards the initiated → failed transition. Returns false if it lost the CAS. */
    async recordAttemptFailure(attemptId: ID, reason: string, providerPaymentId?: string): Promise<boolean> {
        return this.transition(attemptId, "failed", { providerPaymentId, failureReason: reason });
    }

    private async transition(
        attemptId: ID,
        target: "succeeded" | "failed",
        opts: { providerPaymentId?: string; failureReason?: string },
    ): Promise<boolean> {
        const result = await this.connection.rawConnection
            .createQueryBuilder()
            .update(SubscriptionBillingAttempt)
            .set({
                status: target,
                providerPaymentId: opts.providerPaymentId ?? undefined,
                failureReason: opts.failureReason ?? undefined,
            })
            .where("id = :id AND status = 'initiated'", { id: attemptId })
            .execute();
        return result.affected === 1;
    }
}
