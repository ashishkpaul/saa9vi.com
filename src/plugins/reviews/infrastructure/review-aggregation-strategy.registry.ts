import { Injectable } from "@nestjs/common";
import { ReviewTargetType } from "../constants";
import { ReviewAggregationStrategy } from "../contracts/review-aggregation.strategy";

/**
 * Registry for review aggregation strategies.
 * Aggregation policy lives in strategies, not providers or ReviewService.
 */
@Injectable()
export class ReviewAggregationStrategyRegistry {
    private strategies = new Map<ReviewTargetType, ReviewAggregationStrategy>();

    register(strategy: ReviewAggregationStrategy): void {
        this.strategies.set(strategy.targetType, strategy);
    }

    getStrategy(targetType: ReviewTargetType): ReviewAggregationStrategy | undefined {
        return this.strategies.get(targetType);
    }

    getAllStrategies(): ReviewAggregationStrategy[] {
        return Array.from(this.strategies.values());
    }
}