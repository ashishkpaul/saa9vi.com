import { Query, Resolver } from "@nestjs/graphql";
import { Allow, Ctx, Permission, RequestContext } from "@vendure/core";

import { SubscriptionShopService } from "../services/subscription-shop.service";

/**
 * Shop API (tenant-facing) commercial reads — plan §3.5, slice 8.
 *
 * READ-ONLY: no `@Mutation()` exists in this resolver, deliberately (UI-1 —
 * self-serve upgrade/cancel stays deferred pending its own ADR).
 *
 * PERMISSION MODEL (locked):
 *   - `availableSubscriptionPlans` is Public: the plan catalogue is
 *     platform-global and carries no tenant state.
 *   - `mySubscription` / `myLiveUsage` require `Permission.Authenticated` AND
 *     an explicit tenant business-account ownership check performed in the
 *     service. The decorator is only a gate: Vendure grants `Authenticated` to
 *     every role it creates and `TenantRegistrationService` assigns the
 *     Customer role to every tenant channel, so a logged-in learner passes the
 *     gate on the academy's own hostname. Ownership — not authentication — is
 *     what protects the tenant's commercial state.
 *
 * The tenant is always `ctx.channelId` (hostname-resolved by the storefront).
 * No query takes a `channelId` argument.
 */
@Resolver()
export class SubscriptionShopResolver {
  constructor(private readonly subscriptionShopService: SubscriptionShopService) {}

  @Query()
  @Allow(Permission.Public)
  async availableSubscriptionPlans() {
    return this.subscriptionShopService.findAvailablePlans();
  }

  @Query()
  @Allow(Permission.Authenticated)
  async mySubscription(@Ctx() ctx: RequestContext) {
    return this.subscriptionShopService.findMySubscription(ctx);
  }

  @Query()
  @Allow(Permission.Authenticated)
  async myLiveUsage(@Ctx() ctx: RequestContext) {
    return this.subscriptionShopService.findMyLiveUsage(ctx);
  }
}
