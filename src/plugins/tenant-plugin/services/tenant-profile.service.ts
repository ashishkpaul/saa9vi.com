import { Injectable } from '@nestjs/common';
import { Channel, RequestContext, TransactionalConnection, ChannelService, RequestContextService } from '@vendure/core';
import { TenantProfile } from '../entities/tenant-profile.entity';
import { DomainChannelResolverService } from './domain-channel-resolver.service';

@Injectable()
export class TenantProfileService {
  constructor(
    private readonly connection: TransactionalConnection,
    private readonly channelService: ChannelService,
    private readonly requestContextService: RequestContextService,
    private readonly domainResolver: DomainChannelResolverService,
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
    // Use assignToCurrentChannel with a context scoped to the target channel.
    // assignToCurrentChannel reads ctx.channelId to determine which channel to
    // assign to, so when the caller's ctx doesn't match the target channelId,
    // we create a channel-scoped context. This fixes the "assignToCurrentChannel
    // gotcha" documented in TenantRegistrationService.registerTenant().
    //
    // NOTE: RequestContextService.create()'s channelOrToken param accepts a
    // Channel instance or a token string — NOT a raw channel ID. We resolve
    // the Channel entity first so we can pass the instance.
    const assignCtx = ctx.channelId !== channelId
      ? await this.requestContextService.create({
          apiType: 'admin',
          channelOrToken: await this.connection.getRepository(ctx, Channel).findOneOrFail({
            where: { id: channelId },
          }),
        })
      : ctx;
    await this.channelService.assignToCurrentChannel(profile, assignCtx);
    const saved = await this.connection.getRepository(ctx, TenantProfile).save(profile);

    // Sync custom domain to Redis if set
    if (saved.customDomain) {
      const channel = await this.connection.getRepository(ctx, 'Channel').findOne({ where: { id: channelId } });
      if (channel) {
        await this.domainResolver.setMapping(saved.customDomain, (channel as any).token);
      }
    }

    return saved;
  }

  async update(ctx: RequestContext, channelId: string, input: Partial<TenantProfile>): Promise<TenantProfile> {
    const profile = await this.findByChannelIdOrThrow(ctx, channelId);
    const oldDomain = profile.customDomain;
    Object.assign(profile, input);
    const saved = await this.connection.getRepository(ctx, TenantProfile).save(profile);

    // Sync custom domain changes to Redis
    const newDomain = saved.customDomain;
    if (oldDomain !== newDomain) {
      if (oldDomain) {
        await this.domainResolver.removeMapping(oldDomain);
      }
      if (newDomain) {
        const channel = await this.connection.getRepository(ctx, 'Channel').findOne({ where: { id: channelId } });
        if (channel) {
          await this.domainResolver.setMapping(newDomain, (channel as any).token);
        }
      }
    }

    return saved;
  }
}
