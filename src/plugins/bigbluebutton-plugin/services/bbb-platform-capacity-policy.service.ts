import { Injectable } from "@nestjs/common";
import {
  ID,
  Logger,
  RequestContext,
  TransactionalConnection,
  UserInputError,
} from "@vendure/core";
import { IsNull } from "typeorm";

import { BbbOrganization } from "../entities/bbb-organization.entity";
import { BbbPlatformCapacityPolicy } from "../entities/bbb-platform-capacity-policy.entity";

const loggerCtx = "BbbPlatformCapacityPolicyService";

/**
 * INV-015 recommended tier defaults. Reference defaults for Portal Admin seeding.
 *
 * Deliberately carries NO `maxConcurrentMeetings`: only Free Basic's ceiling
 * of 1 is a frozen product decision (plan §3.6, 2026-09-22). Paid-tier
 * concurrency numbers have not been frozen, so none are invented here — a
 * seeded paid tier inherits the column default, and the value stays Admin-set
 * (ADR-031 amendment, 2026-09-25).
 */
export const PLAN_TIER_DEFAULTS = {
  starter: { defaultRoomCapacity: 25, maxRoomCapacity: 100, maxConcurrentParticipants: 250 },
  growth: { defaultRoomCapacity: 100, maxRoomCapacity: 300, maxConcurrentParticipants: 1000 },
  enterprise: { defaultRoomCapacity: 250, maxRoomCapacity: 1000, maxConcurrentParticipants: 5000 },
} as const;

/** Fallback when no policy rows exist at all (feature not yet adopted/bootstrap). */
export const PLATFORM_CAPACITY_FALLBACK = {
  defaultRoomCapacity: 25,
  maxRoomCapacity: 100,
  maxConcurrentParticipants: 250,
  // Mirrors the entity default so pre-adoption behaviour is unchanged. This is
  // a neutral starting point, NOT a commercial decision — and it is Tier 4, so
  // `isPlanDerived()` is false and it can never overwrite an org's value.
  maxConcurrentMeetings: 5,
} as const;

export interface EffectiveCapacityPolicy {
  defaultRoomCapacity: number;
  maxRoomCapacity: number;
  maxConcurrentParticipants: number;
  /** Simultaneous live rooms ceiling — see ADR-031's 2026-09-25 amendment. */
  maxConcurrentMeetings: number;
  /** Which source produced this policy (for logging/debug). */
  source: "channel-override" | "plan" | "platform-default" | "fallback";
}

/**
 * Resolves and applies platform-owned BBB capacity limits (ADR-031 / INV-015).
 *
 * 4-Tier Resolution order for a channel/tenant:
 *   1. Tier 1 (Channel Override): row where channelId = :channelId
 *   2. Tier 2 (Plan Tier Policy): row matching tenant's active/trialing subscription plan
 *   3. Tier 3 (Platform Default): row where channelId IS NULL AND subscriptionPlanId IS NULL
 *   4. Tier 4 (Hardcoded Fallback): PLATFORM_CAPACITY_FALLBACK
 */
@Injectable()
export class BbbPlatformCapacityPolicyService {
  constructor(private readonly connection: TransactionalConnection) {}

  /** Feature-adopted guard: has Portal Admin created any policy rows? */
  async hasAnyPolicy(ctx: RequestContext): Promise<boolean> {
    const count = await this.connection
      .getRepository(ctx, BbbPlatformCapacityPolicy)
      .count();
    return count > 0;
  }

  /**
   * Schema-qualified reference to the subscription table, for the Tier 2 raw
   * lookup below.
   *
   * Why this is needed: TypeORM qualifies ENTITY tables with the connection's
   * `schema` option, but a raw query string is resolved by the connection's
   * `search_path` instead — and `search_path` is NOT derived from `schema`
   * (TypeORM sets `searchSchema` from the DB's `current_schema()`). So in any
   * deployment that sets `dbConnectionOptions.schema` — including every
   * schema-isolated e2e run — an unqualified raw query silently reads the
   * WRONG schema: Tier 2 finds no subscription, the cascade falls through to
   * Tier 3/4, and plan-derived capacity stops working with no error. Worse, the
   * surrounding try/catch would swallow a "relation does not exist" failure
   * into a mere warning.
   *
   * Qualifying keeps the raw path in agreement with the entity path. When no
   * schema is configured (the production default) this is the bare table name
   * and behaviour is unchanged.
   */
  private get subscriptionTableRef(): string {
    const schema = (
      this.connection.rawConnection.options as { schema?: string }
    ).schema;
    return schema
      ? `"${schema}"."organization_subscription"`
      : `"organization_subscription"`;
  }

  /**
   * Alias for getEffectivePolicy to match INV-015 naming.
   */
  async resolveEffectivePolicy(
    ctx: RequestContext,
    channelId?: string | null,
  ): Promise<EffectiveCapacityPolicy> {
    return this.getEffectivePolicy(ctx, channelId);
  }

