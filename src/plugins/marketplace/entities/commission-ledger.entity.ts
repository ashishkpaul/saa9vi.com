import { DeepPartial, VendureEntity } from '@vendure/core';
import { Column, Entity, Index } from 'typeorm';

/**
 * Append-only commission ledger for Stream 2 (INV-002 / DL-030).
 *
 * Rows are written for EVERY server-classified `orderSource = 'marketplace'` order
 * regardless of the current `MARKETPLACE_COMMISSION_PERCENT` rate. When the rate is
 * 0%, rows are written with `commissionAmountInPaise: 0` — preserving complete
 * marketplace GMV history so future rate changes have full historical data.
 *
 * Only server-verified marketplace orders ever produce a row (ADR-021 Decision 5/6 &
 * Rejection criteria). The listener MUST construct a row with an explicit
 * `orderSource = 'marketplace'`; the column default below is purely a schema default
 * and never used to classify — rows for non-marketplace orders are simply not written.
 *
 * Rows are never updated, never deleted. Truth for a channel's commission is
 * always SUM(commissionAmountInPaise) = the immutable rows.

 * This ledger is NOT a balance table — it is a set of immutable financial facts
 * (per the platform ledger discipline).
 */
@Entity('commission_ledger')
@Index(['marketplaceRef', 'orderId'], { unique: true })
export class CommissionLedger extends VendureEntity {
  constructor(input?: DeepPartial<CommissionLedger>) {
    super(input);
  }

  @Index()
  @Column()
  channelId: string;

  @Index()
  @Column()
  orderId: string;

  /** Server-resolved classification; `'marketplace'` is the only source of rows. */
  @Column({ type: 'varchar', default: 'direct' })
  orderSource: 'marketplace' | 'referral' | 'direct';

  /**
   * The consumed HMAC-signed `marketplaceRef` (if any). Stored so that replay
   * (the same ref re-submitted on a second order) can be detected and the
   * second order reclassified to `direct` (ADR-021 Decision 6).
   *
   * The unique (marketplaceRef, orderId) index encodes two leaf guarantees:
   *  - at most one commission row per marketplace order (idempotency on retried
   *    checkouts resolving to the same order), and
   *  - single-use consumption of a reference (Decision 6 replay guard), so a
   *    reused ref cannot mint a second commission row.
   *
   * Marketplace rows therefore always carry a non-null marketplaceRef in practice;
   * null remains possible only for a defensive non-marketplace row, which the
   * listener never writes.
   */
  @Column({ type: 'varchar', nullable: true })
  marketplaceRef: string | null;

 /** Gross order value in minor units (the entire order under ADR-019 single-channel). */
  @Column({ type: 'int' })
  grossAmountInPaise: number;

 /** Applied commission percentage (0–100 integer percent; 0 for a $0-row). */
  @Column({ type: 'int' })
  commissionPercent: number;

 /** Commission charge in minor units; `0` when `commissionPercent` is 0. */
  @Column({ type: 'int' })
  commissionAmountInPaise: number;

  @Column({ type: 'varchar' })
  currency: string;
}