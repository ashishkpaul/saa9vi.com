import { Inject, Injectable } from "@nestjs/common";
import {
  Channel,
  Logger,
  RequestContext,
  TransactionalConnection,
} from "@vendure/core";

import { SUBSCRIPTION_PLUGIN_OPTIONS, loggerCtx } from "../constants";
import { OrganizationSubscription } from "../entities/organization-subscription.entity";
import { SubscriptionPlan } from "../entities/subscription-plan.entity";
import { PluginInitOptions } from "../types";

/** Default catalogue slug of the provider-free entry-tier plan. */
export const DEFAULT_FREE_PLAN_SLUG = "free-basic";

/**
 * Provider-free Free Basic activation (plan §3.2 / slice 4).
 *
 * Every tenant that self-serve registers lands on a real, permanent
 * provider-free plan: a local `OrganizationSubscription` in status `active`
 * with NO provider subscription and NO SubscriptionProviderBinding.
 *
 * Contract — all four points are load-bearing:
 *
 *  1. **No provider interaction.** Provider-free activation is the ADR-039 §3
 *     exception recorded in ADR-044/ADR-039's amendment. `providerPlanId IS
 *     NULL` on the resolved plan is what makes a row provider-free; a plan that
 *     carries a `providerPlanId` is REJECTED here rather than silently activated,
 *     because the paid renewal scan and the webhook pipeline both expect such a
 *     row to have a provider behind it.
 *  2. **Period fields stay NULL** (F-7 correctness requirement). The paid renewal
 *     discovery predicate is `status IN ('active','trialing') AND
 *     currentPeriodEnd < now`; a non-NULL end would enrol this row in the paid
 *     billing pipeline — for a provider-free row that is an orphan-attempt loop.
 *  3. **Idempotent.** One non-cancelled subscription per channel is enforced by
 *     the partial unique index (`status != 'cancelled'`); this upserts against
 *     that index — it returns the existing live row, and a lost race resolves by
 *     re-reading rather than surfacing a unique violation.
 *  4. **Fail-soft.** A missing or misconfigured free plan must never block
 *     registration: it returns `null` and logs. The absence is detectable — a
 *     warn log here, and (slice 8) the Shop read contract reports "no
 *     subscription" to the tenant dashboard.
 *
 * Deliberately NOT done here (plan §3.2/§3.3):
 *  - **no capacity grant.** `BbbOrganizationService.create()` already writes the
 *    organisation's unbounded `internal_overhead` grant (FEAT-002); the free
 *    plan's live allowance is a DAILY grant created by the scheduled job in
 *    slice 6 (`sourceType: 'subscription'`). Creating a billing-period grant
 *    here would be a second writer against the same idempotency key.
 *  - **no `concurrentMeetingLimit` sync** — plan-derived sync is slice 5.
 */
@Injectable()
export class FreePlanProvisioningService {
  constructor(
    private readonly connection: TransactionalConnection,
    @Inject(SUBSCRIPTION_PLUGIN_OPTIONS)
    private readonly options: PluginInitOptions,
  ) {}

  /** Configured provider-free plan slug (falls back to the catalogue default). */
  get freePlanSlug(): string {
    // Defensive `?.`: `SubscriptionPlugin.init()` normally sets the options
    // before DI resolves the factory, but an un-initialised plugin must not
    // throw inside a registration listener.
    return this.options?.freePlanSlug ?? DEFAULT_FREE_PLAN_SLUG;
  }

  /**
   * Resolve the provider-free entry-tier plan from the catalogue.
   *
   * Never throws: returns `null` (with a logged reason) when the slug is
   * unconfigured, the plan row is absent, the plan is inactive, or the plan
   * carries a `providerPlanId` (which would make it provider-wired, not free).
   */
  async resolveFreePlan(ctx: RequestContext): Promise<SubscriptionPlan | null> {
    const slug = this.freePlanSlug;
    if (!slug) {
      Logger.warn(
        `Free-plan provisioning disabled: no freePlanSlug configured`,
        loggerCtx,
      );
      return null;
    }

    const plan = await this.connection
      .getRepository(ctx, SubscriptionPlan)
      .findOne({ where: { slug } });
    if (!plan) {
      Logger.warn(
        `Free-plan provisioning skipped: no SubscriptionPlan with slug '${slug}' exists. ` +
          `Create it via createSubscriptionPlan (providerPlanId must stay null).`,
        loggerCtx,
      );
      return null;
    }
    if (!plan.isActive) {
      Logger.warn(
        `Free-plan provisioning skipped: SubscriptionPlan '${slug}' is inactive`,
        loggerCtx,
      );
      return null;
    }
    if (plan.providerPlanId) {
      Logger.error(
        `Free-plan provisioning skipped: SubscriptionPlan '${slug}' has providerPlanId ` +
          `'${plan.providerPlanId}'. A free plan must be provider-free (providerPlanId null) — ` +
          `activating it locally would create a row the provider pipeline expects to be wired.`,
        loggerCtx,
      );
      return null;
    }
    return plan;
  }

