import { Injectable, Logger } from '@nestjs/common';
import { TransactionalConnection } from '@vendure/core';
import { ProductReview } from '../../reviews/entities/product-review.entity';

const loggerCtx = 'BayesianRatingService';

/**
 * Computes a Bayesian average rating for marketplace sessions.
 *
 * Formula: (C * m + sum(ratings)) / (C + n)
 * Where:
 *   C = confidence (prior weight) — default 10
 *   m = global mean rating across all products — computed from ProductReview
 *   n = number of ratings for this product
 *   sum(ratings) = sum of all ratings for this product
 *
 * This prevents products with few reviews from ranking above
 * products with many reviews and a slightly lower average.
 */
@Injectable()
export class BayesianRatingService {
  private readonly logger = new Logger(loggerCtx);
  private readonly confidence = 10;

  constructor(
    private readonly connection: TransactionalConnection,
  ) {}

  /**
   * Compute Bayesian rating for a specific product.
   */
  async computeForProduct(productId: string): Promise<number> {
    const reviewRepo = this.connection.rawConnection.getRepository(ProductReview);

    // Get global mean rating across all approved reviews
    const globalResult = await reviewRepo
      .createQueryBuilder('review')
      .select('AVG(review.rating)', 'mean')
      .where('review.state = :state', { state: 'approved' })
      .getRawOne();
    const globalMean = parseFloat(globalResult?.mean ?? '0') || 0;

    if (globalMean === 0) return 0;

    // Get this product's review stats
    const productResult = await reviewRepo
      .createQueryBuilder('review')
      .select('COUNT(*)', 'count')
      .addSelect('AVG(review.rating)', 'average')
      .where('review.productId = :productId', { productId })
      .andWhere('review.state = :state', { state: 'approved' })
      .getRawOne();

    const n = parseInt(productResult?.count ?? '0', 10) || 0;
    const avg = parseFloat(productResult?.average ?? '0') || 0;

    if (n === 0) return 0;

    // Bayesian average
    const bayesian = (this.confidence * globalMean + n * avg) / (this.confidence + n);
    return Math.round(bayesian * 100) / 100;
  }

  /**
   * Compute Bayesian rating for a product by its variant ID.
   * Looks up the product from the variant.
   */
  async computeForVariant(variantId: string): Promise<number> {
    const { ProductVariant } = require('@vendure/core');
    const variant = await this.connection.rawConnection
      .getRepository(ProductVariant)
      .findOne({
        where: { id: variantId as any },
        relations: ['product'],
      });

    if (!variant || !(variant as any).product) return 0;
    return this.computeForProduct(String((variant as any).product.id));
  }
}