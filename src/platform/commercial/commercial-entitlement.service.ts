import { Injectable } from '@nestjs/common';
import { TransactionalConnection } from '@vendure/core';
import {
  OrganizationSubscription,
  OrganizationSubscriptionStatus,
} from '../../plugins/subscription/entities/organization-subscription.entity';
import { SubscriptionPlan } from '../../plugins/subscription/entities/subscription-plan.entity';

/**
 * PLATFORM-LEVEL COMMERCIAL ENTITLEMENT POLICY (ADR-042 §1, ADR-043 §2).
 *
 * ONE evaluator for every plan/status-derived commercial entitlement. The
 * header comment of `TenantCommercialEligibilityService` anticipated exactly
 * this ("If commercial eligibility becomes a shared cross-plugin policy (e.g.
 * when ADR-042 marketplace eligibility needs the same commercial-state window),
 * extract the policy into a platform-level service instead of adding further
 * per-plugin entity-query duplicates") — ADR-042 is that trigger.
 *
 * ── Why the window is a parameter, not a constant ────────────────────────────
 * The entitlements do NOT share a window (plan §3.4 item 4):
 *
 *   theming (ADR-043)      : {trialing, active, past_due} — no grace needed;
 *                            an existing customer in dunning keeps branding
 *   marketplace (ADR-042)  : {active} ∪ {past_due ∧ now() < marketplaceGraceUntil}
 *
 * So the caller supplies its `CommercialEligibilityWindow`; this service owns
 * only the mechanics that must never diverge (the plan relation, the
 * fail-closed read, the Saa9vi-clock grace comparison).
 *
 * ── Why a *platform* service reads plugin entities ───────────────────────────
 * `OrganizationSubscription` / `SubscriptionPlan` are TypeORM entities owned by
 * SubscriptionPlugin (which must therefore be registered — the same requirement
 * shape as TenantPlugin/BigBlueButtonPlugin for the marketplace indexer). The
 * read is a cross-plugin *entity* read through TransactionalConnection, the
 * established pattern in this codebase (cf. MarketplaceIndexerService joining
 * BbbScheduledSession / TenantProfile / BbbOrganization). It deliberately does
 * NOT inject `SubscriptionService`: that would create TenantPlugin →
 * SubscriptionPlugin and MarketplacePlugin → SubscriptionPlugin runtime service
 * dependencies, and several e2e configurations load those plugins without the
 * subscription service graph.
 *
 * ── Prohibited eligibility signals (ADR-042 §6, INV-024 rejection criterion) ─
 * Never consult, and never add here:
 *   ❌ hostname / `tenantSlug` presence      ❌ `customDomain` configuration
 *   ❌ Razorpay `providerStatus`             ❌ provider subscription ID existence
 *   ❌ BillingAttempt count
 * A hostname is a routing/reachability contract (G1), not a commercial
 * entitlement, and provider state is not a Saa9vi eligibility state.
 *
 * ── Clock rule (ADR-042 §3) ─────────────────────────────────────────────────
 * Grace is evaluated with the Saa9vi server clock only (the injectable `now`
 * parameter exists for deterministic tests) — never from provider timestamps.
 */
export interface CommercialEligibilityWindow {
  /** Statuses that are entitled outright, with no additional condition. */
  eligibleStatuses: readonly OrganizationSubscriptionStatus[];
  /**
   * Statuses entitled only while the grace deadline is set and still in the
   * future. Used by ADR-042 (`past_due` + `marketplaceGraceUntil`).
   */
  graceStatuses: readonly OrganizationSubscriptionStatus[];
}

export interface CommercialEntitlement {
  /** Which subscription states satisfy this entitlement. */
  window: CommercialEligibilityWindow;
  /**
   * Optional plan-tier capability flag check (e.g. `whitelabelEnabled`,
   * `marketplaceListingEnabled`). A missing plan fails closed.
   */
  requiresPlanFlag?: (plan: SubscriptionPlan | undefined) => boolean;
}

/**
 * ADR-042 marketplace-listing entitlement — INV-024.
 *
 * `active` OR (`past_due` AND now() < marketplaceGraceUntil), AND
 * `plan.marketplaceListingEnabled === true`. Absence of a subscription, or a
 * plan without the flag, is `false` — not an error (ADR-042 §4).
 */
export const MARKETPLACE_LISTING_ENTITLEMENT: CommercialEntitlement = {
  window: {
    eligibleStatuses: ['active'],
    graceStatuses: ['past_due'],
  },
  requiresPlanFlag: (plan) => plan?.marketplaceListingEnabled === true,
};


@Injectable()
export class CommercialEntitlementService {
  constructor(private readonly connection: TransactionalConnection) {}

  /**
   * The tenant's subscription (with plan), or null.
   *
   * Mirrors `SubscriptionService.findSubscriptionByChannel()` — same predicate,
   * same `plan` relation — rather than inventing a new query shape. Read through
   * `rawConnection` because this is a channel-free policy evaluation: the caller
   * may be evaluating a *different* channel than the active RequestContext (the
   * marketplace indexer runs in a job context whose ctx.channelId is not the
   * session's channel). The channel is always supplied explicitly, so tenant
   * isolation is preserved by the WHERE clause.
   */
  async findChannelSubscription(channelId: string): Promise<OrganizationSubscription | null> {
    if (!channelId) return null;
    return this.connection.rawConnection
      .getRepository(OrganizationSubscription)
      .findOne({ where: { channelId }, relations: ['plan'] });
  }

  /**
   * Evaluates an entitlement for a channel. Fails closed on every unknown:
   * no channel id, no subscription row, missing plan, unrecognised status, or
   * an absent/expired grace deadline all yield `false`.
   */
  async isEntitled(
    channelId: string,
    entitlement: CommercialEntitlement,
    now: Date = new Date(),
  ): Promise<boolean> {
    if (!channelId) return false;

    const subscription = await this.findChannelSubscription(channelId);
    if (!subscription) return false;

    if (entitlement.requiresPlanFlag && !entitlement.requiresPlanFlag(subscription.plan)) {
      return false;
    }

    const { eligibleStatuses, graceStatuses } = entitlement.window;
    if (eligibleStatuses.includes(subscription.status)) return true;

    if (graceStatuses.includes(subscription.status)) {
      const graceUntil = subscription.marketplaceGraceUntil;
      if (!graceUntil) return false;
      const graceUntilMs = new Date(graceUntil).getTime();
      // A malformed deadline is not a licence to stay listed.
      if (!Number.isFinite(graceUntilMs)) return false;
      return now.getTime() < graceUntilMs;
    }

    return false;
  }

  /**
   * ADR-042 §4 — `channelMarketplaceEligible(channelId)`:
   *
   *   subscription = findActiveSubscriptionForChannel(channelId)
   *   if (!subscription)                                          → false
   *   plan = subscription.plan
   *   if (!plan.marketplaceListingEnabled)                        → false
   *   if (subscription.status === 'active')                       → true
   *   if (status === 'past_due' && now() < marketplaceGraceUntil) → true
   *   → false
   *
   * Consumed by `MarketplaceIndexerService.indexSession()` (primary
   * enforcement point) and by the tenant-facing commercial read surface.
   */
  channelMarketplaceEligible(channelId: string, now: Date = new Date()): Promise<boolean> {
    return this.isEntitled(channelId, MARKETPLACE_LISTING_ENTITLEMENT, now);
  }
}
