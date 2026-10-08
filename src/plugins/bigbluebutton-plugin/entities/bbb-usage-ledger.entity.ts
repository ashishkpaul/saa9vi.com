import type { DeepPartial } from "@vendure/common/lib/shared-types";
import { VendureEntity } from "@vendure/core";
import { Column, Entity, ManyToOne, Index } from "typeorm";
import { BbbMeeting } from "./bbb-meeting.entity";
import { BbbCapacityGrant } from "./bbb-capacity-grant.entity";

/**
 * Auditable usage ledger for BBB meeting consumption.
 *
 * Every time a meeting ends, a ledger entry records how many hours were
 * consumed against which capacity grant. This enables:
 *   - Invoicing and billing disputes
 *   - Analytics on per-org usage
 *   - Refund calculations
 *   - Granular reporting
 *
 * The unique constraint on (meeting, grant) prevents duplicate billing entries
 * when webhook events or reconciliation tasks retry idempotently.
 */
@Entity("bbb_usage_ledger")
@Index(["meeting", "grant"], { unique: true })
export class BbbUsageLedger extends VendureEntity {
  constructor(input?: DeepPartial<BbbUsageLedger>) {
    super(input);
  }

  @ManyToOne(() => BbbMeeting, { nullable: false })
  meeting: BbbMeeting;

  @ManyToOne(() => BbbCapacityGrant, { nullable: false })
  grant: BbbCapacityGrant;

  /**
   * Minutes consumed for this meeting.
   *
   * `0` for a meeting below the fair-billing threshold (see
   * `bbb-grant-consumption.service.ts`) — the row still exists so
   * `reconcilePendingBilling` never revisits the meeting — and otherwise
   * rounded UP to a whole minute with a minimum of 1.
   */
  @Column({ type: "int", default: 0 })
  consumedMinutes: number;

  @Column()
  startedAt: Date;

  @Column({ nullable: true })
  completedAt: Date;
}
