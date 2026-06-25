import type { DeepPartial } from "@vendure/common/lib/shared-types";
import { VendureEntity } from "@vendure/core";
import { Column, Entity, Index } from "typeorm";

export type WebhookEventStatus = "PENDING" | "PROCESSED" | "FAILED";

/**
 * Persisted BBB webhook event — written before any processing.
 *
 * Enables replay, audit, and recovery:
 *   POST /bbb/webhook → validate HMAC → persist → enqueue → return
 *   BullMQ worker → load by ID → process → update status
 *
 * Failed events are never auto-deleted, enabling manual replay from admin.
 */
@Entity("bbb_webhook_event")
export class BbbWebhookEvent extends VendureEntity {
  constructor(input?: DeepPartial<BbbWebhookEvent>) {
    super(input);
  }

  @Column({ type: "varchar" })
  eventType: string;

  @Column({ type: "simple-json" })
  payload: Record<string, unknown>;

  @Column({ type: "timestamp with time zone" })
  receivedAt: Date;

  @Column({ type: "varchar", default: "PENDING" })
  status: WebhookEventStatus;

  @Column({ type: "timestamp with time zone", nullable: true })
  processedAt: Date | null;

  @Column({ type: "text", nullable: true })
  errorMessage: string | null;

  /** Fast replay lookup by meeting ID — populated on extraction */
  @Index()
  @Column({ type: "varchar", nullable: true })
  bbbMeetingId: string | null;
}
