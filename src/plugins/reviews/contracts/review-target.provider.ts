import { RequestContext, ID } from "@vendure/core";
import { ReviewTargetType } from "../constants";

export interface ReviewTargetProvider {
    readonly targetType: ReviewTargetType;

    validateTargetExists(ctx: RequestContext, targetId: ID): Promise<boolean>;

    getTargetDisplayName(ctx: RequestContext, targetId: ID): Promise<string>;

    getChannels(ctx: RequestContext, targetId: ID): Promise<string[]>;
}