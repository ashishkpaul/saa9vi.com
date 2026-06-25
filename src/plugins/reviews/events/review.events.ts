import { VendureEvent } from "@vendure/core";
import type { ID } from "@vendure/core";

/**
 * Base event for all review-related events.
 */
export class ReviewEvent extends VendureEvent {
  constructor(
    public readonly reviewId: ID,
    public readonly productId: ID,
    public readonly customerId?: ID,
    public readonly channelToken?: string,
  ) {
    super();
  }
}

/**
 * Published when a new review is submitted.
 */
export class ReviewCreatedEvent extends ReviewEvent {
  constructor(reviewId: ID, productId: ID, customerId?: ID, channelToken?: string) {
    super(reviewId, productId, customerId, channelToken);
  }
}

/**
 * Published when a review is approved.
 */
export class ReviewApprovedEvent extends ReviewEvent {
  constructor(reviewId: ID, productId: ID, customerId?: ID, channelToken?: string) {
    super(reviewId, productId, customerId, channelToken);
  }
}

/**
 * Published when a review is rejected.
 */
export class ReviewRejectedEvent extends ReviewEvent {
  constructor(reviewId: ID, productId: ID, customerId?: ID, channelToken?: string) {
    super(reviewId, productId, customerId, channelToken);
  }
}

/**
 * Published when an admin responds to a review.
 */
export class ReviewRespondedEvent extends ReviewEvent {
  constructor(
    reviewId: ID,
    productId: ID,
    customerId?: ID,
    channelToken?: string,
    public readonly response?: string,
  ) {
    super(reviewId, productId, customerId, channelToken);
  }
}

/**
 * Published when a review is hidden by admin.
 */
export class ReviewHiddenEvent extends ReviewEvent {
  constructor(reviewId: ID, productId: ID, customerId?: ID, channelToken?: string) {
    super(reviewId, productId, customerId, channelToken);
  }
}

/**
 * Published when a review is flagged for moderation.
 */
export class ReviewFlaggedEvent extends ReviewEvent {
  constructor(
    reviewId: ID,
    productId: ID,
    customerId?: ID,
    channelToken?: string,
    public readonly reason?: string,
  ) {
    super(reviewId, productId, customerId, channelToken);
  }
}

/**
 * Published when a review request is created.
 */
export class ReviewRequestCreatedEvent extends VendureEvent {
  constructor(
    public readonly requestId: ID,
    public readonly customerId: ID,
    public readonly productId: ID,
    public readonly orderId: ID,
  ) {
    super();
  }
}

/**
 * Published when a review request email is sent.
 */
export class ReviewRequestSentEvent extends VendureEvent {
  constructor(
    public readonly requestId: ID,
    public readonly customerId: ID,
    public readonly productId: ID,
  ) {
    super();
  }
}

/**
 * Published when a review request email is opened.
 */
export class ReviewRequestOpenedEvent extends VendureEvent {
  constructor(
    public readonly requestId: ID,
    public readonly customerId: ID,
    public readonly productId: ID,
  ) {
    super();
  }
}

/**
 * Published when a review request link is clicked.
 */
export class ReviewRequestClickedEvent extends VendureEvent {
  constructor(
    public readonly requestId: ID,
    public readonly customerId: ID,
    public readonly productId: ID,
  ) {
    super();
  }
}

/**
 * Published when a review is converted from a request.
 */
export class ReviewConversionEvent extends VendureEvent {
  constructor(
    public readonly requestId: ID,
    public readonly reviewId: ID,
    public readonly customerId: ID,
    public readonly productId: ID,
  ) {
    super();
  }
}
