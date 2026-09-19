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

    /** Billing period this attempt covers (ISO date, e.g., '2026-08-01'). */
    @Column({ length: 10 })
    billingPeriodStart: string;

    @Column({ type: 'varchar', default: 'initiated' })
    status: BillingAttemptStatus;

    /** Failure reason if status = 'failed'. */
    @Column({ nullable: true })
    failureReason: string;

    @CreateDateColumn()
    attemptedAt: Date;
}
