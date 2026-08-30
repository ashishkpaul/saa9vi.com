import { Column, CreateDateColumn, Entity, Index } from 'typeorm';
import { VendureEntity } from '@vendure/core';

/**
 * Audit table for tracking Juspay payment settlements.
 * Used to reconcile payments and detect missed webhook events.
 */
@Index('IDX_psa_juspay_order_status', ['juspayOrderId', 'status'])
@Entity()
export class PaymentSettlementAudit extends VendureEntity {
  constructor(input?: Partial<PaymentSettlementAudit>) {
    super(input);
  }
  @Column()
  orderId: string;

  @Index('IDX_psa_juspay_order_id')
  @Column()
  juspayOrderId: string;

  @Column()
  amount: number;

  @Column()
  status: string;

  @Column()
  verified: boolean;

  @CreateDateColumn()
  checkedAt: Date;
}