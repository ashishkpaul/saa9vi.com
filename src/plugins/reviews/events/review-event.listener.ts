import { Injectable, Logger, OnApplicationBootstrap } from "@nestjs/common";
import {
  ChannelService,
  EventBus,
  RequestContext,
  RequestContextService,
  TransactionalConnection,
} from "@vendure/core";

import { ProductReview } from "../entities/product-review.entity";
import {
  ReviewApprovedEvent,
  ReviewCreatedEvent,
  ReviewRejectedEvent,
} from "./review.events";
import { ProductReviewService } from "../services/product-review.service";
import { ReviewAntiFraudService } from "../services/review-antifraud.service";

@Injectable()
export class ReviewEventListener implements OnApplicationBootstrap {
  private readonly logger = new Logger(ReviewEventListener.name);

  constructor(
    private eventBus: EventBus,
    private productReviewService: ProductReviewService,
    private reviewAntiFraudService: ReviewAntiFraudService,
    private connection: TransactionalConnection,
    private requestContextService: RequestContextService,
    private channelService: ChannelService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    this.eventBus.ofType(ReviewCreatedEvent).subscribe((event) => {
      this.handleReviewCreated(event).catch((err) => {
        this.logger.error(`Error handling ReviewCreatedEvent: ${err?.message}`);
      });
    });

    this.eventBus.ofType(ReviewApprovedEvent).subscribe((event) => {
      this.handleReviewApproved(event).catch((err) => {
        this.logger.error(
          `Error handling ReviewApprovedEvent: ${err?.message}`,
        );
      });
    });

    this.eventBus.ofType(ReviewRejectedEvent).subscribe((event) => {
      this.handleReviewRejected(event).catch((err) => {
        this.logger.error(
          `Error handling ReviewRejectedEvent: ${err?.message}`,
        );
      });
    });
  }


  private async createInternalCtx(channelToken?: string): Promise<RequestContext> {
    const resolvedChannelToken =
      channelToken ?? (await this.channelService.getDefaultChannel()).token;
    return this.requestContextService.create({
      apiType: "admin",
      channelOrToken: resolvedChannelToken,
    });
  }

  private async handleReviewCreated(event: ReviewCreatedEvent): Promise<void> {
    this.logger.log(
      `Review created: reviewId=${event.reviewId}, productId=${event.productId}`,
    );

    // Run anti-fraud analysis
    const ctx = await this.createInternalCtx(event.channelToken);

    try {
      const reviewRepo = this.connection.getRepository(ctx, ProductReview);

      const review = await reviewRepo.findOne({
        where: { id: event.reviewId },
        relations: ["author"],
      });

      if (review && (review as any).author) {
        const analysis = await this.reviewAntiFraudService.analyzeReview(
          ctx,
          review as any,
        );

        if (analysis.shouldFlag) {
          this.logger.warn(
            `Review ${event.reviewId} flagged as high-risk (score: ${analysis.riskScore}): ${analysis.issues.join(", ")}`,
          );

          // Auto-flag for moderator review
          await this.productReviewService.flagReview(
            ctx,
            event.reviewId,
            `Auto-flagged by fraud detection: ${analysis.issues.join("; ")}`,
          );
        } else if (analysis.riskScore > 0) {
          this.logger.log(
            `Review ${event.reviewId} has moderate risk (score: ${analysis.riskScore}): ${analysis.issues.join(", ")}`,
          );
        }
      }
    } catch (err) {
      this.logger.error(
        `Error running fraud analysis on review ${event.reviewId}: ${err?.message}`,
      );
    }
  }

  private async handleReviewApproved(
    event: ReviewApprovedEvent,
  ): Promise<void> {
    this.logger.log(
      `Review approved: reviewId=${event.reviewId}, productId=${event.productId}`,
    );
    // Rating recalculation is handled synchronously in the service
    // Future: Sync search index, send email notification
  }

  private async handleReviewRejected(
    event: ReviewRejectedEvent,
  ): Promise<void> {
    this.logger.log(
      `Review rejected: reviewId=${event.reviewId}, productId=${event.productId}`,
    );
    // Rating recalculation is handled synchronously in the service
    // Future: Sync search index
  }
}
