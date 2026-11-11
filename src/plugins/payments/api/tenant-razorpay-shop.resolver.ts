import { Args, Mutation, Resolver } from '@nestjs/graphql';
import {
  Allow,
  Ctx,
  ID,
  Permission,
  RequestContext,
  UserInputError,
} from '@vendure/core';
import { TenantRazorpayService } from '../services/tenant-razorpay.service';
import { TenantCheckoutOrderHandle } from '../services/tenant-razorpay.service';

/**
 * Tenant Razorpay Shop resolver (Phase 2, ADR-051 Option C).
 *
 * Tenant-client collections (Flow B) use the tenant's own Razorpay account.
 * The resolver is channel-scoped: credentials resolve from ctx.channelId,
 * and the order must belong to the active channel.
 *
 * This is separate from RazorpayShopResolver (Flow A: platform Razorpay
 * for tenant-admin payments to Saa9vi).
 */
@Resolver()
export class TenantRazorpayShopResolver {
  constructor(
    private readonly checkoutService: TenantRazorpayService,
  ) {}

  @Mutation()
  @Allow(Permission.Owner)
  async createTenantRazorpayCheckoutOrder(
    @Ctx() ctx: RequestContext,
    @Args('orderId', { nullable: true }) orderId?: ID,
  ): Promise<TenantCheckoutOrderHandle> {
    // Login is required — guest checkout rejected.
    if (!ctx.activeUserId) {
      throw new UserInputError('Login required to start Razorpay checkout');
    }

    // Delegate to tenant-aware service — it validates channel membership,
    // order state, and resolves tenant credentials.
    return this.checkoutService.createCheckoutOrder(ctx, orderId ? String(orderId) : undefined);
  }
}