import { Args, Mutation, Resolver } from '@nestjs/graphql';
import {
  Allow,
  Ctx,
  Permission,
  RequestContext,
  Transaction,
} from '@vendure/core';
import { MarketplaceCheckoutService, MarketplaceSessionCheckoutResult } from '../services/marketplace-checkout.service';

/**
 * Marketplace-hosted tenant checkout. Permission.Public is deliberate: the
 * request may begin on the marketplace/default Channel, while authenticated
 * customer identity and target-Channel membership are enforced in the service.
 * Guest checkout is rejected by the service.
 */
@Resolver()
export class MarketplaceCheckoutResolver {
  constructor(private readonly checkoutService: MarketplaceCheckoutService) {}

  @Mutation()
  @Allow(Permission.Public)
  @Transaction()
  async createMarketplaceSessionCheckout(
    @Ctx() ctx: RequestContext,
    @Args('sessionId') sessionId: string,
    @Args('marketplaceRef', { nullable: true }) marketplaceRef?: string | null,
  ): Promise<MarketplaceSessionCheckoutResult> {
    return this.checkoutService.createSessionCheckout(ctx, sessionId, marketplaceRef);
  }
}
