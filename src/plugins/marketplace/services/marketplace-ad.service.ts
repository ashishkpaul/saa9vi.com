import { Injectable, Logger } from '@nestjs/common';
import { TransactionalConnection } from '@vendure/core';
import { MarketplaceAdCampaign } from '../entities/marketplace-ad-campaign.entity';
import { AdSpendLedger } from '../entities/ad-spend-ledger.entity';
import { AdWallet } from '../entities/ad-wallet.entity';

const loggerCtx = 'MarketplaceAdService';

/**
 * Service for managing marketplace advertising campaigns, ad spend ledgers,
 * and ad wallets.
 *
 * INV-010: Campaign.spentInPaise is a cache. Truth is SUM(AdSpendLedger).
 */
@Injectable()
export class MarketplaceAdService {
  constructor(
    private readonly connection: TransactionalConnection,
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
   * Get wallet balance for a channel.
   */
  async getWalletBalance(channelId: string): Promise<number> {
    const wallet = await this.connection.rawConnection
      .getRepository(AdWallet)
      .findOne({ where: { channelId } });
    return wallet?.balanceInPaise ?? 0;
  }
}