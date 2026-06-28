import type { DeepPartial } from "@vendure/common/lib/shared-types";
import { VendureEntity } from "@vendure/core";
import { Column, Entity, Index } from "typeorm";

/**
 * Internal staff membership for an organization.
 *
 * This is the FEAT-001 entity that enables Archetype B (Internal Staff Meeting
 * flow). Staff members with an active membership can join internal rooms
 * (productVariantId = null) without purchasing a plan.
 *
 * Design decisions (DL-017 pattern):
 * - Uses scalar organizationId and channelId — no ManyToOne joins or ChannelAware
 *   junction table. This keeps the entity lightweight and avoids circular FK
 *   constraints with BbbOrganization.
 * - Roles are separate from BbbOrganizationMember (which is for org-admins/trainers).
 *   This membership targets internal staff access with different role semantics:
 *   org_admin / moderator → receives MODERATOR join URL
 *   staff → receives VIEWER join URL
 * - unique index on (organizationId, customerId) prevents duplicate membership.
 */
@Entity("bbb_organization_membership")
@Index(["organizationId", "customerId"], { unique: true })
export class BbbOrganizationMembership extends VendureEntity {
  constructor(input?: DeepPartial<BbbOrganizationMembership>) {
    super(input);
  }

  @Column({ type: "varchar" })
  organizationId: string;

  @Column({ type: "varchar" })
  customerId: string;

  /** Scalar channelId for channel isolation (DL-017 pattern) */
  @Column({ type: "varchar" })
  channelId: string;

  @Column({
    type: "simple-enum",
    enum: ["org_admin", "moderator", "staff"],
  })
  role: "org_admin" | "moderator" | "staff";

  @Column({ default: true })
  isActive: boolean;
}
