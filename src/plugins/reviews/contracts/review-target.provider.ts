import { RequestContext, ID } from "@vendure/core";
import { ReviewTargetType } from "../constants";

export interface ReviewTargetProvider {
    readonly targetType: ReviewTargetType;

    validateTargetExists(ctx: RequestContext, targetId: ID): Promise<boolean>;

    getTargetDisplayName(ctx: RequestContext, targetId: ID): Promise<string>;

    updateAggregates(ctx: RequestContext, targetId: ID): Promise<void>;

    getChannels(ctx: RequestContext, targetId: ID): Promise<string[]>;
}