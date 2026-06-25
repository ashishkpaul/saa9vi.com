import { Injectable } from "@nestjs/common";
import {
    RequestContext,
    Customer,
    TransactionalConnection,
    EventBus,
    ProductService,
    Asset,
} from "@vendure/core";
import { Repository } from "typeorm";
import { ReviewTargetRegistry } from "./review-target.registry";
import { ReviewTargetProvider, ReviewEligibilityStrategy, ReviewVerificationContext } from "../types";
import { ReviewVerificationType } from "../constants";
import { ProductReview } from "../entities/product-review.entity";
import { ReviewCreatedEvent } from "../events/review.events";
import { ID } from "@vendure/core";

export interface CreateReviewInput {
    targetType: string; // ReviewTargetType as string for GraphQL compatibility
    targetId: ID;
    rating: number;
    summary: string;
    body: string;
    authorName?: string;
    authorLocation?: string;
    assetIds?: ID[];
    verificationContext?: ReviewVerificationContext;
}

export interface FindReviewsByTargetInput {
    targetType: string;
    targetId: ID;
    take?: number;
    skip?: number;
    showOnlyApproved?: boolean;
}

@Injectable()
export class ReviewService {
    constructor(
        private connection: TransactionalConnection,
        private productService: ProductService,
        private eventBus: EventBus,
        private targetRegistry: ReviewTargetRegistry,
        private eligibilityStrategies: ReviewEligibilityStrategy[],
    ) {}

    private getReviewRepo(ctx: RequestContext): Repository<ProductReview> {
        return this.connection.getRepository(ctx, ProductReview);
    }

    /**
     * Core review creation method.
     * Orchestrates provider lookup, eligibility check, and persistence.
     */
    async createReview(
        ctx: RequestContext,
        input: CreateReviewInput,
        customerId: ID,
    ): Promise<ProductReview | { error: string; code?: string }> {
        // 1. Validate rating
        if (input.rating < 1 || input.rating > 5) {
            return { error: "Rating must be between 1 and 5", code: "INVALID_RATING" };
        }

        // 2. Validate input lengths
        let summary = input.summary;
        if (summary.length < 1 || summary.length > 100) {
            summary = summary.substring(0, 100);
        }
        let body = input.body;
        if (body.length < 10) {
            return { error: "Review body must be at least 10 characters", code: "INVALID_BODY" };
        }
        if (body.length > 5000) {
            body = body.substring(0, 5000);
        }

        // 3. Resolve target provider
        const provider = await this.targetRegistry.findProviderForTarget(
            ctx,
            input.targetType as any,
            input.targetId,
        );

        if (!provider) {
            return { error: "Invalid review target", code: "INVALID_TARGET" };
        }

        // 4. Check eligibility using strategy
        const strategy = this.eligibilityStrategies.find(s => {
            // In Phase 1A, we only have ProductEligibilityStrategy
            // Future: match strategy to target type
            return true;
        });

        if (!strategy) {
            return { error: "No eligibility strategy configured for this target type", code: "NO_STRATEGY" };
        }

        const eligibility = await strategy.canReview(ctx, customerId, input.targetId, provider);

        if (!eligibility.eligible) {
            return { error: eligibility.reason, code: "NOT_ELIGIBLE" };
        }

        // 5. Get customer details
        const customerRepo = this.connection.getRepository(ctx, Customer);
        const customer = await customerRepo.findOne({
            where: { user: { id: ctx.activeUserId } } as any,
            relations: ["user"],
        });

        if (!customer) {
            return { error: "Customer not found", code: "CUSTOMER_NOT_FOUND" };
        }

        const authorName = input.authorName
            ? input.authorName
            : `${customer.firstName} ${customer.lastName}`.trim() || "Anonymous";

        // 6. Load assets if provided
        let assets: any[] = [];
        if (input.assetIds && input.assetIds.length > 0) {
            const assetRepo = this.connection.getRepository(ctx, Asset);
            const assetRecords = await assetRepo.findByIds(input.assetIds);
            assets = assetRecords as any[];
        }

        // 7. Determine verification
        const verificationType = eligibility.verificationType || ReviewVerificationType.NONE;
        const verifiedPurchase = verificationType === ReviewVerificationType.ORDER;

        // 8. Create the review
        const reviewData: any = {
            summary,
            body,
            rating: input.rating,
            author: { id: customer.id } as any,
            authorName,
            authorLocation: input.authorLocation || null,
            state: "new",
            verifiedPurchase,
            upvotes: 0,
            downvotes: 0,
            assets,
        };

        // If target is PRODUCT, populate product relation (for backward compatibility)
        if (input.targetType === "PRODUCT") {
            reviewData.product = { id: input.targetId } as any;
        }

        // Phase 1B+ will populate targetType, targetId, verificationType, verificationContext
        // For now, these columns don't exist yet

        const review = this.getReviewRepo(ctx).create(reviewData);
        const savedReview = await this.getReviewRepo(ctx).save(review);

        // 9. Update aggregates
        await provider.updateAggregates(ctx, input.targetId);

        // 10. Publish event
        this.eventBus.publish(
            new ReviewCreatedEvent(
                (savedReview as any).id,
                input.targetId,
                customerId,
                ctx.channel.token,
            ),
        );

        return savedReview as unknown as ProductReview;
    }

    /**
     * Find reviews for a given target.
     */
    async findByTarget(
        ctx: RequestContext,
        input: FindReviewsByTargetInput,
    ): Promise<{ items: ProductReview[]; totalItems: number }> {
        const repo = this.getReviewRepo(ctx);
        const take = input.take ?? 10;
        const skip = input.skip ?? 0;
        const showOnlyApproved = input.showOnlyApproved ?? true;

        const where: Record<string, any> = {};

        // For PRODUCT targets, filter by product relation (existing behavior)
        if (input.targetType === "PRODUCT") {
            where.product = { id: input.targetId } as any;
        }
        // Future: add generic targetType/targetId filters in Phase 1B

        if (showOnlyApproved) {
            where.state = "approved";
        }

        const result = await repo.findAndCount({
            where,
            relations: ["product", "author"],
            take,
            skip,
            order: { createdAt: "DESC" },
        });

        const items = result[0] as ProductReview[];
        const totalItems = result[1];
        return { items, totalItems };
    }

    /**
     * Check if a customer can review a target.
     */
    async canReview(
        ctx: RequestContext,
        customerId: ID,
        targetType: string,
        targetId: ID,
    ): Promise<{ eligible: boolean; reason: string }> {
        const provider = await this.targetRegistry.findProviderForTarget(
            ctx,
            targetType as any,
            targetId,
        );

        if (!provider) {
            return { eligible: false, reason: "Invalid review target" };
        }

        const strategy = this.eligibilityStrategies.find(s => true);
        if (!strategy) {
            return { eligible: false, reason: "No eligibility strategy configured" };
        }

        const eligibility = await strategy.canReview(ctx, customerId, targetId, provider);
        return { eligible: eligibility.eligible, reason: eligibility.reason };
    }
}