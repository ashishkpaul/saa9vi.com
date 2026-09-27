import { FindOptionsWhere, Not, Repository } from "typeorm";

import {
  OrganizationSubscription,
  OrganizationSubscriptionStatus,
} from "../entities/organization-subscription.entity";

/**
 * BUG-040 — the single home for "which row is this channel's subscription?".
 *
 * The entity's partial unique index
 *   `@Index(["channelId"], { unique: true, where: '"status" != \'cancelled\'' })`
 * deliberately permits ANY number of `cancelled` rows per channel alongside at
 * most one live row. An unordered, unfiltered `findOne({ channelId })` is
 * therefore free to return history, which produced three live failures (found
 * 2026-09-27 against a running server): cancel/change acting on the stale
 * cancelled row, a misleading "subscription is cancelled" error while a live
 * row existed, and a re-subscribe that created the provider subscription
 * before failing on the unique index — orphaning a Razorpay subscription that
 * no local row referenced.
 *
 * The first fix applied the predicate at several call sites but left
 * `CommercialEntitlementService.findChannelSubscription()` — whose docstring
 * claimed to mirror `SubscriptionService.findSubscriptionByChannel()` — running
 * the old unfiltered query. That is the BUG-036 lesson repeating (a rule
 * duplicated in two places drifts), so the rule now lives here and both layers
 * call it.
 *
 * Deliberately a pure module rather than a service: the platform-level
 * `CommercialEntitlementService` reads these entities through
 * `TransactionalConnection` precisely so it does NOT inject
 * `SubscriptionService` (see its header — several e2e configurations load
 * plugins without the subscription service graph), and it can import a pure
 * function without creating that dependency.
 */

export const CANCELLED_SUBSCRIPTION_STATUS = "cancelled";

/**
 * Condition selecting a channel's LIVE row. At most one row matches, by the
 * partial unique index, so this is deterministic without an ORDER BY.
 */
export function liveSubscriptionWhere(
  channelId: string,
): FindOptionsWhere<OrganizationSubscription> {
  return {
    channelId,
    // Explicit type argument on `Not`: outside a `findOne` argument position
    // there is nothing to infer from, so `Not("cancelled")` widens to
    // `FindOperator<string>` and stops being assignable to the status union.
    status: Not<NonNullable<OrganizationSubscriptionStatus>>(
      CANCELLED_SUBSCRIPTION_STATUS,
    ),
  };
}

/**
 * The channel's live (non-cancelled) subscription, or `null` when it has none.
 *
 * Use for every MUTATION precondition and for any question of the form "does
 * this channel currently hold a subscription?" — `subscribeToPlan`'s slot
 * guard, plan change, provider-binding attachment, free-plan provisioning.
 */
export async function findLiveSubscriptionForChannel(
  repo: Repository<OrganizationSubscription>,
  channelId: string,
  relations: string[] = ["plan"],
): Promise<OrganizationSubscription | null> {
  return repo.findOne({ where: liveSubscriptionWhere(channelId), relations });
}

/**
 * The channel's CURRENT subscription for READ surfaces: the live row when one
 * exists, otherwise the newest `cancelled` row so a terminal cancellation is
 * still reported rather than vanished.
 *
 * Use where the caller reports state backwards to a user or a policy:
 * `mySubscription` / `myLiveUsage`, commercial entitlement evaluation, and
 * cancellation idempotency.
 */
export async function findCurrentSubscriptionForChannel(
  repo: Repository<OrganizationSubscription>,
  channelId: string,
  relations: string[] = ["plan"],
): Promise<OrganizationSubscription | null> {
  const live = await findLiveSubscriptionForChannel(repo, channelId, relations);
  if (live) return live;
  // Only reached when the channel has no live row: a cancelled-only channel
  // still has exactly one deterministic answer (newest history row).
  return repo.findOne({
    where: { channelId, status: CANCELLED_SUBSCRIPTION_STATUS },
    relations,
    order: { id: "DESC" },
  });
}
