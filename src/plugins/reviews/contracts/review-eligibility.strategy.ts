import { RequestContext, ID } from "@vendure/core";
import { ReviewTargetProvider } from "./review-target.provider";
import { ReviewTargetType, ReviewVerificationType } from "../constants";

export interface EligibilityResult {
    eligible: boolean;
    reason?: string;

    hasPurchased?: boolean;
    hasExistingReview?: boolean;

    eligibleOrderId?: ID;
    eligibleOrderLineId?: ID;

    verificationType?: ReviewVerificationType;
    verificationContext?: Record<string, any>;
}

export interface ReviewEligibilityStrategy {
    readonly targetType: ReviewTargetType;

    canReview(
        ctx: RequestContext,
        customerId: ID,
        targetId: ID,
        provider: ReviewTargetProvider,
    ): Promise<EligibilityResult>;
}