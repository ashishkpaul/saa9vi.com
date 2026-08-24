import type { DeepPartial } from "@vendure/common/lib/shared-types";
import { VendureEntity } from "@vendure/core";
import { Column, Entity, Index } from "typeorm";

/**
 * Platform-owned BBB capacity policy (ADR-031).
 *
 * Portal Admin controls BBB infrastructure limits; tenants cannot raise room
 * capacity beyond maxRoomCapacity regardless of what their commercial fields
 * say. One row per SubscriptionPlan tier plus an optional platform-default
 * row (subscriptionPlanId IS NULL).
 *
 * Plan-based tiers (ADR-031 recommended table):
 *   Starter    → default 50 / max 100 / concurrent 500
 *   Growth     → default 200 / max 500 / concurrent 2000
 *   Enterprise → default 500 / max 1000 / concurrent 5000
 * These are DATA (rows created by Portal Admin), not code branches — see
 * PLAN_TIER_DEFAULTS in bbb-platform-capacity-policy.service.ts.
 */
@Entity("bbb_platform_capacity_policy")
@Index(["subscriptionPlanId"], { unique: true })
export class BbbPlatformCapacityPolicy extends VendureEntity {
  constructor(input?: DeepPartial<BbbPlatformCapacityPolicy>) {
    super(input);
  }

  /** Room capacity applied on creation when the tenant doesn't specify one. */
  @Column({ default: 100 })
  defaultRoomCapacity: number;

  /** Hard ceiling — tenant cannot raise BbbRoom.maxParticipants above this. */
  @Column({ default: 500 })
  maxRoomCapacity: number;

  /** Across all rooms for this tenant (advisory today — INV-012). */
  @Column({ default: 1000 })
  maxConcurrentParticipants: number;

  /**
   * String FK to SubscriptionPlan.id (cross-plugin, string-FK pattern).
   * NULL = platform-default policy for tenants without a matching plan.
   */
  @Column({ type: "varchar", nullable: true })
  subscriptionPlanId: string | null;
}
