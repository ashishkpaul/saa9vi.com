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
} as const;

export interface EffectiveCapacityPolicy {
  defaultRoomCapacity: number;
  maxRoomCapacity: number;
  maxConcurrentParticipants: number;
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
          `SELECT "planId" FROM "organization_subscription"
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
