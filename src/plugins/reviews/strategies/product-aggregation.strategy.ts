import { Injectable } from "@nestjs/common";
import { RequestContext, ID, ProductService } from "@vendure/core";
import { ReviewAggregationStrategy, AggregateResult } from "../contracts/review-aggregation.strategy";
import { ReviewAggregationService } from "../services/review-aggregation.service";

/**
 * Aggregation strategy for Product reviews.
 * Updates Product custom fields (reviewRating, reviewCount) using existing logic.
 */
@Injectable()
export class ProductReviewAggregationStrategy implements ReviewAggregationStrategy {
    constructor(
        private reviewAggregationService: ReviewAggregationService,
        private productService: ProductService,
    ) {}

    async recalculate(ctx: RequestContext, targetId: ID): Promise<AggregateResult> {
        // Delegate to existing aggregation service which already knows how to update product custom fields
        await this.reviewAggregationService.recalculateForProduct(ctx, targetId);

        // Fetch the computed values to return
        const product = await this.productService.findOne(ctx, targetId);
        const customFields = (product as any)?.customFields || {};

        return {
            averageRating: customFields.reviewRating ?? 0,
            reviewCount: customFields.reviewCount ?? 0,
            verifiedReviewCount: 0, // Will be populated when we extend the entity
        };
    }
}