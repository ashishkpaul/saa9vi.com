import { Injectable } from "@nestjs/common";
import { Logger, RequestContext, TransactionalConnection } from "@vendure/core";

import { CommercialEntitlementService } from "../../../platform/commercial/commercial-entitlement.service";
import { TenantBusinessAccountService } from "../../../platform/commercial/tenant-business-account.service";
import { BbbCapacityGrant } from "../../bigbluebutton-plugin/entities/bbb-capacity-grant.entity";
import { BbbOrganization } from "../../bigbluebutton-plugin/entities/bbb-organization.entity";
import {
  TENANT_SELECTABLE_SOURCE_TYPES,
  remainingMinutesForGrant,
} from "../../bigbluebutton-plugin/services/grant-selection.policy";
import { SubscriptionPlan } from "../entities/subscription-plan.entity";

/** Public projection of a catalogue plan — provider wiring deliberately absent. */
export interface SubscriptionPlanPublicView {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  monthlyPriceInPaise: number;
  includedBbbMinutes: number;
  maxStudents: number;
  customDomainEnabled: boolean;
  whitelabelEnabled: boolean;
  marketplaceListingEnabled: boolean;
}

export interface MySubscriptionView {
  plan: SubscriptionPlanPublicView;
  status: string;
  currentPeriodStart: Date | null;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
  cancelledAt: Date | null;
  marketplaceEligible: boolean;
}

export interface MyLiveUsageView {
  periodStart: Date | null;
  periodEnd: Date | null;
  includedMinutes: number;
  consumedMinutes: number;
  remainingMinutes: number | null;
  isUnbounded: boolean;
}

/**
 * Plan §3.5 (slice 8) — tenant-facing commercial READ surface.
 *
 * ── Design rules this service is bound by ────────────────────────────────────
 * 1. TENANT FROM `ctx.channelId` ONLY. No method takes a channel argument, so
 *    there is no code path by which a caller can name another tenant.
 * 2. AUTHORIZATION FIRST, EVERY TIME. Each tenant-scoped read calls
 *    `TenantBusinessAccountService.assertBusinessAccount()` before any query —
 *    `@Allow(Permission.Authenticated)` at the resolver is a gate, not an
 *    ownership decision (learners satisfy it; see that service).
 * 3. NO SECOND EVALUATOR. The subscription read and the marketplace-eligibility
 *    decision come from the shared platform policy
 *    (`CommercialEntitlementService`); plan §3.5 requires the ADR-042 semantics
 *    to have exactly one home.
 * 4. EXPLICIT PROJECTION, NEVER ENTITY PASSTHROUGH. Every field set is built by
 *    hand so a future column (e.g. another provider field) cannot leak into the
 *    public surface by accident.
 * 5. USAGE SEMANTICS FROM THE GRANT POLICY. Selectable source types and the
 *    `Infinity`/`isUnbounded` rule come from
 *    `bigbluebutton-plugin/services/grant-selection.policy.ts`, the single home
 *    established by BUG-036 — so this read model cannot drift from the
 *    provisioning gate it describes.
 *
 * SCHEMA REQUIREMENT: `myLiveUsage` reads BigBlueButtonPlugin's entities, so a
 * configuration serving this query must register BigBlueButtonPlugin — the same
 * requirement shape `CommercialEntitlementModule` documents for
 * SubscriptionPlugin. Where it is not registered the read degrades to a zeroed
 * allowance plus a warning (a *read* model must not 500 a dashboard; capacity
 * enforcement lives in the provisioning worker, not here).
 */
@Injectable()
export class SubscriptionShopService {
  private static readonly loggerCtx = "SubscriptionShopService";

  constructor(
    private readonly connection: TransactionalConnection,
    private readonly businessAccount: TenantBusinessAccountService,
    private readonly commercialEntitlements: CommercialEntitlementService,
  ) {}

  /**
   * The platform-global plan catalogue. No tenant context: `SubscriptionPlan`
   * is intentionally not channel-scoped (see the entity header), which is why
   * this query is `Permission.Public`.
   */
  async findAvailablePlans(): Promise<SubscriptionPlanPublicView[]> {
    const plans = await this.connection.rawConnection
      .getRepository(SubscriptionPlan)
      .find({ where: { isActive: true }, order: { sortOrder: "ASC", name: "ASC" } });
    return plans.map((plan) => this.toPublicPlan(plan));
  }

