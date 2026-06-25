import { Injectable } from "@nestjs/common";
import {
  ID,
  RequestContext,
  TransactionalConnection,
  Order,
  EventBus,
} from "@vendure/core";
import { Repository } from "typeorm";
import { randomBytes } from "crypto";

import {
  ReviewRequest,
  ReviewRequestStatus,
} from "../entities/review-request.entity";
import { ReviewEmailService } from "./review-email.service";

export interface CreateReviewRequestInput {
  customerId: ID;
  productId: ID;
  orderId: ID;
  orderLineId?: ID;
  scheduledAt: Date;
  expiresAt: Date;
  channelId?: string;
  isIncentivized?: boolean;
}

export interface ReviewRequestResult {
  id: ID;
  status: ReviewRequestStatus;
  scheduledAt: Date;
  sentAt: Date | null;
  reviewedAt: Date | null;
  reminderCount: number;
  expiresAt: Date;
  reviewToken: string;
  openedAt: Date | null;
  clickCount: number;
  product: {
    id: ID;
    name: string;
  };
  order: {
    id: ID;
    code: string;
  };
}

@Injectable()
export class ReviewRequestService {
  constructor(
    private connection: TransactionalConnection,
    private eventBus: EventBus,
    private reviewEmailService: ReviewEmailService,
  ) {}

  private getRepo(ctx: RequestContext): Repository<ReviewRequest> {
    return this.connection.getRepository(ctx, ReviewRequest);
  }

  /**
   * Generate a unique review token
   */
  private generateReviewToken(): string {
    return randomBytes(32).toString("hex");
  }

  /**
   * Create review requests for all eligible products in an order
   */
  async createRequestsFromOrder(
    ctx: RequestContext,
    orderId: ID,
    options?: {
      reviewDelayDays?: number;
      expiryDays?: number;
      isIncentivized?: boolean;
    },
  ): Promise<ReviewRequest[]> {
    const reviewDelayDays = options?.reviewDelayDays ?? 5;
    const expiryDays = options?.expiryDays ?? 60;
    const isIncentivized = options?.isIncentivized ?? false;

    const orderRepo = this.connection.getRepository(ctx, Order);
    const order = await orderRepo.findOne({
      where: { id: orderId },
      relations: [
        "customer",
        "lines",
        "lines.productVariant",
        "lines.productVariant.product",
        "channels",
      ],
    });

    if (!order || !order.customer) {
      console.warn(`Order ${orderId} not found or has no customer`);
      return [];
    }

    if (order.state !== "Delivered") {
      console.debug(
        `Order ${orderId} is not delivered, skipping review requests`,
      );
      return [];
    }

    const now = new Date();
    const scheduledAt = new Date(
      now.getTime() + reviewDelayDays * 24 * 60 * 60 * 1000,
    );
    const expiresAt = new Date(
      now.getTime() + expiryDays * 24 * 60 * 60 * 1000,
    );

    const candidateLines = order.lines.filter((line) => !!line.productVariant?.product);
    if (candidateLines.length === 0) {
      return [];
    }

    const orderLineIds = candidateLines.map((line) => line.id);
    const existingRequests = await this.getRepo(ctx).find({
      where: orderLineIds.map((id) => ({ orderLine: { id } as any })),
      relations: ["orderLine"],
    });
    const existingOrderLineIds = new Set(
      existingRequests
        .map((request) => request.orderLine?.id)
        .filter((id): id is ID => !!id),
    );

    const values = candidateLines
      .filter((line) => !existingOrderLineIds.has(line.id as ID))
      .map((line) => ({
        customer: { id: order.customer!.id as string },
        product: { id: line.productVariant!.product.id as string },
        order: { id: order.id as string },
        orderLine: { id: line.id as string },
        status: "scheduled" as const,
        scheduledAt,
        expiresAt,
        reviewToken: this.generateReviewToken(),
        channelId: (order.channels?.[0]?.id as string) ?? null,
        isIncentivized,
      }));

    if (values.length === 0) {
      return [];
    }

    await this.getRepo(ctx)
      .createQueryBuilder()
      .insert()
      .into(ReviewRequest)
      .values(values)
      .orIgnore()
      .execute();

    const insertedOrderLineIds = values
      .map((value) => value.orderLine?.id)
      .filter((id): id is string => !!id);

    const createdRequests = await this.getRepo(ctx).find({
      where: insertedOrderLineIds.map((id) => ({ orderLine: { id } as any })),
      relations: ["product", "order", "orderLine"],
    });

    createdRequests.forEach((request) => {
      console.log(
        `Created review request for customer ${order.customer!.id}, product ${(request.product as any)?.id}`,
      );
    });

    return createdRequests;
  }

  /**
   * Get pending review requests for a customer
   */
  async getPendingRequests(
    ctx: RequestContext,
    customerId: ID,
    options?: {
      take?: number;
      skip?: number;
    },
  ): Promise<{ items: ReviewRequestResult[]; totalItems: number }> {
    const take = options?.take ?? 10;
    const skip = options?.skip ?? 0;

    const [items, totalItems] = await this.getRepo(ctx).findAndCount({
      where: {
        customer: { id: customerId },
        status: "scheduled",
      },
      relations: ["product", "order"],
      order: { scheduledAt: "ASC" },
      take,
      skip,
    });

    return {
      items: items.map((item) => this.toResult(item)),
      totalItems,
    };
  }

  /**
   * Get pending review requests by order
   */
  async getPendingRequestsByOrder(
    ctx: RequestContext,
    orderId: ID,
  ): Promise<ReviewRequestResult[]> {
    const items = await this.getRepo(ctx).find({
      where: {
        order: { id: orderId },
        status: "scheduled",
      },
      relations: ["product", "order"],
      order: { scheduledAt: "ASC" },
    });

    return items.map((item) => this.toResult(item));
  }

