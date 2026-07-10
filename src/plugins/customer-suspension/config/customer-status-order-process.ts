import {
  Logger,
  OrderProcess,
  RequestContext,
  TransactionalConnection,
} from "@vendure/core";
import { CustomerChannelStatus } from "../entities/customer-channel-status.entity";

const loggerCtx = "CustomerStatusOrderProcess";

let connection: TransactionalConnection;

/**
 * Order process that blocks checkout for suspended customers.
 *
 * Checks both status levels at transition to ArrangingPayment:
 *   1. Platform-wide status (Customer.customFields.status)
 *   2. Channel-scoped status (CustomerChannelStatus entity)
 *
 * INV-014: Suspension blocks NEW checkouts only — existing entitlements
 * continue until natural expiry via validUntil.
 */
export const customerStatusOrderProcess: OrderProcess<string> = {
  init(injector: any) {
    connection = injector.get(TransactionalConnection);
  },

  async onTransitionStart(
    fromState: string,
    toState: string,
    data: { ctx: RequestContext; order: { customer?: any } },
  ): Promise<string | void> {
    if (toState !== "ArrangingPayment") return;

    const customer = data.order.customer;
    if (!customer) return;

    // Check platform-wide status
    if ((customer as any).customFields?.status === "Suspended") {
      Logger.info(
        `Blocking checkout for customer ${customer.id}: platform-suspended`,
        loggerCtx,
      );
      return "Your account is suspended. You cannot place orders.";
    }

    // Check channel-scoped status
    const channelId = data.ctx.channelId as string;
    if (channelId) {
      const channelStatus = await connection
        .getRepository(data.ctx, CustomerChannelStatus)
        .findOne({
          where: { customerId: String(customer.id), channelId },
        });

      if (channelStatus?.status === "Suspended") {
        Logger.info(
          `Blocking checkout for customer ${customer.id}: suspended in channel ${channelId}`,
          loggerCtx,
        );
        return "Your account has been suspended for this academy. You cannot place orders here.";
      }
    }
  },
};
