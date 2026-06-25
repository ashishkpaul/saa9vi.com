import { ErrorResult } from "@vendure/core";

export type ReviewErrorResult =
  | DuplicateReviewError
  | InvalidRatingError
  | InvalidReviewStateError
  | ReviewNotFoundError
  | UnauthorizedError
  | NotVerifiedPurchaseError
  | ReviewValidationError
  | ProductNotFoundError;

export class DuplicateReviewError {
  readonly errorCode = "DUPLICATE_REVIEW_ERROR";
  readonly message: string;
  constructor(message = "You have already reviewed this product") {
    this.message = message;
  }
}

export class InvalidRatingError {
  readonly errorCode = "INVALID_RATING_ERROR";
  readonly message: string;
  constructor(message = "Rating must be between 1 and 5") {
    this.message = message;
  }
}

export class InvalidReviewStateError {
  readonly errorCode = "INVALID_REVIEW_STATE_ERROR";
  readonly message: string;
  constructor(message = "Invalid review state transition") {
    this.message = message;
  }
}

export class ReviewNotFoundError {
  readonly errorCode = "REVIEW_NOT_FOUND_ERROR";
  readonly message: string;
  constructor(message = "Review not found") {
    this.message = message;
  }
}

export class UnauthorizedError {
  readonly errorCode = "UNAUTHORIZED_ERROR";
  readonly message: string;
  constructor(message = "You are not authorized to perform this action") {
    this.message = message;
  }
}

export class NotVerifiedPurchaseError {
  readonly errorCode = "NOT_VERIFIED_PURCHASE_ERROR";
  readonly message: string;
  constructor(message = "You can only review products you have purchased") {
    this.message = message;
  }
}

export class ReviewValidationError {
  readonly errorCode = "REVIEW_VALIDATION_ERROR";
  readonly message: string;
  constructor(message = "Review input is invalid") {
    this.message = message;
  }
}

export class ProductNotFoundError {
  readonly errorCode = "PRODUCT_NOT_FOUND_ERROR";
  readonly message: string;
  constructor(message = "Product not found") {
    this.message = message;
  }
}
