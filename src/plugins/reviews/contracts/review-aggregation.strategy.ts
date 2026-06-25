import { RequestContext, ID } from "@vendure/core";
import { ReviewTargetProvider } from "./review-target.provider";
import { AggregateResult } from "./review-types";

export interface ReviewAggregationStrategy {
    recalculate(ctx: RequestContext, targetId: ID): Promise<AggregateResult>;
}