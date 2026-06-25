import { Args, Parent, ResolveField, Resolver } from "@nestjs/graphql";
import {
  Api,
  ListQueryBuilder,
  Product,
  TransactionalConnection,
  Logger,
} from "@vendure/core";
import type { ApiType } from "@vendure/core";

import { ProductReview } from "../entities/product-review.entity";
import type { ProductReviewsArgs } from "../generated-shop-types";

const logger = new Logger();

@Resolver("Product")
export class ProductEntityResolver {
  constructor(
    private listQueryBuilder: ListQueryBuilder,
    private connection: TransactionalConnection,
  ) {}

  @ResolveField()
  reviews(
    @Api() apiType: ApiType,
    @Parent() product: Product,
    @Args() args: ProductReviewsArgs,
  ) {
    if (!product || !product.id) {
      logger.error("Missing product or product.id in reviews resolver");
      return { items: [], totalItems: 0 };
    }
    if (args && args.options && typeof args.options !== "object") {
      logger.error("Malformed args.options in reviews resolver");
      return { items: [], totalItems: 0 };
    }
    logger.debug(
      `Resolving reviews for product.id=${product.id}, apiType=${apiType}`,
    );
    return this.listQueryBuilder
      .build(ProductReview, args.options as any || undefined, {
        where: {
          product: { id: product.id },
          ...(apiType === "shop" ? { state: "approved" } : {}),
        },
        relations: ["product", "product.featuredAsset"],
      })
      .getManyAndCount()
      .then(([items, totalItems]) => ({
        items,
        totalItems,
      }))
      .catch((err) => {
        logger.error(`Error in reviews query: ${err.message}`);
        return { items: [], totalItems: 0 };
      });
  }

  @ResolveField()
  reviewsHistogram(@Parent() product: Product) {
    if (!product || !product.id) {
      logger.error(
        "Missing product or product.id in reviewsHistogram resolver",
      );
      return [];
    }
    logger.debug(`Resolving reviewsHistogram for product.id=${product.id}`);
    return this.connection.rawConnection
      .createQueryBuilder()
      .select("ROUND(rating)", "bin")
      .addSelect("COUNT(*)", "frequency")
      .from(ProductReview, "review")
      .where("review.product = :productId", { productId: product.id })
      .andWhere("review.state = :state", { state: "approved" })
      .groupBy("ROUND(rating)")
      .getRawMany()
      .catch((err) => {
        logger.error(`Error in reviewsHistogram query: ${err.message}`);
        return [];
      });
  }
}
