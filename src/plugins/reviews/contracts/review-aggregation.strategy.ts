import { RequestContext, ID } from "@vendure/core";
import { ReviewTargetType } from "../constants";

export interface AggregateResult {
    averageRating: number;
    reviewCount: number;
    verifiedReviewCount: number;
}

export interface ReviewAggregationStrategy {
    readonly targetType: ReviewTargetType;

    recalculate(ctx: RequestContext, targetId: ID): Promise<AggregateResult>;
}