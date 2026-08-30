import { VendureEntity } from '@vendure/core';
import type { DeepPartial } from '@vendure/core';
import { Column, CreateDateColumn, Entity, Index } from 'typeorm';

/**
 * Shared idempotency log. Any event that writes here first
 * prevents duplicate processing across all payment plugins.
 */
@Entity('payment_event_log')
export class PaymentEventLog extends VendureEntity {
  constructor(input?: DeepPartial<PaymentEventLog>) {
    super(input);
  }

  /**
   * Key format: '{gateway}:{event_type}:{order_id}'
   * Example: 'juspay:order_created:ORD-123'
   */
  @Column({ length: 512, unique: true })
  @Index('IDX_payment_event_log_event_key')
  eventKey: string;

  /**
   * Which payment gateway produced this event (e.g. 'juspay')
   */
  @Column({ length: 64 })
  gateway: string;

  /**
   * Raw JSON snapshot for audit
   */
  @Column({
    type: process.env.DB_TYPE === 'postgres' ? 'jsonb' : 'simple-json',
    nullable: true,
  })
  payloadSnapshot: any | null;

  /**
   * When this event was processed
   */
  @CreateDateColumn()
  processedAt: Date;
}