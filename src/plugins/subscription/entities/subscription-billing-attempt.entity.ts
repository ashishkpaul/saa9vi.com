import { DeepPartial, VendureEntity } from '@vendure/core';
import { Column, CreateDateColumn, Entity, Index, ManyToOne } from 'typeorm';
import { OrganizationSubscription } from './organization-subscription.entity';

export type BillingAttemptStatus = 'initiated' | 'succeeded' | 'failed';

/**
 * Provider-neutral billing attempt record.
 *
  * Each row is a single billing attempt
 * against a subscription. Retries create new rows — terminal results are never
 * overwritten.
 *
 * Channel isolation: denormalized scalar channelId (ADR-003 scalar-only exception).
 */
@Entity('subscription_billing_attempt')
@Index(['channelId'])
@Index(['subscription', 'attemptedAt'])
@Index(['provider', 'providerEventId'], { unique: true })
// Concurrent-payment idempotency: at most one attempt row per
// (provider, providerPaymentId), provider-qualified per the provider-neutral
// architecture. Partial unique — NULLs (renewal-created initiated rows,
// pre-terminal) are exempt; blocks the check-then-insert race where two
// different provider event IDs reference the same payment.
//
// Declared at class level deliberately: TypeORM's @Index used as a *property*
// decorator silently discards an explicit columns array and uses only the
// decorated property name (typeorm/decorator/Index.js:
// `columns: propertyName ? [propertyName] : fields`), which would silently
// degrade this to a single-column index.
@Index('UQ_billing_attempt_provider_payment', ['provider', 'providerPaymentId'], {
    unique: true,
    where: '"providerPaymentId" IS NOT NULL',
})
export class SubscriptionBillingAttempt extends VendureEntity {
    constructor(input?: DeepPartial<SubscriptionBillingAttempt>) {
        super(input);
    }

    @ManyToOne(() => OrganizationSubscription, { nullable: false })
    subscription: OrganizationSubscription;

    /** Denormalized tenant scope (ADR-003 scalar-only exception). */
    @Column()
    channelId: string;

    /** Provider identifier (e.g. 'razorpay'). */
    @Column()
    provider: string;

    /** Provider's subscription ID (e.g., Razorpay subscription_id). */
    @Column({ nullable: true })
    providerSubscriptionId: string;

    /** Provider event ID for idempotency (e.g., Razorpay event_id). */
    @Column({ nullable: true })
    providerEventId: string;

    @Column({ nullable: true })
    providerPaymentId: string;

    /** Provider's invoice ID (e.g., Razorpay invoice_id). */
    @Column({ nullable: true })
    providerInvoiceId: string;

    /** Invoice ID for this attempt (matches SubscriptionInvoicePaidEvent.invoiceId). */
    @Column({ nullable: true })
    invoiceId: string;

    /** Provider's attempt ID (e.g., Razorpay attempt reference). */
    @Column({ nullable: true })
    providerAttemptId: string;

    /** Amount in paise (minor currency unit). */
    @Column()
    amountPaise: number;

    @Column()
    currency: string;

    /**
     * Billing period start this attempt covers (ISO date YYYY-MM-DD, UTC).
     *
     * ADR-041 G3 / INV-020: uniform semantics across all terminal states:
     *
     *   NULL
     *     → cycle identity unknown / not applicable.
     *       Renewal-worker-initiated rows carry NULL until the terminal CAS;
     *       failed terminal rows without an authoritative provider cycle are
     *       also NULL (cleared by the terminal CAS, not left as a provisional
     *       estimate).
     *
     *   YYYY-MM-DD (UTC)
     *     → authoritative provider cycle start from Razorpay `current_start`
     *       (Unix seconds → UTC date). Present on succeeded attempts and on
     *       failed attempts where the provider supplied a failure cycle.
     *
     * The field is cycle identity, not a generic audit timestamp. A value that
     * does not originate from an authoritative provider cycle MUST NOT be stored
     * here (INV-020 prohibition on manufactured period identity).
     */
    @Column({ type: 'varchar', length: 10, nullable: true })
    billingPeriodStart: string | null;

    /**
     * Billing period end this attempt covers (ISO date, e.g., '2026-10-20').
     *
     * ADR-041 (G3): the durable carrier of the provider cycle end date.
     * Set from the provider's `current_end` field on webhook-created attempts.
     * Null for renewal-worker-initiated attempts (unknown until the webhook
     * arrives) and for all pre-G2 legacy rows.
     *
     * `finalizeAfterPayment()` reads this column to reconstruct the
     * authoritative provider cycle on replay without re-parsing the original
     * webhook payload.
     */
    @Column({ type: 'varchar', length: 10, nullable: true })
    billingPeriodEnd: string | null;

    @Column({ type: 'varchar', default: 'initiated' })
    status: BillingAttemptStatus;

    /** Failure reason if status = 'failed'. */
    @Column({ nullable: true })
    failureReason: string;

    @CreateDateColumn()
    attemptedAt: Date;
}
