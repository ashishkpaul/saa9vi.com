import type { DeepPartial } from "@vendure/common/lib/shared-types";
import { VendureEntity } from "@vendure/core";
import { Column, Entity, Index } from "typeorm";

export type TenantLearnerStatus =
  | "PENDING"
  | "ACTIVE"
  | "SUSPENDED"
  | "REVOKED"
  | "LEFT"
;

export type TenantLearnerAdmissionType =
  | "REGULAR"
  | "SCHOLARSHIP"
  | "DEMO"
  | "COMPLIMENTARY"
  | "CORPORATE"
  | "OTHER"
;

/**
 * Tenant-specific learner membership record.
 *
 * This is Saa9vi's academy admission record — distinct from Vendure's
 * shared User identity and channel-aware Customer record. A customer may
 * have memberships in multiple tenant channels, each with independent
 * status and activity tracking.
 *
 * Invariant: one membership per (customerId, channelId) pair — enforced by
 * unique index. Status transitions are handled by the admission service,
 * never by direct row mutation.
 *
 * `lastActivityAt` is the tenant-specific activity timestamp. It complements
 * Vendure's global `User.lastLogin` (which is platform-wide, not per-tenant).
 */
@Entity("tenant_learner_membership")
@Index(["customerId", "channelId"], { unique: true })
@Index(["channelId", "status"])
@Index(["customerId"])
export class TenantLearnerMembership extends VendureEntity {
  constructor(input?: DeepPartial<TenantLearnerMembership>) {
    super(input);
  }

  /** Vendure Customer.id — the global identity */
  @Column({ type: "varchar" })
  customerId: string;

  /** Tenant Channel.id — the academy boundary */
  @Column({ type: "varchar" })
  channelId: string;

  /** Membership status within this tenant */
  @Column({ type: "varchar", default: "PENDING" })
  status: TenantLearnerStatus;

  /** How the learner was admitted to this tenant */
  @Column({ type: "varchar", default: "REGULAR" })
  admissionType: TenantLearnerAdmissionType;

  /** Tenant-specific last activity timestamp. Complements User.lastLogin. */
  @Column({ type: "timestamp", nullable: true })
  lastActivityAt: Date | null;

  /** User.id who invited this learner (for invitation-based admission). */
  @Column({ type: "varchar", nullable: true })
  invitedByUserId: string | null;

  /** When the invitation was sent. */
  @Column({ type: "timestamp", nullable: true })
  invitedAt: Date | null;

  /** When the learner accepted/joined (status -> ACTIVE). */
  @Column({ type: "timestamp", nullable: true })
  joinedAt: Date | null;
}
