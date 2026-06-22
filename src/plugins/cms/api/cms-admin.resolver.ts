import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';
import { Allow, Ctx, ID, ListQueryOptions, RequestContext, Transaction } from '@vendure/core';
import { articlePermission, bannerPermission, pagePermission } from '../constants';
import { Article } from '../entities/article.entity';
import { Banner } from '../entities/banner.entity';
import { Page } from '../entities/page.entity';
import { ArticleService } from '../services/article.service';
import { BannerService } from '../services/banner.service';
import { PageService } from '../services/page.service';

@Resolver()
export class CmsAdminResolver {
    constructor(
        private articleService: ArticleService,
        private bannerService: BannerService,
        private pageService: PageService,
    ) {}

    // ---------- Articles ----------

    @Query()
    @Allow(articlePermission.Read)
    articles(@Ctx() ctx: RequestContext, @Args() args: { options?: ListQueryOptions<Article> }) {
        return this.articleService.findAll(ctx, args.options);
    }

    @Query()
    @Allow(articlePermission.Read)
    article(@Ctx() ctx: RequestContext, @Args() args: { id: ID }) {
        return this.articleService.findOne(ctx, args.id);
    }

    @Transaction()
    @Mutation()
    @Allow(articlePermission.Create)
    createArticle(@Ctx() ctx: RequestContext, @Args('input') input: any) {
        return this.articleService.create(ctx, input);
    }

    @Transaction()
    @Mutation()
    @Allow(articlePermission.Update)
    updateArticle(@Ctx() ctx: RequestContext, @Args('input') input: any) {
        return this.articleService.update(ctx, input);
    }

    @Transaction()
    @Mutation()
    @Allow(articlePermission.Delete)
    deleteArticle(@Ctx() ctx: RequestContext, @Args() args: { id: ID }) {
        return this.articleService.delete(ctx, args.id);
    }

    // ---------- Banners ----------

    @Query()
    @Allow(bannerPermission.Read)
    banners(@Ctx() ctx: RequestContext, @Args() args: { options?: ListQueryOptions<Banner> }) {
        return this.bannerService.findAll(ctx, args.options);
    }

    @Query()
    @Allow(bannerPermission.Read)
    banner(@Ctx() ctx: RequestContext, @Args() args: { id: ID }) {
        return this.bannerService.findOne(ctx, args.id);
    }

    @Transaction()
    @Mutation()
    @Allow(bannerPermission.Create)
    createBanner(@Ctx() ctx: RequestContext, @Args('input') input: any) {
        return this.bannerService.create(ctx, input);
    }

    @Transaction()
    @Mutation()
    @Allow(bannerPermission.Update)
    updateBanner(@Ctx() ctx: RequestContext, @Args('input') input: any) {
        return this.bannerService.update(ctx, input);
    }

    @Transaction()
    @Mutation()
    @Allow(bannerPermission.Delete)
    deleteBanner(@Ctx() ctx: RequestContext, @Args() args: { id: ID }) {
        return this.bannerService.delete(ctx, args.id);
    }

    // ---------- Pages ----------
    //
    // Query method names match the GraphQL schema: `cmsPages` / `cmsPage` (not
    // `pages` / `page`) for two reasons:
    //   1. `Page` / `page` collides with an existing type/query in the Vendure
    //      admin schema — prefixing avoids that.
    //   2. Consistency with the shop API's `cmsPage(slug: String!)` query, which
    //      is already prefixed by convention.

    @Query()
    @Allow(pagePermission.Read)
    cmsPages(@Ctx() ctx: RequestContext, @Args() args: { options?: ListQueryOptions<Page> }) {
        return this.pageService.findAll(ctx, args.options);
    }

    @Query()
    @Allow(pagePermission.Read)
    cmsPage(@Ctx() ctx: RequestContext, @Args() args: { id: ID }) {
        return this.pageService.findOne(ctx, args.id);
    }

    @Transaction()
    @Mutation()
    @Allow(pagePermission.Create)
    createPage(@Ctx() ctx: RequestContext, @Args('input') input: any) {
        return this.pageService.create(ctx, input);
    }

    @Transaction()
    @Mutation()
    @Allow(pagePermission.Update)
    updatePage(@Ctx() ctx: RequestContext, @Args('input') input: any) {
        return this.pageService.update(ctx, input);
    }

    @Transaction()
    @Mutation()
    @Allow(pagePermission.Delete)
    deletePage(@Ctx() ctx: RequestContext, @Args() args: { id: ID }) {
        return this.pageService.delete(ctx, args.id);
    }
}
