import { Injectable } from "@nestjs/common";
import {
    RequestContext,
    ID,
    Customer,
    TransactionalConnection,
    OrderService,
    Order,
    OrderLine,
} from "@vendure/core";
import { Repository } from "typeorm";
import { ReviewTargetProvider, ReviewEligibilityStrategy, EligibilityResult } from "../../types";
import { ReviewVerificationType } from "../../constants";
import { ProductReview } from "../../entities/product-review.entity";

const ELIGIBLE_ORDER_STATES = ["Delivered", "Shipped"];

/**
 * Eligibility strategy for Product reviews.
 * Determines if a customer can review a product based on purchase history.
 */
@Injectable()
export class ProductReviewEligibilityStrategy implements ReviewEligibilityStrategy {
    constructor(
        private connection: TransactionalConnection,
        private orderService: OrderService,
    ) {}

    async canReview(
        ctx: RequestContext,
        customerId: ID,
        targetId: ID,
        provider: ReviewTargetProvider,
    ): Promise<EligibilityResult> {
        // Only products are supported by this strategy
        if (provider.targetType !== "PRODUCT") {
            return {
                eligible: false,
                reason: "This strategy only supports PRODUCT targets",
            };
        }

        const productId = targetId;

        // Check for existing review (any state)
        const reviewRepo = this.connection.getRepository(ctx, ProductReview as any);
        const existingReview = await reviewRepo.findOne({
            where: {
                product: { id: productId } as any,
                author: { id: customerId } as any,
            } as any,
        });

        if (existingReview) {
            return {
                eligible: false,
                reason: "You have already reviewed this product",
                hasPurchased: (existingReview as any).verifiedPurchase,
                hasExistingReview: true,
            };
        }

        // Find eligible order with this product
        const orderLineRepo = this.connection.getRepository(ctx, OrderLine);

        const orderLines = await orderLineRepo
            .createQueryBuilder("line")
            .innerJoinAndSelect("line.order", "order")
            .innerJoinAndSelect("line.productVariant", "variant")
            .where("order.customerId = :customerId", { customerId })
            .andWhere("variant.productId = :productId", { productId })
            .andWhere("order.state IN (:...states)", {
                states: ELIGIBLE_ORDER_STATES,
            })
            .orderBy("order.updatedAt", "DESC")
            .getMany();

        if (orderLines.length === 0) {
            return {
                eligible: false,
                reason: "You can only review products you have purchased",
                hasPurchased: false,
                hasExistingReview: false,
            };
        }

        const eligibleOrderLine = orderLines[0];
        const eligibleOrder = eligibleOrderLine.order;

        return {
            eligible: true,
            reason: "You can review this product",
            hasPurchased: true,
            hasExistingReview: false,
            eligibleOrderId: eligibleOrder.id,
            eligibleOrderLineId: eligibleOrderLine.id,
            verificationType: ReviewVerificationType.ORDER,
            verificationContext: {
                source: ReviewVerificationType.ORDER,
                orderId: eligibleOrder.id,
                orderLineId: eligibleOrderLine.id,
            },
        };
    }
}