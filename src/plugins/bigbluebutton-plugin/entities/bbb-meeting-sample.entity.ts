import type { DeepPartial } from "@vendure/common/lib/shared-types";
import { VendureEntity } from "@vendure/core";
import { Column, Entity, Index } from "typeorm";

/**
 * A single per-minute observation of a live metered meeting (ADR-047).
 *
 * **Operational, not a billing fact.** This table exists only to compute the
 * learner-minutes that are later frozen into `BbbMeteredUsage`, so it is safe to
 * prune (≈35 days). INV-028 makes `BbbMeteredUsage` — never this table — the
 * billing truth.
 *
 * Idempotency (INV-002): the unique constraint is what makes the sampler's
 * `INSERT … ON CONFLICT DO NOTHING` correct. One row per meeting per minute, so
 * a retried or overlapping tick cannot double-count minutes.
 */
@Entity("bbb_meeting_sample")
@Index(["meetingId", "bucketMinute"], { unique: true })
export class BbbMeetingSample extends VendureEntity {
  constructor(input?: DeepPartial<BbbMeetingSample>) {
    super(input);
  }

  @Column()
  meetingId: string;

  /** The minute this sample represents — timestamp truncated to the minute. */
  @Column({ type: "timestamp" })
  bucketMinute: Date;

  /** `max(0, participantCount − moderatorCount)` at sample time (D1). */
  @Column({ type: "int", default: 0 })
  learnerCount: number;

  /** Raw moderator count observed — trainers are never billable (D1/D9). */
  @Column({ type: "int", default: 0 })
  moderatorCount: number;
}
