import type { DeepPartial } from "@vendure/common/lib/shared-types";
import { VendureEntity } from "@vendure/core";
import { Column, CreateDateColumn, Entity, Index, ManyToOne } from "typeorm";
import { OrganizationSubscription } from "./organization-subscription.entity";

export type JuspayPaymentAttemptStatus = "initiated" | "succeeded" | "failed";

/**
 * Ledger of Juspay charge attempts (INV-002 pattern; INV-019 semantics —
 * "stateful attempt record" model, decided in review of Step 2):
 *
 *   1. Every payment attempt is an independently recorded financial fact.
 *   2. A retry is a NEW row — never a mutation of an existing row's
 *      terminal result by another attempt.
 *   3. The ONLY permitted mutation is the single lifecycle transition
 *      'initiated' → 'succeeded' | 'failed', performed exclusively by
 *      the tightly-scoped attempt-recording service (never via generic
 *      repository.save() on a loaded row, and never exposed on any API).
 *
 * This is deliberately NOT "physically immutable from insert" — the
 * initiated → terminal transition is inherent to the model. What is
 * forbidden is overwriting terminal results, rewriting history, or
 * collapsing retries into an existing row.
 *
 * Ties to SubscriptionInvoicePaidEvent's invoiceId. Amounts are stored in
 * paise (Juspay minor units) — never rupees — to avoid float rounding.
 *
 * CHANNEL ISOLATION: carries a denormalized scalar channelId (ADR-003
 * scalar-only exception, cf. BbbUsageLedger) so ledger queries never need
 * to reach through the subscription relation for tenant scoping. An admin
 * ledger query MUST filter on channelId (or join the subscription's
 * channel) — a bare repository.find() is a channel-isolation bug of the
 * BUG-031 class. The row is immutable financial history: FK to
 * organization_subscription is NO ACTION on delete by design.
 */
@Entity("juspay_payment_attempt")
@Index(["channelId"])
@Index(["subscription", "attemptedAt"])
@Index(["juspayTransactionId"])
export class JuspayPaymentAttempt extends VendureEntity {
    constructor(input?: DeepPartial<JuspayPaymentAttempt>) {
        super(input);
    }

    @ManyToOne(() => OrganizationSubscription, { nullable: false })
    subscription: OrganizationSubscription;

    /**
     * Denormalized tenant scope (ADR-003 scalar-only exception). Copied from
     * OrganizationSubscription.channelId at insert; NEVER updated.
     */
    @Column()
    channelId: string;

    /** Invoice this attempt bills (matches SubscriptionInvoicePaidEvent.invoiceId). */
    @Column()
    invoiceId: string;

    /** Billing period this attempt covers, ISO date (e.g. '2026-08-01'). Part of the idempotency key. */
    @Column({ length: 10 })
    billingPeriodStart: string;

    @Column()
    amountPaise: number;

    @Column({ type: "varchar", default: "initiated" })
    status: JuspayPaymentAttemptStatus;

    /** Juspay order created for this charge attempt. */
    @Column({ nullable: true })
    juspayOrderId: string;

    @Column({ nullable: true })
    juspayTransactionId: string;

    @Column({ nullable: true })
    failureReason: string;

    @CreateDateColumn()
    attemptedAt: Date;
}
