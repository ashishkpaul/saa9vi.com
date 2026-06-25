import { Injectable } from "@nestjs/common";
import { RequestContext, TransactionalConnection, Logger, UserInputError } from "@vendure/core";
import { Repository } from "typeorm";

import { ReviewReport } from "../entities/review-report.entity";
import { ProductReview } from "../entities/product-review.entity";

const loggerCtx = "ReviewReportService";

export interface CreateReviewReportInput {
  reviewId: string;
  reporterId: string;
  reason: string;
  description?: string;
  reporterIp?: string;
  reporterUserAgent?: string;
}

@Injectable()
export class ReviewReportService {
  constructor(private connection: TransactionalConnection) {}

  private getRepo(ctx: RequestContext): Repository<ReviewReport> {
    return this.connection.getRepository(ctx, ReviewReport);
  }

  private getReviewRepo(ctx: RequestContext): Repository<ProductReview> {
    return this.connection.getRepository(ctx, ProductReview);
  }

  /**
   * Create report safely
   */
  async createReport(
    ctx: RequestContext,

    input: CreateReviewReportInput,
  ): Promise<ReviewReport> {
    const repo = this.getRepo(ctx);

    const reviewRepo = this.getReviewRepo(ctx);

    const review = await reviewRepo.findOne({
      where: {
        id: input.reviewId,
      },
    });

    if (!review) {
      throw new UserInputError("Review not found");
    }

    const existingReport = await repo.findOne({
      where: {
        reviewId: input.reviewId,
        reporterId: input.reporterId,
      },
    });

    if (existingReport) {
      throw new UserInputError("You have already reported this review");
    }

    const report = repo.create({
      reviewId: input.reviewId,

      reporterId: input.reporterId,

      reason: input.reason,

      description: input.description ?? null,

      reporterIp: input.reporterIp ?? null,

      reporterUserAgent: input.reporterUserAgent ?? null,

      status: "pending",
    });

    const saved = await repo.save(report);

    Logger.info(
      `Report created for review ${input.reviewId}`,

      loggerCtx,
    );

    return saved;
  }

  /**
   * Admin report listing
   */
  async getReports(
    ctx: RequestContext,

    options?: {
      status?: string;

      take?: number;

      skip?: number;
    },
  ) {
    const repo = this.getRepo(ctx);

    const where: any = {};

    if (options?.status) {
      where.status = options.status;
    }

    const take = Math.min(options?.take ?? 20, 50);

    const skip = options?.skip ?? 0;

    const [items, totalItems] = await repo.findAndCount({
      where,

      relations: ["review", "reporter"],

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
   * Single report lookup
   */
  async getReport(
    ctx: RequestContext,

    reportId: string,
  ) {
    return this.getRepo(ctx)

      .findOne({
        where: {
          id: reportId,
        },

        relations: ["review", "reporter", "review.product", "review.author"],
      });
  }

  /**
   * Admin review action
   */
  async reviewReport(
    ctx: RequestContext,

    reportId: string,

    adminId: string,

    actionTaken: string,

    adminNotes?: string,
  ) {
    const repo = this.getRepo(ctx);

    const reviewRepo = this.getReviewRepo(ctx);

    const report = await repo.findOne({
      where: {
        id: reportId,
      },

      relations: ["review"],
    });

    if (!report) {
      throw new UserInputError(`Report ${reportId} not found`);
    }

    report.status = "reviewed";

    report.reviewedByAdminId = adminId;

    report.reviewedAt = new Date();

    report.actionTaken = actionTaken;

    report.adminNotes = adminNotes ?? null;

    if (report.review) {
      if (actionTaken === "review_hidden") {
        report.review.state = "hidden";

        await reviewRepo.save(report.review);
      }

      if (actionTaken === "review_deleted") {
        report.review.state = "rejected";

        await reviewRepo.save(report.review);
      }
    }

    const saved = await repo.save(report);

    Logger.info(
      `Report ${reportId} reviewed action=${actionTaken}`,

      loggerCtx,
    );

    return saved;
  }

  /**
   * Dismiss report
   */
  async dismissReport(
    ctx: RequestContext,

    reportId: string,

    adminId: string,

    adminNotes?: string,
  ) {
    const repo = this.getRepo(ctx);

    const report = await repo.findOne({
      where: {
        id: reportId,
      },
    });

    if (!report) {
      throw new UserInputError(`Report ${reportId} not found`);
    }

    report.status = "dismissed";

    report.reviewedByAdminId = adminId;

    report.reviewedAt = new Date();

    report.actionTaken = "none";

    report.adminNotes = adminNotes ?? null;

    const saved = await repo.save(report);

    Logger.info(
      `Report ${reportId} dismissed`,

      loggerCtx,
    );

    return saved;
  }

  /**
   * Count reports for review
   */
  async getReportCount(
    ctx: RequestContext,

    reviewId: string,
  ) {
    return this.getRepo(ctx)

      .count({
        where: {
          reviewId,
        },
      });
  }

  /**
   * Pending count
   */
  async getPendingReportCount(ctx: RequestContext) {
    return this.getRepo(ctx)

      .count({
        where: {
          status: "pending",
        },
      });
  }
}
