import { RequestContext, VendureEvent } from "@vendure/core";
import { OrganizationSubscription } from "../entities/organization-subscription.entity";

export class SubscriptionRenewedEvent extends VendureEvent {
  constructor(
    public readonly ctx: RequestContext,
    public readonly subscription: OrganizationSubscription,
    public readonly channelId: string,
    public readonly billingPeriodStart: Date,
    public readonly billingPeriodEnd: Date,
    public readonly grantedMinutes: number = 600,
  ) {
    super();
  }
}

export class SubscriptionInvoicePaidEvent extends VendureEvent {
  constructor(
    public readonly ctx: RequestContext,
    public readonly subscription: OrganizationSubscription,
    public readonly invoiceId: string,
    public readonly amountPaise: number,
  ) {
    super();
  }
}
