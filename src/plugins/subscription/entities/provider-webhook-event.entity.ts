import { DeepPartial, VendureEntity } from '@vendure/core';
import { Column, Entity, Index, CreateDateColumn } from 'typeorm';

/**
 * Immutable inbox for provider webhook events.
 *
 * This is the authoritative record that a webhook was received.
 * Events are never updated — only appended.
 *
 * Idempotency: UNIQUE(provider, providerEventId) prevents duplicate processing.
 */
@Entity('provider_webhook_event')
@Index(['channelId'])
@Index(['provider', 'providerEventId'], { unique: true })
@Index(['processingStatus'])
export class ProviderWebhookEvent extends VendureEntity {
    constructor(input?: DeepPartial<ProviderWebhookEvent>) {
        super(input);
    }

    /** Denormalized tenant scope (ADR-003 scalar-only exception). */
    @Column()
    channelId: string;

    /** Provider identifier: 'razorpay', 'juspay', etc. */
    @Column()
    provider: string;

    /** Provider's event ID (e.g., Razorpay event_id). */
    @Column()
    providerEventId: string;

    /** Event type (e.g., 'subscription.charged'). */
    @Column()
    eventType: string;

    /** SHA-256 hash of the raw payload (for integrity verification). */
    @Column()
    payloadHash: string;

    /** Raw webhook payload (immutable). */
    @Column({ type: 'json' })
    rawPayload: Record<string, unknown>;

    /** When the webhook was received. */
    @CreateDateColumn()
    receivedAt: Date;

    /** When the webhook signature was verified. */
    @Column({ type: 'timestamp', nullable: true })
    verifiedAt: Date;

    /** When the webhook was processed. */
    @Column({ type: 'timestamp', nullable: true })
    processedAt: Date;

    /** Processing status: 'pending', 'processed', 'failed'. */
    @Column({ type: 'varchar', default: 'pending' })
    processingStatus: string;

    /** Error message if processing failed. */
    @Column({ nullable: true })
    errorMessage: string;
}
