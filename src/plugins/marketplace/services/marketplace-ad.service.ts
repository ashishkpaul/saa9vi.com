import { Injectable, Logger } from '@nestjs/common';
import { RequestContext, TransactionalConnection } from '@vendure/core';
import { MarketplaceAdCampaign } from '../entities/marketplace-ad-campaign.entity';
import { AdSpendLedger } from '../entities/ad-spend-ledger.entity';
import { AdWallet } from '../entities/ad-wallet.entity';
import { AdWalletService } from './ad-wallet.service';

const loggerCtx = 'MarketplaceAdService';

export interface RecordCampaignSpendInput {
  campaignId: string;
  eventType: 'impression' | 'click' | 'conversion';
  /** Positive amount in minor units to debit from the campaign's wallet. */
  amountInPaise: number;
  /**
   * Caller-supplied idempotency key spanning BOTH ledgers (e.g.
   * `campaign:{id}:click:{impressionEventId}`). A retried spend with the same
   * reference neither debits the wallet twice nor creates a second spend fact.
   */
  reference: string;
  orderId?: string | null;
}

export type RecordCampaignSpendResult =
  | 'recorded'
  | 'duplicate_ref'
  | 'insufficient_funds'
  | 'budget_exceeded'
  | 'campaign_invalid'
  | 'error';

/**
 * Service for managing marketplace advertising campaigns, ad spend ledgers,
 * and ad wallets.
 *
 * INV-010: Campaign.spentInPaise is a cache. Truth is SUM(AdSpendLedger).
 */
@Injectable()
export class MarketplaceAdService {
  private readonly logger = new Logger(loggerCtx);

  constructor(
    private readonly connection: TransactionalConnection,
    private readonly walletService: AdWalletService,
  ) {}

  /**
   * Find active sponsored listing campaigns for a given session.
   * Returns the campaign with the highest boost weight if multiple exist.
   */
  async findActiveCampaignForSession(sessionId: string): Promise<MarketplaceAdCampaign | null> {
    const now = new Date();
    const repo = this.connection.rawConnection.getRepository(MarketplaceAdCampaign);
    return repo.findOne({
      where: {
        targetSessionId: sessionId,
        status: 'active',
        startsAt: { $lte: now } as any,
        endsAt: { $gte: now } as any,
      },
      order: { boostWeight: 'DESC' },
    });
  }

  /**
   * Find all active campaigns for a channel (academy).
   */
  async findActiveByChannel(channelId: string): Promise<MarketplaceAdCampaign[]> {
    const now = new Date();
    const repo = this.connection.rawConnection.getRepository(MarketplaceAdCampaign);
    return repo.find({
      where: {
        channelId,
        status: 'active',
        startsAt: { $lte: now } as any,
        endsAt: { $gte: now } as any,
      },
    });
  }

  /**
   * Get the true spent amount from the append-only ledger (INV-010).
   */
  async getTrueSpent(campaignId: string): Promise<number> {
    const result = await this.connection.rawConnection
      .getRepository(AdSpendLedger)
      .createQueryBuilder('ledger')
      .select('SUM(ledger.amountInPaise)', 'total')
      .where('ledger.campaignId = :campaignId', { campaignId })
      .getRawOne();
    return parseInt(result?.total ?? '0', 10) || 0;
  }

  /**
   * Get the wallet balance for a channel from the LEDGER (AdWalletLedger SUM),
   * not from the AdWallet.balanceInPaise cache. Delegates to AdWalletService —
   * no campaign-spend decision may depend on the cached balance column.
   */
  async getWalletBalance(ctx: RequestContext, channelId: string): Promise<number> {
    return this.walletService.getBalance(ctx, channelId);
  }