  /**
   * Mark a review request as reviewed
   */
  async markReviewed(
    ctx: RequestContext,
    requestId: ID,
  ): Promise<ReviewRequest | null> {
    const request = await this.getRepo(ctx).findOne({
      where: { id: requestId },
    });

    if (!request) {
      return null;
    }

    request.status = "reviewed";
    request.reviewedAt = new Date();

    return this.getRepo(ctx).save(request);
  }

  /**
   * Mark a review request as reviewed by token
   */
  async markReviewedByToken(
    ctx: RequestContext,
    token: string,
  ): Promise<ReviewRequest | null> {
    const request = await this.getRepo(ctx).findOne({
      where: { reviewToken: token },
    });

    if (!request) {
      return null;
    }

    request.status = "reviewed";
    request.reviewedAt = new Date();

    return this.getRepo(ctx).save(request);
  }

  /**
   * Process scheduled review requests (send emails)
   */
  async processScheduled(
    ctx: RequestContext,
    options?: {
      batchSize?: number;
    },
  ): Promise<{ processed: number; sent: number }> {
    const batchSize = options?.batchSize ?? 100;
    const now = new Date();

    const scheduledRequests = await this.getRepo(ctx).find({
      where: {
        status: "scheduled",
        scheduledAt: { lte: now } as any,
      },
      relations: ["customer", "product", "order"],
      take: batchSize,
      order: { scheduledAt: "ASC" },
    });

    let sent = 0;

    for (const request of scheduledRequests) {
      try {
        // Send email via review email service
        await this.reviewEmailService.sendReviewRequestEmail(
          ctx,
          request as any,
        );

        request.status = "sent";
        request.sentAt = now;
        await this.getRepo(ctx).save(request);

        sent++;
        console.log(
          `Sent review request email for token ${request.reviewToken}`,
        );
      } catch (error) {
        console.error(
          `Failed to send review request email for token ${request.reviewToken}`,
          error,
        );
      }
    }

    return { processed: scheduledRequests.length, sent };
  }

  /**
   * Send reminder emails for pending review requests
   */
  async sendReminder(
    ctx: RequestContext,
    options?: {
      maxReminders?: number;
      reminderIntervalDays?: number;
      batchSize?: number;
    },
  ): Promise<{ processed: number; sent: number }> {
    const maxReminders = options?.maxReminders ?? 2;
    const reminderIntervalDays = options?.reminderIntervalDays ?? 10;
    const batchSize = options?.batchSize ?? 100;

    const now = new Date();
    const cutoffDate = new Date(
      now.getTime() - reminderIntervalDays * 24 * 60 * 60 * 1000,
    );

    const pendingRequests = await this.getRepo(ctx).find({
      where: {
        status: "sent",
        reminderCount: { lt: maxReminders } as any,
        lastReminderAt: { lte: cutoffDate } as any,
      },
      relations: ["customer", "product", "order"],
      take: batchSize,
      order: { sentAt: "ASC" },
    });

    let sent = 0;

    for (const request of pendingRequests) {
      try {
        // Send reminder email via review email service
        await this.reviewEmailService.sendReviewReminderEmail(
          ctx,
          request as any,
        );

        request.reminderCount += 1;
        request.lastReminderAt = now;
        await this.getRepo(ctx).save(request);

        sent++;
        console.log(`Sent reminder email for token ${request.reviewToken}`);
      } catch (error) {
        console.error(
          `Failed to send reminder email for token ${request.reviewToken}`,
          error,
        );
      }
    }

    return { processed: pendingRequests.length, sent };
  }

  /**
   * Expire old review requests
   */
  async expireOldRequests(
    ctx: RequestContext,
    options?: {
      batchSize?: number;
    },
  ): Promise<{ expired: number }> {
    const batchSize = options?.batchSize ?? 100;
    const now = new Date();

    const expiredRequests = await this.getRepo(ctx).find({
      where: {
        status: "scheduled",
        expiresAt: { lte: now } as any,
      },
      take: batchSize,
    });

    for (const request of expiredRequests) {
      request.status = "expired";
      await this.getRepo(ctx).save(request);
    }

    console.log(`Expired ${expiredRequests.length} review requests`);

    return { expired: expiredRequests.length };
  }

  /**
   * Validate a review token and return the request
   */
  async validateToken(
    ctx: RequestContext,
    token: string,
  ): Promise<ReviewRequestResult | null> {
    const request = await this.getRepo(ctx).findOne({
      where: { reviewToken: token },
      relations: ["product", "order"],
    });

    if (!request) {
      return null;
    }

    // Check if expired
    if (new Date() > request.expiresAt) {
      request.status = "expired";
      await this.getRepo(ctx).save(request);
      return null;
    }

    // Check if already reviewed
    if (request.status === "reviewed") {
      return null;
    }

    // Track click
    request.clickCount += 1;
    if (!request.openedAt) {
      request.openedAt = new Date();
    }
    await this.getRepo(ctx).save(request);

    return this.toResult(request);
  }

  /**
   * Convert ReviewRequest to result format
   */
  private toResult(request: ReviewRequest): ReviewRequestResult {
    return {
      id: request.id,
      status: request.status,
      scheduledAt: request.scheduledAt,
      sentAt: request.sentAt,
      reviewedAt: request.reviewedAt,
      reminderCount: request.reminderCount,
      expiresAt: request.expiresAt,
      reviewToken: request.reviewToken,
      openedAt: request.openedAt,
      clickCount: request.clickCount,
      product: {
        id: (request.product as any).id,
        name: (request.product as any).name,
      },
      order: {
        id: (request.order as any).id,
        code: (request.order as any).code,
      },
    };
  }
}
