import { Injectable } from "@nestjs/common";
import { ID, RequestContext } from "@vendure/core";
import { ReviewTargetProvider } from "../contracts/review-target.provider";
import { ReviewTargetType } from "../constants";

/**
 * Registry for review target providers.
 * Allows plugins to register themselves as reviewable entities
 * without modifying the core Reviews plugin.
 */
@Injectable()
export class ReviewTargetRegistry {
    private providers = new Map<ReviewTargetType, ReviewTargetProvider>();

    register(provider: ReviewTargetProvider): void {
        this.providers.set(provider.targetType, provider);
    }

    getProvider(targetType: ReviewTargetType): ReviewTargetProvider | undefined {
        return this.providers.get(targetType);
    }

    getAllProviders(): ReviewTargetProvider[] {
        return Array.from(this.providers.values());
    }

    /**
     * Returns the provider for a given targetId if the target exists.
     * Returns undefined if no provider claims this target.
     */
    async findProviderForTarget(
        ctx: RequestContext,
        targetType: ReviewTargetType,
        targetId: ID,
    ): Promise<ReviewTargetProvider | undefined> {
        const provider = this.providers.get(targetType);
        if (!provider) {
            return undefined;
        }
        const exists = await provider.validateTargetExists(ctx, targetId);
        return exists ? provider : undefined;
    }
}