import { DeepPartial, VendureEntity, ChannelAware, Channel } from '@vendure/core';
import { Column, Entity, Index, ManyToOne, JoinTable, ManyToMany } from 'typeorm';
import { OrganizationSubscription } from './organization-subscription.entity';

/**
 * Binds an OrganizationSubscription to a provider-specific subscription.
 *
 * This is the provider-neutral binding: Saa9vi's subscription domain
 * references this entity, never the provider directly.
 *
 * Provider-specific details (Razorpay subscription_id, Juspay mandate_id, etc.)
 * live in the provider adapter, not here.
 */
@Entity('subscription_provider_binding')
@Index(['channelId'])
@Index(['provider', 'providerSubscriptionId'], { unique: true })
export class SubscriptionProviderBinding extends VendureEntity implements ChannelAware {
    constructor(input?: DeepPartial<SubscriptionProviderBinding>) {
        super(input);
    }

    /** The subscription this binding belongs to. */
    @ManyToOne(() => OrganizationSubscription, { nullable: false })
    subscription: OrganizationSubscription;

    /** Dual channels[] + scalar channelId per ADR-003. */
    @ManyToMany(() => Channel)
    @JoinTable()
    channels: Channel[];

    @Column()
    channelId: string;

    /** Provider identifier: 'razorpay', 'juspay', etc. */
    @Column()
    provider: string;

    /** Provider's subscription ID (e.g., Razorpay subscription_id). */
    @Column()
    providerSubscriptionId: string;

    /** Provider's plan ID (e.g., Razorpay plan_id). */
    @Column({ nullable: true })
    providerPlanId: string;

    /** Provider's current status string (untranslated). */
    @Column()
    providerStatus: string;

    /** Whether the provider subscription is currently active. */
    @Column({ default: false })
    active: boolean;

    /** Provider-specific metadata (JSON). */
    @Column({ type: 'json', nullable: true })
    metadata: Record<string, unknown>;
}
