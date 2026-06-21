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
import { Page } from '../entities/page.entity';
import { PageSection } from '../types';

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
}

@Injectable()
export class PageService {
    constructor(
        private connection: TransactionalConnection,
        private listQueryBuilder: ListQueryBuilder,
        private channelService: ChannelService,
    ) {}

    findAll(ctx: RequestContext, options?: ListQueryOptions<Page>) {
        return this.listQueryBuilder
            .build(Page, options, { ctx, relations: ['channels'] })
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

        const page = new Page({ ...input, sections: input.sections ?? [] });
        await this.channelService.assignToCurrentChannel(page, ctx);
        const saved = await this.connection.getRepository(ctx, Page).save(page);

        if (input.channelIds?.length) {
            await this.channelService.assignToChannels(ctx, Page, saved.id, input.channelIds);
        }

        return assertFound(this.findOne(ctx, saved.id));
    }

    async update(ctx: RequestContext, input: UpdatePageInput): Promise<Page> {
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

        if (input.channelIds?.length) {
            await this.channelService.assignToChannels(ctx, Page, updated.id, input.channelIds);
        }

        return assertFound(this.findOne(ctx, updated.id));
    }

    async delete(ctx: RequestContext, id: ID) {
        const page = await this.connection.getEntityOrThrow(ctx, Page, id, {
            channelId: ctx.channelId,
        });
        await this.connection.getRepository(ctx, Page).remove(page);
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
        }
    }
}
