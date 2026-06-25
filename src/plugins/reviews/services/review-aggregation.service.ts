import { Injectable } from "@nestjs/common";
import { ID, Product, RequestContext, TransactionalConnection } from "@vendure/core";

import { ProductReview } from "../entities/product-review.entity";

@Injectable()
export class ReviewAggregationService {
  constructor(private connection: TransactionalConnection) {}

  async recalculateForProduct(ctx: RequestContext, productId: ID): Promise<void> {
    const reviewRepo = this.connection.getRepository(ctx, ProductReview);

    const result = await reviewRepo
      .createQueryBuilder("review")
      .select("COUNT(*)", "count")
      .addSelect("AVG(review.rating)", "average")
      .where("review.productId = :productId", { productId })
      .andWhere("review.state = :state", { state: "approved" })
      .getRawOne();

    const count = parseInt(result?.count ?? "0", 10) || 0;
    const average = parseFloat(result?.average ?? "0") || 0;

    await this.connection.getRepository(ctx, Product).update(productId, {
      customFields: {
        reviewRating: count > 0 ? Math.round(average * 10) / 10 : 0,
        reviewCount: count,
      },
    });
  }

  async recalculateForProducts(ctx: RequestContext, productIds: ID[]): Promise<void> {
    for (const productId of [...new Set(productIds)]) {
      await this.recalculateForProduct(ctx, productId);
    }
  }
}
