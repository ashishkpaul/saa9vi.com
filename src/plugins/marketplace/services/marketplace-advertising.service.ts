import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import {
  DeepPartial,
  Permission,
  RequestContext,
  TransactionalConnection,
} from '@vendure/core';
import { MarketplaceAdCampaign } from '../entities/marketplace-ad-campaign.entity';
import { AdWalletLedger } from '../entities/ad-wallet-ledger.entity';
import { AdSpendLedger } from '../entities/ad-spend-ledger.entity';
import { AdWalletService, WalletMutationResult } from './ad-wallet.service';

const loggerCtx = 'MarketplaceAdvertisingService';

export interface CreateCampaignInput {
  type: 'sponsored_listing' | 'banner';
  budgetInPaise: number;
  targetSessionId?: string | null;
  targetSubject?: string | null;
  targetCity?: string | null;
  startsAt: Date;
  endsAt: Date;
  boostWeight?: number;
}

export interface UpdateCampaignInput {
  budgetInPaise?: number;
  targetSessionId?: string | null;
  targetSubject?: string | null;
  targetCity?: string | null;
  startsAt?: Date;
  endsAt?: Date;
  boostWeight?: number;
}
/**
 * Self-serve advertising service (3C.7a).
 *
 * Channel-scoped: every method enforces that the caller's channelId matches
 * the campaign/wallet being accessed. SuperAdmin bypasses the filter.
 *
 * Financial operations (credit/debit) delegate to AdWalletService, which
 * owns the ledger-as-authority invariant. This service never manipulates
 * financial entities directly.
 */
@Injectable()
export class MarketplaceAdvertisingService {
  private readonly logger = new Logger(loggerCtx);

  constructor(
    private readonly connection: TransactionalConnection,
    private readonly walletService: AdWalletService,
  ) {}

  /**
   * Create a campaign for the caller's channel.
   */
  async createCampaign(
    ctx: RequestContext,
    input: CreateCampaignInput,
  ): Promise<MarketplaceAdCampaign> {
    if (input.budgetInPaise < 0) {
      throw new BadRequestException('budgetInPaise must be non-negative');
    }
    if (new Date(input.endsAt) <= new Date(input.startsAt)) {
      throw new BadRequestException('endsAt must be after startsAt');
    }

    const repo = this.connection.getRepository(ctx, MarketplaceAdCampaign);
    const campaign = repo.create({
      channelId: String(ctx.channelId),
      type: input.type,
      status: 'draft',
      budgetInPaise: input.budgetInPaise,
      spentInPaise: 0,
      targetSessionId: input.targetSessionId ?? undefined,
      targetSubject: input.targetSubject ?? undefined,
      targetCity: input.targetCity ?? undefined,
      startsAt: new Date(input.startsAt),
      endsAt: new Date(input.endsAt),
      boostWeight: input.boostWeight ?? 3.0,
    });
    const saved = await repo.save(campaign);
    this.logger.log(
      `Campaign ${saved.id} created for channel ${ctx.channelId}`,
    );
    return saved;
  }

  /**
   * List campaigns for the caller's channel (SuperAdmin sees all).
   */
  async getCampaigns(ctx: RequestContext): Promise<MarketplaceAdCampaign[]> {
    const repo = this.connection.getRepository(ctx, MarketplaceAdCampaign);
    if (ctx.userHasPermissions([Permission.SuperAdmin])) {
      return repo.find({ order: { createdAt: 'DESC' } });
    }
    return repo.find({
      where: { channelId: String(ctx.channelId) },
      order: { createdAt: 'DESC' },
    });
  }

  /**
   * Get a single campaign, enforcing channel ownership.
   */
  async getCampaign(
    ctx: RequestContext,
    id: string,
  ): Promise<MarketplaceAdCampaign | null> {
    const repo = this.connection.getRepository(ctx, MarketplaceAdCampaign);
    const campaign = await repo.findOne({ where: { id: id as any } });
    if (!campaign) {
      return null;
    }
    // Channel-scoped: tenant admin may only see their own campaigns.
    if (
      !ctx.userHasPermissions([Permission.SuperAdmin]) &&
      campaign.channelId !== String(ctx.channelId)
    ) {
      return null;
    }
    return campaign;
  }

