import { Injectable } from '@nestjs/common';
import {
    ChannelService,
    EventBus,
    ID,
    ListQueryBuilder,
    ListQueryOptions,
    Logger,
    Permission,
    RequestContext,
    TransactionalConnection,
    VendureEvent,
    assertFound,
} from '@vendure/core';
import { Banner } from '../entities/banner.entity';
import { BannerPlacement } from '../types';
import { loggerCtx } from '../constants';
import { CmsChannelAssignmentPolicy } from './cms-channel-assignment.policy';

export class BannerEvent extends VendureEvent {
    createdAt: Date;

    constructor(
        public ctx: RequestContext,
        public banner: Banner,
        public type: 'created' | 'updated' | 'deleted',
    ) {
        super();
        this.createdAt = new Date();
    }
}

export interface CreateBannerInput {
    title: string;
    imageId: ID;
    linkUrl?: string;
    placement: BannerPlacement;
    priority?: number;
    isActive?: boolean;
    startsAt?: Date;
    endsAt?: Date;
    channelIds?: ID[];
    /** FEAT-004 (3C.4): 'marketplace' scope requires SuperAdmin (tenant admins always get 'tenant'). */
    scope?: 'tenant' | 'marketplace';
    /** Marketplace-scope targeting (ignored for tenant banners). */
    targetSubject?: string | null;
    targetCity?: string | null;
    /** FK → MarketplaceAdCampaign.id (spend-backed marketplace banner). */
    campaignId?: string | null;
}

export interface UpdateBannerInput extends Partial<CreateBannerInput> {
    id: ID;
    removeFromChannelIds?: ID[];
}

@Injectable()
export class BannerService {
    constructor(
        private connection: TransactionalConnection,
        private listQueryBuilder: ListQueryBuilder,
        private channelService: ChannelService,
        private eventBus: EventBus,
        private cmsChannelAssignmentPolicy: CmsChannelAssignmentPolicy,
    ) {}

    findAll(ctx: RequestContext, options?: ListQueryOptions<Banner>) {
        return this.listQueryBuilder
            .build(Banner, options, { ctx, relations: ['image', 'channels'] })
            .innerJoin('banner.channels', 'channel', 'channel.id = :channelId', {
                channelId: ctx.channelId,
            })
            .getManyAndCount()
            .then(([items, totalItems]) => ({ items, totalItems }));
    }

    findOne(ctx: RequestContext, id: ID): Promise<Banner | undefined> {
        return this.connection.findOneInChannel(ctx, Banner, id, ctx.channelId, {
            relations: ['image', 'channels'],
        });
    }

    /**
     * Used by the storefront (Shop API) to fetch what's currently live for a
     * given placement in the active channel.
     *
     * Uses the precomputed isCurrentlyActive flag (refreshed every minute by
     * the banner-activator ScheduledTask) instead of runtime date-range
     * comparisons — eliminates the need for date arithmetic on every
     * storefront page load (BUG-015 / CMS-002).
     *
     * FEAT-004 (3C.4): restricted to scope='tenant'. Existing behavior is
     * unchanged — every banner created before 3C.4 carries the 'tenant'
     * default, and marketplace-scope banners are served exclusively by
     * MarketplaceBannerService.
     */
    async findActiveForPlacement(
        ctx: RequestContext,
        placement: BannerPlacement,
    ): Promise<Banner[]> {
        const banners = await this.connection
            .getRepository(ctx, Banner)
            .createQueryBuilder('banner')
            .innerJoin('banner.channels', 'channel', 'channel.id = :channelId', {
                channelId: ctx.channelId,
            })
            .leftJoinAndSelect('banner.image', 'image')
            .where('banner.placement = :placement', { placement })
            .andWhere('banner.isCurrentlyActive = true')
            .andWhere('banner.scope = :scope', { scope: 'tenant' })
            .orderBy('banner.priority', 'ASC')
            .getMany();

        return banners;
    }

