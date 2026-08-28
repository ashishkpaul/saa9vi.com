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

