import { Injectable } from '@nestjs/common';
import { EventBus, RequestContext, TransactionalConnection, ChannelService } from '@vendure/core';
import { ID } from '@vendure/common/lib/shared-types';
import { TenantProfile } from '../entities/tenant-profile.entity';
import { DomainChannelResolverService } from './domain-channel-resolver.service';
import { TenantProfileUpdatedEvent } from '../events/tenant-events';

@Injectable()
export class TenantProfileService {
  constructor(
    private readonly connection: TransactionalConnection,
    private readonly channelService: ChannelService,
    private readonly domainResolver: DomainChannelResolverService,
    private readonly eventBus: EventBus,
  ) {}

  async findByChannelId(ctx: RequestContext, channelId: ID): Promise<TenantProfile | null> {
    return this.connection
      .getRepository(ctx, TenantProfile)
      .findOne({ where: { channelId } });
  }

  async findByChannelIdOrThrow(ctx: RequestContext, channelId: ID): Promise<TenantProfile> {
    const profile = await this.findByChannelId(ctx, channelId);
    if (!profile) {
      throw new Error(`TenantProfile not found for channel ${channelId}`);
    }
    return profile;
  }

  async create(ctx: RequestContext, input: Partial<TenantProfile>): Promise<TenantProfile> {
    const channelId = input.channelId || ctx.channelId as ID;
    if (!channelId) {
      throw new Error('channelId is required');
    }
    const existing = await this.findByChannelId(ctx, channelId);
    if (existing) {
      throw new Error(`TenantProfile already exists for channel ${channelId}`);
    }
    const profile = new TenantProfile({ ...input, channelId });

    // Save first to get an ID, then assign to channel
    const saved = await this.connection.getRepository(ctx, TenantProfile).save(profile);

    // Use assignToChannels with an explicit channelId rather than
    // assignToCurrentChannel, which reads ctx.channelId and would silently
    // assign to the wrong channel when ctx is scoped to a different channel
    // (e.g. the default Shop API channel during self-serve registration).
    // assignToChannels uses the same transactional ctx so it sees the Channel
    // row that was just inserted in the same open transaction — no second
    // RequestContext needed (fixes BUG-021 / root cause from TP-004).
    await this.channelService.assignToChannels(ctx, TenantProfile, saved.id, [channelId]);

    // Sync custom domain to Redis if set
    if (saved.customDomain) {
      const channel = await this.connection.getRepository(ctx, 'Channel').findOne({ where: { id: channelId } });
      if (channel) {
        await this.domainResolver.setMapping(saved.customDomain, (channel as any).token);
      }
    }

    return saved;
  }

  async update(ctx: RequestContext, channelId: ID, input: Partial<TenantProfile>): Promise<TenantProfile> {
    const profile = await this.findByChannelIdOrThrow(ctx, channelId);
    const oldDomain = profile.customDomain;
    const updatedFields = Object.keys(input);
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

    // Gate 1.4 (F5): notify marketplace consumers so every marketplace
    // document belonging to this channel can be bulk-invalidated/reindexed.
    this.eventBus.publish(
      new TenantProfileUpdatedEvent(String(saved.id), String(channelId), updatedFields),
    );

    return saved;
  }
}
