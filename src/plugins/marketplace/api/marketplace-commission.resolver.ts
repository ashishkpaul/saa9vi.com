import { Args, Mutation, Resolver } from '@nestjs/graphql';
import { Allow, Ctx, Order, OrderService, Permission, RequestContext, TransactionalConnection } from '@vendure/core';
import { MarketplaceAttributionService } from '../services/marketplace-attribution.service';

export type MarketplaceReferenceApplyResult =
  | { ok: true; orderId: string }
  | { ok: false; code: 'FORBIDDEN' | 'INVALID_OR_STALE_REF' | 'NO_ACTIVE_ORDER' | 'NO_CHANNEL' };

@Resolver()
export class MarketplaceCommissionResolver {
  constructor(
    private readonly attributionService: MarketplaceAttributionService,
    private readonly orderService: OrderService,
    private readonly connection: TransactionalConnection,
  ) {}

  @Mutation()
  @Allow(Permission.Owner)
  async applyMarketplaceReference(
    @Ctx() ctx: RequestContext,
    @Args('ref') ref: string,
  ): Promise<MarketplaceReferenceApplyResult> {
if (!ctx.activeUserId) {
      return { ok: false, code: 'FORBIDDEN' };
    }
    const channelToken = ctx.channel?.token;
    if (!channelToken) {
      return { ok: false, code: 'NO_CHANNEL' };
    }
    const verified = this.attributionService.resolveRef(ref, channelToken);
    if (!verified) {
      return { ok: false, code: 'INVALID_OR_STALE_REF' };
    }
    const order = await this.orderService.getActiveOrderForUser(ctx, ctx.activeUserId);
    if (!order) {
      return { ok: false, code: 'NO_ACTIVE_ORDER' };
    }
    order.customFields = order.customFields ?? {};
    order.customFields.marketplaceRef = ref;
    await this.connection.getRepository(ctx, Order).save(order);
    return { ok: true, orderId: String(order.id) };
  }
}