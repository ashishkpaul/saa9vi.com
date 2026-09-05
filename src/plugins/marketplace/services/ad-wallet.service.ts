import { Injectable, Logger } from '@nestjs/common';
import { RequestContext, TransactionalConnection } from '@vendure/core';
import { In } from 'typeorm';
import { AdWallet } from '../entities/ad-wallet.entity';
import { AdWalletLedger } from '../entities/ad-wallet-ledger.entity';

const loggerCtx = 'AdWalletService';

export interface CreditWalletInput {
  channelId: string;
  /** Positive amount in minor units. */
  amountInPaise: number;
  type: 'topup' | 'refund';
  /** Caller-supplied idempotency key (e.g. the Juspay order id for a topup). */
  reference?: string | null;
  orderId?: string | null;
}

export interface DebitWalletInput {
  channelId: string;
  /** Positive amount in minor units; stored as a NEGATIVE ledger row. */
  amountInPaise: number;
  campaignId?: string | null;
  /** Caller-supplied idempotency key (e.g. `campaign:{id}:{eventId}`). */
  reference?: string | null;
}

export type WalletMutationResult =
  | 'inserted'
  | 'duplicate_ref'
  | 'insufficient_funds'
  | 'error';

/**
 * Service boundary for the prepaid ad wallet (ADR FEAT-003, Phase 3C.2/3C.3).
 *
 * FINANCIAL INVARIANT: `AdWallet.balanceInPaise` is a DERIVED CACHE ONLY.
 * Truth for a wallet's balance is always SUM(amountInPaise) over
 * `AdWalletLedger` rows for the wallet. This service:
 *  - computes balances FROM THE LEDGER (never from the cache),
 *  - writes an immutable ledger row for every movement,
 *  - refreshes the cache inside the same transaction (best-effort
 *    self-healing: recomputed from the ledger, not incremented),
 *  - arbitrates concurrent debits with a pessimistic row lock on the
 *    wallet row inside the transaction, so two simultaneous debits can
 *    never jointly overdraw the ledger balance,
 *  - lets the UNIQUE(reference) index arbitrate retried writes
 *    insert-first (23505 → duplicate_ref), mirroring the
 *    CommissionLedgerService pattern (no check-then-insert race).
 *
 * Ledger rows themselves are append-only (AdWalletLedgerImmutableSubscriber).
 */
@Injectable()
export class AdWalletService {
  private readonly logger = new Logger(loggerCtx);

  constructor(private readonly connection: TransactionalConnection) {}

  /**
   * The wallet's authoritative balance: SUM(amountInPaise) over its ledger rows.
   * Never reads the AdWallet.balanceInPaise cache.
   */
  async getBalance(ctx: RequestContext, channelId: string): Promise<number> {
    const wallet = await this.ensureWallet(ctx, channelId);
    return this.sumLedger(ctx, String(wallet.id));
  }

  /**
   * Return the wallet for a channel, creating it if absent.
   * The UNIQUE(channelId) index arbitrates concurrent creation (23505 → refetch).
   */
  async ensureWallet(ctx: RequestContext, channelId: string): Promise<AdWallet> {
    const repo = this.connection.getRepository(ctx, AdWallet);
    const existing = await repo.findOne({ where: { channelId } });
    if (existing) {
      return existing;
    }
    try {
      return await repo.save(repo.create({ channelId, balanceInPaise: 0 }));
    } catch (err: any) {
      if (err?.code === '23505') {
        const raced = await repo.findOne({ where: { channelId } });
        if (raced) {
          return raced;
        }
      }
      throw err;
    }
  }

  /**
   * Append a credit (topup/refund) movement. Insert-first; a duplicate
   * `reference` is a DB-arbitrated idempotent no-op (duplicate_ref).
   */
  async creditWallet(ctx: RequestContext, input: CreditWalletInput): Promise<WalletMutationResult> {
    if (!Number.isInteger(input.amountInPaise) || input.amountInPaise <= 0) {
      throw new Error(
        `AdWalletService: credit amount must be a positive integer in paise (got ${input.amountInPaise}).`
      );
    }
    return this.connection.withTransaction(ctx, async (txnCtx) => {
      const wallet = await this.ensureWallet(txnCtx, input.channelId);
      const inserted = await this.insertLedgerRow(txnCtx, String(wallet.id), {
        type: input.type,
        amountInPaise: input.amountInPaise,
        campaignId: null,
        orderId: input.orderId ?? null,
        reference: input.reference ?? null,
      });
      if (inserted !== 'inserted') {
        return inserted;
      }
      // Cache refresh: recompute from the ledger (self-healing), inside the txn.
      await this.refreshCache(txnCtx, String(wallet.id));
      return 'inserted';
    });
  }

