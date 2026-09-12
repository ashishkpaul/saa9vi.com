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

    /**
     * Denormalized tenant scope (ADR-003 scalar-only exception).
     *
     * Initially NULL at ingress — resolved by the worker after provider binding lookup.
     * This ensures the authoritative channel comes from the provider binding, not arbitrary request context.
     */
    @Column({ type: 'varchar', nullable: true })
    channelId: string | null;

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
    verifiedAt: Date | null;

    /** When the webhook was successfully processed. */
    @Column({ type: 'timestamp', nullable: true })
    processedAt: Date | null;

    /** When the webhook processing terminally failed (all retries exhausted). */
    @Column({ type: 'timestamp', nullable: true })
    failedAt: Date | null;

    /**
     * Processing status lifecycle:
     *   pending   → initial state, awaiting worker pickup
     *   processed → successfully processed (terminal)
     *   failed    → all retries exhausted, terminal failure
     *
     * Intermediate retry failures do NOT change status — the record stays `pending`
     * until either success or terminal failure. Use `attemptCount` for retry visibility.
     */
    @Column({ type: 'varchar', default: 'pending' })
    processingStatus: string;

    /** Number of processing attempts made. Incremented by the worker on each attempt. */
    @Column({ type: 'int', default: 0 })
    attemptCount: number;

    /** Error message from the most recent failed attempt (cleared on success). */
    @Column({ type: String, nullable: true })
    errorMessage: string | null;
}
