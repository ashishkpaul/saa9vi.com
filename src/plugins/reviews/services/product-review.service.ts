import { Injectable } from "@nestjs/common";
import {
  Asset,
  ID,
  RequestContext,
  TransactionalConnection,
  ProductService,
  Customer,
  EventBus,
  Order,
  OrderLine,
  OrderService,
} from "@vendure/core";
import { Repository } from "typeorm";

import { ProductReview } from "../entities/product-review.entity";
import {
  DuplicateReviewError,
  InvalidRatingError,
  InvalidReviewStateError,
  ReviewNotFoundError,
  UnauthorizedError,
  NotVerifiedPurchaseError,
  ReviewValidationError,
  ProductNotFoundError,
} from "../entities/review-error.types";
import {
  ReviewApprovedEvent,
  ReviewCreatedEvent,
  ReviewRejectedEvent,
  ReviewHiddenEvent,
  ReviewFlaggedEvent,
  ReviewRespondedEvent,
} from "../events/review.events";
import { ReviewAggregationService } from "./review-aggregation.service";
import { ReviewService } from "./review.service";

export interface CreateReviewInput {
  productId: ID;
  variantId?: ID;
  orderId?: ID;
  orderLineId?: ID;
  summary: string;
  body: string;
  rating: number;
  authorName?: string;
  authorLocation?: string;
  reviewToken?: string;
  assetIds?: ID[];
}

export interface UpdateReviewInput {
  id: ID;
  summary?: string;
  body?: string;
  response?: string;
}

export interface ReviewHistogramItem {
  bin: number;
  frequency: number;
}

export interface ReviewEligibilityResult {
  eligible: boolean;
  reason: string;
  hasPurchased: boolean;
  hasExistingReview: boolean;
  eligibleOrderId?: ID;
  eligibleOrderLineId?: ID;
}

export type ReviewErrorResult =
  | DuplicateReviewError
  | InvalidRatingError
  | InvalidReviewStateError
  | ReviewNotFoundError
  | UnauthorizedError
  | NotVerifiedPurchaseError
  | ReviewValidationError
  | ProductNotFoundError;

// Eligible order states for review (Delivered orders)
const ELIGIBLE_ORDER_STATES = ["Delivered", "Shipped"];

@Injectable()
export class ProductReviewService {
  private reviewRepo: Repository<ProductReview>;

  constructor(
    private connection: TransactionalConnection,
    private productService: ProductService,
    private orderService: OrderService,
    private eventBus: EventBus,
    private reviewAggregationService: ReviewAggregationService,
    private reviewService: ReviewService,
  ) {}

  private getRepo(ctx: RequestContext): Repository<ProductReview> {
    return this.connection.getRepository(ctx, ProductReview);
  }

  /**
   * Check if a customer can review a product.
   * Returns eligibility status with reasons.
   */
  async canCustomerReviewProduct(
    ctx: RequestContext,
    customerId: ID,
    productId: ID,
  ): Promise<ReviewEligibilityResult> {
    // Check for existing review (any state)
    const existingReview = await this.getRepo(ctx).findOne({
      where: {
        product: { id: productId } as any,
        author: { id: customerId } as any,
      },
    });

    if (existingReview) {
      return {
        eligible: false,
        reason: "You have already reviewed this product",
        hasPurchased: existingReview.verifiedPurchase,
        hasExistingReview: true,
      };
    }

    // Find eligible order with this product
    const orderRepo = this.connection.getRepository(ctx, Order);
    const orderLineRepo = this.connection.getRepository(ctx, OrderLine);

    // Find order lines for this product in eligible order states
    const orderLines = await orderLineRepo
      .createQueryBuilder("line")
      .innerJoinAndSelect("line.order", "order")
      .innerJoinAndSelect("line.productVariant", "variant")
      .where("order.customerId = :customerId", { customerId })
      .andWhere("variant.productId = :productId", { productId })
      .andWhere("order.state IN (:...states)", {
        states: ELIGIBLE_ORDER_STATES,
      })
      .orderBy("order.updatedAt", "DESC")
      .getMany();

    if (orderLines.length === 0) {
      return {
        eligible: false,
        reason: "You can only review products you have purchased",
        hasPurchased: false,
        hasExistingReview: false,
      };
    }

    // Get the most recent eligible order line
    const eligibleOrderLine = orderLines[0];
    const eligibleOrder = eligibleOrderLine.order;

    return {
      eligible: true,
      reason: "You can review this product",
      hasPurchased: true,
      hasExistingReview: false,
      eligibleOrderId: eligibleOrder.id,
      eligibleOrderLineId: eligibleOrderLine.id,
    };
  }