  /**
   * Idempotently activate the Free plan for a channel (INV-001: Channel = Tenant).
   *
   * Returns the live subscription (existing or newly created), or `null` when the
   * free plan is unavailable/not configured. Callers MUST treat `null` as
   * "registration continues; the tenant has no subscription yet" — never as a
   * thrown error, because a missing free *plan row* is a catalogue/ops gap, not a
   * reason to refuse a registration.
   */
  async provisionForChannel(
    ctx: RequestContext,
    channelId: string,
  ): Promise<OrganizationSubscription | null> {
    const freePlan = await this.resolveFreePlan(ctx);
    if (!freePlan) {
      return null;
    }

    const repo = this.connection.getRepository(ctx, OrganizationSubscription);

    // Cheap pre-check (the authoritative check is inside the transaction). A
    // CANCELLED row does not occupy the partial unique index, so it is history
    // rather than a conflict — a fresh row is created below.
    const existing = await repo.findOne({ where: { channelId } });
    if (existing && existing.status !== "cancelled") {
      Logger.debug(
        `Channel ${channelId} already has a non-cancelled subscription ` +
          `('${existing.status}') — free-plan provisioning is a no-op`,
        loggerCtx,
      );
      return existing;
    }

    const channel = await this.connection.rawConnection
      .getRepository(Channel)
      .findOne({ where: { id: channelId } });
    if (!channel) {
      Logger.error(
        `Free-plan provisioning skipped: channel ${channelId} not found`,
        loggerCtx,
      );
      return null;
    }

    try {
      const saved = await this.connection.rawConnection.transaction(async (em) => {
        // Authoritative idempotency check INSIDE the transaction: registration
        // retries and a double-published TenantRegisteredEvent are both plausible.
        const current = await em
          .getRepository(OrganizationSubscription)
          .findOne({ where: { channelId } });
        if (current && current.status !== "cancelled") {
          return current;
        }

        const sub = new OrganizationSubscription({
          channelId,
          plan: freePlan,
          // Freeze decision (§3.6 / ADR-044 §4): reuse `active`. `status` is a
          // varchar with no DB enum, and every downstream reader already treats
          // `active` as eligible (commercial eligibility, Tier-2 capacity
          // resolution, ADR-042's marketplace window).
          status: "active",
          // F-7: provider-free rows MUST keep the period NULL — see the class
          // docstring. A non-NULL end makes this row a paid renewal candidate.
          currentPeriodStart: null as any,
          currentPeriodEnd: null as any,
          cancelAtPeriodEnd: false,
          version: 1,
        });
        // INV-001 dual pattern: join-table membership + scalar channelId, tenant
        // channel only. Deliberately NOT assignToCurrentChannel(), which would
        // also join the default channel and leak the row (BUG-031 / ADR-036).
        sub.channels = [channel];
        return em.save(sub);
      });

      Logger.info(
        `Free-plan provisioning: channel ${channelId} ('${channel.code}') activated on ` +
          `'${freePlan.slug}' (provider-free; status active; no provider call; no binding)`,
        loggerCtx,
      );
      return saved;
    } catch (err: unknown) {
      // Backstop for a lost race: the partial unique index is the DB guard, so a
      // unique violation means a concurrent writer won — adopt their row rather
      // than failing the registration.
      const again = await repo.findOne({ where: { channelId } });
      if (again && again.status !== "cancelled") {
        Logger.warn(
          `Free-plan provisioning: concurrent creation detected for channel ${channelId}; ` +
            `adopted existing subscription ${again.id}`,
          loggerCtx,
        );
        return again;
      }
      const msg = err instanceof Error ? err.message : String(err);
      Logger.error(
        `Free-plan provisioning failed for channel ${channelId}: ${msg}. ` +
          `The tenant has NO subscription until this is repaired — detect via the ` +
          `tenant dashboard read contract (plan §3.5, slice 8).`,
        loggerCtx,
      );
      return null;
    }
  }
}
