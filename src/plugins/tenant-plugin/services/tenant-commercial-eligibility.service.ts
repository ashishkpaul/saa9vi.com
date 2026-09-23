import { Injectable as NestInjectable } from '@nestjs/common';
import { RequestContext, UserInputError } from '@vendure/core';
import {
  CommercialEntitlement,
  CommercialEntitlementService,
} from '../../../platform/commercial/commercial-entitlement.service';
import { OrganizationSubscriptionStatus } from '../../subscription/entities/organization-subscription.entity';

/**
 * ADR-043 §2 — commercial entitlement for L1 white-label storefront theming.
 *
 * ARCHITECTURAL NOTE — delegation, not duplication:
 * The entity read and the grace/window mechanics live in the platform-level
 * `CommercialEntitlementService` (ADR-042 §1 / plan §3.4 item 4), which is the
 * single evaluator shared with marketplace-listing eligibility. This service
 * contributes only what is specific to theming: the eligible-state window and
 * the `whitelabelEnabled` plan flag. It deliberately does NOT inject
 * `SubscriptionService`, which would create a runtime TenantPlugin →
 * SubscriptionPlugin service dependency; the platform policy performs the
 * cross-plugin *entity* read through TransactionalConnection instead (the
 * established pattern — cf. MarketplaceEventListener reading BbbScheduledSession
 * / InstructorProfile).
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
 * NOTE the window is intentionally WIDER than ADR-042's marketplace window:
 * theming admits `past_due` outright (no grace deadline), while marketplace
 * listing admits `past_due` only inside `marketplaceGraceUntil`. The shared
 * policy therefore takes the window per entitlement rather than baking in one.
 *
 * The local FSM is the only source of truth; provider-side states (e.g. a
 * Razorpay `halted`) do not become new local eligibility states.
 */
export const WHITELABEL_ELIGIBLE_STATUSES: readonly OrganizationSubscriptionStatus[] = [
  'trialing',
  'active',
  'past_due',
];

/**
 * ADR-043 §2 window descriptor — consumed by the platform policy.
 * `graceStatuses` is empty: `past_due` is entitled outright here, so no
 * `marketplaceGraceUntil` deadline is consulted.
 */
export const WHITELABEL_ENTITLEMENT: CommercialEntitlement = {
  window: { eligibleStatuses: WHITELABEL_ELIGIBLE_STATUSES, graceStatuses: [] },
  requiresPlanFlag: (plan) => plan?.whitelabelEnabled === true,
};


@NestInjectable()
export class TenantCommercialEligibilityService {
  constructor(private readonly commercialEntitlements: CommercialEntitlementService) {}

  /**
   * True when the current channel's tenant may use tenant-specific theming.
   *
   * Requires BOTH:
   *   plan.whitelabelEnabled === true
   *   subscription.status ∈ {trialing, active, past_due}
   *
   * Fails closed: no channel, no subscription row, or an unrecognised state
   * yields false. Delegated to CommercialEntitlementService, which is the
   * single evaluator for plan/status-derived commercial entitlements.
   *
   * Marketplace listing eligibility (ADR-042, `marketplaceListingEnabled`) is a
   * SEPARATE entitlement and is intentionally not modelled here — it is
   * evaluated by the same platform policy with a different window.
   */
  async canUseWhitelabel(ctx: RequestContext): Promise<boolean> {
    const channelId = String(ctx.channelId ?? '');
    if (!channelId) return false;

    return this.commercialEntitlements.isEntitled(channelId, WHITELABEL_ENTITLEMENT);
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
}
