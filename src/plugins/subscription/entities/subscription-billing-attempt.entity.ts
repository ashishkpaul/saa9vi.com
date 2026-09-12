import { DeepPartial, VendureEntity } from '@vendure/core';
import { Column, CreateDateColumn, Entity, Index, ManyToOne } from 'typeorm';
import { OrganizationSubscription } from './organization-subscription.entity';

export type BillingAttemptStatus = 'initiated' | 'succeeded' | 'failed';

/**
 * Provider-neutral billing attempt record.
 *
 * Replaces the old JuspayPaymentAttempt. Each row is a single billing attempt
 * against a subscription. Retries create new rows — terminal results are never
 * overwritten.
 *
 * Channel isolation: denormalized scalar channelId (ADR-003 scalar-only exception).
 */
@Entity('subscription_billing_attempt')
@Index(['channelId'])
@Index(['subscription', 'attemptedAt'])
@Index(['provider', 'providerEventId'], { unique: true })
export class SubscriptionBillingAttempt extends VendureEntity {
    constructor(input?: DeepPartial<SubscriptionBillingAttempt>) {
        super(input);
    }

    @ManyToOne(() => OrganizationSubscription, { nullable: false })
    subscription: OrganizationSubscription;

    /** Denormalized tenant scope (ADR-003 scalar-only exception). */
    @Column()
    channelId: string;

    /** Provider identifier: 'razorpay', 'juspay', etc. */
    @Column()
    provider: string;

    /** Provider's subscription ID (e.g., Razorpay subscription_id). */
    @Column({ nullable: true })
    providerSubscriptionId: string;

    /** Provider's payment ID (e.g., Razorpay payment_id). */
    @Column({ nullable: true })
    providerPaymentId: string;

    /** Provider's invoice ID (e.g., Razorpay invoice_id). */
    @Column({ nullable: true })
    providerInvoiceId: string;

    /** Provider event ID for idempotency (e.g., Razorpay event_id). */
    @Column({ nullable: true })
    providerEventId: string;

    /** Invoice ID for this attempt (matches SubscriptionInvoicePaidEvent.invoiceId). */
    @Column({ nullable: true })
    invoiceId: string;

    /** Provider's attempt ID (e.g., merchant order ID for Juspay). */
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
