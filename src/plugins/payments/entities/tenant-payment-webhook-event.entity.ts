import {
  Channel,
  ChannelAware,
  DeepPartial,
  VendureEntity,
} from '@vendure/core';
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinTable,
  ManyToMany,
  Unique,
} from 'typeorm';

/**
 * Persist-first inbox for tenant-owned Razorpay Flow B notifications (INV-004).
 *
 * The route token selects the tenant Channel; authenticity comes exclusively
 * from the per-tenant Razorpay webhook secret and the exact raw request bytes.
 * The event is ChannelAware and is assigned only to that tenant Channel.
 *
 * Provider receipt fields are immutable after insertion. Processing metadata
 * is advanced by TenantPaymentWebhookQueueService.
 */
@Entity('tenant_payment_webhook_event')
@Unique('UQ_tenant_payment_webhook_event_dedupe', ['dedupeKey'])
@Index('IDX_tenant_payment_webhook_event_status', ['processingStatus'])
export class TenantPaymentWebhookEvent extends VendureEntity implements ChannelAware {
  constructor(input?: DeepPartial<TenantPaymentWebhookEvent>) {
    super(input);
  }

  @ManyToMany(() => Channel)
  @JoinTable()
  channels: Channel[];

  /** Razorpay provider name. */
  @Column({ type: 'varchar' })
  provider: string;

  /** Exact x-razorpay-event-id supplied by Razorpay. */
  @Column({ type: 'varchar' })
  providerEventId: string;

  /** SHA-256(provider + channel ID + provider event ID); unique per tenant. */
  @Column({ type: 'varchar', length: 64 })
  dedupeKey: string;

  /** Razorpay event name, e.g. payment.captured. */
  @Column({ type: 'varchar' })
  eventType: string;

  /** SHA-256 of the exact raw request bytes whose HMAC was verified. */
  @Column({ type: 'varchar', length: 64 })
  payloadHash: string;

  /** Parsed payload corresponding to the verified raw request bytes. */
  @Column({ type: 'json' })
  rawPayload: Record<string, unknown>;

  @CreateDateColumn()
  receivedAt: Date;

  @Column({ type: 'timestamp', nullable: true })
  verifiedAt: Date | null;

  /** pending → processed / ignored / failed. */
  @Column({ type: 'varchar', default: 'pending' })
  processingStatus: string;

  @Column({ type: 'int', default: 0 })
  attemptCount: number;

  @Column({ type: 'timestamp', nullable: true })
  processedAt: Date | null;

  @Column({ type: 'timestamp', nullable: true })
  failedAt: Date | null;

  @Column({ type: 'varchar', nullable: true })
  errorMessage: string | null;

  /** Payload-derived, informational only; worker re-reads the order/provider. */
  @Column({ type: 'varchar', nullable: true })
  vendureOrderCode: string | null;
}
