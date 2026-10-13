import type { DeepPartial } from "@vendure/common/lib/shared-types";
import { VendureEntity } from "@vendure/core";
import { Column, Entity, Index } from "typeorm";

export type WebhookEventStatus = "PENDING" | "PROCESSED" | "FAILED" | "PARSE_FAILED";

/**
 * Persisted BBB webhook event — written before any processing.
 *
 * Enables replay, audit, and recovery:
 *   POST /bbb/webhook/:serverId → verify auth → persist → enqueue → return 200
 *   BullMQ worker → load by ID → process → update status
 *
 * Failed events are never auto-deleted, enabling manual replay from admin.
 *
 * Deduplication: `dedupeKey = sha256(serverId + rawBodyText)`. BBB retries
 * send identical bodies, so body-hash is a stable idempotency key.
 * The UNIQUE index on `dedupeKey` allows INSERT…ON CONFLICT callers to detect
 * duplicates without a prior SELECT.
 *
 * W3 changes (2026-10-07):
 *   - `rawBody`   — exact bytes received; used for replay and parse-failure audit
 *   - `dedupeKey` — sha256(serverId + rawBody), uniquely indexed
 *   - `serverId`  — which BbbServer received this event
 *   - Status `PARSE_FAILED` — auth passed but URLSearchParams failed;
 *     body is kept, hook is not killed (return 200 to BBB)
 */
@Entity("bbb_webhook_event")
export class BbbWebhookEvent extends VendureEntity {
  constructor(input?: DeepPartial<BbbWebhookEvent>) {
    super(input);
  }

  // ─── Server context ────────────────────────────────────────────────────

  /**
   * Which BbbServer delivered this event (from route param :serverId).
   * Nullable for legacy events persisted by the pre-W3 bare-path controller.
   */
  @Column({ type: "varchar", nullable: true })
  serverId: string | null;

  // ─── Raw wire data ─────────────────────────────────────────────────────

  /**
   * Exact body bytes BBB sent (`application/x-www-form-urlencoded`).
   * Stored as text (UTF-8). Used for replay, parse-failure audit, and
   * deduplication (dedupeKey is derived from this).
   * Capped at ~1 MB at the route middleware level.
   */
  @Column({ type: "text", nullable: true })
  rawBody: string | null;

  // ─── Deduplication ────────────────────────────────────────────────────

  /**
   * sha256(serverId + rawBody).
   * Null for pre-W3 rows. New rows always have this set.
   * The UNIQUE index lets a re-delivered identical body be detected cheaply;
   * the controller checks for existing rows before persisting.
   */
  @Index({ unique: true, where: '"dedupeKey" IS NOT NULL' })
  @Column({ type: "varchar", nullable: true })
  dedupeKey: string | null;

  // ─── Parsed fields ─────────────────────────────────────────────────────

  @Column({ type: "varchar", nullable: true })
  eventType: string | null;

  @Column({ type: "simple-json", nullable: true })
  payload: Record<string, unknown> | null;

  @Column()
  receivedAt: Date;

  @Column({ type: "varchar", default: "PENDING" })
  status: WebhookEventStatus;

  @Column({ type: "timestamp", nullable: true })
  processedAt: Date | null;

  @Column({ type: "text", nullable: true })
  errorMessage: string | null;

  /** Fast replay lookup by meeting ID — populated on extraction */
  @Index()
  @Column({ type: "varchar", nullable: true })
  bbbMeetingId: string | null;
}
