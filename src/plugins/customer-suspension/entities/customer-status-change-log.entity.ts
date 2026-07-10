import type { DeepPartial } from "@vendure/common/lib/shared-types";
import { VendureEntity } from "@vendure/core";
import { Column, Entity, Index } from "typeorm";

export type StatusScope = "platform" | "channel";

/**
 * Append-only audit log for customer status changes.
 *
 * Mirrors the CustomerDeletionLog pattern (INV-004): the status change
 * is persisted before any processing begins, enabling replay and audit.
 *
 * INV-014: Customer suspension at channel level is independent of
 * platform-wide suspension. Both use this same log entity with different scopes.
 */
@Entity("customer_status_change_log")
@Index(["customerId"])
@Index(["scope"])
export class CustomerStatusChangeLog extends VendureEntity {
  constructor(input?: DeepPartial<CustomerStatusChangeLog>) {
    super(input);
  }

  /** The Customer.id being suspended/reinstated */
  @Column({ type: "varchar" })
  customerId: string;

  /**
   * The channel for channel-scoped changes (null for platform-wide).
   * When set, this is a channel-level status change.
   */
  @Column({ type: "varchar", nullable: true })
  channelId: string | null;

  /** Scope of this status change: 'platform' or 'channel' */
  @Column({ type: "varchar" })
  scope: StatusScope;

  /** Previous status value */
  @Column({ type: "varchar" })
  previousStatus: string;

  /** New status value */
  @Column({ type: "varchar" })
  newStatus: string;

  /** Reason for the status change (optional) */
  @Column({ type: "text", nullable: true })
  reason: string | null;

  /** Administrator who initiated the change */
  @Column({ type: "varchar", nullable: true })
  changedByAdministratorId: string | null;

  /** When the change was made */
  @Column({ type: "timestamp with time zone", nullable: true })
  changedAt: Date | null;
}