  /**
   * Resolve the effective policy for a channel using the 4-tier cascade.
   */
  async getEffectivePolicy(
    ctx: RequestContext,
    channelId?: string | null,
  ): Promise<EffectiveCapacityPolicy> {
    const repo = this.connection.getRepository(ctx, BbbPlatformCapacityPolicy);

    // 1. Tier 1: Channel-specific override
    if (channelId) {
      const channelOverride = await repo.findOne({ where: { channelId } });
      if (channelOverride) {
        return this.toEffective(channelOverride, "channel-override");
      }
    }

    // 2. Tier 2: Plan-matched policy for active/trialing subscriptions
    if (channelId) {
      try {
        const subRows: Array<{ planId: string }> = await this.connection.rawConnection.query(
          `SELECT "planId" FROM ${this.subscriptionTableRef}
            WHERE "channelId" = $1 AND "status" IN ('trialing', 'active')
            ORDER BY "updatedAt" DESC LIMIT 1`,
          [channelId],
        );
        const planId = subRows[0]?.planId;
        if (planId) {
          const planPolicy = await repo.findOne({ where: { subscriptionPlanId: planId } });
          if (planPolicy) {
            return this.toEffective(planPolicy, "plan");
          }
        }
      } catch (error) {
        Logger.warn(
          `Subscription lookup failed, falling back to default policy: ${(error as Error).message}`,
          loggerCtx,
        );
      }
    }

    // 3. Tier 3: Platform-default row (no channelId, no subscriptionPlanId)
    const defaultPolicy = await repo.findOne({
      where: {
        channelId: IsNull(),
        subscriptionPlanId: IsNull(),
      },
    });
    if (defaultPolicy) {
      return this.toEffective(defaultPolicy, "platform-default");
    }

    // 4. Tier 4: Hardcoded fallback
    return { ...PLATFORM_CAPACITY_FALLBACK, source: "fallback" };
  }

  /**
   * Validate and clamp a requested room capacity against policy:
   * defaults from defaultRoomCapacity, ceiling at maxRoomCapacity.
   */
  resolveRoomCapacity(
    policy: EffectiveCapacityPolicy,
    requested?: number | null,
  ): number {
    if (requested != null) {
      if (requested > policy.maxRoomCapacity) {
        throw new UserInputError(
          `Requested room capacity (${requested}) exceeds maximum allowed by policy (${policy.maxRoomCapacity})`,
        );
      }
      return Math.max(1, requested);
    }
    return policy.defaultRoomCapacity;
  }

  /**
   * Write-through denormalization (INV-015): org.maxParticipantsPerMeeting
   * caches the default room capacity, preserving historical default semantics
   * for admin UIs and reports.
   */
  async syncOrganizationCache(
    ctx: RequestContext,
    org: BbbOrganization,
    policy: EffectiveCapacityPolicy,
  ): Promise<void> {
    if (org.maxParticipantsPerMeeting === policy.defaultRoomCapacity) {
      return;
    }
    org.maxParticipantsPerMeeting = policy.defaultRoomCapacity;
    await this.connection.getRepository(ctx, BbbOrganization).save(org);
    Logger.info(
      `Synced org ${org.id} maxParticipantsPerMeeting → ${policy.defaultRoomCapacity} (policy source: ${policy.source})`,
      loggerCtx,
    );
  }

  /**
   * True when the policy came from a row somebody deliberately configured for
   * this tenant: Tier 1 (channel override) or Tier 2 (plan-matched).
   *
   * Tier 3 (platform default) and Tier 4 (hardcoded fallback) are *generic*
   * answers — `getEffectivePolicy()` always returns one — so treating them as
   * authoritative would silently reset every organisation whose plan has no
   * policy row. Named rather than an inline `source === …` comparison so the
   * rule has exactly one home (ADR-031 amendment, Decision 4).
   */
  isPlanDerived(policy: EffectiveCapacityPolicy): boolean {
    return policy.source === "plan" || policy.source === "channel-override";
  }

  /**
   * Write-through denormalization for the concurrent-rooms ceiling (ADR-031
   * amendment, 2026-09-25): `org.concurrentMeetingLimit` mirrors
   * `policy.maxConcurrentMeetings`.
   *
   * The organisation field stays the SINGLE enforcement surface — nothing
   * resolves the policy at enforcement time. This method re-checks
   * `isPlanDerived()` itself rather than trusting its callers, so a Tier 3 /
   * Tier 4 resolution can never overwrite an Admin-set value even if a future
   * call site forgets the guard.
   *
   * Note the deliberate asymmetry with `syncOrganizationCache()` above: that
   * path has always applied *any* resolved policy once adoption began
   * (INV-015's documented transition), whereas this one applies only
   * plan-derived policies. Concurrency is new, so it gets the stricter rule.
   *
   * @returns true when a write actually happened — so callers and tests can
   *          assert the no-op path (no unnecessary write).
   */
  async syncConcurrentMeetingLimit(
    ctx: RequestContext,
    org: BbbOrganization,
    policy: EffectiveCapacityPolicy,
  ): Promise<boolean> {
    if (!this.isPlanDerived(policy)) {
      Logger.debug(
        `Org ${org.id} concurrentMeetingLimit left unchanged at ${org.concurrentMeetingLimit}: ` +
          `effective policy is '${policy.source}' (not plan-derived)`,
        loggerCtx,
      );
      return false;
    }

    const next = policy.maxConcurrentMeetings;
    if (org.concurrentMeetingLimit === next) {
      return false;
    }

    const previous = org.concurrentMeetingLimit;
    org.concurrentMeetingLimit = next;
    await this.connection.getRepository(ctx, BbbOrganization).save(org);
    Logger.info(
      `Synced org ${org.id} concurrentMeetingLimit ${previous} → ${next} (policy source: ${policy.source})`,
      loggerCtx,
    );
    return true;
  }

  private toEffective(
    entity: BbbPlatformCapacityPolicy,
    source: EffectiveCapacityPolicy["source"],
  ): EffectiveCapacityPolicy {
    return {
      defaultRoomCapacity: entity.defaultRoomCapacity,
      maxRoomCapacity: entity.maxRoomCapacity,
      maxConcurrentParticipants: entity.maxConcurrentParticipants,
      maxConcurrentMeetings: entity.maxConcurrentMeetings,
      source,
    };
  }
}
