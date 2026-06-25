import { Args, Mutation, Query, Resolver } from "@nestjs/graphql";
import {
  Allow,
  Ctx,
  ID,
  ListQueryBuilder,
  patchEntity,
  Permission,
  Product,
  RequestContext,
  Transaction,
  TransactionalConnection,
} from "@vendure/core";

// Import type declarations for custom fields
import "../types";
import { REVIEW_ADMIN_PERMISSION } from "../constants";

import { ProductReview } from "../entities/product-review.entity";
import { ProductReviewService } from "../services/product-review.service";
import type {
  MutationApproveProductReviewArgs,
  MutationRejectProductReviewArgs,
  MutationUpdateProductReviewArgs,
  MutationHideProductReviewArgs,
  MutationFlagProductReviewArgs,
  QueryProductReviewArgs,
  QueryProductReviewsArgs,
} from "../generated-admin-types";

@Resolver()
export class ProductReviewAdminResolver {
  constructor(
    private connection: TransactionalConnection,
    private listQueryBuilder: ListQueryBuilder,
    private productReviewService: ProductReviewService,
  ) {}

  @Query()
  @Allow(Permission.SuperAdmin, REVIEW_ADMIN_PERMISSION.Permission)
  async productReviews(
    @Ctx() ctx: RequestContext,
    @Args() args: QueryProductReviewsArgs,
  ) {
    // Scope reviews to products in the current channel.
    // ProductReview is not channel-aware so without this sellers see
    // reviews from other channels (multi-vendor isolation bug).
    const qb = this.listQueryBuilder.build(ProductReview, args.options as any || undefined, {
      relations: ['product'],
      ctx,
    });

    // ListQueryBuilder alias = entity.name.toLowerCase() = 'productreview'
    const reviewAlias = qb.alias;

    const channelProductSubquery = this.connection
      .getRepository(ctx, Product)
      .createQueryBuilder('p')
      .innerJoin('p.channels', 'ch')
      .where('ch.id = :channelId', { channelId: ctx.channelId })
      .select('p.id');

    qb.innerJoin(`${reviewAlias}.product`, 'reviewProduct')
      .andWhere(`reviewProduct.id IN (${channelProductSubquery.getQuery()})`)
      .setParameters(channelProductSubquery.getParameters());

    return qb.getManyAndCount().then(([items, totalItems]) => ({ items, totalItems }));
  }

  @Query()
  @Allow(Permission.SuperAdmin, REVIEW_ADMIN_PERMISSION.Permission)
  async productReview(
    @Ctx() ctx: RequestContext,
    @Args() args: QueryProductReviewArgs,
  ) {
    return this.connection.getRepository(ctx, ProductReview).findOne({
      where: { id: args.id },
      relations: {
        author: true,
        product: true,
        productVariant: true,
      },
    });
  }

  @Transaction()
  @Mutation()
  @Allow(Permission.SuperAdmin, REVIEW_ADMIN_PERMISSION.Permission)
  async updateProductReview(
    @Ctx() ctx: RequestContext,
    @Args() { input }: MutationUpdateProductReviewArgs,
  ) {
    const review = await this.connection.getEntityOrThrow(
      ctx,
      ProductReview,
      input.id,
    );
    const originalResponse = review.response;
    const updatedProductReview = patchEntity(review, input);
    if (input.response !== originalResponse) {
      updatedProductReview.responseCreatedAt = new Date();
    }
    return this.connection
      .getRepository(ctx, ProductReview)
      .save(updatedProductReview);
  }

  @Transaction()
  @Mutation()
  @Allow(Permission.SuperAdmin, REVIEW_ADMIN_PERMISSION.Permission)
  async approveProductReview(
    @Ctx() ctx: RequestContext,
    @Args() { id }: MutationApproveProductReviewArgs,
  ) {
    return this.productReviewService.approveReview(ctx, id);
  }

  @Transaction()
  @Mutation()
  @Allow(Permission.SuperAdmin, REVIEW_ADMIN_PERMISSION.Permission)
  async rejectProductReview(
    @Ctx() ctx: RequestContext,
    @Args() { id }: MutationRejectProductReviewArgs,
  ) {
    return this.productReviewService.rejectReview(ctx, id);
  }

  @Transaction()
  @Mutation()
  @Allow(Permission.SuperAdmin, REVIEW_ADMIN_PERMISSION.Permission)
  async hideProductReview(
    @Ctx() ctx: RequestContext,
    @Args() { id }: MutationHideProductReviewArgs,
  ) {
    return this.productReviewService.hideReview(ctx, id);
  }

  @Transaction()
  @Mutation()
  @Allow(Permission.SuperAdmin, REVIEW_ADMIN_PERMISSION.Permission)
  async flagProductReview(
    @Ctx() ctx: RequestContext,
    @Args() { id, reason }: MutationFlagProductReviewArgs,
  ) {
    return this.productReviewService.flagReview(ctx, id, reason ?? undefined);
  }

  @Transaction()
  @Mutation()
  @Allow(Permission.SuperAdmin, REVIEW_ADMIN_PERMISSION.Permission)
  async respondToReview(
    @Ctx() ctx: RequestContext,
    @Args() { id, response }: { id: string; response: string },
  ) {
    return this.productReviewService.respondToReview(ctx, id, response);
  }

}
