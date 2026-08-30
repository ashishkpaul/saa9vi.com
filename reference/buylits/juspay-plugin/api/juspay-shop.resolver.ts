import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';
import { Allow, Ctx, Permission, RequestContext } from '@vendure/core';
import { JuspayService } from '../service/juspay.service';

@Resolver()
export class JuspayShopResolver {
  constructor(private readonly juspayService: JuspayService) {}

  @Query()
  @Allow(Permission.Owner)
  async juspayOrderStatus(
    @Ctx() ctx: RequestContext,
    @Args('juspayOrderId') juspayOrderId: string
  ): Promise<string> {
    return this.juspayService.getOrderStatus(juspayOrderId);
  }

  @Mutation()
  @Allow(Permission.Owner)
  async initiateJuspaySession(
    @Ctx() ctx: RequestContext,
    @Args('orderId') orderId: string
  ): Promise<{ juspayOrderId: string; paymentLink: string | null; status: string }> {
    return this.juspayService.initiatePaymentSession(ctx, orderId);
  }

  @Mutation()
  @Allow(Permission.Owner)
  async cancelJuspaySession(
    @Ctx() ctx: RequestContext,
    @Args('orderId') orderId: string
  ): Promise<boolean> {
    return this.juspayService.cancelPaymentSession(ctx, orderId);
  }
}