  async findAll(
    ctx: RequestContext,
    options?: { take?: number; skip?: number },
  ): Promise<{ items: ProductReview[]; totalItems: number }> {
    const repo = this.getRepo(ctx);
    const take = options?.take ?? 10;
    const skip = options?.skip ?? 0;
    const [items, totalItems] = await repo.findAndCount({
      relations: ["product", "author"],
      take,
      skip,
      order: { createdAt: "DESC" },
    });
    return { items, totalItems };
  }

  async findOne(ctx: RequestContext, id: ID): Promise<ProductReview | null> {
    return this.getRepo(ctx).findOne({
      where: { id },
      relations: ["product", "author"],
    });
  }

  async findByProduct(
    ctx: RequestContext,
    productId: ID,
    options?: {
      take?: number;
      skip?: number;
      showOnlyApproved?: boolean;
    },
  ): Promise<{ items: ProductReview[]; totalItems: number }> {
    const showOnlyApproved = options?.showOnlyApproved ?? true;
    const repo = this.getRepo(ctx);
    const take = options?.take ?? 10;
    const skip = options?.skip ?? 0;
    const where: Record<string, any> = { product: { id: productId } };

    if (showOnlyApproved) {
      where.state = "approved";
    }

    const [items, totalItems] = await repo.findAndCount({
      where,
      relations: ["product", "author"],
      take,
      skip,
      order: { createdAt: "DESC" },
    });
    return { items, totalItems };
  }

  async createReview(
    ctx: RequestContext,
    input: CreateReviewInput,
  ): Promise<ProductReview | ReviewErrorResult> {
    // Validate rating range
    if (input.rating < 1 || input.rating > 5) {
      return new InvalidRatingError();
    }

    // Validate input lengths
    if (input.summary.length < 1 || input.summary.length > 100) {
      input.summary = input.summary.substring(0, 100);
    }
    if (input.body.length < 10) {
      return new ReviewValidationError("Review body must be at least 10 characters");
    }
    if (input.body.length > 5000) {
      input.body = input.body.substring(0, 5000);
    }

    const activeUserId = ctx.activeUserId;
    if (!activeUserId) {
      return new UnauthorizedError("You must be logged in to submit a review");
    }

    // Get customer from user
    const customerRepo = this.connection.getRepository(ctx, Customer);
    const customer = await customerRepo.findOne({
      where: { user: { id: activeUserId } } as any,
      relations: ["user"],
    });

    if (!customer) {
      return new UnauthorizedError("Customer not found");
    }

    // Check eligibility
    const eligibility = await this.canCustomerReviewProduct(
      ctx,
      customer.id as ID,
      input.productId,
    );

    if (!eligibility.eligible) {
      if (eligibility.hasExistingReview) {
        return new DuplicateReviewError();
      }
      if (!eligibility.hasPurchased) {
        return new NotVerifiedPurchaseError();
      }
    }

    // Verify product exists
    const product = await this.productService.findOne(ctx, input.productId);
    if (!product) {
      return new ProductNotFoundError("Product not found");
    }

    // Determine verified purchase status
    let verifiedPurchase = false;
    let orderId = input.orderId;
    let orderLineId = input.orderLineId;

    if (eligibility.hasPurchased && eligibility.eligibleOrderId) {
      verifiedPurchase = true;
      orderId = orderId ?? eligibility.eligibleOrderId;
      orderLineId = orderLineId ?? eligibility.eligibleOrderLineId;
    }

    const authorName = input.authorName
      ? input.authorName
      : `${customer.firstName} ${customer.lastName}`.trim() || "Anonymous";

    // Load assets if provided
    let assets: Asset[] = [];
    if (input.assetIds && input.assetIds.length > 0) {
      const assetRepo = this.connection.getRepository(ctx, Asset);
      assets = await assetRepo.findByIds(input.assetIds);
    }

    // Delegate to the new ReviewService for orchestrator-based creation
    const result = await this.reviewService.createReview(
      ctx,
      {
        targetType: 'PRODUCT',
        targetId: input.productId,
        rating: input.rating,
        summary: input.summary,
        body: input.body,
        authorName,
        authorLocation: input.authorLocation,
        assetIds: input.assetIds,
      },
      customer.id as ID,
    );

    if ((result as any).error) {
      // Translate generic error codes to legacy error types
      if ((result as any).code === "NOT_ELIGIBLE") {
        if (eligibility.hasExistingReview) {
          return new DuplicateReviewError();
        }
        return new NotVerifiedPurchaseError();
      }
      if ((result as any).code === "INVALID_RATING") {
        return new InvalidRatingError();
      }
      if ((result as any).code === "INVALID_BODY") {
        return new ReviewValidationError((result as any).error);
      }
      if ((result as any).code === "CUSTOMER_NOT_FOUND") {
        return new UnauthorizedError((result as any).error);
      }
      if ((result as any).code === "INVALID_TARGET") {
        return new ProductNotFoundError("Invalid product target");
      }
      // Fallback
      return new ReviewValidationError((result as any).error);
    }

    return result as unknown as ProductReview;
  }

