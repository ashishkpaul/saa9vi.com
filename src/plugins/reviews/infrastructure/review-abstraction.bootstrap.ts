import { Injectable, OnApplicationBootstrap } from "@nestjs/common";
import { ProductReviewTargetProvider } from "../providers/product-review-target.provider";
import { ProductReviewAggregationStrategy } from "../strategies/product-aggregation.strategy";
import { ProductReviewEligibilityStrategy } from "../strategies/product-eligibility.strategy";
import { ReviewAggregationStrategyRegistry } from "./review-aggregation-strategy.registry";
import { ReviewEligibilityStrategyRegistry } from "./review-eligibility-strategy.registry";
import { ReviewTargetRegistry } from "./review-target.registry";

/**
 * Wires the Phase 1A product adapter into the generic review abstraction layer.
 * Future plugins can register their own providers and strategies without
 * changing ReviewService.
 */
@Injectable()
export class ReviewAbstractionBootstrap implements OnApplicationBootstrap {
    constructor(
        private targetRegistry: ReviewTargetRegistry,
        private eligibilityStrategyRegistry: ReviewEligibilityStrategyRegistry,
        private aggregationStrategyRegistry: ReviewAggregationStrategyRegistry,
        private productTargetProvider: ProductReviewTargetProvider,
        private productEligibilityStrategy: ProductReviewEligibilityStrategy,
        private productAggregationStrategy: ProductReviewAggregationStrategy,
    ) {}

    onApplicationBootstrap(): void {
        this.targetRegistry.register(this.productTargetProvider);
        this.eligibilityStrategyRegistry.register(this.productEligibilityStrategy);
        this.aggregationStrategyRegistry.register(this.productAggregationStrategy);
    }
}