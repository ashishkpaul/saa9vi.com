import type { DeepPartial } from "@vendure/common/lib/shared-types";
import { VendureEntity } from "@vendure/core";
import { Column, Entity, Index } from "typeorm";

export type CustomerStatus = "Active" | "Suspended";

/**
 * Channel-scoped customer status for tenant-level suspension.
 *
 * A customer can be Active or Suspended per academy (channel).
 * This enables academy admins to suspend problematic customers
 * without affecting their access to other academies.
 *
 * INV-014: Customer suspension at channel level is independent of
 * platform-wide suspension. Both are checked at checkout.
 */
@Entity("customer_channel_status")
@Index(["customerId", "channelId"], { unique: true })
export class CustomerChannelStatus extends VendureEntity {
  constructor(input?: DeepPartial<CustomerChannelStatus>) {
    super(input);
  }

  /** The Customer.id being suspended/reinstated */
  @Column({ type: "varchar" })
  customerId: string;

  /** The Channel.id (academy) where this status applies */
  @Column({ type: "varchar" })
  channelId: string;

  /** Current status: Active or Suspended */
  @Column({ type: "varchar" })
  status: CustomerStatus;

  /** Optional reason for suspension (for audit trail) */
  @Column({ type: "text", nullable: true })
  reason: string | null;
}
