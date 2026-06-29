import { EventLog, EventLogSource } from "./entities/event-log.entity";
import { CorrelationContext } from "./correlation-context";
import { Injectable } from "@nestjs/common";
import { TransactionalConnection } from "@vendure/core";

@Injectable()
export class BullMQTracer {
  constructor(private readonly connection: TransactionalConnection) {}

  private async persistLog(log: EventLog): Promise<void> {
    try {
      await this.connection.rawConnection.getRepository(EventLog).save(log);
    } catch (err) {
      // Non-fatal — tracing must never break production flows
      console.warn("[BullMQTracer] Failed to persist event log:", err);
    }
  }
  async traceJob<T>(
    jobName: string,
    jobId: string,
    fn: () => Promise<T>,
  ): Promise<T> {
    const parentEventId = CorrelationContext.get();
    const correlationId = CorrelationContext.generateId();

    CorrelationContext.set(correlationId);

    const startLog = new EventLog({
      eventType: `${jobName}:started`,
      payload: { jobId, jobName },
      source: EventLogSource.BULLMQ,
      correlationId,
      parentEventId: parentEventId ? String(parentEventId) : undefined,
      timestamp: new Date(),
      status: "pending",
    });

    try {
      // Persist start (non-blocking, best-effort)
      void this.persistLog(startLog);

      const result = await fn();

      const successLog = new EventLog({
        eventType: `${jobName}:completed`,
        payload: { jobId, jobName, result: this.sanitize(result) },
        source: EventLogSource.BULLMQ,
        correlationId,
        parentEventId: startLog.id ? String(startLog.id) : undefined,
        timestamp: new Date(),
        status: "processed",
      });

      void this.persistLog(successLog);

      return result;
    } catch (err) {
      const errorLog = new EventLog({
        eventType: `${jobName}:failed`,
        payload: {
          jobId,
          jobName,
          error: err instanceof Error ? err.message : String(err),
        },
        source: EventLogSource.BULLMQ,
        correlationId,
        parentEventId: startLog.id ? String(startLog.id) : undefined,
        timestamp: new Date(),
        status: "failed",
        errorMessage: err instanceof Error ? err.message : String(err),
      });

      void this.persistLog(errorLog);

      throw err;
    } finally {
      CorrelationContext.pop();
    }
  }


  private sanitize(value: unknown): unknown {
    if (value instanceof Date) return value.toISOString();
    if (typeof value === "function") return "[function]";
    return value;
  }
}