  async updateReview(
    ctx: RequestContext,
    input: UpdateReviewInput,
  ): Promise<ProductReview | ReviewNotFoundError> {
    const review = await this.getRepo(ctx).findOne({
      where: { id: input.id },
    });

    if (!review) {
      return new ReviewNotFoundError();
    }

    if (input.summary !== undefined) {
      review.summary = input.summary;
    }
    if (input.body !== undefined) {
      review.body = input.body;
    }
    if (input.response !== undefined) {
      review.response = input.response;
      review.responseCreatedAt = new Date();
    }

    return this.getRepo(ctx).save(review);
  }

  async approveReview(
    ctx: RequestContext,
    reviewId: ID,
  ): Promise<ProductReview | ReviewNotFoundError | InvalidReviewStateError> {
    const review = await this.getRepo(ctx).findOne({
      where: { id: reviewId },
      relations: ["product"],
    });

    if (!review) {
      return new ReviewNotFoundError();
    }

    if (review.state !== "new") {
      return new InvalidReviewStateError(
        "Only pending reviews can be approved",
      );
    }

    review.state = "approved";
    await this.getRepo(ctx).save(review);

    // Recalculate product rating
    await this.recalculateProductRating(ctx, review.product.id as ID);

    this.eventBus.publish(
      new ReviewApprovedEvent(
        review.id,
        review.product.id as ID,
        review.author?.id as ID | undefined,
        ctx.channel.token,
      ),
    );

    return review;
  }

  async rejectReview(
    ctx: RequestContext,
    reviewId: ID,
  ): Promise<ProductReview | ReviewNotFoundError | InvalidReviewStateError> {
    const review = await this.getRepo(ctx).findOne({
      where: { id: reviewId },
      relations: ["product"],
    });

    if (!review) {
      return new ReviewNotFoundError();
    }

    const wasApproved = review.state === "approved";
    review.state = "rejected";
    await this.getRepo(ctx).save(review);

    // Only recalculate if it was previously approved and is now rejected
    if (wasApproved) {
      await this.recalculateProductRating(ctx, review.product.id as ID);
    }

    this.eventBus.publish(
      new ReviewRejectedEvent(
        review.id,
        review.product.id as ID,
        review.author?.id as ID | undefined,
        ctx.channel.token,
      ),
    );

    return review;
  }

