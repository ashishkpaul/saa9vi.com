import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';
import { Allow, Ctx, ID, ListQueryOptions, RequestContext, Transaction } from '@vendure/core';
import { articlePermission, bannerPermission, pagePermission } from '../constants';
import { Article } from '../entities/article.entity';
import { Banner } from '../entities/banner.entity';
import { Page } from '../entities/page.entity';
import { ArticleService } from '../services/article.service';
import { BannerService } from '../services/banner.service';
import { PageService } from '../services/page.service';
import { CreateArticleInput, UpdateArticleInput } from '../services/article.service';
import { CreateBannerInput, UpdateBannerInput } from '../services/banner.service';
import { CreatePageInput, UpdatePageInput } from '../services/page.service';

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

    @Allow(articlePermission.Create)
    @Transaction()
    @Mutation()
    createArticle(@Ctx() ctx: RequestContext, @Args('input') input: CreateArticleInput) {
        return this.articleService.create(ctx, input);
    }

    @Allow(articlePermission.Update)
    @Transaction()
    @Mutation()
    updateArticle(@Ctx() ctx: RequestContext, @Args('input') input: UpdateArticleInput) {
        return this.articleService.update(ctx, input);
    }

    @Allow(articlePermission.Delete)
    @Transaction()
    @Mutation()
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

    @Allow(bannerPermission.Create)
    @Transaction()
    @Mutation()
    createBanner(@Ctx() ctx: RequestContext, @Args('input') input: CreateBannerInput) {
        return this.bannerService.create(ctx, input);
    }

    @Allow(bannerPermission.Update)
    @Transaction()
    @Mutation()
    updateBanner(@Ctx() ctx: RequestContext, @Args('input') input: UpdateBannerInput) {
        return this.bannerService.update(ctx, input);
    }

    @Allow(bannerPermission.Delete)
    @Transaction()
    @Mutation()
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

    @Allow(pagePermission.Create)
    @Transaction()
    @Mutation()
    createPage(@Ctx() ctx: RequestContext, @Args('input') input: CreatePageInput) {
        return this.pageService.create(ctx, input);
    }

    @Allow(pagePermission.Update)
    @Transaction()
    @Mutation()
    updatePage(@Ctx() ctx: RequestContext, @Args('input') input: UpdatePageInput) {
        return this.pageService.update(ctx, input);
    }

    @Allow(pagePermission.Delete)
    @Transaction()
    @Mutation()
    deletePage(@Ctx() ctx: RequestContext, @Args() args: { id: ID }) {
        return this.pageService.delete(ctx, args.id);
    }
}
