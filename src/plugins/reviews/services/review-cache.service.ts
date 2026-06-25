import { Injectable } from "@nestjs/common";
import {
  ID,
  Product,
  RequestContext,
  TransactionalConnection,
  Logger,
} from "@vendure/core";
import { ProductReview } from "../entities/product-review.entity";
import { ReviewAggregationService } from "./review-aggregation.service";

const loggerCtx = "ReviewCacheService";

/**
 * Service for managing review aggregate caching and invalidation.
 * Handles recalculation of product review statistics when reviews change state.
 */
@Injectable()
export class ReviewCacheService {
  constructor(
    private connection: TransactionalConnection,
    private reviewAggregationService: ReviewAggregationService,
  ) {}

  /**
   * Recalculate and update product review aggregates.
   * This should be called whenever a review state changes (approved, rejected, hidden, etc.)
   */
  async recalculateProductAggregates(
    ctx: RequestContext,
    productId: ID,
  ): Promise<void> {
    await this.reviewAggregationService.recalculateForProduct(ctx, productId);

    const stats = await this.getProductReviewStats(ctx, productId);
    Logger.info(
      `Updated review aggregates for product ${productId}: count=${stats?.count ?? 0}, rating=${stats?.rating ?? 0}`,
      loggerCtx,
    );
  }

  /**
   * Get cached review statistics for a product.
   * Returns null if not cached or if cache is stale.
   */
  async getProductReviewStats(
    ctx: RequestContext,
    productId: ID,
  ): Promise<{ count: number; rating: number } | null> {
    const productRepo = this.connection.getRepository(ctx, Product);
    const product = await productRepo.findOne({
      where: { id: productId },
    });

    if (!product) {
      return null;
    }

    const reviewCount = (product.customFields as any)?.reviewCount ?? 0;
    const reviewRating = (product.customFields as any)?.reviewRating ?? 0;

    return {
      count: reviewCount,
      rating: reviewRating,
    };
  }

  /**
   * Invalidate cache for a specific product's review stats.
   * In our implementation, this triggers a recalculation.
   */
  async invalidateProductCache(
    ctx: RequestContext,
    productId: ID,
  ): Promise<void> {
    await this.recalculateProductAggregates(ctx, productId);
  }

  /**
   * Batch invalidate multiple products.
   * Useful when bulk operations affect multiple products.
   */
  async batchInvalidate(ctx: RequestContext, productIds: ID[]): Promise<void> {
    for (const productId of productIds) {
      await this.invalidateProductCache(ctx, productId);
    }
  }

  /**
   * Get review summary statistics for a product.
   * Includes average rating, rating distribution, and total count.
   */
  async getReviewSummary(
    ctx: RequestContext,
    productId: ID,
  ): Promise<{
    averageRating: number;
    totalReviews: number;
    ratingDistribution: { [key: number]: number };
  }> {
    const reviewRepo = this.connection.getRepository(ctx, ProductReview);

    const approvedReviews = await reviewRepo.find({
      where: {
        product: { id: productId },
        state: "approved",
      },
    });

    const totalReviews = approvedReviews.length;
    const averageRating =
      totalReviews > 0
        ? approvedReviews.reduce((sum, r) => sum + r.rating, 0) / totalReviews
        : 0;

    // Calculate rating distribution (1-5 stars)
    const ratingDistribution: { [key: number]: number } = {
      1: 0,
      2: 0,
      3: 0,
      4: 0,
      5: 0,
    };
    approvedReviews.forEach((review) => {
      ratingDistribution[review.rating] =
        (ratingDistribution[review.rating] || 0) + 1;
    });

    return {
      averageRating: Math.round(averageRating * 10) / 10,
      totalReviews,
      ratingDistribution,
    };
  }

  /**
   * Get top-rated products based on review aggregates.
   * Returns products sorted by average rating and review count.
   */
  async getTopRatedProducts(
    ctx: RequestContext,
    options?: {
      limit?: number;
      minReviews?: number;
    },
  ): Promise<
    Array<{
      productId: ID;
      averageRating: number;
      reviewCount: number;
    }>
  > {
    const limit = options?.limit ?? 10;
    const minReviews = options?.minReviews ?? 1;

    const productRepo = this.connection.getRepository(ctx, Product);

    const products = await productRepo
      .createQueryBuilder("product")
      .leftJoinAndSelect("product.reviews", "review", "review.state = :state", {
        state: "approved",
      })
      .groupBy("product.id")
      .having("COUNT(review.id) >= :minReviews", { minReviews })
      .orderBy("AVG(review.rating)", "DESC")
      .addOrderBy("COUNT(review.id)", "DESC")
      .limit(limit)
      .getMany();

    return products.map((product) => {
      const reviews = (product as any).reviews || [];
      const reviewCount = reviews.length;
      const averageRating =
        reviewCount > 0
          ? reviews.reduce((sum: number, r: any) => sum + r.rating, 0) /
            reviewCount
          : 0;

      return {
        productId: product.id,
        averageRating: Math.round(averageRating * 10) / 10,
        reviewCount,
      };
    });
  }

  /**
   * Search reviews by text content.
   * Searches in review summary and body fields.
   */
  async searchReviews(
    ctx: RequestContext,
    options: {
      query: string;
      productId?: ID;
      limit?: number;
      offset?: number;
    },
  ): Promise<{
    items: ProductReview[];
    totalItems: number;
  }> {
    const reviewRepo = this.connection.getRepository(ctx, ProductReview);
    const limit = options.limit ?? 10;
    const offset = options.offset ?? 0;

    const queryBuilder = reviewRepo
      .createQueryBuilder("review")
      .leftJoinAndSelect("review.product", "product")
      .leftJoinAndSelect("review.author", "author")
      .where("review.state = :state", { state: "approved" });

    if (options.productId) {
      queryBuilder.andWhere("review.productId = :productId", {
        productId: options.productId,
      });
    }

    // Search in summary and body
    queryBuilder.andWhere(
      "(LOWER(review.summary) LIKE LOWER(:query) OR LOWER(review.body) LIKE LOWER(:query))",
      { query: `%${options.query}%` },
    );

    queryBuilder.orderBy("review.createdAt", "DESC").skip(offset).take(limit);

    const [items, totalItems] = await queryBuilder.getManyAndCount();

    return { items, totalItems };
  }
}