  /**
   * The active channel's subscription, or `null` when it has none (a channel
   * without a subscription is not an error — plan §3.5 acceptance).
   */
  async findMySubscription(ctx: RequestContext): Promise<MySubscriptionView | null> {
    await this.businessAccount.assertBusinessAccount(ctx);
    const channelId = ctx.channelId ? String(ctx.channelId) : "";
    if (!channelId) return null;

    const subscription =
      await this.commercialEntitlements.findChannelSubscription(channelId);
    if (!subscription) return null;

    return {
      plan: this.toPublicPlan(subscription.plan),
      status: subscription.status,
      currentPeriodStart: subscription.currentPeriodStart ?? null,
      currentPeriodEnd: subscription.currentPeriodEnd ?? null,
      cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
      cancelledAt: subscription.cancelledAt ?? null,
      marketplaceEligible:
        await this.commercialEntitlements.channelMarketplaceEligible(channelId),
    };
  }

  /**
   * Live allowance for the current period.
   *
   * Included/consumed/remaining are summed over the channel's *tenant-selectable*
   * in-window grants only. An `internal_overhead` grant is ops headroom and is
   * never reported as customer allowance (BUG-036); if a selectable grant is
   * `isUnbounded`, remaining is `null` — infinite capacity is not a number, and
   * `grantedMinutes` on such a row is a sentinel, not a quantity.
   *
   * Remaining is summed per grant with a floor of 0: an over-consumed grant
   * cannot mask another grant's shortfall.
   *
   * The period dates come from the subscription row and are NULL for
   * provider-free plans by design (F-7), so the figures are not period-dated in
   * that case — slice 6's daily allowance will populate these same fields rather
   * than change this contract.
   */
  async findMyLiveUsage(ctx: RequestContext): Promise<MyLiveUsageView> {
    await this.businessAccount.assertBusinessAccount(ctx);
    const channelId = ctx.channelId ? String(ctx.channelId) : "";
    if (!channelId) {
      return this.emptyUsage();
    }

    const subscription =
      await this.commercialEntitlements.findChannelSubscription(channelId);
    const period = {
      periodStart: subscription?.currentPeriodStart ?? null,
      periodEnd: subscription?.currentPeriodEnd ?? null,
    };

    if (!this.connection.rawConnection.hasMetadata(BbbOrganization)) {
      Logger.warn(
        "BigBlueButtonPlugin is not registered in this configuration; reporting a zeroed live allowance",
        SubscriptionShopService.loggerCtx,
      );
      return { ...this.emptyUsage(), ...period };
    }

    const organization = await this.connection.rawConnection
      .getRepository(BbbOrganization)
      .findOne({ where: { channelId } });
    if (!organization) {
      return { ...this.emptyUsage(), ...period };
    }

    const now = new Date();
    const grants = await this.connection.rawConnection
      .getRepository(BbbCapacityGrant)
      .createQueryBuilder("grant")
      .where("grant.organizationId = :orgId", { orgId: organization.id })
      // Positive IN list (not `!= 'internal_overhead'`) so a future third source
      // type cannot become customer-visible by default — the BUG-036 lesson.
      .andWhere("grant.sourceType IN (:...sourceTypes)", {
        sourceTypes: [...TENANT_SELECTABLE_SOURCE_TYPES],
      })
      .andWhere("grant.validFrom <= :now", { now })
      .andWhere("grant.validUntil >= :now", { now })
      .getMany();

    let includedMinutes = 0;
    let consumedMinutes = 0;
    let remainingMinutes = 0;
    let isUnbounded = false;

    for (const grant of grants) {
      if (grant.isUnbounded) {
        isUnbounded = true;
        continue;
      }
      includedMinutes += grant.grantedMinutes ?? 0;
      consumedMinutes += grant.consumedMinutes ?? 0;
      remainingMinutes += Math.max(
        0,
        remainingMinutesForGrant({
          grantedMinutes: grant.grantedMinutes,
          consumedMinutes: grant.consumedMinutes,
          isUnbounded: grant.isUnbounded,
        }),
      );
    }

    return {
      ...period,
      includedMinutes,
      consumedMinutes,
      remainingMinutes: isUnbounded ? null : remainingMinutes,
      isUnbounded,
    };
  }

  private emptyUsage(): MyLiveUsageView {
    return {
      periodStart: null,
      periodEnd: null,
      includedMinutes: 0,
      consumedMinutes: 0,
      remainingMinutes: 0,
      isUnbounded: false,
    };
  }

  /**
   * Whitelist projection. `providerPlanId` and any future provider column are
   * excluded by construction rather than by omission.
   */
  private toPublicPlan(plan: SubscriptionPlan): SubscriptionPlanPublicView {
    return {
      id: String(plan.id),
      name: plan.name,
      slug: plan.slug,
      description: plan.description ?? null,
      monthlyPriceInPaise: plan.monthlyPriceInPaise,
      includedBbbMinutes: plan.includedBbbMinutes,
      maxStudents: plan.maxStudents,
      customDomainEnabled: plan.customDomainEnabled,
      whitelabelEnabled: plan.whitelabelEnabled,
      marketplaceListingEnabled: plan.marketplaceListingEnabled,
    };
  }
}
