import type { DeepPartial } from "@vendure/common/lib/shared-types";
import { VendureEntity } from "@vendure/core";
import { Column, Entity, Index } from "typeorm";

export type EventLogStatus = "pending" | "processed" | "failed" | "retried";

export enum EventLogSource {
  EVENTBUS = "eventbus",
  BULLMQ = "bullmq",
  WEBHOOK = "webhook",
  CRON = "cron",
  SCHEDULER = "scheduler",
}

@Entity("event_log")
@Index(["correlationId"])
@Index(["parentEventId"])
@Index(["source", "status"])
@Index(["timestamp"])
export class EventLog extends VendureEntity {
  constructor(input?: Partial<EventLog>) {
    super(input);
  }

  @Column({ type: "varchar" })
  eventType: string;

  @Column({ type: "simple-json" })
  payload: any;

  @Column({ type: "varchar" })
  source: EventLogSource;

  @Column({ type: "varchar" })
  correlationId: string;

  @Column({ type: "varchar", nullable: true })
  parentEventId: string | null;

  @Column({ type: "timestamp" })
  timestamp: Date;

  @Column({
    type: "varchar",
    default: "pending",
  })
  status: EventLogStatus;

  @Column({ type: "text", nullable: true })
  errorMessage: string | null;

  @Column({ type: "varchar", nullable: true })
  triggeredBy: string | null;
}
