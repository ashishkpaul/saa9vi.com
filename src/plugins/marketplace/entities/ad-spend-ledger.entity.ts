import { DeepPartial, VendureEntity } from '@vendure/core';
import { Column, Entity, Index } from 'typeorm';

/**
 * Append-only ledger for ad spend (INV-010).
 * Rows are never updated, never deleted.
 * Truth for campaign spend is always SUM(amountInPaise) WHERE campaignId = X.
 */
@Entity('ad_spend_ledger')
export class AdSpendLedger extends VendureEntity {
  constructor(input?: DeepPartial<AdSpendLedger>) {
    super(input);
  }

  @Index()
  @Column()
  campaignId: string;

  @Column({ type: 'varchar' })
  eventType: 'impression' | 'click' | 'conversion';

  @Column({ type: 'int' })
  amountInPaise: number;

  @Column()
  occurredAt: Date;

  @Column({ type: 'varchar', nullable: true })
  orderId: string | null;
}