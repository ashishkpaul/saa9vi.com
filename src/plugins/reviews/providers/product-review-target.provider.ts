import { Injectable } from "@nestjs/common";
import { RequestContext, ProductService, ID } from "@vendure/core";
import { ReviewTargetProvider } from "../contracts/review-target.provider";
import { ReviewTargetType } from "../constants";

/**
 * Adapts Vendure Product entity as a review target.
 * Encapsulates all Product-specific knowledge.
 */
@Injectable()
export class ProductReviewTargetProvider implements ReviewTargetProvider {
    readonly targetType = ReviewTargetType.PRODUCT;

    constructor(
        private productService: ProductService,
    ) {}

    async validateTargetExists(ctx: RequestContext, targetId: ID): Promise<boolean> {
        try {
            const product = await this.productService.findOne(ctx, targetId);
            return !!product;
        } catch {
            return false;
        }
    }

    async getTargetDisplayName(ctx: RequestContext, targetId: ID): Promise<string> {
        const product = await this.productService.findOne(ctx, targetId);
        if (!product) {
            return `Unknown Product (${targetId})`;
        }
        return (product as any).productName || (product as any).name || `Product ${targetId}`;
    }

    async getChannels(ctx: RequestContext, targetId: ID): Promise<string[]> {
        const product = await this.productService.findOne(ctx, targetId);
        if (!product) {
            return [];
        }
        const channelId = (product as any).channelId;
        return channelId ? [channelId] : [];
    }
}