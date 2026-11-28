import type { DeepPartial } from "@vendure/common/lib/shared-types";
import { VendureEntity, Channel, ChannelAware } from "@vendure/core";
import { Column, Entity, Index, JoinTable, ManyToMany } from "typeorm";

/**
 * Maps a validated Keycloak identity (issuer + subject) to a Vendure
 * customer/administrator within a single tenant channel.
 *
 * This entity is the data-model foundation for PR 2 (tenant/moderator
 * identity ownership). It stores the Keycloak `iss` + `sub` pair that
 * will be validated during Keycloak provisioning (PR 4); PR 2 itself
 * does not perform any Keycloak user provisioning.
 *
 * Design decisions (INV-001 / DL-010 scalar-channelId pattern):
 * - One Keycloak identity maps to exactly one tenant channel (scalar
 *   channelId, not ChannelAware join table — the identity is owned by
 *   one tenant only).
 * - Unique index on (issuer, subject) enforces the person-one-tenant
 *   rule: a single Keycloak subject cannot be mapped to multiple
 *   tenants.
 * - customerId / administratorId are nullable because PR 2 establishes
 *   the table shape; the actual linking to a Vendure customer or
 *   administrator happens in PR 4 (Keycloak provisioning).
 */
@Entity("keycloak_identity")
@Index(["issuer", "subject"], { unique: true })
export class KeycloakIdentity extends VendureEntity implements ChannelAware {
  constructor(input?: DeepPartial<KeycloakIdentity>) {
    super(input);
  }

  @ManyToMany(() => Channel)
  @JoinTable()
  channels: Channel[];

  /** Tenant Channel.id — the academy boundary (INV-001). May be null at
   * first Keycloak login if the channel is not yet known; it is populated
   * once the Administrator is associated with a tenant channel. */
  @Column({ type: "varchar", nullable: true })
  channelId: string | null;

  /** Keycloak issuer URL (the `iss` claim). */
  @Column({ type: "varchar" })
  issuer: string;

  /** Keycloak subject claim (the `sub` claim). */
  @Column({ type: "varchar" })
  subject: string;

  /** Optional link to a Vendure Customer. Populated in PR 4. */
  @Column({ nullable: true })
  customerId: string | null;

  /** Optional link to a Vendure Administrator. Populated in PR 4. */
  @Column({ nullable: true })
  administratorId: string | null;
}
