import { DeepPartial, VendureEntity } from '@vendure/core';
import { Column, Entity, Index } from 'typeorm';

/**
 * Marketplace advertising campaign for sponsored listings.
 *
 * Each campaign belongs to an academy (channel) and controls budget,
 * targeting, and scheduling for sponsored placement in marketplace search.
 *
 * INV-010: spentInPaise is a cache only. Truth is SUM(AdSpendLedger).
 */
@Entity('marketplace_ad_campaign')
export class MarketplaceAdCampaign extends VendureEntity {
  constructor(input?: DeepPartial<MarketplaceAdCampaign>) {
    super(input);
  }

  @Index()
  @Column()
  channelId: string;

  @Column({ type: 'varchar', default: 'sponsored_listing' })
  type: 'sponsored_listing' | 'banner';

  @Column({ type: 'varchar', default: 'draft' })
  status: 'draft' | 'active' | 'paused' | 'exhausted';

  @Column({ type: 'int', default: 0 })
  budgetInPaise: number;

  /** Cache only — truth is SUM(AdSpendLedger) per INV-010 */
  @Column({ type: 'int', default: 0 })
  spentInPaise: number;

  /** The session ID this campaign promotes (for sponsored_listing type) */
  @Column({ type: 'varchar', nullable: true })
  targetSessionId: string;

  @Column({ type: 'varchar', nullable: true })
  targetSubject: string | null;

  @Column({ type: 'varchar', nullable: true })
  targetCity: string | null;

  @Column()
  startsAt: Date;

  @Column()
  endsAt: Date;

  @Column({ type: 'float', default: 3.0 })
  boostWeight: number;
}