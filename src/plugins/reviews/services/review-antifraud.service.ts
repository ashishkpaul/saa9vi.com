import { Injectable } from "@nestjs/common";
import {
  ID,
  RequestContext,
  TransactionalConnection,
  Logger,
  Customer,
} from "@vendure/core";
import { Repository } from "typeorm";

import { ProductReview } from "../entities/product-review.entity";

const loggerCtx = "ReviewAntiFraudService";

/**
 * Anti-fraud intelligence service for detecting suspicious review patterns.
 * Implements various heuristics to identify potentially fraudulent reviews.
 */
@Injectable()
export class ReviewAntiFraudService {
  constructor(private connection: TransactionalConnection) {}

  /**
   * Analyze a review for potential fraud indicators.
   * Returns a risk score (0-100) and list of detected issues.
   */
  async analyzeReview(
    ctx: RequestContext,
    review: ProductReview & { author: Customer },
  ): Promise<{
    riskScore: number;
    issues: string[];
    shouldFlag: boolean;
  }> {
    const issues: string[] = [];
    let riskScore = 0;

    // Check 1: Review velocity - multiple reviews in short time
    const recentReviews = await this.getRecentReviewsByCustomer(
      ctx,
      review.author.id,
      7, // last 7 days
    );
    if (recentReviews.length >= 5) {
      issues.push("High review velocity: multiple reviews in short period");
      riskScore += 25;
    }

    // Check 2: Duplicate/similar content
    const similarReviews = await this.findSimilarReviews(
      ctx,
      review.body,
      review.product.id as ID,
    );
    if (similarReviews.length > 0) {
      issues.push("Similar review content detected");
      riskScore += 30;
    }

    // Check 3: Account age vs purchase timing
    const accountAge = this.getAccountAgeDays(review.author);
    if (accountAge < 7) {
      issues.push("New account with immediate review");
      riskScore += 20;
    }

    // Check 4: Review pattern (always 5 stars or always 1 star)
    const reviewPattern = await this.getReviewPattern(ctx, review.author.id);
    if (reviewPattern.totalReviews >= 3) {
      if (
        reviewPattern.averageRating >= 4.8 ||
        reviewPattern.averageRating <= 1.2
      ) {
        issues.push("Suspicious rating pattern");
        riskScore += 15;
      }
    }

    // Check 5: Purchased the product
    if (!review.verifiedPurchase) {
      issues.push("Review without verified purchase");
      riskScore += 10;
    }

    const shouldFlag = riskScore >= 50;

    if (shouldFlag) {
      Logger.warn(
        `Review ${review.id} flagged for potential fraud: ${issues.join(", ")}`,
        loggerCtx,
      );
    }

    return {
      riskScore: Math.min(riskScore, 100),
      issues,
      shouldFlag,
    };
  }

  /**
   * Get reviews by a customer in the last N days
   */
  private async getRecentReviewsByCustomer(
    ctx: RequestContext,
    customerId: ID,
    days: number,
  ): Promise<ProductReview[]> {
    const reviewRepo = this.connection.getRepository(ctx, ProductReview);
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - days);

    return reviewRepo
      .createQueryBuilder("review")
      .where("review.authorId = :customerId", { customerId })
      .andWhere("review.createdAt >= :cutoffDate", { cutoffDate })
      .getMany();
  }

  /**
   * Find reviews with similar content to detect duplicates
   */
  private async findSimilarReviews(
    ctx: RequestContext,
    body: string,
    productId: ID,
  ): Promise<ProductReview[]> {
    const reviewRepo = this.connection.getRepository(ctx, ProductReview);

    // Simple similarity check - look for exact matches or very similar content
    // In production, you might use more sophisticated text similarity algorithms
    const reviews = await reviewRepo
      .createQueryBuilder("review")
      .where("review.productId = :productId", { productId })
      .andWhere("review.state = :state", { state: "approved" })
      .getMany();

    return reviews.filter((r) => {
      // Check for exact match
      if (r.body === body) return true;

      // Check for high similarity (simple Levenshtein-like check)
      const similarity = this.calculateSimilarity(r.body, body);
      return similarity > 0.8;
    });
  }

  /**
   * Calculate simple string similarity (0-1)
   */
  private calculateSimilarity(str1: string, str2: string): number {
    if (str1 === str2) return 1;
    if (!str1 || !str2) return 0;

    const longer = str1.length > str2.length ? str1 : str2;
    const shorter = str1.length > str2.length ? str2 : str1;

    if (longer.length === 0) return 1;

    // Simple character-based similarity
    let matches = 0;
    for (let i = 0; i < shorter.length; i++) {
      if (longer.includes(shorter[i])) {
        matches++;
      }
    }

    return matches / longer.length;
  }

  /**
   * Get account age in days
   */
  private getAccountAgeDays(customer: Customer): number {
    const createdAt = customer.createdAt;
    const now = new Date();
    const diffTime = Math.abs(now.getTime() - createdAt.getTime());
    return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  }

  /**
   * Get review pattern for a customer
   */
  private async getReviewPattern(
    ctx: RequestContext,
    customerId: ID,
  ): Promise<{ totalReviews: number; averageRating: number }> {
    const reviewRepo = this.connection.getRepository(ctx, ProductReview);

    const reviews = await reviewRepo
      .createQueryBuilder("review")
      .where("review.authorId = :customerId", { customerId })
      .andWhere("review.state = :state", { state: "approved" })
      .getMany();

    const totalReviews = reviews.length;
    const averageRating =
      totalReviews > 0
        ? reviews.reduce((sum, r) => sum + r.rating, 0) / totalReviews
        : 0;

    return { totalReviews, averageRating };
  }

  /**
   * Get fraud statistics for admin dashboard
   */
  async getFraudStats(
    ctx: RequestContext,
    options?: {
      startDate?: Date;
      endDate?: Date;
    },
  ): Promise<{
    totalFlagged: number;
    highRiskCount: number;
    topIssues: Array<{ issue: string; count: number }>;
  }> {
    // This would typically query a separate fraud log table
    // For now, return placeholder data
    return {
      totalFlagged: 0,
      highRiskCount: 0,
      topIssues: [],
    };
  }
}
