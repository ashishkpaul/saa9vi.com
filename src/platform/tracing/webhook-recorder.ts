import { EventLog, EventLogSource } from "./entities/event-log.entity";
import { CorrelationContext } from "./correlation-context";
import { Injectable } from "@nestjs/common";
import { Repository } from "typeorm";

@Injectable()
export class WebhookRecorder {
  constructor(private readonly eventLogRepo: Repository<EventLog>) {}
  async recordReceived(
    eventType: string,
    payload: Record<string, unknown>,
    triggeredBy?: string,
  ): Promise<void> {
    const correlationId = CorrelationContext.get() || CorrelationContext.generateId();

    const log = new EventLog({
      eventType: `webhook:${eventType}:received`,
      payload,
      source: EventLogSource.WEBHOOK,
      correlationId,
      parentEventId: triggeredBy || null,
      timestamp: new Date(),
      status: "pending",
      triggeredBy: triggeredBy || null,
    });

    this.persist(log);
  }

  async recordProcessed(
    eventId: string,
    result: "success" | "failed",
    error?: string,
  ): Promise<void> {
    const log = new EventLog({
      eventType: `webhook:${eventId}:${result}`,
      payload: { result, error },
      source: EventLogSource.WEBHOOK,
      correlationId: CorrelationContext.get() || "",
      parentEventId: eventId,
      timestamp: new Date(),
      status: result === "success" ? "processed" : "failed",
      errorMessage: error || null,
    });

    this.persist(log);
  }

  private async persist(log: EventLog): Promise<void> {
    try {
      await this.eventLogRepo.save(log);
    } catch (err) {
      // Non-fatal: tracing must not break production flows
      console.warn("[WebhookRecorder] Failed to persist event log:", err);
    }
  }
}
