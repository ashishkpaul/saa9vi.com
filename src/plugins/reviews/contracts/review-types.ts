import { ReviewVerificationType } from "../constants";
export type { EligibilityResult } from "./review-eligibility.strategy";
export type { AggregateResult } from "./review-aggregation.strategy";

/**
 * Structured context for how a review was verified.
 */
export interface ReviewVerificationContext {
    source: ReviewVerificationType;
    [key: string]: any;
}