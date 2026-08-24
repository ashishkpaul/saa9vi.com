import { Injectable } from "@nestjs/common";
import {
  ID,
  Logger,
  RequestContext,
  TransactionalConnection,
} from "@vendure/core";

import { BbbOrganization } from "../entities/bbb-organization.entity";
import { BbbPlatformCapacityPolicy } from "../entities/bbb-platform-capacity-policy.entity";

const loggerCtx = "BbbPlatformCapacityPolicyService";

/**
 * ADR-031 recommended tier table (Starter/Growth/Enterprise). Reference
 * defaults for Portal Admin seeding / dashboard presets — tiers are DATA
 * rows on BbbPlatformCapacityPolicy, not code branches.
 */
export const PLAN_TIER_DEFAULTS = {
  starter: { defaultRoomCapacity: 50, maxRoomCapacity: 100, maxConcurrentParticipants: 500 },
  growth: { defaultRoomCapacity: 200, maxRoomCapacity: 500, maxConcurrentParticipants: 2000 },
  enterprise: { defaultRoomCapacity: 500, maxRoomCapacity: 1000, maxConcurrentParticipants: 5000 },
} as const;

/** Fallback when no policy rows exist at all (feature not yet adopted). */
export const PLATFORM_CAPACITY_FALLBACK = {
  defaultRoomCapacity: 100,
  maxRoomCapacity: 500,
  maxConcurrentParticipants: 1000,
} as const;

export interface EffectiveCapacityPolicy {
  defaultRoomCapacity: number;
  maxRoomCapacity: number;
  maxConcurrentParticipants: number;
  /** Which source produced this policy (for logging/debug). */
  source: "plan" | "platform-default" | "fallback";
}

/**
 * Resolves and applies platform-owned BBB capacity limits (ADR-031).
 *
 * Resolution order for a channel/tenant:
 *   1. Policy row matching the tenant's active subscription plan
 *      (organization_subscription.status IN ('trialing','active'))
 *   2. The platform-default policy row (subscriptionPlanId IS NULL)
 *   3. Hardcoded PLATFORM_CAPACITY_FALLBACK constants
 *
 * Adoption is opt-in: if NO policy rows exist at all, callers preserve the
 * pre-ADR-031 behavior (INV-014 current) via hasAnyPolicy() === false.
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
   * Resolve the effective policy for a channel. Cross-plugin lookup of the
   * tenant's active subscription uses a raw table query (string-FK pattern —
   * no compile-time coupling to SubscriptionPlugin entities).
   */
  async getEffectivePolicy(
    ctx: RequestContext,
    channelId: string,
  ): Promise<EffectiveCapacityPolicy> {
    const repo = this.connection.getRepository(ctx, BbbPlatformCapacityPolicy);

    // 1. Plan-matched policy — raw query keeps BBB decoupled from the
    //    subscription plugin's entity classes.
    let planPolicy: BbbPlatformCapacityPolicy | null = null;
    try {
      const subRows: Array<{ planId: string }> = await this.connection.rawConnection.query(
        `SELECT "planId" FROM "organization_subscription"
          WHERE "channelId" = $1 AND "status" IN ('trialing', 'active')
          ORDER BY "updatedAt" DESC LIMIT 1`,
        [channelId],
      );
      const planId = subRows[0]?.planId;
      if (planId) {
        planPolicy =
          (await repo.findOne({ where: { subscriptionPlanId: planId } })) ?? null;
      }
    } catch (error) {
      // Table may not exist if the subscription migration hasn't run in an
      // environment — degrade to platform-default instead of failing rooms.
      Logger.warn(
        `Subscription lookup failed, falling back to default policy: ${(error as Error).message}`,
        loggerCtx,
      );
    }
    if (planPolicy) {
      return this.toEffective(planPolicy, "plan");
    }

    // 2. Platform-default row.
    const defaultPolicy = await repo.findOne({ where: { subscriptionPlanId: null as any } });
    if (defaultPolicy) {
      return this.toEffective(defaultPolicy, "platform-default");
    }

    // 3. Hardcoded fallback.
    return { ...PLATFORM_CAPACITY_FALLBACK, source: "fallback" };
  }

  /**
   * Clamp a requested room capacity against policy: defaults from
   * defaultRoomCapacity, ceiling at maxRoomCapacity (ADR-031 room rule).
   */
  resolveRoomCapacity(
    policy: EffectiveCapacityPolicy,
    requested?: number | null,
  ): number {
    const base = requested ?? policy.defaultRoomCapacity;
    return Math.max(1, Math.min(base, policy.maxRoomCapacity));
  }

  /**
   * Write-through denormalization (ADR-031): org.maxParticipantsPerMeeting
   * caches the effective LIMIT (maxRoomCapacity), preserving INV-014's
   * rejection criterion ("room must never exceed the org value at
   * provisioning") while allowing increases up to the policy ceiling.
   */
  async syncOrganizationCache(
    ctx: RequestContext,
    org: BbbOrganization,
    policy: EffectiveCapacityPolicy,
  ): Promise<void> {
    if (org.maxParticipantsPerMeeting === policy.maxRoomCapacity) {
      return;
    }
    org.maxParticipantsPerMeeting = policy.maxRoomCapacity;
    await this.connection.getRepository(ctx, BbbOrganization).save(org);
    Logger.info(
      `Synced org ${org.id} maxParticipantsPerMeeting → ${policy.maxRoomCapacity} (policy source: ${policy.source})`,
      loggerCtx,
    );
  }

  private toEffective(
    entity: BbbPlatformCapacityPolicy,
    source: EffectiveCapacityPolicy["source"],
  ): EffectiveCapacityPolicy {
    return {
      defaultRoomCapacity: entity.defaultRoomCapacity,
      maxRoomCapacity: entity.maxRoomCapacity,
      maxConcurrentParticipants: entity.maxConcurrentParticipants,
      source,
    };
  }
}
