import { Injectable, Logger } from '@nestjs/common';
import { ConfigService, TransactionalConnection } from '@vendure/core';
import { ProductReview } from '../../reviews/entities/product-review.entity';
import { BayesianBaseline } from './marketplace-baseline.service';

const loggerCtx = 'BayesianRatingService';

/**
 * Computes a Bayesian average rating for marketplace sessions.
 *
 * Formula: (C * m + sum(ratings)) / (C + n)
 * Where:
 *   C = confidence (prior weight) — default 10
 *   m = global mean rating — from the authoritative frozen baseline (3D.1a/3D.1b)
 *   n = number of ratings for this product
 *   sum(ratings) = sum of all ratings for this product
 *
 * 3D.1b contract: the global prior G comes from the Settings Store baseline,
 * NOT from a live query on ProductReview. The baseline snapshot is passed in
 * by the caller to guarantee a single {G, V} snapshot per indexing operation.
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
    private readonly configService: ConfigService,
  ) {}

  /**
   * Compute Bayesian rating for a specific product.
   * The baseline snapshot is passed in — NOT fetched live.
   */
  async computeForProduct(productId: string, baseline: BayesianBaseline): Promise<number> {
    const reviewRepo = this.connection.rawConnection.getRepository(ProductReview);

    // Use the authoritative frozen baseline — NOT a live global mean query
    const globalMean = baseline.globalMean;

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

    // Bayesian average using the frozen baseline
    const bayesian = (this.confidence * globalMean + n * avg) / (this.confidence + n);
    return Math.round(bayesian * 100) / 100;
  }

  /**
   * Compute Bayesian rating for a product by its variant ID.
   * Looks up the product from the variant. The baseline snapshot is passed in.
   */
  async computeForVariant(variantId: string, baseline: BayesianBaseline): Promise<number> {
    const { ProductVariant } = require('@vendure/core');
    // variantId may be GraphQL-encoded (e.g. "T_5"); decode to the raw PK.
    const decoded = this.configService.entityIdStrategy.decodeId(String(variantId));
    const variant = await this.connection.rawConnection
      .getRepository(ProductVariant)
      .findOne({
        where: { id: (decoded === -1 ? variantId : decoded) as any },
        relations: ['product'],
      });

    if (!variant || !(variant as any).product) return 0;
    return this.computeForProduct(String((variant as any).product.id), baseline);
  }
}