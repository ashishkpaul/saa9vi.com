import { Injectable } from '@nestjs/common';
import {
    ChannelService,
    EventBus,
    ID,
    ListQueryBuilder,
    ListQueryOptions,
    Logger,
    RequestContext,
    TransactionalConnection,
    UserInputError,
    VendureEvent,
    assertFound,
} from '@vendure/core';
import { loggerCtx } from '../constants';
import { Article } from '../entities/article.entity';
import { CmsChannelAssignmentPolicy } from './cms-channel-assignment.policy';

export class ArticleEvent extends VendureEvent {
    createdAt: Date;

    constructor(
        public ctx: RequestContext,
        public article: Article,
        public type: 'created' | 'updated' | 'deleted',
    ) {
        super();
        this.createdAt = new Date();
    }
}

export interface CreateArticleInput {
    slug: string;
    title: string;
    excerpt?: string;
    body: string;
    isPublished?: boolean;
    featuredAssetId?: ID;
    tags?: string[];
    /**
     * Additional channel ids to publish to, beyond the channel the admin is
     * currently operating in. Lets a platform admin publish a single article
     * to several seller channels at once if needed; usually left empty.
     */
    channelIds?: ID[];
}

export interface UpdateArticleInput extends Partial<CreateArticleInput> {
    id: ID;
    removeFromChannelIds?: ID[];
}

@Injectable()
export class ArticleService {
    constructor(
        private connection: TransactionalConnection,
        private listQueryBuilder: ListQueryBuilder,
        private channelService: ChannelService,
        private eventBus: EventBus,
        private cmsChannelAssignmentPolicy: CmsChannelAssignmentPolicy,
    ) {}

    findAll(ctx: RequestContext, options?: ListQueryOptions<Article>) {
        // ListQueryBuilder automatically restricts results to the active
        // Channel (ctx.channelId) because Article implements ChannelAware.
        return this.listQueryBuilder
            .build(Article, options, {
                ctx,
                relations: ['featuredAsset', 'channels'],
            })
            .getManyAndCount()
            .then(([items, totalItems]) => ({ items, totalItems }));
    }

    findOne(ctx: RequestContext, id: ID): Promise<Article | undefined> {
        return this.connection.findOneInChannel(ctx, Article, id, ctx.channelId, {
            relations: ['featuredAsset', 'channels'],
        });
    }

    async findPublishedBySlug(ctx: RequestContext, slug: string): Promise<Article | null> {
        return this.connection
            .getRepository(ctx, Article)
            .createQueryBuilder('article')
            .innerJoin('article.channels', 'channel', 'channel.id = :channelId', {
                channelId: ctx.channelId,
            })
            .leftJoinAndSelect('article.featuredAsset', 'featuredAsset')
            .where('article.slug = :slug', { slug })
            .andWhere('article.isPublished = true')
            .getOne();
    }

    async create(ctx: RequestContext, input: CreateArticleInput): Promise<Article> {
        await this.assertSlugIsUnique(ctx, input.slug);
        Logger.verbose(`Creating Article slug="${input.slug}" channel=${ctx.channelId}`, loggerCtx);

        const article = new Article({
            ...input,
            publishedAt: input.isPublished ? new Date() : null,
        });

        // ADR-036: assign by creator role (SuperAdmin → default, Tenant → tenant only).
        // Previously used assignToCurrentChannel(), which leaked tenant-created
        // articles onto the default channel (BUG-031).
        await this.cmsChannelAssignmentPolicy.assign(article, ctx);

        const saved = await this.connection.getRepository(ctx, Article).save(article);

        if (input.channelIds?.length) {
            await this.channelService.assignToChannels(ctx, Article, saved.id, input.channelIds);
        }

        const savedResult = await assertFound(this.findOne(ctx, saved.id));
        this.eventBus.publish(new ArticleEvent(ctx, savedResult, 'created'));
        return savedResult;
    }

    async update(ctx: RequestContext, input: UpdateArticleInput): Promise<Article> {
        Logger.verbose(`Updating Article id=${input.id}`, loggerCtx);
        const article = await this.connection.getEntityOrThrow(ctx, Article, input.id, {
            channelId: ctx.channelId,
        });

        if (input.slug && input.slug !== article.slug) {
            await this.assertSlugIsUnique(ctx, input.slug, input.id);
        }

        const updated = new Article({
            ...article,
            ...input,
            publishedAt:
                input.isPublished && !article.isPublished ? new Date() : article.publishedAt,
        });

        await this.connection.getRepository(ctx, Article).save(updated);

        if (input.channelIds?.length) {
            await this.channelService.assignToChannels(ctx, Article, updated.id, input.channelIds);
        }
        if (input.removeFromChannelIds?.length) {
            await this.channelService.removeFromChannels(ctx, Article, updated.id, input.removeFromChannelIds);
        }

        const updatedResult = await assertFound(this.findOne(ctx, updated.id));
        this.eventBus.publish(new ArticleEvent(ctx, updatedResult, 'updated'));
        return updatedResult;
    }

    async delete(ctx: RequestContext, id: ID) {
        const article = await this.connection.getEntityOrThrow(ctx, Article, id, {
            channelId: ctx.channelId,
        });
        Logger.info(`Deleting Article id=${id} slug="${article.slug}"`, loggerCtx);
        await this.connection.getRepository(ctx, Article).remove(article);
        this.eventBus.publish(new ArticleEvent(ctx, article, 'deleted'));
        return { result: 'DELETED' as const };
    }

    /**
     * Slugs only need to be unique *within a channel* (a platform article and
     * a seller's article are allowed to share a slug, since they're served on
     * different storefront contexts). Channel-scoped uniqueness can't be a DB
     * constraint because `channels` is a many-to-many join table, so it's
     * enforced here.
     */
    private async assertSlugIsUnique(ctx: RequestContext, slug: string, excludeId?: ID) {
        const qb = this.connection
            .getRepository(ctx, Article)
            .createQueryBuilder('article')
            .innerJoin('article.channels', 'channel', 'channel.id = :channelId', {
                channelId: ctx.channelId,
            })
            .where('article.slug = :slug', { slug });

        if (excludeId) {
            qb.andWhere('article.id != :excludeId', { excludeId });
        }

        const existing = await qb.getOne();
        if (existing) {
            throw new UserInputError(`An article with the slug "${slug}" already exists in this channel`);
        }
    }
}
