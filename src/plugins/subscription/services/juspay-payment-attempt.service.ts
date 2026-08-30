import { Injectable } from "@nestjs/common";
import { TransactionalConnection, ID } from "@vendure/core";
import { JuspayPaymentAttempt } from "../entities/juspay-payment-attempt.entity";

/**
 * INV-019 transition primitive — the ONLY service allowed to mutate a
 * JuspayPaymentAttempt. Both the renewal worker and the webhook processor
 * use exactly these methods (Step 3 review 🟠: historically they diverged —
 * the worker used a plain repository.update while the processor used a
 * guarded CAS).
 *
 * The terminal transition (initiated → succeeded | failed) is a CASE-guarded
 * UPDATE so it wins exactly once regardless of writer:
 *
 *   UPDATE juspay_payment_attempt
 *      SET status = :target, ...
 *    WHERE id = :id AND status = 'initiated'
 *
 * A lost race (affected = 0) means another writer already moved the attempt
 * to terminal — the caller must treat that as a no-op, never a retry and
 * never a second financial write.
 *
 * Attempt rows are created here (status 'initiated') BEFORE the gateway
 * call. A retry is always a NEW row.
 */
@Injectable()
export class JuspayPaymentAttemptService {
    constructor(private readonly connection: TransactionalConnection) {}

    /**
     * Creates an 'initiated' attempt row BEFORE the Juspay call.
     */
    async recordAttemptInitiated(params: {
        subscriptionId: ID;
        channelId: string;
        invoiceId: string;
        billingPeriodStart: string; // YYYY-MM-DD
        amountPaise: number;
        juspayOrderId?: string;
    }): Promise<JuspayPaymentAttempt> {
        const repo = this.connection.rawConnection.getRepository(JuspayPaymentAttempt);
        const created = (await repo.save(
            repo.create({
                subscription: { id: params.subscriptionId } as any,
                channelId: params.channelId,
                invoiceId: params.invoiceId,
                billingPeriodStart: params.billingPeriodStart,
                amountPaise: params.amountPaise,
                status: "initiated",
                juspayOrderId: params.juspayOrderId ?? undefined,
            } as any),
        )) as unknown as JuspayPaymentAttempt;
        return Array.isArray(created) ? created[0] : created;
    }

    /**
     * Stores the provider-issued order ID on an existing attempt. Called by the
     * renewal worker after the charge request is accepted, so the webhook
     * processor can match the incoming CHARGE_SUCCEEDED/FAILED event to this
     * attempt via juspayOrderId.
     *
     * This is a metadata-only update on an attempt that is still in 'initiated'
     * state — it does NOT perform the terminal transition.
     */
    async recordProviderOrderId(attemptId: ID, juspayOrderId: string): Promise<void> {
        await this.connection.rawConnection
            .createQueryBuilder()
            .update(JuspayPaymentAttempt)
            .set({ juspayOrderId })
            .where("id = :id AND status = 'initiated'", { id: attemptId })
            .execute();
    }

    /** Guards the initiated → succeeded transition. Returns false if it lost the CAS. */
    async recordAttemptSuccess(attemptId: ID, txnId?: string): Promise<boolean> {
        return this.transition(attemptId, "succeeded", { txnId });
    }

    /** Guards the initiated → failed transition. Returns false if it lost the CAS. */
    async recordAttemptFailure(attemptId: ID, reason: string, txnId?: string): Promise<boolean> {
        return this.transition(attemptId, "failed", { txnId, failureReason: reason });
    }

    private async transition(
        attemptId: ID,
        target: "succeeded" | "failed",
        opts: { txnId?: string; failureReason?: string },
    ): Promise<boolean> {
        const result = await this.connection.rawConnection
            .createQueryBuilder()
            .update(JuspayPaymentAttempt)
            .set({
                status: target,
                juspayTransactionId: opts.txnId ?? undefined,
                failureReason: opts.failureReason ?? undefined,
            })
            .where("id = :id AND status = 'initiated'", { id: attemptId })
            .execute();
        return result.affected === 1;
    }
}