import type { DeepPartial } from "@vendure/common/lib/shared-types";
import { VendureEntity } from "@vendure/core";
import { Column, CreateDateColumn, Entity, Index, ManyToOne } from "typeorm";
import { OrganizationSubscription } from "./organization-subscription.entity";

export type JuspayPaymentAttemptStatus = "initiated" | "succeeded" | "failed";

/**
 * Append-only ledger of Juspay charge attempts (INV-002 pattern).
 *
 * INVARIANT (to be registered as INV-019 in docs/architecture/invariants.md):
 * a row is NEVER mutated after it reaches a terminal status ('succeeded' /
 * 'failed'). A retry is a NEW row, never an update — same discipline as
 * BbbUsageLedger. No update path may ever be exposed on the Admin API;
 * "trigger a new attempt" creates a new row, it does not mutate history.
 *
 * Ties to SubscriptionInvoicePaidEvent's invoiceId. Amounts are stored in
 * paise (Juspay minor units) — never rupees — to avoid float rounding.
 */
@Entity("juspay_payment_attempt")
@Index(["subscription", "attemptedAt"])
@Index(["juspayTransactionId"])
export class JuspayPaymentAttempt extends VendureEntity {
    constructor(input?: DeepPartial<JuspayPaymentAttempt>) {
        super(input);
    }

    @ManyToOne(() => OrganizationSubscription, { nullable: false })
    subscription: OrganizationSubscription;

    /** Invoice this attempt bills (matches SubscriptionInvoicePaidEvent.invoiceId). */
    @Column()
    invoiceId: string;

    /** Billing period this attempt covers, ISO date (e.g. '2026-08-01'). Part of the idempotency key. */
    @Column({ length: 10 })
    billingPeriodStart: string;

    @Column()
    amountPaise: number;

    @Column({ default: "initiated" })
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
