import { Injectable as NestInjectable } from '@nestjs/common';
import { RequestContext, TransactionalConnection, UserInputError } from '@vendure/core';
import {
  OrganizationSubscription,
  OrganizationSubscriptionStatus,
} from '../../subscription/entities/organization-subscription.entity';

/**
 * ADR-043 §2 — commercial entitlement for L1 white-label storefront theming.
 *
 * ARCHITECTURAL NOTE — why this reads subscription entities directly:
 * This service reads `OrganizationSubscription` / `SubscriptionPlan` through
 * `TransactionalConnection` instead of injecting `SubscriptionService`, which
 * would create a runtime TenantPlugin → SubscriptionPlugin dependency (pulling
 * its provider/controller/job-queue infrastructure into every TenantPlugin
 * consumer). The query intentionally mirrors
 * `SubscriptionService.findSubscriptionByChannel()`
 * (findOne({ where: { channelId }, relations: ['plan'] })) — it reproduces the
 * established data-access path rather than inventing a new one; Vendure core
 * services likewise use TransactionalConnection for cross-aggregate reads.
 * If commercial eligibility becomes a shared cross-plugin policy (e.g. when
 * ADR-042 marketplace eligibility needs the same commercial-state window),
 * extract the policy into a platform-level service instead of adding further
 * per-plugin entity-query duplicates.
 *
 * Subscription states that still carry the paid tenant relationship:
 * - `trialing`  — legitimately inside the commercial lifecycle
 * - `active`    — normal paid state
 * - `past_due`  — existing customer in payment recovery / dunning; denying here
 *                 would strip branding from a tenant who is still being billed
 *
 * Deliberately NOT eligible:
 * - `pending_provider_auth` — the subscription never completed authorization
 * - `cancelled`             — the commercial relationship has ended
 *
 * The local FSM is the only source of truth; provider-side states (e.g. a
 * Razorpay `halted`) do not become new local eligibility states.
 */
export const WHITELABEL_ELIGIBLE_STATUSES: readonly OrganizationSubscriptionStatus[] = [
  'trialing',
  'active',
  'past_due',
];

@NestInjectable()
export class TenantCommercialEligibilityService {
  constructor(private readonly connection: TransactionalConnection) {}

  /**
   * True when the current channel's tenant may use tenant-specific theming.
   *
   * Requires BOTH:
   *   plan.whitelabelEnabled === true
   *   subscription.status ∈ {trialing, active, past_due}
   *
   * Fails closed: no channel, no subscription row, or an unrecognised state
   * yields false.
   *
   * Marketplace listing eligibility (ADR-042, `marketplaceListingEnabled`) is a
   * SEPARATE entitlement and is intentionally not modelled here.
   */
  async canUseWhitelabel(ctx: RequestContext): Promise<boolean> {
    const channelId = String(ctx.channelId ?? '');
    if (!channelId) return false;

    const subscription = await this.findSubscription(ctx, channelId);
    if (!subscription) return false;
    if (!subscription.plan?.whitelabelEnabled) return false;

    return WHITELABEL_ELIGIBLE_STATUSES.includes(subscription.status);
  }

  /**
   * Throws when the tenant has no white-label entitlement. Used by every
   * operation that creates, modifies or activates a tenant theme.
   */
  async assertCanUseWhitelabel(ctx: RequestContext): Promise<void> {
    if (await this.canUseWhitelabel(ctx)) return;
    throw new UserInputError(
      'Storefront theming is not enabled for this tenant. White-label theming requires ' +
        'a trialing, active or past_due subscription on a plan that includes it.',
    );
  }

  /**
   * Reads the tenant's subscription, mirroring
   * `SubscriptionService.findSubscriptionByChannel()` — same predicate, same
   * `plan` relation — rather than inventing a new query shape.
   *
   * Queried through TransactionalConnection instead of injecting
   * SubscriptionService because TenantPlugin must remain loadable in
   * configurations that do not load SubscriptionPlugin (several e2e configs),
   * and a cross-plugin *entity* read is the established pattern in this codebase
   * (cf. MarketplaceEventListener reading BbbScheduledSession / InstructorProfile).
   * If a shared commercial-entitlement layer emerges later, this method is the
   * single place to swap in the owning service.
   */
  private findSubscription(ctx: RequestContext, channelId: string) {
    return this.connection
      .getRepository(ctx, OrganizationSubscription)
      .findOne({ where: { channelId }, relations: ['plan'] });
  }
}
