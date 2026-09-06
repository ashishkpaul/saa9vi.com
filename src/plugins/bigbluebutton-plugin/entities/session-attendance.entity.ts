import type { DeepPartial } from "@vendure/common/lib/shared-types";
import { VendureEntity } from "@vendure/core";
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  UpdateDateColumn,
} from "typeorm";

export type SessionAttendanceStatus = "PRESENT" | "PARTIAL" | "NO_SHOW";
export type SessionAttendanceSource = "WEBHOOK" | "MANUAL_CORRECTION";

/**
 * Derived, recomputable attendance fact — one row per student per session.
 *
 * Layer contract (docs/implementation/phase3-attendance.md §2):
 *   BbbWebhookEvent (immutable raw evidence)
 *        ↓
 *   SessionAttendance (this entity — derived, correctable)
 *
 * Unlike CommissionLedger/AdWalletLedger this is NOT append-only:
 * late/updated BBB events legitimately recompute the derived fact.
 * Immutability lives in the raw webhook event layer.
 *
 * Identity: UNIQUE (scheduledSessionId, customerId, channelId).
 * channelId is derived server-side from BbbScheduledSession.channelId —
 * never accepted from client input (Channel=Tenant invariant).
 */
@Entity("session_attendance")
@Index(["scheduledSessionId", "customerId", "channelId"], { unique: true })
@Index(["channelId", "scheduledSessionId"])
export class SessionAttendance extends VendureEntity {
  constructor(input?: DeepPartial<SessionAttendance>) {
    super(input);
  }

  /** Tenant scope — always mirrored from the linked session's channelId. */
  @Index()
  @Column("varchar")
  channelId: string;

  @Column("varchar")
  scheduledSessionId: string;

  @Column({ type: "varchar", nullable: true })
  meetingId: string | null;

  /** Vendure Customer.id of the student. */
  @Index()
  @Column("varchar")
  customerId: string;

  /** First observed join (nullable: NO_SHOW rows have no join). */
  @Column({ type: "timestamp", nullable: true })
  joinedAt: Date | null;

  /** Last observed leave (null while live / unknown). */
  @Column({ type: "timestamp", nullable: true })
  leftAt: Date | null;

  /** Sum of all join/leave cycle durations. */
  @Column({ type: "int", default: 0 })
  totalDurationSeconds: number;

  /** Number of join/leave cycles (v1 snapshot aggregation yields 1). */
  @Column({ type: "int", default: 0 })
  cyclesCount: number;

  @Column({ type: "varchar", default: "PRESENT" })
  attendanceStatus: SessionAttendanceStatus;

  /** Late provider events must NOT masquerade as manual corrections. */
  @Column({ type: "varchar", default: "WEBHOOK" })
  source: SessionAttendanceSource;

  /** When the last recompute of this row occurred. */
  @Column({ type: "timestamp", nullable: true })
  lastEventAt: Date | null;

  /**
   * Raw-event processing watermark: id of the last BbbWebhookEvent
   * folded into this row. Replay/reprocessing compares against this
   * to avoid double-counting non-idempotent event payloads.
   */
  @Column({ type: "varchar", nullable: true })
  lastProcessedWebhookEventId: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
