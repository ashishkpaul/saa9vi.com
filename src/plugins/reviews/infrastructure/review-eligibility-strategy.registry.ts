import { Injectable } from "@nestjs/common";
import { ReviewTargetType } from "../constants";
import { ReviewEligibilityStrategy } from "../contracts/review-eligibility.strategy";

/**
 * Registry for review eligibility strategies.
 * Keeps ReviewService free of target-specific strategy selection logic.
 */
@Injectable()
export class ReviewEligibilityStrategyRegistry {
    private strategies = new Map<ReviewTargetType, ReviewEligibilityStrategy>();

    register(strategy: ReviewEligibilityStrategy): void {
        this.strategies.set(strategy.targetType, strategy);
    }

    getStrategy(targetType: ReviewTargetType): ReviewEligibilityStrategy | undefined {
        return this.strategies.get(targetType);
    }

    getAllStrategies(): ReviewEligibilityStrategy[] {
        return Array.from(this.strategies.values());
    }
}