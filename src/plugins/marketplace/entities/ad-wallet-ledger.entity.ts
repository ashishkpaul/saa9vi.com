import { DeepPartial, VendureEntity } from '@vendure/core';
import { Column, Entity, Index } from 'typeorm';

/**
 * Append-only wallet movement ledger for the prepaid ad wallet (ADR FEAT-003).
 *
 * Each row is an immutable financial fact: money entering (topup) or leaving
 * (spend, refund) an academy's AdWallet. The AdWallet.balanceInPaise column is
 * a DERIVED CACHE ONLY — truth for a wallet's balance is always
 * SUM(amountInPaise) over this ledger for the walletId (same discipline as
 * CommissionLedger under INV-002 and AdSpendLedger under INV-010).
 *
 * Amount sign convention (per FEAT-003):
 *  - `topup`  → amountInPaise POSITIVE (money in)
 *  - `spend`  → amountInPaise NEGATIVE (money out)
 *  - `refund` → amountInPaise POSITIVE (money back in)
 *
 * Rows are never updated, never deleted (enforced by the
 * AdWalletLedgerImmutableSubscriber at the TypeORM service boundary).
 *
 * Idempotency: `reference` is an optional caller-supplied unique key (e.g. the
 * Juspay order id for a top-up, or `campaign:{id}:{eventId}` for a spend). A
 * UNIQUE index on it makes retried writes safe at the DB level (23505 →
 * duplicate). `orderId` links a top-up to its Juspay order; `campaignId`
 * attributes a spend (or refund) to a campaign.
 */
@Entity('ad_wallet_ledger')
export class AdWalletLedger extends VendureEntity {
  constructor(input?: DeepPartial<AdWalletLedger>) {
    super(input);
  }

  @Index()
  @Column()
  walletId: string;

  @Column({ type: 'varchar' })
  type: 'topup' | 'spend' | 'refund';

  /** Signed amount in minor units: positive for topup/refund, negative for spend. */
  @Column({ type: 'int' })
  amountInPaise: number;

  @Column()
  occurredAt: Date;

  /** Campaign attribution for spend/refund rows; null for topups. */
  @Index()
  @Column({ type: 'varchar', nullable: true })
  campaignId: string | null;

  /** Juspay order id backing a topup; null otherwise. */
  @Column({ type: 'varchar', nullable: true })
  orderId: string | null;

  /** Caller-supplied idempotency key; NULL rows are not subject to uniqueness. */
  @Index({ unique: true })
  @Column({ type: 'varchar', nullable: true })
  reference: string | null;
}