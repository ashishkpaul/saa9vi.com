import { Injectable, Logger } from "@nestjs/common";
import { ID, RequestContext, TransactionalConnection } from "@vendure/core";
import { In } from "typeorm";
import { ProductReview } from "../entities/product-review.entity";
import { ReviewRequest } from "../entities/review-request.entity";
import { ReviewVote } from "../entities/review-vote.entity";

const loggerCtx = "ReviewDeletionService";

/**
 * Handles customer data cleanup for the Reviews plugin.
 *
 * Called by CustomerDeletionService during Flow A (leave_channel) and
 * Flow B (full_delete).
 *
 * INV-013 compliance:
 * - ProductReview: authorName anonymized, review text kept (community value)
 * - ReviewRequest: cancelled (no future prompts)
 * - ReviewVote: deleted (no PII to preserve)
 * - ReviewReport: kept (moderation audit trail, no PII field)
 * - ReviewReward: kept (financial/reward audit trail)
 */
@Injectable()
export class ReviewDeletionService {
  constructor(private readonly connection: TransactionalConnection) {}

  // ─── Flow A: Channel-scoped ───────────────────────────────────────────────

  /**
   * Remove customer data scoped to a single channel.
   *
   * Note: ProductReview and ReviewVote have no channelId column.
   * Channel scoping requires joining through product → product_channels_channel.
   */
  async removeFromChannel(
    ctx: RequestContext,
    customerId: ID,
    channelId: string,
  ): Promise<void> {
    Logger.log(
      `Reviews: Removing customer ${customerId} from channel ${channelId}`,
      loggerCtx,
    );

    // 1. Anonymize ProductReview.authorName scoped via product.channels join
    // ProductReview has no channelId — must join through product → channels
    const reviews = await this.connection
      .getRepository(ctx, ProductReview)
      .createQueryBuilder("review")
      .innerJoin("review.product", "product")
      .innerJoin("product.channels", "channel", "channel.id = :channelId", {
        channelId,
      })
      .where("review.author = :customerId", {
        customerId: String(customerId),
      })
      .getMany();

    for (const review of reviews) {
      review.authorName = "[deleted]";
      await this.connection.getRepository(ctx, ProductReview).save(review);
    }

    // 2. Cancel ReviewRequests in this channel (has scalar channelId)
    await this.connection.getRepository(ctx, ReviewRequest).update(
      { customer: { id: customerId as string } as any, channelId },
      { status: "expired" as any },
    );

    // 3. Delete ReviewVotes scoped via review → product → channel join
    const votes = await this.connection
      .getRepository(ctx, ReviewVote)
      .createQueryBuilder("vote")
      .innerJoin("vote.review", "review")
      .innerJoin("review.product", "product")
      .innerJoin("product.channels", "channel", "channel.id = :channelId", {
        channelId,
      })
      .where("vote.customer = :customerId", {
        customerId: String(customerId),
      })
      .getMany();

    if (votes.length > 0) {
      await this.connection
        .getRepository(ctx, ReviewVote)
        .remove(votes);
    }
  }

  // ─── Flow B: Full platform deletion ───────────────────────────────────────

  /**
   * Remove customer data across all channels.
   */
  async fullDelete(
    ctx: RequestContext,
    customerId: ID,
  ): Promise<void> {
    Logger.log(
      `Reviews: Full deletion of customer ${customerId}`,
      loggerCtx,
    );

    // 1. Anonymize all ProductReview.authorName for this customer
    const reviews = await this.connection
      .getRepository(ctx, ProductReview)
      .find({ where: { author: { id: customerId as string } as any } });

    for (const review of reviews) {
      review.authorName = "[deleted]";
      await this.connection.getRepository(ctx, ProductReview).save(review);
    }

    // 2. Cancel all ReviewRequests for this customer
    await this.connection.getRepository(ctx, ReviewRequest).update(
      { customer: { id: customerId as string } as any },
      { status: "expired" as any },
    );

    // 3. Delete all ReviewVotes by this customer
    const votes = await this.connection
      .getRepository(ctx, ReviewVote)
      .find({ where: { customer: { id: customerId as string } as any } });

    if (votes.length > 0) {
      await this.connection
        .getRepository(ctx, ReviewVote)
        .remove(votes);
    }

    // ReviewReport and ReviewReward are kept — no PII fields to anonymize,
    // and ReviewReward carries financial value (INV-013).
  }
}
