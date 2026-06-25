import { Injectable } from "@nestjs/common";
import { RequestContext, TransactionalConnection, Logger, UserInputError } from "@vendure/core";
import { Repository } from "typeorm";

import { ReviewReward } from "../entities/review-reward.entity";
import { ProductReview } from "../entities/product-review.entity";

const loggerCtx = "ReviewRewardService";

export interface CreateReviewRewardInput {
  customerId: string;
  reviewId: string;
  productId: string;
  orderId?: string;
  rewardType: string;
  rewardValue: number;
  currencyCode?: string;
  rewardCode?: string;
  expiresAt?: Date;
  isIncentivized?: boolean;
  metadata?: any;
}

@Injectable()
export class ReviewRewardService {
  constructor(private connection: TransactionalConnection) {}

  private getRepo(ctx: RequestContext): Repository<ReviewReward> {
    return this.connection.getRepository(ctx, ReviewReward);
  }

  private getReviewRepo(ctx: RequestContext): Repository<ProductReview> {
    return this.connection.getRepository(ctx, ProductReview);
  }

  private safeParseMetadata(metadata: string | null): any {
    if (!metadata) return {};

    try {
      return JSON.parse(metadata);
    } catch {
      return {};
    }
  }

  private safeStringifyMetadata(metadata: any): string {
    try {
      return JSON.stringify(metadata);
    } catch {
      return "{}";
    }
  }

  /**
   * Create reward safely (prevents duplicates)
   */
  async createReward(
    ctx: RequestContext,
    input: CreateReviewRewardInput,
  ): Promise<ReviewReward> {
    const repo = this.getRepo(ctx);

    const existing = await repo.findOne({
      where: {
        reviewId: input.reviewId,
        customerId: input.customerId,
      },
    });

    if (existing) {
      Logger.warn(
        `Reward already exists for review ${input.reviewId}`,
        loggerCtx,
      );

      return existing;
    }

    const reward = repo.create({
      customerId: input.customerId,

      reviewId: input.reviewId,

      productId: input.productId,

      orderId: input.orderId ?? null,

      rewardType: input.rewardType,

      rewardValue: input.rewardValue,

      currencyCode: input.currencyCode ?? null,

      rewardCode: input.rewardCode ?? null,

      status: "pending",

      expiresAt: input.expiresAt ?? null,

      isIncentivized: input.isIncentivized ?? false,

      metadata: input.metadata
        ? this.safeStringifyMetadata(input.metadata)
        : null,
    });

    const saved = await repo.save(reward);

    Logger.info(
      `Reward created for review ${input.reviewId}`,

      loggerCtx,
    );

    return saved;
  }

  /**
   * Grant reward only if review approved
   */
  async grantReward(
    ctx: RequestContext,

    rewardId: string,

    grantedAt?: Date,
  ): Promise<ReviewReward> {
    const repo = this.getRepo(ctx);

    const reviewRepo = this.getReviewRepo(ctx);

    const reward = await repo.findOne({
      where: { id: rewardId },
    });

    if (!reward) {
      throw new UserInputError(`Reward ${rewardId} not found`);
    }

    if (reward.status !== "pending") {
      return reward;
    }

    const review = await reviewRepo.findOne({
      where: { id: reward.reviewId },
    });

    if (!review) {
      throw new UserInputError("Review not found for reward");
    }

    if (review.state !== "approved") {
      Logger.warn(
        `Reward blocked. Review ${review.id} not approved`,

        loggerCtx,
      );

      return reward;
    }

    reward.status = "granted";

    reward.grantedAt = grantedAt ?? new Date();

    const saved = await repo.save(reward);

    Logger.info(
      `Reward ${rewardId} granted`,

      loggerCtx,
    );

    return saved;
  }

  /**
   * Redeem reward safely
   */
  async redeemReward(
    ctx: RequestContext,

    rewardId: string,

    redeemedAt?: Date,
  ): Promise<ReviewReward> {
    const repo = this.getRepo(ctx);

    const reward = await repo.findOne({
      where: { id: rewardId },
    });

    if (!reward) {
      throw new UserInputError(`Reward ${rewardId} not found`);
    }

    if (reward.status !== "granted") {
      throw new UserInputError("Reward must be granted before redeem");
    }

    if (reward.expiresAt && reward.expiresAt < new Date()) {
      reward.status = "expired";

      await repo.save(reward);

      throw new UserInputError("Reward expired");
    }

    reward.status = "redeemed";

    reward.redeemedAt = redeemedAt ?? new Date();

    const saved = await repo.save(reward);

    Logger.info(
      `Reward ${rewardId} redeemed`,

      loggerCtx,
    );

    return saved;
  }

  /**
   * Revoke reward safely
   */
  async revokeReward(
    ctx: RequestContext,

    rewardId: string,

    reason?: string,
  ): Promise<ReviewReward> {
    const repo = this.getRepo(ctx);

    const reward = await repo.findOne({
      where: { id: rewardId },
    });

    if (!reward) {
      throw new UserInputError(`Reward ${rewardId} not found`);
    }

    if (reward.status === "revoked") {
      return reward;
    }

    reward.status = "revoked";

    const metadata = this.safeParseMetadata(reward.metadata);

    metadata.revokedReason = reason;

    metadata.revokedAt = new Date();

    reward.metadata = this.safeStringifyMetadata(metadata);

    const saved = await repo.save(reward);

    Logger.info(
      `Reward ${rewardId} revoked`,

      loggerCtx,
    );

    return saved;
  }

  /**
   * Customer rewards with pagination cap
   */
  async getCustomerRewards(
    ctx: RequestContext,

    customerId: string,

    options?: {
      status?: string;

      take?: number;

      skip?: number;
    },
  ) {
    const repo = this.getRepo(ctx);

    const where: any = { customerId };

    if (options?.status) {
      where.status = options.status;
    }

    const take = Math.min(options?.take ?? 20, 50);

    const skip = options?.skip ?? 0;

    const [items, totalItems] = await repo.findAndCount({
      where,

      order: {
        createdAt: "DESC",
      },

      take,

      skip,
    });

    return {
      items,

      totalItems,
    };
  }

  /**
   * Rewards for review
   */
  async getReviewRewards(
    ctx: RequestContext,

    reviewId: string,
  ) {
    const repo = this.getRepo(ctx);

    return repo.find({
      where: { reviewId },

      order: {
        createdAt: "DESC",
      },
    });
  }

  /**
   * Pending rewards count
   */
  async getPendingRewardCount(ctx: RequestContext) {
    return this.getRepo(ctx)

      .count({
        where: {
          status: "pending",
        },
      });
  }

  /**
   * Check duplicate reward
   */
  async hasRewardForReview(
    ctx: RequestContext,

    customerId: string,

    reviewId: string,
  ) {
    const count = await this.getRepo(ctx).count({
      where: {
        customerId,
        reviewId,
      },
    });

    return count > 0;
  }
}
