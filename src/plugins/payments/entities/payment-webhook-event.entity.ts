import { DeepPartial, VendureEntity } from '@vendure/core';
import { Column, Entity, Index, CreateDateColumn } from 'typeorm';

/**
 * R3 — immutable inbox for ONE-TIME Razorpay payment webhooks (INV-004).
 *
 * Boundary: this entity belongs to the one-time commerce lifecycle only
 * (PaymentsPlugin). It mirrors the recurring-billing
 * `ProviderWebhookEvent` persist-first contract — validate signature →
 * persist inbox row { status: PENDING } → enqueue inbox ID to BullMQ →
 * return 2xx immediately; the worker loads the row by ID, reconciles, and
 * marks PROCESSED/FAILED — but the two lifecycles must not be merged
 * (ADR-038; production-readiness.md §7/§9).
 *
 * The receipt fields (`providerEventId`, `eventType`, `payloadHash`,
 * `rawPayload`, `receivedAt`, `verifiedAt`) are never modified after
 * insert; processing metadata (`processingStatus`, `attemptCount`,
 * `processedAt`, `failedAt`, `errorMessage`, `vendureOrderCode`) is updated
 * by the worker as the event moves through its processing lifecycle.
 *
 * Idempotency: UNIQUE(provider, providerEventId) prevents duplicate
 * processing. Razorpay delivers `x-razorpay-event-id` on every webhook
 * delivery; when the header is absent the controller derives a stable
 * synthetic key from the payload hash so retries of the same delivery map
 * to the same row.
 */
@Entity('payment_webhook_event')
@Index(['processingStatus'])
@Index(['provider', 'providerEventId'], { unique: true })
@Index(['vendureOrderCode'])
export class PaymentWebhookEvent extends VendureEntity {
  constructor(input?: DeepPartial<PaymentWebhookEvent>) {
    super(input);
  }

  /** Provider identifier (always 'razorpay' while ADR-038 holds). */
  @Column()
  provider: string;

  /**
   * Provider's event delivery ID (`x-razorpay-event-id` header, or a
   * `synthetic:<payloadHash>` fallback when the header is absent).
   */
  @Column()
  providerEventId: string;

  /** Event type (e.g. 'payment.captured', 'order.paid'). */
  @Column()
  eventType: string;

  /** SHA-256 hash of the raw request body (integrity + synthetic-key input). */
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

  /** When the webhook was successfully reconciled. */
  @Column({ type: 'timestamp', nullable: true })
  processedAt: Date | null;

  /** When reconciliation terminally failed (all retries exhausted). */
  @Column({ type: 'timestamp', nullable: true })
  failedAt: Date | null;

  /**
   * Processing status lifecycle:
   *   pending   → initial state, awaiting worker pickup
   *   processed → successfully reconciled (terminal)
   *   failed    → all retries exhausted (terminal)
   *   ignored   → non-settling / unusable delivery, terminal by inspection
   *               (missing identifiers, unknown order, already-settled order)
   *
   * Intermediate retry failures do NOT change status — the record stays
   * `pending` until either success or terminal failure. Use `attemptCount`
   * for retry visibility.
   */
  @Column({ type: 'varchar', default: 'pending' })
  processingStatus: string;

  /** Number of processing attempts made. Incremented by the worker on each attempt. */
  @Column({ type: 'int', default: 0 })
  attemptCount: number;

  /** Error message from the most recent failed attempt (cleared on success). */
  @Column({ type: String, nullable: true })
  errorMessage: string | null;

  /**
   * Vendure order code extracted from the payload at ingress
   * (`notes.vendureOrderCode` / `receipt`). Informational only — the worker
   * re-reads the order from the DB; a missing code marks the event `ignored`.
   */
  @Column({ type: 'varchar', nullable: true })
  vendureOrderCode: string | null;
}