    async create(ctx: RequestContext, input: CreateBannerInput): Promise<Banner> {
        Logger.verbose(`Creating Banner placement="${input.placement}" channel=${ctx.channelId}`, loggerCtx);
        // FEAT-004 (3C.4): only SuperAdmin may create marketplace-scope banners;
        // tenant admins always get 'tenant' regardless of what they pass.
        const scope: 'tenant' | 'marketplace' =
            input.scope === 'marketplace' && ctx.userHasPermissions([Permission.SuperAdmin])
                ? 'marketplace'
                : 'tenant';
        const banner = new Banner({
            ...input,
            scope,
            targetSubject: scope === 'marketplace' ? input.targetSubject ?? null : null,
            targetCity: scope === 'marketplace' ? input.targetCity ?? null : null,
            campaignId: scope === 'marketplace' ? input.campaignId ?? null : null,
        });
        // ADR-036: assign by creator role (SuperAdmin → default, Tenant → tenant only).
        await this.cmsChannelAssignmentPolicy.assign(banner, ctx);
        const saved = await this.connection.getRepository(ctx, Banner).save(banner);

        if (input.channelIds?.length && ctx.userHasPermissions([Permission.SuperAdmin])) {
            await this.channelService.assignToChannels(ctx, Banner, saved.id, input.channelIds);
        }

        const savedResult = await assertFound(this.findOne(ctx, saved.id));
        this.eventBus.publish(new BannerEvent(ctx, savedResult, 'created'));
        return savedResult;
    }

    async update(ctx: RequestContext, input: UpdateBannerInput): Promise<Banner> {
        Logger.verbose(`Updating Banner id=${input.id}`, loggerCtx);
        const banner = await this.connection.getEntityOrThrow(ctx, Banner, input.id, {
            channelId: ctx.channelId,
        });
        // FEAT-004 (3C.4): same SuperAdmin guard on scope changes. A scope flip
        // requires SuperAdmin; targeting fields only apply to marketplace scope
        // and are cleared when demoting to tenant.
        const isSuperAdmin = ctx.userHasPermissions([Permission.SuperAdmin]);
        let nextScope: 'tenant' | 'marketplace' = banner.scope ?? 'tenant';
        if (input.scope !== undefined) {
            nextScope = input.scope === 'marketplace' && isSuperAdmin ? 'marketplace' : 'tenant';
        }
        const updated = new Banner({
            ...banner,
            ...input,
            scope: nextScope,
            targetSubject:
                nextScope === 'marketplace' ? (input.targetSubject ?? banner.targetSubject ?? null) : null,
            targetCity:
                nextScope === 'marketplace' ? (input.targetCity ?? banner.targetCity ?? null) : null,
            campaignId:
                nextScope === 'marketplace' ? (input.campaignId ?? banner.campaignId ?? null) : null,
        });
        await this.connection.getRepository(ctx, Banner).save(updated);

        if (input.channelIds?.length && ctx.userHasPermissions([Permission.SuperAdmin])) {
            await this.channelService.assignToChannels(ctx, Banner, updated.id, input.channelIds);
        }
        if (input.removeFromChannelIds?.length && ctx.userHasPermissions([Permission.SuperAdmin])) {
            await this.channelService.removeFromChannels(ctx, Banner, updated.id, input.removeFromChannelIds);
        }

        const updatedResult = await assertFound(this.findOne(ctx, updated.id));
        this.eventBus.publish(new BannerEvent(ctx, updatedResult, 'updated'));
        return updatedResult;
    }

    async delete(ctx: RequestContext, id: ID) {
        const banner = await this.connection.getEntityOrThrow(ctx, Banner, id, {
            channelId: ctx.channelId,
        });
        Logger.info(`Deleting Banner id=${id}`, loggerCtx);
        await this.connection.getRepository(ctx, Banner).remove(banner);
        this.eventBus.publish(new BannerEvent(ctx, banner, 'deleted'));
        return { result: 'DELETED' as const };
    }
}
