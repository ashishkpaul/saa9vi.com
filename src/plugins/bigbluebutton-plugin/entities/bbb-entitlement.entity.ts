import type { DeepPartial } from "@vendure/common/lib/shared-types";
import { VendureEntity } from "@vendure/core";
import { Column, Entity, Index } from "typeorm";

export type EntitlementType = "bbb_session" | "bbb_room";
export type EntitlementSource = "purchase" | "trial" | "admin" | "import";

/**
 * Grant of access to a specific resource.
 *
 * This is the ADR-targeted access primitive. It replaces the role of
 * BbbEnrollment for session-scoped access and will eventually subsume
 * room-scoped access as well.
 *
 * Current scope (Phase 1.5):
 * - "bbb_session": access to a specific BbbScheduledSession
 * - "bbb_room": (future) room access, currently still handled by BbbEnrollment
 *
 * Key design decision: Entitlement is *not* ChannelAware. It carries
 * a scalar channelId for channel isolation without the complexity of
 * Vendure's Channel junction table.
 */
@Entity("bbb_entitlement")
@Index(["customerId", "type", "resourceId"])
@Index(["resourceId", "type"])
@Index(["channelId"])
export class BbbEntitlement extends VendureEntity {
  constructor(input?: DeepPartial<BbbEntitlement>) {
    super(input);
  }

  /** The type of resource this entitlement grants access to */
  @Column({ type: "varchar" })
  type: EntitlementType;

  /** The ID of the specific resource (e.g. BbbScheduledSession.id) */
  @Column({ type: "varchar" })
  resourceId: string;

  /** Vendure Customer.id who is granted access */
  @Index()
  @Column({ type: "varchar" })
  customerId: string;

  /** How the entitlement was created — for audit and filtering */
  @Column({ type: "varchar", default: "purchase" })
  source: EntitlementSource;

  /** Optional: when access begins. null = immediate */
  @Column({ type: "timestamp", nullable: true })
  validFrom: Date | null;

  /** Optional: when access expires. null = no expiration */
  @Column({ type: "timestamp", nullable: true })
  validUntil: Date | null;

  /** Channel isolation — scalar FK to Channel.id (not junction table) */
  @Column({ type: "varchar", nullable: true })
  channelId: string | null;
}