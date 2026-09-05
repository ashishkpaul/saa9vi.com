import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';
import {
  Allow,
  Ctx,
  ID,
  RequestContext,
  Transaction,
} from '@vendure/core';
import { MarketplaceAdvertisingService } from '../services/marketplace-advertising.service';
import { MarketplaceAdCampaign } from '../entities/marketplace-ad-campaign.entity';
import { AdWalletLedger } from '../entities/ad-wallet-ledger.entity';
import { AdSpendLedger } from '../entities/ad-spend-ledger.entity';
import {
  CreateCampaignPermission,
  ReadCampaignPermission,
  UpdateCampaignPermission,
} from '../constants';

@Resolver()
export class MarketplaceAdvertisingResolver {
  constructor(
    private readonly advertisingService: MarketplaceAdvertisingService,
  ) {}

  // ── Campaigns ──────────────────────────────────────────────────

  @Query()
  @Allow(ReadCampaignPermission)
  async campaigns(
    @Ctx() ctx: RequestContext,
  ): Promise<MarketplaceAdCampaign[]> {
    return this.advertisingService.getCampaigns(ctx);
  }

  @Query()
  @Allow(ReadCampaignPermission)
  async campaign(
    @Ctx() ctx: RequestContext,
    @Args() args: { id: ID },
  ): Promise<MarketplaceAdCampaign | null> {
    return this.advertisingService.getCampaign(ctx, args.id as string);
  }

  @Mutation()
  @Allow(CreateCampaignPermission)
  @Transaction()
  async createCampaign(
    @Ctx() ctx: RequestContext,
    @Args('input') input: any,
  ): Promise<MarketplaceAdCampaign> {
    return this.advertisingService.createCampaign(ctx, input);
  }

  @Mutation()
  @Allow(UpdateCampaignPermission)
  @Transaction()
  async updateCampaign(
    @Ctx() ctx: RequestContext,
    @Args() args: { id: ID; input: any },
  ): Promise<MarketplaceAdCampaign> {
    return this.advertisingService.updateCampaign(
      ctx,
      args.id as string,
      args.input,
    );
  }

  @Mutation()
  @Allow(UpdateCampaignPermission)
  @Transaction()
  async activateCampaign(
    @Ctx() ctx: RequestContext,
    @Args() args: { id: ID },
  ): Promise<MarketplaceAdCampaign> {
    return this.advertisingService.activateCampaign(ctx, args.id as string);
  }

  @Mutation()
  @Allow(UpdateCampaignPermission)
  @Transaction()
  async pauseCampaign(
    @Ctx() ctx: RequestContext,
    @Args() args: { id: ID },
  ): Promise<MarketplaceAdCampaign> {
    return this.advertisingService.pauseCampaign(ctx, args.id as string);
  }

  // ── Wallet ─────────────────────────────────────────────────────

  @Query()
  @Allow(ReadCampaignPermission)
  async walletBalance(@Ctx() ctx: RequestContext): Promise<number> {
    return this.advertisingService.getWalletBalance(ctx);
  }

  @Query()
  @Allow(ReadCampaignPermission)
  async walletLedger(
    @Ctx() ctx: RequestContext,
  ): Promise<AdWalletLedger[]> {
    return this.advertisingService.getWalletLedger(ctx);
  }

  @Mutation()
  @Allow(CreateCampaignPermission)
  @Transaction()
  async topUpWallet(
    @Ctx() ctx: RequestContext,
    @Args() args: { amountInPaise: number; reference: string },
  ): Promise<string> {
    const result = await this.advertisingService.topUpWallet(
      ctx,
      args.amountInPaise,
      args.reference,
    );
    return result;
  }

  // ── Spend report ───────────────────────────────────────────────

  @Query()
  @Allow(ReadCampaignPermission)
  async spendReport(
    @Ctx() ctx: RequestContext,
    @Args() args: { campaignId: ID },
  ): Promise<AdSpendLedger[]> {
    return this.advertisingService.getSpendReport(
      ctx,
      args.campaignId as string,
    );
  }
}
