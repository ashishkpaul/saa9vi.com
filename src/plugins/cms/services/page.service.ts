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
    UserInputError,
    VendureEvent,
    assertFound,
} from '@vendure/core';
import { Page } from '../entities/page.entity';
import { PageSection } from '../types';
import { loggerCtx } from '../constants';
import { CmsChannelAssignmentPolicy } from './cms-channel-assignment.policy';

export class PageEvent extends VendureEvent {
    createdAt: Date;

    constructor(
        public ctx: RequestContext,
        public page: Page,
        public type: 'created' | 'updated' | 'deleted',
    ) {
        super();
        this.createdAt = new Date();
    }
}

export interface CreatePageInput {
    slug: string;
    title: string;
    metaDescription?: string;
    isPublished?: boolean;
    sections?: PageSection[];
    channelIds?: ID[];
}

export interface UpdatePageInput extends Partial<CreatePageInput> {
    id: ID;
    removeFromChannelIds?: ID[];
}

@Injectable()
export class PageService {
    constructor(
        private connection: TransactionalConnection,
        private listQueryBuilder: ListQueryBuilder,
        private channelService: ChannelService,
        private eventBus: EventBus,
        private cmsChannelAssignmentPolicy: CmsChannelAssignmentPolicy,
    ) {}

    findAll(ctx: RequestContext, options?: ListQueryOptions<Page>) {
        return this.listQueryBuilder
            .build(Page, options, { ctx, relations: ['channels'] })
            .innerJoin('page.channels', 'channel', 'channel.id = :channelId', {
                channelId: ctx.channelId,
            })
            .getManyAndCount()
            .then(([items, totalItems]) => ({ items, totalItems }));
    }

    findOne(ctx: RequestContext, id: ID): Promise<Page | undefined> {
        return this.connection.findOneInChannel(ctx, Page, id, ctx.channelId, {
            relations: ['channels'],
        });
    }

    /** Used by the storefront to resolve a Page by its URL slug within the active channel */
    findBySlug(ctx: RequestContext, slug: string): Promise<Page | null> {
        return this.connection
            .getRepository(ctx, Page)
            .createQueryBuilder('page')
            .innerJoin('page.channels', 'channel', 'channel.id = :channelId', {
                channelId: ctx.channelId,
            })
            .where('page.slug = :slug', { slug })
            .andWhere('page.isPublished = true')
            .getOne();
    }

    async create(ctx: RequestContext, input: CreatePageInput): Promise<Page> {
        await this.assertSlugIsUnique(ctx, input.slug);
        this.validateSections(input.sections ?? []);
        Logger.verbose(`Creating Page slug="${input.slug}" channel=${ctx.channelId}`, loggerCtx);

        const page = new Page({ ...input, sections: input.sections ?? [] });
        // ADR-036: assign by creator role (SuperAdmin → default, Tenant → tenant only).
        await this.cmsChannelAssignmentPolicy.assign(page, ctx);
        const saved = await this.connection.getRepository(ctx, Page).save(page);

        if (input.channelIds?.length && ctx.userHasPermissions([Permission.SuperAdmin])) {
            await this.channelService.assignToChannels(ctx, Page, saved.id, input.channelIds);
        }

        const savedResult = await assertFound(this.findOne(ctx, saved.id));
        this.eventBus.publish(new PageEvent(ctx, savedResult, 'created'));
        return savedResult;
    }

    async update(ctx: RequestContext, input: UpdatePageInput): Promise<Page> {
        Logger.verbose(`Updating Page id=${input.id}`, loggerCtx);
        const page = await this.connection.getEntityOrThrow(ctx, Page, input.id, {
            channelId: ctx.channelId,
        });

        if (input.slug && input.slug !== page.slug) {
            await this.assertSlugIsUnique(ctx, input.slug, input.id);
        }
        if (input.sections) {
            this.validateSections(input.sections);
        }

        const updated = new Page({ ...page, ...input });
        await this.connection.getRepository(ctx, Page).save(updated);

        if (input.channelIds?.length && ctx.userHasPermissions([Permission.SuperAdmin])) {
            await this.channelService.assignToChannels(ctx, Page, updated.id, input.channelIds);
        }
        if (input.removeFromChannelIds?.length && ctx.userHasPermissions([Permission.SuperAdmin])) {
            await this.channelService.removeFromChannels(ctx, Page, updated.id, input.removeFromChannelIds);
        }

        const updatedResult = await assertFound(this.findOne(ctx, updated.id));
        this.eventBus.publish(new PageEvent(ctx, updatedResult, 'updated'));
        return updatedResult;
    }

    async delete(ctx: RequestContext, id: ID) {
        const page = await this.connection.getEntityOrThrow(ctx, Page, id, {
            channelId: ctx.channelId,
        });
        Logger.info(`Deleting Page id=${id} slug="${page.slug}"`, loggerCtx);
        await this.connection.getRepository(ctx, Page).remove(page);
        this.eventBus.publish(new PageEvent(ctx, page, 'deleted'));
        return { result: 'DELETED' as const };
    }

    private async assertSlugIsUnique(ctx: RequestContext, slug: string, excludeId?: ID) {
        const qb = this.connection
            .getRepository(ctx, Page)
            .createQueryBuilder('page')
            .innerJoin('page.channels', 'channel', 'channel.id = :channelId', {
                channelId: ctx.channelId,
            })
            .where('page.slug = :slug', { slug });

        if (excludeId) {
            qb.andWhere('page.id != :excludeId', { excludeId });
        }

        const existing = await qb.getOne();
        if (existing) {
            throw new UserInputError(`A page with the slug "${slug}" already exists in this channel`);
        }
    }

    /** Defensive guard since `sections` arrives as loosely-typed JSON over GraphQL */
    private validateSections(sections: PageSection[]) {
        const ids = new Set<string>();
        for (const section of sections) {
            if (!section.id || !section.type) {
                throw new UserInputError('Each page section requires an id and a type');
            }
            if (ids.has(section.id)) {
                throw new UserInputError(`Duplicate section id "${section.id}"`);
            }
            ids.add(section.id);

            if (section.type === 'hero') {
                if (!section.config.headline?.trim()) {
                    throw new UserInputError(`hero section "${section.id}" requires a non-empty headline`);
                }
            }
            if (section.type === 'richText') {
                if (!section.config.html?.trim()) {
                    throw new UserInputError(`richText section "${section.id}" requires html content`);
                }
            }
            if (section.type === 'productGrid') {
                const limit = section.config.limit;
                if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
                    throw new UserInputError(`productGrid section "${section.id}" limit must be between 1 and 100`);
                }
            }
            if (section.type === 'articleGrid') {
                const articleIds = section.config.articleIds;
                if (!Array.isArray(articleIds) || articleIds.length === 0) {
                    throw new UserInputError(`articleGrid section "${section.id}" requires at least one articleId`);
                }
            }
            if (section.type === 'bannerSlot') {
                if (!section.config.placement) {
                    throw new UserInputError(`bannerSlot section "${section.id}" requires a placement`);
                }
            }
        }
    }
}
