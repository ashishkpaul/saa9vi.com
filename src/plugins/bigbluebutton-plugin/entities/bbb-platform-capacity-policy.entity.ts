import type { DeepPartial } from "@vendure/common/lib/shared-types";
import { VendureEntity } from "@vendure/core";
import { Column, Entity, Index } from "typeorm";

/**
 * Platform-owned BBB capacity policy (ADR-031 / INV-015).
 *
 * Portal Admin controls BBB infrastructure limits; tenants cannot raise room
 * capacity beyond maxRoomCapacity regardless of what their commercial fields
 * say. One row per SubscriptionPlan tier, optional channel override, and an
 * optional platform-default row (subscriptionPlanId IS NULL AND channelId IS NULL).
 */
@Entity("bbb_platform_capacity_policy")
@Index(["channelId"], { unique: true, where: '"channelId" IS NOT NULL' })
@Index(["subscriptionPlanId"], { unique: true, where: '"subscriptionPlanId" IS NOT NULL' })
@Index(["subscriptionPlanId", "channelId"], {
  unique: true,
  where: '"subscriptionPlanId" IS NULL AND "channelId" IS NULL',
})
export class BbbPlatformCapacityPolicy extends VendureEntity {
  constructor(input?: DeepPartial<BbbPlatformCapacityPolicy>) {
    super(input);
  }

  /** Room capacity applied on creation when the tenant doesn't specify one. */
  @Column({ default: 25 })
  defaultRoomCapacity: number;

  /** Hard ceiling — tenant cannot raise BbbRoom.maxParticipants above this. */
  @Column({ default: 100 })
  maxRoomCapacity: number;

  /** Across all rooms for this tenant (advisory today — INV-012). */
  @Column({ default: 250 })
  maxConcurrentParticipants: number;

  /**
   * Simultaneous live rooms (meetings in PROVISIONING or ACTIVE) this tenant
   * may hold at once. Denormalized onto
   * `BbbOrganization.concurrentMeetingLimit`, which remains the single
   * enforcement surface — see ADR-031's 2026-09-25 amendment.
   *
   * This is a *packaging ceiling* (how many at once), not a *consumption
   * allowance* (how much per day) — daily live minutes belong to
   * `BbbCapacityGrant`, never here. The two must not be conflated.
   *
   * Default 5 matches the value every organization received before this
   * column existed, so migrating does not change any tenant's effective
   * limit. Only Free Basic's ceiling of 1 is a frozen product decision;
   * paid-tier numbers remain Admin-set and are deliberately not encoded.
   */
  @Column({ default: 5 })
  maxConcurrentMeetings: number;

  /**
   * String FK to SubscriptionPlan.id (cross-plugin, string-FK pattern).
   * NULL = platform-default policy or channel override.
   */
  @Column({ type: "varchar", nullable: true })
  subscriptionPlanId: string | null;

  /**
   * Optional channel ID for tenant-specific policy overrides.
   * NULL = platform default or plan tier policy.
   */
  @Column({ type: "varchar", nullable: true })
  channelId: string | null;
}

