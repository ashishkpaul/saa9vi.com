import {
  Args,
  Mutation,
  Query,
  Resolver,
  ResolveField,
  Parent,
} from "@nestjs/graphql";
import {
  Allow,
  Ctx,
  Customer,
  Permission,
  UserInputError,
  RequestContext,
  Transaction,
  TransactionalConnection,
} from "@vendure/core";

import { ProductReview } from "../entities/product-review.entity";
import { ReviewVote } from "../entities/review-vote.entity";
import { ProductReviewService } from "../services/product-review.service";
import { ReviewRequestService } from "../services/review-request.service";
import { ReviewReportService } from "../services/review-report.service";

@Resolver("ProductReview")
export class ProductReviewShopResolver {
  constructor(
    private connection: TransactionalConnection,
    private productReviewService: ProductReviewService,
    private reviewRequestService: ReviewRequestService,
    private reviewReportService: ReviewReportService,
  ) {}

  @ResolveField()
  async userVote(
    @Ctx() ctx: RequestContext,
    @Parent() review: ProductReview,
  ): Promise<string | null> {
    const activeUserId = ctx.activeUserId;
    if (!activeUserId) {
      return null;
    }

    const customerRepo = this.connection.getRepository(ctx, Customer);
    const customer = await customerRepo.findOne({
      where: { user: { id: activeUserId } } as any,
    });
    if (!customer) {
      return null;
    }

    const voteRepo = this.connection.getRepository(ctx, ReviewVote);
    const vote = await voteRepo.findOne({
      where: {
        review: { id: review.id },
        customer: { id: customer.id },
      },
    });

    if (!vote) {
      return null;
    }

    return vote.isUpvote ? "upvote" : "downvote";
  }

  @Query()
  async canReviewProduct(
    @Ctx() ctx: RequestContext,
    @Args("productId") productId: string,
  ) {
    const activeUserId = ctx.activeUserId;
    if (!activeUserId) {
      return {
        eligible: false,
        reason: "You must be logged in to review products",
        hasPurchased: false,
        hasExistingReview: false,
      };
    }

    // Get customer from user
    const customerRepo = this.connection.getRepository(ctx, Customer);
    const customer = await customerRepo.findOne({
      where: { user: { id: activeUserId } } as any,
      relations: ["user"],
    });

    if (!customer) {
      return {
        eligible: false,
        reason: "Customer not found",
        hasPurchased: false,
        hasExistingReview: false,
      };
    }

    return this.productReviewService.canCustomerReviewProduct(
      ctx,
      customer.id as string,
      productId,
    );
  }

  @Query()
  async pendingReviewRequests(
    @Ctx() ctx: RequestContext,
    @Args("options") options: any,
  ) {
    const activeUserId = ctx.activeUserId;
    if (!activeUserId) {
      return { items: [], totalItems: 0 };
    }

    // Get customer from user
    const customerRepo = this.connection.getRepository(ctx, Customer);
    const customer = await customerRepo.findOne({
      where: { user: { id: activeUserId } } as any,
      relations: ["user"],
    });

    if (!customer) {
      return { items: [], totalItems: 0 };
    }

    return this.reviewRequestService.getPendingRequests(
      ctx,
      customer.id as string,
      {
        take: options.take,
        skip: options.skip,
      },
    );
  }

  @Query()
  async validateReviewToken(
    @Ctx() ctx: RequestContext,
    @Args("token") token: string,
  ) {
    return this.reviewRequestService.validateToken(ctx, token);
  }

