import { DeepPartial, VendureEntity } from '@vendure/core';
import { Column, Entity, Index } from 'typeorm';

/**
 * Prepaid ad wallet per academy (channel).
 * balanceInPaise is a cache only — truth is SUM(AdWalletLedger).
 */
@Entity('ad_wallet')
export class AdWallet extends VendureEntity {
  constructor(input?: DeepPartial<AdWallet>) {
    super(input);
  }

  @Index({ unique: true })
  @Column()
  channelId: string;

  /** Cache only — truth is SUM(AdWalletLedger) */
  @Column({ type: 'int', default: 0 })
  balanceInPaise: number;
}