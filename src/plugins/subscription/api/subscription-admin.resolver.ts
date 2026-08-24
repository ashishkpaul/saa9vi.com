import { Args, Mutation, Query, Resolver } from "@nestjs/graphql";
import { Allow, Ctx, ID, Permission, RequestContext, Transaction } from "@vendure/core";

import { OrganizationSubscription } from "../entities/organization-subscription.entity";
import { SubscriptionPlan } from "../entities/subscription-plan.entity";
import { SubscriptionService } from "../services/subscription.service";

@Resolver()
export class SubscriptionAdminResolver {
  constructor(private readonly subscriptionService: SubscriptionService) {}

  @Query()
  @Allow(Permission.SuperAdmin)
  async subscriptionPlans(@Ctx() ctx: RequestContext): Promise<SubscriptionPlan[]> {
    return this.subscriptionService.findAllPlans(ctx);
  }

  @Query()
  @Allow(Permission.SuperAdmin)
  async organizationSubscriptions(
    @Ctx() ctx: RequestContext,
  ): Promise<OrganizationSubscription[]> {
    return this.subscriptionService.findAllSubscriptions(ctx);
  }

  @Transaction()
  @Mutation()
  @Allow(Permission.SuperAdmin)
  async createSubscriptionPlan(
    @Ctx() ctx: RequestContext,
    @Args("input") input: Partial<SubscriptionPlan>,
  ): Promise<SubscriptionPlan> {
    return this.subscriptionService.createPlan(ctx, input);
  }

  @Transaction()
  @Mutation()
  @Allow(Permission.SuperAdmin)
  async updateSubscriptionPlan(
    @Ctx() ctx: RequestContext,
    @Args("id") id: ID,
    @Args("input") input: Partial<SubscriptionPlan>,
  ): Promise<SubscriptionPlan> {
    return this.subscriptionService.updatePlan(ctx, id, input);
  }
}