  @Allow(Permission.Authenticated)
  @Transaction()
  @Mutation()
  async submitProductReview(
    @Ctx() ctx: RequestContext,
    @Args("input")
    input: {
      productId: string;
      variantId?: string;
      orderId?: string;
      orderLineId?: string;
      summary: string;
      body: string;
      rating: number;
      authorName?: string;
      authorLocation?: string;
      assetIds?: string[];
    },
  ) {
    const result = await this.productReviewService.createReview(ctx, {
      productId: input.productId,
      variantId: input.variantId ?? undefined,
      orderId: input.orderId ?? undefined,
      orderLineId: input.orderLineId ?? undefined,
      summary: input.summary,
      body: input.body,
      rating: input.rating,
      authorName: input.authorName,
      authorLocation: input.authorLocation ?? undefined,
      assetIds: input.assetIds,
    });

    // If review was created successfully and there's a token, mark the request as reviewed
    if (input.orderId && input.orderLineId) {
      // Find and mark the review request as reviewed
      const requestRepo = this.connection.getRepository(ctx, "ReviewRequest");
      const request = await requestRepo.findOne({
        where: {
          order: { id: input.orderId },
          orderLine: { id: input.orderLineId },
          status: "scheduled",
        },
      });

      if (request) {
        await this.reviewRequestService.markReviewed(ctx, request.id);
      }
    }

    return result;
  }

  @Allow(Permission.Authenticated)
  @Transaction()
  @Mutation()
  async voteOnReview(
    @Ctx() ctx: RequestContext,
    @Args("id") id: string,
    @Args("vote") vote: boolean,
  ) {
    const activeUserId = ctx.activeUserId;
    if (!activeUserId) {
      throw new UserInputError("You must be logged in to vote on reviews");
    }

    const customerRepo = this.connection.getRepository(ctx, Customer);
    const customer = await customerRepo.findOne({
      where: { user: { id: activeUserId } } as any,
    });
    if (!customer) {
      throw new UserInputError("Customer not found");
    }

    const review = await this.connection
      .getRepository(ctx, ProductReview)
      .findOne({
        where: { id, state: "approved" as any },
      });
    if (!review) {
      throw new UserInputError("Review not found or not approved");
    }

    const voteRepo = this.connection.getRepository(ctx, ReviewVote);

    // Check for existing vote
    const existingVote = await voteRepo.findOne({
      where: {
        review: { id },
        customer: { id: customer.id },
      },
    });

    if (existingVote) {
      // User already voted - check if same vote type (already voted this way)
      if (existingVote.isUpvote === vote) {
        throw new UserInputError("You have already voted on this review");
      }

      // Change vote - decrement old, increment new
      if (existingVote.isUpvote) {
        review.upvotes = Math.max(0, review.upvotes - 1);
        review.downvotes += 1;
      } else {
        review.downvotes = Math.max(0, review.downvotes - 1);
        review.upvotes += 1;
      }

      existingVote.isUpvote = vote;
      await voteRepo.save(existingVote);
    } else {
      // New vote
      if (vote) {
        review.upvotes += 1;
      } else {
        review.downvotes += 1;
      }

      await voteRepo.save(
        voteRepo.create({
          review: { id },
          customer: { id: customer.id },
          isUpvote: vote,
        }),
      );
    }

    return this.connection.getRepository(ctx, ProductReview).save(review);
  }

  @Allow(Permission.Authenticated)
  @Transaction()
  @Mutation()
  async reportReview(
    @Ctx() ctx: RequestContext,
    @Args("input")
    input: {
      id: string;
      reason: string;
      comment?: string;
    },
  ) {
    const activeUserId = ctx.activeUserId;
    if (!activeUserId) {
      throw new UserInputError("You must be logged in to report a review");
    }

    // Get customer from user
    const customerRepo = this.connection.getRepository(ctx, Customer);
    const customer = await customerRepo.findOne({
      where: { user: { id: activeUserId } } as any,
      relations: ["user"],
    });

    if (!customer) {
      throw new UserInputError("Customer not found");
    }

    await this.reviewReportService.createReport(ctx, {
      reviewId: input.id,
      reporterId: customer.id as string,
      reason: input.reason,
      description: input.comment ?? undefined,
    });

    return true;
  }
}
