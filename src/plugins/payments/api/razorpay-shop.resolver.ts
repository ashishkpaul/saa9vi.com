import { Args, Mutation, Resolver } from '@nestjs/graphql';
import {
  Allow,
  Ctx,
  ID,
  Order,
  OrderService,
  Permission,
  RequestContext,
  TransactionalConnection,
  UserInputError,
} from '@vendure/core';
import { CheckoutOrderHandle, RazorpayCheckoutService } from '../services/razorpay-checkout.service';

@Resolver()
export class RazorpayShopResolver {
  constructor(
    private readonly checkoutService: RazorpayCheckoutService,
    private readonly orderService: OrderService,
    private readonly connection: TransactionalConnection,
  ) {}

  @Mutation()
  @Allow(Permission.Owner)
  async createRazorpayCheckoutOrder(
    @Ctx() ctx: RequestContext,
    @Args('orderId', { nullable: true }) orderId?: ID,
  ): Promise<CheckoutOrderHandle> {
    let order: Order | undefined | null;

    if (orderId) {
      order = await this.connection.getRepository(ctx, Order).findOne({
        where: { id: orderId },
        relations: { channels: true, customer: { user: true } },
      });
      if (!order) {
        throw new UserInputError('Order not found');
      }
      // Ensure caller is the owner of this order
      if (
        ctx.activeUserId &&
        order.customer?.user?.id &&
        String(order.customer.user.id) !== String(ctx.activeUserId)
      ) {
        throw new UserInputError('Not authorized for this order');
      }
    } else {
      if (!ctx.activeUserId) {
        throw new UserInputError('No active user or orderId provided');
      }
      order = await this.orderService.getActiveOrderForUser(ctx, ctx.activeUserId);
      if (!order) {
        throw new UserInputError('No active order found');
      }
    }

    if (order.totalWithTax <= 0) {
      throw new UserInputError('Order total must be greater than zero');
    }

    return this.checkoutService.createCheckoutOrder(ctx, order);
  }
}
