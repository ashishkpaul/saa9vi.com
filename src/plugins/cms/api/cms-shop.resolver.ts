import { Args, Query, Resolver } from '@nestjs/graphql';
import { Allow, Ctx, Permission, RequestContext } from '@vendure/core';
import { ArticleService } from '../services/article.service';
import { BannerService } from '../services/banner.service';
import { PageService } from '../services/page.service';
import { BannerPlacement } from '../types';

@Resolver()
export class CmsShopResolver {
    constructor(
        private articleService: ArticleService,
        private bannerService: BannerService,
        private pageService: PageService,
    ) {}

    @Query()
    @Allow(Permission.Public)
    async cmsArticle(@Ctx() ctx: RequestContext, @Args() args: { slug: string }) {
        return this.articleService.findPublishedBySlug(ctx, args.slug);
    }

    @Query()
    @Allow(Permission.Public)
    cmsArticles(@Ctx() ctx: RequestContext, @Args() args: { options?: any }) {
        return this.articleService.findAll(ctx, {
            ...args.options,
            filter: { ...(args.options?.filter ?? {}), isPublished: { eq: true } },
        });
    }

    @Query()
    @Allow(Permission.Public)
    cmsPage(@Ctx() ctx: RequestContext, @Args() args: { slug: string }) {
        return this.pageService.findBySlug(ctx, args.slug);
    }

    @Query()
    @Allow(Permission.Public)
    cmsBanners(@Ctx() ctx: RequestContext, @Args() args: { placement: BannerPlacement }) {
        return this.bannerService.findActiveForPlacement(ctx, args.placement);
    }
}