  /**
   * Append a spend movement (NEGATIVE ledger row) if the authoritative
   * ledger balance covers it. The wallet row is locked FOR UPDATE inside
   * the transaction, so concurrent debits are serialized against the same
   * balance — no double-spend race. A retried debit with the same
   * `reference` is a DB-arbitrated no-op (duplicate_ref).
   *
   * NOTE: do NOT nest this inside another withTransaction on the same ctx —
   * Vendure's wrapper re-attempts startTransaction on the inherited runner
   * and throws TransactionAlreadyStartedError. Callers that are already
   * inside a transaction (e.g. recordCampaignSpend) must use
   * debitWalletInTxn() instead so the two ledgers share one atomic boundary.
   */
  async debitWallet(ctx: RequestContext, input: DebitWalletInput): Promise<WalletMutationResult> {
    if (!Number.isInteger(input.amountInPaise) || input.amountInPaise <= 0) {
      throw new Error(
        `AdWalletService: debit amount must be a positive integer in paise (got ${input.amountInPaise}).`
      );
    }
    return this.connection.withTransaction(ctx, async (txnCtx) => {
      return this.debitWalletInTxn(txnCtx, input);
    });
  }

  /**
   * Debit-core WITHOUT transaction wrapping: executes on whatever transaction
   * the given ctx already carries. Used by debitWallet() and by multi-ledger
   * callers (recordCampaignSpend) that must keep the wallet debit and their
   * own writes in ONE atomic transaction.
   */
  async debitWalletInTxn(txnCtx: RequestContext, input: DebitWalletInput): Promise<WalletMutationResult> {
    if (!Number.isInteger(input.amountInPaise) || input.amountInPaise <= 0) {
      throw new Error(
        `AdWalletService: debit amount must be a positive integer in paise (got ${input.amountInPaise}).`
      );
    }
    const walletRepo = this.connection.getRepository(txnCtx, AdWallet);
    // Pessimistic write lock serializes concurrent debits for this wallet.
    const wallet = await walletRepo.findOne({
      where: { channelId: input.channelId },
      lock: { mode: 'pessimistic_write' },
    });
    if (!wallet) {
      // No wallet ⇒ no funded balance ⇒ cannot debit.
      this.logger.warn(`Debit refused: no ad wallet exists for channel ${input.channelId}.`);
      return 'insufficient_funds';
    }
    const balance = await this.sumLedger(txnCtx, String(wallet.id));
    if (balance < input.amountInPaise) {
      this.logger.warn(
        `Debit refused: ledger balance ${balance} < requested ${input.amountInPaise} (channel ${input.channelId}).`
      );
      return 'insufficient_funds';
    }
    const inserted = await this.insertLedgerRow(txnCtx, String(wallet.id), {
      type: 'spend',
      amountInPaise: -input.amountInPaise,
      campaignId: input.campaignId ?? null,
      orderId: null,
      reference: input.reference ?? null,
    });
    if (inserted !== 'inserted') {
      return inserted;
    }
    await this.refreshCache(txnCtx, String(wallet.id));
    return 'inserted';
  }

  private async sumLedger(ctx: RequestContext, walletId: string): Promise<number> {
    const result = await this.connection
      .getRepository(ctx, AdWalletLedger)
      .createQueryBuilder('ledger')
      .select('SUM(ledger.amountInPaise)', 'total')
      .where('ledger.walletId = :walletId', { walletId })
      .getRawOne();
    return parseInt(result?.total ?? '0', 10) || 0;
  }

  /**
   * Insert-first ledger append. Returns duplicate_ref when the UNIQUE
   * (reference) index rejects a retried write. Any other failure is logged
   * as RECONCILIATION-REQUIRED: no movement happened, so the caller's
   * financial operation must not proceed.
   */
  private async insertLedgerRow(
    ctx: RequestContext,
    walletId: string,
    row: {
      type: AdWalletLedger['type'];
      amountInPaise: number;
      campaignId: string | null;
      orderId: string | null;
      reference: string | null;
    },
  ): Promise<WalletMutationResult> {
    const repo = this.connection.getRepository(ctx, AdWalletLedger);
    try {
      await repo.insert(
        repo.create({
          walletId,
          type: row.type,
          amountInPaise: row.amountInPaise,
          occurredAt: new Date(),
          campaignId: row.campaignId,
          orderId: row.orderId,
          reference: row.reference,
        }),
      );
      this.logger.log(
        `AdWalletLedger row appended: wallet=${walletId} type=${row.type} amount=${row.amountInPaise} ref=${row.reference ?? '—'}`
      );
      return 'inserted';
    } catch (err: any) {
      if (err?.code === '23505') {
        this.logger.warn(`Duplicate wallet-ledger reference '${row.reference}'; idempotent no-op.`);
        return 'duplicate_ref';
      }
      this.logger.error(
        `RECONCILIATION-REQUIRED: failed to append AdWalletLedger row for wallet ${walletId}: ${err?.message}`,
        err?.stack
      );
      return 'error';
    }
  }

  /**
   * Refresh the AdWallet.balanceInPaise cache from the authoritative ledger
   * sum. Recompute (not increment) so pre-existing cache drift self-heals.
   * Cache-only: a failure here does NOT undo the ledger row (the ledger is
   * the truth); it is logged for observability.
   */
  private async refreshCache(ctx: RequestContext, walletId: string): Promise<void> {
    try {
      const balance = await this.sumLedger(ctx, walletId);
      await this.connection
        .getRepository(ctx, AdWallet)
        .update({ id: In([walletId]) }, { balanceInPaise: balance });
    } catch (err: any) {
      this.logger.warn(
        `AdWallet cache refresh failed for wallet ${walletId} (ledger row is still authoritative): ${err?.message}`
      );
    }
  }
}