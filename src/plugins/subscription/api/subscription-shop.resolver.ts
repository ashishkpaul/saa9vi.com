import { Args, Mutation, Query, Resolver } from "@nestjs/graphql";
import { Allow, Ctx, ID, Logger, Permission, RequestContext } from "@vendure/core";

import { SubscriptionShopService } from "../services/subscription-shop.service";
import { SubscriptionService } from "../services/subscription.service";
import { TenantSelfServeSubscriptionCooldownService } from "../services/tenant-self-serve-subscription-cooldown.service";
import { TenantBusinessAccountService } from "../../../platform/commercial/tenant-business-account.service";

/**
 * Shop API (tenant-facing) commercial reads — plan §3.5, slice 8.
 *
 * Tenant-facing commercial reads plus ADR-046 self-serve billing mutations.
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
 * No Shop operation takes a `channelId` argument; mutations resolve the tenant from `ctx.channelId`.
 */
@Resolver()
export class SubscriptionShopResolver {
  constructor(
    private readonly subscriptionShopService: SubscriptionShopService,
    private readonly subscriptionService: SubscriptionService,
    private readonly cooldown: TenantSelfServeSubscriptionCooldownService,
    private readonly businessAccount: TenantBusinessAccountService,
  ) {}

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

  /**
   * ADR-046: tenant-scoped self-serve plan change.
   *
   * The resolver is intentionally thin: authorization/provenance, channel
   * resolution, cooldown, delegation, and Shop-contract shaping only.
   */
  @Mutation()
  @Allow(Permission.Authenticated)
  async requestMySubscriptionPlanChange(
    @Ctx() ctx: RequestContext,
    @Args("planId") planId: ID,
  ) {
    const actor = await this.businessAccount.assertTenantSelfServeBusinessAccount(ctx);
    const channelId = ctx.channelId ? String(ctx.channelId) : "";
    if (!channelId) throw new Error("Tenant channel is required");

    await this.cooldown.acquire(channelId);

    const operation =
      await this.subscriptionService.changeOrganizationSubscriptionPlanForSelfServe(
        ctx,
        channelId,
        planId,
      );

    Logger.info(
      JSON.stringify({
        event: "subscription.plan-change",
        actor,
        channelId,
        toPlanId: String(planId),
        authorizationRequired: Boolean(operation.providerAuthorizationUrl),
      }),
      "SubscriptionShopResolver",
    );

    const subscription = await this.subscriptionShopService.findMySubscription(ctx);
    if (!subscription) {
      throw new Error("Subscription disappeared after plan change");
    }

    return {
      subscription,
      authorizationUrl: operation.providerAuthorizationUrl,
    };
  }

  /**
   * ADR-046: tenant-scoped self-serve cancellation.
   */
  @Mutation()
  @Allow(Permission.Authenticated)
  async cancelMySubscription(
    @Ctx() ctx: RequestContext,
    @Args("atPeriodEnd", { nullable: true, defaultValue: true }) atPeriodEnd?: boolean,
  ) {
    const actor = await this.businessAccount.assertTenantSelfServeBusinessAccount(ctx);
    const channelId = ctx.channelId ? String(ctx.channelId) : "";
    if (!channelId) throw new Error("Tenant channel is required");

    await this.subscriptionService.cancelOrganizationSubscription(
      ctx,
      channelId,
      atPeriodEnd ?? true,
    );

    Logger.info(
      JSON.stringify({
        event: "subscription.cancel",
        actor,
        channelId,
        atPeriodEnd: atPeriodEnd ?? true,
      }),
      "SubscriptionShopResolver",
    );

    const subscription = await this.subscriptionShopService.findMySubscription(ctx);
    if (!subscription) {
      throw new Error("Subscription disappeared after cancellation");
    }

    return {
      subscription,
      authorizationUrl: null,
    };
  }
}