  /**
   * Record one advertising-spend fact for a campaign, charging the academy's
   * prepaid wallet (Phase 3C.3). The two financial ledgers are connected here:
   *
   *   validate campaign → idempotency reference → debit wallet → AdSpendLedger row
   *
   * ATOMICITY: the wallet debit and the AdSpendLedger insert execute inside the
   * SAME transaction. AdWalletService.debitWallet's inner withTransaction JOINS
   * the outer transaction (Vendure's TransactionWrapper inherits the open query
   * runner), so a failure while writing the spend fact rolls back the wallet
   * debit too — the failure mode `wallet debited but spend fact missing` cannot
   * occur, and no reconciliation path is needed for it.
   *
   * INV-010: AdSpendLedger remains the authoritative advertising-spend truth
   * (Campaign.spentInPaise is refreshed from SUM(AdSpendLedger) in the same
   * transaction — recompute, not increment).
   *
   * Idempotency spans BOTH ledgers via the single `reference` key: a retried
   * spend neither debits the wallet twice nor writes a second spend fact.
   */
  async recordCampaignSpend(ctx: RequestContext, input: RecordCampaignSpendInput): Promise<RecordCampaignSpendResult> {
    if (!Number.isInteger(input.amountInPaise) || input.amountInPaise <= 0) {
      throw new Error(
        `MarketplaceAdService: spend amount must be a positive integer in paise (got ${input.amountInPaise}).`
      );
    }
    return this.connection.withTransaction(ctx, async (txnCtx) => {
      // ---- 1. Campaign validation ----------------------------------------
      const campaignRepo = this.connection.getRepository(txnCtx, MarketplaceAdCampaign);
      const campaign = await campaignRepo.findOne({ where: { id: input.campaignId as any } });
      if (!campaign) {
        this.logger.warn(`Spend refused: campaign ${input.campaignId} not found.`);
        return 'campaign_invalid';
      }
      // Channel ownership: the campaign may only spend from its own channel's wallet.
      if (String(campaign.channelId) !== String(ctx.channelId)) {
        this.logger.warn(
          `Spend refused: campaign ${input.campaignId} belongs to channel ${campaign.channelId}, ` +
            `not the requesting channel ${ctx.channelId}.`
        );
        return 'campaign_invalid';
      }
      const now = new Date();
      if (campaign.status !== 'active' || campaign.startsAt > now || campaign.endsAt < now) {
        this.logger.warn(
          `Spend refused: campaign ${input.campaignId} not eligible (status=${campaign.status}, ` +
            `window=${campaign.startsAt.toISOString()}..${campaign.endsAt.toISOString()}, now=${now.toISOString()}).`
        );
        return 'campaign_invalid';
      }
      // Budget cap (INV-010 truth): true spent + amount must fit the budget (0 = uncapped).
      const trueSpent = await this.getTrueSpent(input.campaignId);
      if (campaign.budgetInPaise > 0 && trueSpent + input.amountInPaise > campaign.budgetInPaise) {
        this.logger.warn(
          `Spend refused: campaign ${input.campaignId} budget exceeded ` +
            `(spent=${trueSpent} + requested=${input.amountInPaise} > budget=${campaign.budgetInPaise}).`
        );
        return 'budget_exceeded';
      }

      // ---- 2. Wallet debit on the SAME transaction (no nesting) -----------
      const debit = await this.walletService.debitWalletInTxn(txnCtx, {
        channelId: String(ctx.channelId),
        amountInPaise: input.amountInPaise,
        campaignId: input.campaignId,
        reference: input.reference,
      });
      if (debit === 'duplicate_ref') {
        // Idempotent replay across the ledger boundary: neither debit nor spend fact.
        return 'duplicate_ref';
      }
      if (debit === 'insufficient_funds') {
        return 'insufficient_funds';
      }
      if (debit === 'error') {
        // Wallet ledger persistence failed and no debit happened — the caller
        // must not record a spend fact for money that was not charged.
        return 'error';
      }

      // ---- 3. AdSpendLedger fact (same transaction; failure rolls back the debit)
      try {
        const spendRepo = this.connection.getRepository(txnCtx, AdSpendLedger);
        await spendRepo.insert(
          spendRepo.create({
            campaignId: input.campaignId,
            eventType: input.eventType,
            amountInPaise: input.amountInPaise,
            occurredAt: new Date(),
            orderId: input.orderId ?? null,
          }),
        );
      } catch (err: any) {
        // Throwing rolls back the wallet debit within the shared transaction:
        // wallet and spend fact can never diverge. Logged as a hard failure.
        this.logger.error(
          `RECONCILIATION-ROLLBACK: AdSpendLedger insert failed for campaign ${input.campaignId} ` +
            `(wallet debit rolled back atomically): ${err?.message}`,
          err?.stack
        );
        throw err;
      }

      // ---- 4. Refresh the INV-010 cache from the ledger (recompute) --------
      try {
        const spent = await this.getTrueSpent(input.campaignId);
        await campaignRepo.update({ id: input.campaignId as any }, { spentInPaise: spent });
      } catch (err: any) {
        // Cache-only failure: the ledger rows are committed truth either way.
        this.logger.warn(
          `Campaign.spentInPaise cache refresh failed for ${input.campaignId} (ledger is authoritative): ${err?.message}`
        );
      }

      this.logger.log(
        `Campaign spend recorded: campaign=${input.campaignId} type=${input.eventType} ` +
          `amount=${input.amountInPaise} ref=${input.reference}`
      );
      return 'recorded';
    });
  }
}