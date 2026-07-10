import type { DeepPartial } from "@vendure/common/lib/shared-types";
import { VendureEntity } from "@vendure/core";
import { Column, Entity, Index } from "typeorm";

export type DeletionType = "leave_channel" | "full_delete";
export type DeletionStatus = "PENDING" | "COMPLETED" | "FAILED";

/**
 * Append-only audit log for customer deletion requests.
 *
 * Mirrors the BbbWebhookEvent pattern (INV-004): the deletion request is
 * persisted before any processing begins, enabling replay and audit.
 *
 * INV-013: Customer deletion is always anonymization, never cascade delete.
 * This log is the authoritative record of what was deleted and when.
 */
@Entity("customer_deletion_log")
@Index(["customerId"])
@Index(["status"])
export class CustomerDeletionLog extends VendureEntity {
  constructor(input?: DeepPartial<CustomerDeletionLog>) {
    super(input);
  }

  /** The Customer.id being deleted */
  @Column({ type: "varchar" })
  customerId: string;

  /**
   * The channel being left (null for full platform deletion).
   * When set, only channel-scoped data is anonymized.
   */
  @Column({ type: "varchar", nullable: true })
  channelId: string | null;

  /** Whether this is a channel-scoped leave or full platform deletion */
  @Column({ type: "varchar" })
  deletionType: DeletionType;

  /** When the deletion was requested */
  @Column({ type: "timestamp with time zone" })
  requestedAt: Date;

  /** When processing completed */
  @Column({ type: "timestamp with time zone", nullable: true })
  processedAt: Date | null;

  /** Current processing status */
  @Column({ type: "varchar", default: "PENDING" })
  status: DeletionStatus;

  /** Error message if processing failed */
  @Column({ type: "text", nullable: true })
  errorMessage: string | null;
}
