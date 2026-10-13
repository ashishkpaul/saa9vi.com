import type { DeepPartial } from "@vendure/common/lib/shared-types";
import { VendureEntity } from "@vendure/core";
import { Column, Entity, Index } from "typeorm";

/**
 * Append-only metered billing fact (ADR-047 / INV-028).
 *
 * One row per completed meeting of a `metered` organization, written with
 * `INSERT … ON CONFLICT (meetingId) DO NOTHING RETURNING id` — never a
 * check-then-insert — so webhook retries and the metered recovery scan cannot
 * double-bill (INV-002). Billing facts are never UPDATEd or DELETEd.
 *
 * Deliberately has **no money column** (D2): `learnerMinutes` and
 * `ratePaisePerHour` are stored exactly, and the paise amount is computed once
 * per month by the single pure helper
 * `services/metered-billing.policy.ts#computeMonthChargePaise`, so per-meeting
 * rounding cannot drift from the monthly total.
 *
 * A row is written even when the charge is zero (fair-billing threshold not met,
 * no learners, trainer-only time): the row proves the meeting was accounted for
 * and it terminates recovery scans (A14).
 */
@Entity("bbb_metered_usage")
@Index(["channelId", "completedAt"])
export class BbbMeteredUsage extends VendureEntity {
  constructor(input?: DeepPartial<BbbMeteredUsage>) {
    super(input);
  }

  /** One row per meeting — the idempotency key of the metered path. */
  @Index({ unique: true })
  @Column()
  meetingId: string;

  @Column()
  organizationId: string;

  /** Tenant scope, denormalized from the organization (INV-001). */
  @Column()
  channelId: string;

  /** null for legacy / room-less meetings (D5 keeps roomId nullable). */
  @Column({ type: "varchar", nullable: true })
  roomId: string | null;

  @Column()
  startedAt: Date;

  @Column()
  completedAt: Date;

  /** Σ learnerCount over the meeting's per-minute samples. Integer, never a float. */
  @Column({ type: "int", default: 0 })
  learnerMinutes: number;

  @Column({ type: "int", default: 0 })
  peakLearners: number;

  @Column({ type: "int", default: 0 })
  peakModerators: number;

  /** Rate snapshot at completion, in paise per learner-hour (ADR-047 decision 3). */
  @Column({ type: "int", default: 0 })
  ratePaisePerHour: number;

  /**
   * `YYYY-MM` of `completedAt`, snapshotted at write time so monthly queries need
   * no timezone arithmetic (D4).
   */
  @Column({ type: "char", length: 7 })
  periodMonth: string;

  /** True when reconciliation force-completed the meeting at maxMeetingDurationMs. */
  @Column({ default: false })
  billingCapped: boolean;
}
