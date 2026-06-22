// src/plugins/bigbluebutton-plugin/entities/bbb-organization-member.entity.ts
// NEW FILE — M1

import type { DeepPartial } from "@vendure/common/lib/shared-types";
import { VendureEntity } from "@vendure/core";
import { Column, Entity, ManyToOne, Index } from "typeorm";
import { BbbOrganization } from "./bbb-organization.entity";
import { ORG_ROLE } from "../constants";
import type { OrgRole } from "../constants";

/**
 * Links a Vendure Customer (by customerId) to a BbbOrganization with an
 * explicit role. This is the membership boundary for the multi-tenant
 * role-based join flow.
 *
 * Design decisions:
 * - customerId references Vendure's Customer.id (not User.id) so it works
 *   with the shop API context (ctx.activeUserId resolves to Customer in shop ctx).
 * - The unique index on (organizationId, customerId) prevents duplicate membership.
 * - keycloakSub is nullable — populated when Keycloak integration (Phase 1) is added.
 *   Allows the membership system to work today with Vendure-native auth.
 */
@Entity("bbb_organization_member")
@Index(["organization", "customerId"], { unique: true })
export class BbbOrganizationMember extends VendureEntity {
  constructor(input?: DeepPartial<BbbOrganizationMember>) {
    super(input);
  }

  @ManyToOne(() => BbbOrganization, (org) => org.members, { nullable: false })
  organization: BbbOrganization;

  /**
   * Vendure Customer.id — the shop-layer user identity.
   * Resolved from ctx.activeUserId in shop context.
   */
  @Column()
  customerId: string;

  /**
   * Role within this organization.
   * Determines whether join URL is moderator (TRAINER/ORG_ADMIN) or attendee (STUDENT).
   */
  @Column({ type: "varchar" })
  role: OrgRole;

  /**
   * If false, the member cannot join or perform any actions.
   * Use instead of hard-deleting to preserve audit history.
   */
  @Column({ default: true })
  active: boolean;

  /**
   * Optional Keycloak subject claim (`sub`).
   * Populated when Phase 1 (KeycloakAuthenticationStrategy) is implemented.
   * Null = using Vendure-native auth; non-null = Keycloak identity confirmed.
   */
  @Column({ nullable: true })
  keycloakSub: string;
}
