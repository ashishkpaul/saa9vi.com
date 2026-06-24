import { Injectable } from '@nestjs/common';
import { RequestContext, TransactionalConnection, ChannelService } from '@vendure/core';
import { TenantProfile } from '../entities/tenant-profile.entity';

@Injectable()
export class TenantProfileService {
  constructor(
    private readonly connection: TransactionalConnection,
    private readonly channelService: ChannelService,
  ) {}

  async findByChannelId(ctx: RequestContext, channelId: string): Promise<TenantProfile | null> {
    return this.connection
      .getRepository(ctx, TenantProfile)
      .findOne({ where: { channelId } });
  }

  async findByChannelIdOrThrow(ctx: RequestContext, channelId: string): Promise<TenantProfile> {
    const profile = await this.findByChannelId(ctx, channelId);
    if (!profile) {
      throw new Error(`TenantProfile not found for channel ${channelId}`);
    }
    return profile;
  }

  async create(ctx: RequestContext, input: Partial<TenantProfile>): Promise<TenantProfile> {
    const channelId = input.channelId || ctx.channelId as string;
    if (!channelId) {
      throw new Error('channelId is required');
    }
    const existing = await this.findByChannelId(ctx, channelId);
    if (existing) {
      throw new Error(`TenantProfile already exists for channel ${channelId}`);
    }
    const profile = new TenantProfile({ ...input, channelId });
    await this.channelService.assignToCurrentChannel(profile, ctx);
    return this.connection.getRepository(ctx, TenantProfile).save(profile);
  }

  async update(ctx: RequestContext, channelId: string, input: Partial<TenantProfile>): Promise<TenantProfile> {
    const profile = await this.findByChannelIdOrThrow(ctx, channelId);
    Object.assign(profile, input);
    return this.connection.getRepository(ctx, TenantProfile).save(profile);
  }
}