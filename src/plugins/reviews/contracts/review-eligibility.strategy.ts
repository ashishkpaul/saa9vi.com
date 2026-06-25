import { RequestContext, ID } from "@vendure/core";
import { ReviewTargetProvider } from "./review-target.provider";
import { EligibilityResult } from "./review-types";

export interface ReviewEligibilityStrategy {
    canReview(
        ctx: RequestContext,
        customerId: ID,
        targetId: ID,
        provider: ReviewTargetProvider,
    ): Promise<EligibilityResult>;
}