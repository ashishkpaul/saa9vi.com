// src/plugins/reviews/types.ts

import { ProductReview } from "./entities/product-review.entity";
import { ID, RequestContext } from "@vendure/core";
import { ReviewTargetType, ReviewVerificationType } from "./constants";

export type ReviewState =
  | "new"
  | "approved"
  | "rejected"
  | "hidden"
  | "flagged";

// This module augmentation extends the CustomProductFields interface
// provided by @vendure/core. This is crucial for TypeScript to recognize
// your custom fields when accessing `product.customFields`.
// Targeting the specific file where CustomProductFields is defined
// makes the augmentation more reliable.
declare module "@vendure/core/dist/entity/custom-entity-fields" {
  interface CustomProductFields {
    // Corresponds to 'reviewRating' defined in reviews-plugin.ts.
    // It's a float and nullable in your Vendure config.
    reviewRating: number | null;
    // Corresponds to 'reviewCount' defined in reviews-plugin.ts.
    // It's a float with a default value, so it's always a number.
    reviewCount: number;
    // Corresponds to 'featuredReview' defined in reviews-plugin.ts.
    // It's a relation to ProductReview and is nullable.
    featuredReview: ProductReview | null;
  }
  // If you have custom fields on other entities (e.g., Order, Customer),
  // you would add similar interfaces here:
  // interface CustomOrderFields { /* ... */ }
  // interface CustomCustomerFields { /* ... */ }
}

export const ReviewAdminPermission = "ReviewAdmin";

/**
 * Structured context for how a review was verified.
 * Example:
 *   { source: "ORDER", orderId: "abc", orderLineId: "def" }
 *   { source: "BBB_ATTENDANCE", meetingId: "ghi", attendeeId: "jkl", durationMinutes: 60 }
 */
export interface ReviewVerificationContext {
    source: ReviewVerificationType;
    [key: string]: any;
}

export interface EligibilityResult {
    eligible: boolean;
    reason: string;
    [key: string]: any;
}

export interface AggregateResult {
    averageRating: number;
    reviewCount: number;
    verifiedReviewCount: number;
    [key: string]: any;
}

/**
 * Interface for adapting external entities as review targets.
 * Provides entity-specific knowledge without embedding business rules.
 */
export interface ReviewTargetProvider {
    readonly targetType: ReviewTargetType;

    validateTargetExists(ctx: RequestContext, targetId: ID): Promise<boolean>;

    getTargetDisplayName(ctx: RequestContext, targetId: ID): Promise<string>;

    updateAggregates(ctx: RequestContext, targetId: ID): Promise<void>;

    /**
     * Returns the channel IDs in which this target is visible.
     * Used for multi-tenant filtering without denormalizing channelId on reviews.
     */
    getChannels(ctx: RequestContext, targetId: ID): Promise<string[]>;
}

/**
 * Interface for business rules that determine review eligibility.
 * Separate from the provider to keep entity knowledge distinct from policy.
 */
export interface ReviewEligibilityStrategy {
    canReview(
        ctx: RequestContext,
        customerId: ID,
        targetId: ID,
        provider: ReviewTargetProvider,
    ): Promise<EligibilityResult>;
}

/**
 * Interface for aggregating review data into target-specific metrics.
 * Different target types may require different aggregation logic.
 */
export interface ReviewAggregationStrategy {
    recalculate(ctx: RequestContext, targetId: ID): Promise<AggregateResult>;
}
