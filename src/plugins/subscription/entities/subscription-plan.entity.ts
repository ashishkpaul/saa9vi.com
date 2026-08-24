import type { DeepPartial } from "@vendure/common/lib/shared-types";
import { VendureEntity } from "@vendure/core";
import { Column, Entity } from "typeorm";

/**
 * Platform-global catalogue of tenant SaaS tiers (Starter / Growth / Enterprise).
 *
 * Deliberately NOT channel-scoped: plans are defined once by Portal Admin and
 * subscribed to by many tenants. Per-tenant subscription state lives in
 * OrganizationSubscription (channel-scoped per INV-001).
 *
 * Capacity limits are NOT stored here — they live in BbbPlatformCapacityPolicy,
 * which references this entity via subscriptionPlanId (ADR-031).
 *
 * Design sources: legacy ADR §AC-004 (field set) reconciled with RFC-001 §2.2
 * billing mechanics. Note: this is the *tenant-tier* plan, not RFC-001's
 * student-facing membership plan (SubscriptionEnrollment stream).
 */
@Entity("subscription_plan")
export class SubscriptionPlan extends VendureEntity {
  constructor(input?: DeepPartial<SubscriptionPlan>) {
    super(input);
  }

  /** e.g. 'Starter' | 'Growth' | 'Enterprise' */
  @Column()
  name: string;

  /** Unique catalogue identifier, e.g. 'starter-monthly' */
  @Column({ unique: true })
  slug: string;

  @Column({ nullable: true })
  description: string;

  /** Monthly price in paise (integer avoids float rounding). */
  @Column({ default: 0 })
  monthlyPriceInPaise: number;

  /** BBB meeting minutes included per billing period. */
  @Column({ default: 600 })
  includedBbbMinutes: number;

  /** Max students the academy may enroll (SaaS-tier feature). */
  @Column({ default: 100 })
  maxStudents: number;

  /** Custom-domain feature flag for this tier. */
  @Column({ default: false })
  customDomainEnabled: boolean;

  /** White-label theming feature flag (Phase 4 TenantProfile.theme gate). */
  @Column({ default: false })
  whitelabelEnabled: boolean;

  @Column({ default: true })
  isActive: boolean;

  @Column({ default: 0 })
  sortOrder: number;
}
