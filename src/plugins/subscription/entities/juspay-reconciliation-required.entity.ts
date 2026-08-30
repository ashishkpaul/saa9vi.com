import type { DeepPartial } from "@vendure/common/lib/shared-types";
import { VendureEntity } from "@vendure/core";
import { Column, CreateDateColumn, Entity, Index, ManyToOne } from "typeorm";
import { OrganizationSubscription } from "./organization-subscription.entity";

/**
 * Operator-visible reconciliation incident record (Step 4D).
 *
 * Records the dangerous window: a Juspay charge SUCCEEDED but the renewal
 * FINALIZE CAS lost (e.g. a second worker claimed between CLAIM and FINALIZE,
 * or manual state edit). Money moved but the subscription period did not
 * advance. This MUST be manual-reconciled — never auto-retried (a retry
 * would double-charge).
 *
 * The webhook processor and the renewal worker both write this when they
 * detect a success-without-finalize, so the incident surfaces on an operator
 * query instead of being inferred from logs.
 *
 * SEMANTICS: this is an OPERATIONAL INCIDENT RECORD, not a financial ledger.
 * It has a controlled PENDING → RESOLVED workflow (an operator resolves it
 * after verifying the payment and manually advancing the period if needed).
 * INV-002 (immutable ledger rows) applies to financial facts like
 * JuspayPaymentAttempt — not to this incident-tracking record.
 */
@Entity("juspay_payment_reconciliation_required")
@Index(["channelId"])
@Index(["status"])
export class RenewalPaymentReconciliationRequired extends VendureEntity {
    constructor(input?: DeepPartial<RenewalPaymentReconciliationRequired>) {
        super(input);
    }

    @ManyToOne(() => OrganizationSubscription, { nullable: false })
    subscription: OrganizationSubscription;

    @Column()
    channelId: string;

    /**
     * The Juspay order id whose charge succeeded. Used by an operator to
     * locate the corresponding attempt/transaction.
     */
    @Column()
    juspayOrderId: string;

    @Column()
    invoiceId: string;

    @Column({ type: "varchar", default: "PENDING" })
    status: "PENDING" | "RESOLVED";

    @Column({ nullable: true })
    resolutionNote: string;

    @Column()
    detectedAt: Date;

    @CreateDateColumn()
    createdAt: Date;
}