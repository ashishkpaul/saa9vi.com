import { Injectable } from '@nestjs/common';
import {
    ChannelService,
    ID,
    ListQueryBuilder,
    ListQueryOptions,
    RequestContext,
    TransactionalConnection,
    UserInputError,
    assertFound,
} from '@vendure/core';
import { Article } from '../entities/article.entity';

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
}

@Injectable()
export class ArticleService {
    constructor(
        private connection: TransactionalConnection,
        private listQueryBuilder: ListQueryBuilder,
        private channelService: ChannelService,
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

    async create(ctx: RequestContext, input: CreateArticleInput): Promise<Article> {
        await this.assertSlugIsUnique(ctx, input.slug);

        const article = new Article({
            ...input,
            publishedAt: input.isPublished ? new Date() : null,
        });

        // Assigns to the default Channel + whichever Channel the admin is
        // currently operating in (the seller's channel, if a seller admin).
        await this.channelService.assignToCurrentChannel(article, ctx);

        const saved = await this.connection.getRepository(ctx, Article).save(article);

        if (input.channelIds?.length) {
            await this.channelService.assignToChannels(ctx, Article, saved.id, input.channelIds);
        }

        return assertFound(this.findOne(ctx, saved.id));
    }

    async update(ctx: RequestContext, input: UpdateArticleInput): Promise<Article> {
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

        return assertFound(this.findOne(ctx, updated.id));
    }

    async delete(ctx: RequestContext, id: ID) {
        const article = await this.connection.getEntityOrThrow(ctx, Article, id, {
            channelId: ctx.channelId,
        });
        await this.connection.getRepository(ctx, Article).remove(article);
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
