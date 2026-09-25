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

/**
 * The channel's plan identity was established or changed: provider-free
 * activation (Free Basic at registration), a plan change (ADR-044), or an
 * explicit first subscribe.
 *
 * Why this event exists (ADR-031 amendment, Decision 5). Plan-derived tenant
 * *capacity* — `BbbOrganization.concurrentMeetingLimit` ← the plan's
 * `BbbPlatformCapacityPolicy.maxConcurrentMeetings` — cannot be synchronised
 * reliably from `TenantRegisteredEvent` alone: the BBB plugin's listener and
 * the subscription plugin's listener both subscribe to it with no guaranteed
 * relative order, and the BBB plugin is registered first, so the organization
 * is often created before the Free Basic subscription row exists and Tier 2
 * cannot match. Publishing from the subscription side once the row is
 * committed lets the BBB plugin converge afterwards, making correctness
 * independent of subscriber order.
 *
 * Consumers MUST treat every `cause` identically and be idempotent: a missed
 * event is healed by the same re-sync path (and by the consumer's startup
 * reconciliation pass), so `cause` is advisory logging metadata only.
 */
export class SubscriptionPlanChangedEvent extends VendureEvent {
  constructor(
    public readonly ctx: RequestContext,
    public readonly subscription: OrganizationSubscription,
    public readonly channelId: string,
    /** The plan now in force for this channel. */
    public readonly planId: string,
    /** The plan it replaced, or null on first activation. */
    public readonly previousPlanId: string | null,
    public readonly cause: "activated" | "changed" | "subscribed",
  ) {
    super();
  }
}