  async hideReview(
    ctx: RequestContext,
    reviewId: ID,
  ): Promise<ProductReview | ReviewNotFoundError | InvalidReviewStateError> {
    const review = await this.getRepo(ctx).findOne({
      where: { id: reviewId },
      relations: ["product"],
    });

    if (!review) {
      return new ReviewNotFoundError();
    }

    if (review.state === "hidden") {
      return new InvalidReviewStateError("Review is already hidden");
    }

    const wasApproved = review.state === "approved";
    review.state = "hidden";
    await this.getRepo(ctx).save(review);

    // Recalculate if it was previously approved and is now hidden
    if (wasApproved) {
      await this.recalculateProductRating(ctx, review.product.id as ID);
    }

    this.eventBus.publish(
      new ReviewHiddenEvent(
        review.id,
        review.product.id as ID,
        review.author?.id as ID | undefined,
        ctx.channel.token,
      ),
    );

    return review;
  }

  async flagReview(
    ctx: RequestContext,
    reviewId: ID,
    reason?: string,
  ): Promise<ProductReview | ReviewNotFoundError> {
    const review = await this.getRepo(ctx).findOne({
      where: { id: reviewId },
      relations: ["product"],
    });

    if (!review) {
      return new ReviewNotFoundError();
    }

    review.state = "flagged";
    await this.getRepo(ctx).save(review);

    this.eventBus.publish(
      new ReviewFlaggedEvent(
        review.id,
        review.product.id as ID,
        review.author?.id as ID | undefined,
        ctx.channel.token,
        reason,
      ),
    );

    return review;
  }

  async voteOnReview(
    ctx: RequestContext,
    reviewId: ID,
    vote: boolean,
  ): Promise<ProductReview | ReviewNotFoundError> {
    const review = await this.getRepo(ctx).findOne({
      where: { id: reviewId },
    });

    if (!review) {
      return new ReviewNotFoundError();
    }

    const repo = this.getRepo(ctx);
    const column = vote ? "upvotes" : "downvotes";
    await repo
      .createQueryBuilder()
      .update(ProductReview)
      .set({ [column]: () => `${column} + 1` })
      .where("id = :id", { id: reviewId })
      .execute();

    const updatedReview = await repo.findOne({ where: { id: reviewId } });
    if (!updatedReview) {
      return new ReviewNotFoundError();
    }
    return updatedReview;
  }

  async recalculateProductRating(
    ctx: RequestContext,
    productId: ID,
  ): Promise<void> {
    await this.reviewAggregationService.recalculateForProduct(ctx, productId);
  }

  async getHistogram(
    ctx: RequestContext,
    productId: ID,
  ): Promise<ReviewHistogramItem[]> {
    const reviewRepo = this.getRepo(ctx);

    const results = await reviewRepo
      .createQueryBuilder("review")
      .select("review.rating", "bin")
      .addSelect("COUNT(*)", "frequency")
      .where("review.productId = :productId", { productId })
      .andWhere("review.state = :state", { state: "approved" })
      .groupBy("review.rating")
      .orderBy("review.rating", "DESC")
      .getRawMany();

    // Ensure all bins 1-5 are present
    const histogram: ReviewHistogramItem[] = [5, 4, 3, 2, 1].map((bin) => {
      const found = results.find((r) => parseInt(r.bin, 10) === bin);
      return {
        bin,
        frequency: found ? parseInt(found.frequency, 10) : 0,
      };
    });

    return histogram;
  }

  /**
   * Respond to a review (seller/admin response)
   */
  async respondToReview(
    ctx: RequestContext,
    reviewId: ID,
    response: string,
  ): Promise<ProductReview | ReviewNotFoundError> {
    const review = await this.getRepo(ctx).findOne({
      where: { id: reviewId },
      relations: ["product"],
    });

    if (!review) {
      return new ReviewNotFoundError();
    }

    review.response = response;
    review.responseCreatedAt = new Date();
    await this.getRepo(ctx).save(review);

    this.eventBus.publish(
      new ReviewRespondedEvent(
        review.id,
        review.product.id as ID,
        review.author?.id as ID | undefined,
        ctx.channel.token,
        response,
      ),
    );

    return review;
  }
}