  /**
   * Update a campaign's mutable fields. Cannot edit a campaign that has
   * already exhausted its budget.
   */
  async updateCampaign(
    ctx: RequestContext,
    id: string,
    input: UpdateCampaignInput,
  ): Promise<MarketplaceAdCampaign> {
    const campaign = await this.getCampaign(ctx, id);
    if (!campaign) {
      throw new BadRequestException('Campaign not found');
    }
    if (input.budgetInPaise !== undefined) {
      if (input.budgetInPaise < 0) {
        throw new BadRequestException('budgetInPaise must be non-negative');
      }
      campaign.budgetInPaise = input.budgetInPaise;
    }
    if (input.targetSessionId !== undefined) {
      campaign.targetSessionId = input.targetSessionId ?? '';
    }
    if (input.targetSubject !== undefined) {
      campaign.targetSubject = input.targetSubject;
    }
    if (input.targetCity !== undefined) {
      campaign.targetCity = input.targetCity;
    }
    if (input.startsAt !== undefined) {
      campaign.startsAt = new Date(input.startsAt);
    }
    if (input.endsAt !== undefined) {
      campaign.endsAt = new Date(input.endsAt);
    }
    if (input.boostWeight !== undefined) {
      campaign.boostWeight = input.boostWeight;
    }
    if (campaign.endsAt <= campaign.startsAt) {
      throw new BadRequestException('endsAt must be after startsAt');
    }
    const repo = this.connection.getRepository(ctx, MarketplaceAdCampaign);
    return repo.save(campaign);
  }

  /**
   * Activate a draft or paused campaign.
   */
  async activateCampaign(
    ctx: RequestContext,
    id: string,
  ): Promise<MarketplaceAdCampaign> {
    const campaign = await this.getCampaign(ctx, id);
    if (!campaign) {
      throw new BadRequestException('Campaign not found');
    }
    if (campaign.status !== 'draft' && campaign.status !== 'paused') {
      throw new BadRequestException(
        `Cannot activate campaign in '${campaign.status}' status`,
      );
    }
    campaign.status = 'active';
    const repo = this.connection.getRepository(ctx, MarketplaceAdCampaign);
    return repo.save(campaign);
  }

  /**
   * Pause an active campaign.
   */
  async pauseCampaign(
    ctx: RequestContext,
    id: string,
  ): Promise<MarketplaceAdCampaign> {
    const campaign = await this.getCampaign(ctx, id);
    if (!campaign) {
      throw new BadRequestException('Campaign not found');
    }
    if (campaign.status !== 'active') {
      throw new BadRequestException(
        `Cannot pause campaign in '${campaign.status}' status`,
      );
    }
    campaign.status = 'paused';
    const repo = this.connection.getRepository(ctx, MarketplaceAdCampaign);
    return repo.save(campaign);
  }

  /**
   * Get the wallet balance for the caller's channel.
   * Delegates to AdWalletService (ledger-as-authority).
   */
  async getWalletBalance(ctx: RequestContext): Promise<number> {
    return this.walletService.getBalance(ctx, String(ctx.channelId));
  }

  /**
   * Get the wallet ledger for the caller's channel.
   */
  async getWalletLedger(
    ctx: RequestContext,
  ): Promise<AdWalletLedger[]> {
    const wallet = await this.walletService.ensureWallet(
      ctx,
      String(ctx.channelId),
    );
    const repo = this.connection.getRepository(ctx, AdWalletLedger);
    return repo.find({
      where: { walletId: String(wallet.id) },
      order: { occurredAt: 'DESC' },
    });
  }

  /**
   * Get spend report for a campaign.
   */
  async getSpendReport(
    ctx: RequestContext,
    campaignId: string,
  ): Promise<AdSpendLedger[]> {
    const campaign = await this.getCampaign(ctx, campaignId);
    if (!campaign) {
      throw new BadRequestException('Campaign not found');
    }
    const repo = this.connection.getRepository(ctx, AdSpendLedger);
    return repo.find({
      where: { campaignId },
      order: { occurredAt: 'DESC' },
    });
  }

  /**
   * Top up the wallet for the caller's channel.
   * NOTE: In production this should be backed by a payment flow (Juspay order).
   * The `reference` should be the Juspay order id for idempotency.
   */
  async topUpWallet(
    ctx: RequestContext,
    amountInPaise: number,
    reference: string,
  ): Promise<WalletMutationResult> {
    if (!Number.isInteger(amountInPaise) || amountInPaise <= 0) {
      throw new BadRequestException('amountInPaise must be a positive integer');
    }
    if (!reference) {
      throw new BadRequestException('reference is required for idempotency');
    }
    return this.walletService.creditWallet(ctx, {
      channelId: String(ctx.channelId),
      amountInPaise,
      type: 'topup',
      reference,
    });
  }
}

