import { Injectable } from '@nestjs/common';
import {
    ChannelService,
    EventBus,
    ID,
    ListQueryBuilder,
    ListQueryOptions,
    RequestContext,
    TransactionalConnection,
    VendureEvent,
    assertFound,
} from '@vendure/core';
import { Banner } from '../entities/banner.entity';
import { BannerPlacement } from '../types';

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
}

export interface UpdateBannerInput extends Partial<CreateBannerInput> {
    id: ID;
}

@Injectable()
export class BannerService {
    constructor(
        private connection: TransactionalConnection,
        private listQueryBuilder: ListQueryBuilder,
        private channelService: ChannelService,
        private eventBus: EventBus,
    ) {}

    findAll(ctx: RequestContext, options?: ListQueryOptions<Banner>) {
        return this.listQueryBuilder
            .build(Banner, options, { ctx, relations: ['image', 'channels'] })
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
     * given placement in the active channel — active flag + date window +
     * channel are all checked here so the storefront query stays a single
     * dumb fetch with no client-side filtering logic to duplicate.
     */
    async findActiveForPlacement(
        ctx: RequestContext,
        placement: BannerPlacement,
    ): Promise<Banner[]> {
        const now = new Date();
        const banners = await this.connection
            .getRepository(ctx, Banner)
            .createQueryBuilder('banner')
            .innerJoin('banner.channels', 'channel', 'channel.id = :channelId', {
                channelId: ctx.channelId,
            })
            .leftJoinAndSelect('banner.image', 'image')
            .where('banner.placement = :placement', { placement })
            .andWhere('banner.isActive = true')
            .andWhere('(banner.startsAt IS NULL OR banner.startsAt <= :now)', { now })
            .andWhere('(banner.endsAt IS NULL OR banner.endsAt >= :now)', { now })
            .orderBy('banner.priority', 'ASC')
            .getMany();

        return banners;
    }

    async create(ctx: RequestContext, input: CreateBannerInput): Promise<Banner> {
        const banner = new Banner(input);
        await this.channelService.assignToCurrentChannel(banner, ctx);
        const saved = await this.connection.getRepository(ctx, Banner).save(banner);

        if (input.channelIds?.length) {
            await this.channelService.assignToChannels(ctx, Banner, saved.id, input.channelIds);
        }

        const savedResult = await assertFound(this.findOne(ctx, saved.id));
        this.eventBus.publish(new BannerEvent(ctx, savedResult, 'created'));
        return savedResult;
    }

    async update(ctx: RequestContext, input: UpdateBannerInput): Promise<Banner> {
        const banner = await this.connection.getEntityOrThrow(ctx, Banner, input.id, {
            channelId: ctx.channelId,
        });
        const updated = new Banner({ ...banner, ...input });
        await this.connection.getRepository(ctx, Banner).save(updated);

        if (input.channelIds?.length) {
            await this.channelService.assignToChannels(ctx, Banner, updated.id, input.channelIds);
        }

        const updatedResult = await assertFound(this.findOne(ctx, updated.id));
        this.eventBus.publish(new BannerEvent(ctx, updatedResult, 'updated'));
        return updatedResult;
    }

    async delete(ctx: RequestContext, id: ID) {
        const banner = await this.connection.getEntityOrThrow(ctx, Banner, id, {
            channelId: ctx.channelId,
        });
        await this.connection.getRepository(ctx, Banner).remove(banner);
        this.eventBus.publish(new BannerEvent(ctx, banner, 'deleted'));
        return { result: 'DELETED' as const };
    }
}
