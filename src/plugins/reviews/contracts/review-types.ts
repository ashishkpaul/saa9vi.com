import { ReviewVerificationType } from "../constants";

/**
 * Structured context for how a review was verified.
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