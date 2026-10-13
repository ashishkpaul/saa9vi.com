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

    // Commit 2 correction: login is REQUIRED. Guest checkout is rejected —
    // ownership is proven by activeUserId only (session-order matching would
    // let any anonymous caller with an orderId attempt checkout).
    if (!ctx.activeUserId) {
      throw new UserInputError('Login required to start Razorpay checkout');
    }

    if (orderId) {
      // Commit 2: scope the lookup to the active channel — a caller must not
      // be able to mint a Razorpay order against another tenant's order.
      order = await this.connection.getRepository(ctx, Order).findOne({
        where: { id: orderId },
        relations: { channels: true, customer: { user: true } },
      });
      if (!order) {
        throw new UserInputError('Order not found');
      }
      const inChannel = (order.channels ?? []).some(
        (c) => String(c.id) === String(ctx.channelId),
      );
      if (!inChannel) {
        throw new UserInputError('Order not found');
      }
      // Ownership: the order's customer user must be the caller.
      if (
        order.customer?.user?.id &&
        String(order.customer.user.id) !== String(ctx.activeUserId)
      ) {
        throw new UserInputError('Not authorized for this order');
      }
    } else {
      order = await this.orderService.getActiveOrderForUser(ctx, ctx.activeUserId);
      if (!order) {
        throw new UserInputError('No active order found');
      }
    }

    if (order.totalWithTax <= 0) {
      throw new UserInputError('Order total must be greater than zero');
    }

    // Commit 2: only ArrangingPayment orders may enter checkout. Anything
    // else (AddingItems, Settled, Cancelled…) is a stale or replayed call.
    if (order.state !== 'ArrangingPayment') {
      throw new UserInputError(`Order must be in ArrangingPayment state (got ${order.state})`);
    }

    return this.checkoutService.createCheckoutOrder(ctx, order);
  }
}
