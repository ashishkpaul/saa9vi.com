import { Injectable, Logger } from '@nestjs/common';
import { RequestContext, TransactionalConnection } from '@vendure/core';
import { Banner } from '../../cms/entities/banner.entity';
import { AdWallet } from '../entities/ad-wallet.entity';
import { MarketplaceAdCampaign } from '../entities/marketplace-ad-campaign.entity';
import { BannerPlacement } from '../../cms/types';

const loggerCtx = 'MarketplaceBannerService';

/**
 * Serves marketplace-scope banners for the platform-wide marketplace surface
 * (ADR FEAT-004, Phase 3C.4).
 *
 * - Queries ONLY `scope = 'marketplace'` banners; tenant storefront banners are
 *   served exclusively by the CmsPlugin BannerService (which filters to
 *   scope = 'tenant'). The two surfaces can never leak into each other.
 * - Ordering: banners backed by a campaign (campaignId) are ordered by their
 *   campaign's channel wallet balance DESC — higher spenders get priority when
 *   multiple banners compete for the same slot. Banners without a campaign rank
 *   after campaign-backed ones. NOTE: the wallet cache column is used for this
 *   ORDERING only (a display-priority heuristic, NOT a financial decision);
 *   all financial decisions remain ledger-based via AdWalletService (3C.2/3C.3).
 * - No channel filter: marketplace banners are platform-surface content, not
 *   channel inventory (their channel assignment remains for admin ACL only).
 */
@Injectable()
export class MarketplaceBannerService {
  private readonly logger = new Logger(loggerCtx);

  constructor(private readonly connection: TransactionalConnection) {}

  async findActiveForPlacement(ctx: RequestContext, placement: BannerPlacement): Promise<Banner[]> {
    const banners = await this.connection
      .getRepository(ctx, Banner)
      .createQueryBuilder('banner')
      .leftJoinAndSelect('banner.image', 'image')
      .leftJoin(MarketplaceAdCampaign, 'campaign', 'banner.campaignId IS NOT NULL AND CAST(campaign.id AS varchar) = banner.campaignId')
      .leftJoin(AdWallet, 'wallet', 'wallet.channelId = campaign.channelId')
      .where('banner.scope = :scope', { scope: 'marketplace' })
      .andWhere('banner.placement = :placement', { placement })
      .andWhere('banner.isCurrentlyActive = true')
      .orderBy('wallet.balanceInPaise', 'DESC', 'NULLS LAST')
      .addOrderBy('banner.priority', 'ASC')
      .getMany();

    this.logger.verbose(
      `findActiveForPlacement(placement=${placement}) -> ${banners.length} marketplace banner(s)`
    );
    return banners;
  }
}