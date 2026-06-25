import { Injectable } from "@nestjs/common";
import {
  ID,
  RequestContext,
  Logger,
  Customer,
  Product,
  Order,
  TransactionalConnection,
} from "@vendure/core";
import { ReviewRequest } from "../entities/review-request.entity";

const loggerCtx = "ReviewEmailService";

/**
 * Service for handling review-related email notifications.
 * Includes review request emails, reminders, and confirmation emails.
 *
 * Note: Email sending is handled via event listeners and the email plugin.
 * This service prepares the data and logs the intent.
 */
@Injectable()
export class ReviewEmailService {
  constructor(private connection: TransactionalConnection) {}

  /**
   * Prepare and log a review request email.
   * In a production setup, this would integrate with the email plugin.
   */
  async sendReviewRequestEmail(
    ctx: RequestContext,
    reviewRequest: ReviewRequest & {
      customer: Customer;
      product: Product;
      order: Order;
    },
  ): Promise<void> {
    try {
      const { customer, product, order } = reviewRequest;
      const reviewUrl = this.generateReviewUrl(reviewRequest.reviewToken);

      // Log the email intent - in production, integrate with email plugin
      Logger.info(
        `Review request email queued for ${customer.emailAddress}: ` +
          `Product: ${product.name}, Order: ${order.code}, URL: ${reviewUrl}`,
        loggerCtx,
      );

      // TODO: Integrate with @vendure/email-plugin when available
      // Example integration:
      // await this.eventBus.publish(
      //   new ReviewRequestEmailEvent(ctx, {
      //     customer,
      //     product,
      //     order,
      //     reviewUrl,
      //     reviewToken: reviewRequest.reviewToken,
      //   })
      // );
    } catch (error: any) {
      Logger.error(
        `Failed to process review request email: ${error.message}`,
        loggerCtx,
      );
    }
  }

  /**
   * Prepare and log a review reminder email.
   */
  async sendReviewReminderEmail(
    ctx: RequestContext,
    reviewRequest: ReviewRequest & {
      customer: Customer;
      product: Product;
      order: Order;
    },
  ): Promise<void> {
    try {
      const { customer, product, order } = reviewRequest;
      const reviewUrl = this.generateReviewUrl(reviewRequest.reviewToken);

      Logger.info(
        `Review reminder email queued for ${customer.emailAddress}: ` +
          `Product: ${product.name}, Reminder #${reviewRequest.reminderCount}, URL: ${reviewUrl}`,
        loggerCtx,
      );
    } catch (error: any) {
      Logger.error(
        `Failed to process review reminder email: ${error.message}`,
        loggerCtx,
      );
    }
  }

  /**
   * Log a thank you notification after a review is submitted.
   */
  async sendReviewThankYouEmail(
    ctx: RequestContext,
    customer: Customer,
    product: Product,
  ): Promise<void> {
    try {
      Logger.info(
        `Review thank you notification for ${customer.emailAddress}: ` +
          `Product: ${product.name}`,
        loggerCtx,
      );
    } catch (error: any) {
      Logger.error(
        `Failed to process review thank you: ${error.message}`,
        loggerCtx,
      );
    }
  }

  /**
   * Generate the URL for the review submission page.
   * This should be configurable based on the storefront URL.
   */
  private generateReviewUrl(token: string): string {
    // TODO: Make this configurable via plugin options
    const storefrontUrl = process.env.STOREFRONT_URL || "http://localhost:3000";
    return `${storefrontUrl}/review/submit?token=${token}`;
  }
}
