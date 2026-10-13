import { EventBus, VendureEvent } from "@vendure/core";
import { Logger } from "@nestjs/common";
import { EventLog, EventLogSource } from "./entities/event-log.entity";
import { CorrelationContext } from "./correlation-context";

const loggerCtx = "EventBusInterceptor";

/**
 * Failure visibility for the event-log write path (production-readiness
 * review, medium item): `recordEvent` must never break the production flow,
 * but a silently swallowed error means a broken `event_log` table is
 * indistinguishable from a quiet one. Failures are now counted and logged —
 * the first failure immediately, then at most once per minute so a
 * sustained outage cannot flood the log.
 */
let recordEventFailures = 0;
let lastFailureLogAt = 0;
const FAILURE_LOG_THROTTLE_MS = 60_000;

/** Observed `recordEvent` failures since process start (metrics/health probes). */
export function getRecordEventFailureCount(): number {
  return recordEventFailures;
}

function logFailure(err: unknown): void {
  recordEventFailures++;
  const now = Date.now();
  if (
    recordEventFailures === 1 ||
    now - lastFailureLogAt >= FAILURE_LOG_THROTTLE_MS
  ) {
    lastFailureLogAt = now;
    Logger.error(
      `EventLog persist failed (${recordEventFailures} total): ${
        err instanceof Error ? err.message : String(err)
      }`,
      loggerCtx,
    );
  }
}

export class EventBusInterceptor {
  constructor(private eventBus: EventBus, private connection: any) {}

  intercept(): void {
    const originalPublish = this.eventBus.publish.bind(this.eventBus);

    this.eventBus.publish = (event: VendureEvent) => {
      const correlationId = CorrelationContext.get();
      if (!correlationId) {
        CorrelationContext.set(CorrelationContext.generateId());
      }

      this.recordEvent(
        event.constructor.name,
        { event },
        EventLogSource.EVENTBUS,
      );

      return originalPublish(event);
    };
  }

  private async recordEvent(
    eventType: string,
    payload: Record<string, unknown>,
    source: EventLogSource,
    parentEventId?: string,
  ): Promise<void> {
    try {
      const log = new EventLog({
        eventType,
        payload,
        source,
        correlationId: CorrelationContext.get() || CorrelationContext.generateId(),
        parentEventId: parentEventId || null,
        timestamp: new Date(),
        status: "pending",
      });

      await this.connection.rawConnection.getRepository(EventLog).save(log);
      log.status = "processed";
      await this.connection.rawConnection.getRepository(EventLog).update(log.id, { status: "processed" });
    } catch (err) {
      // Non-fatal: tracing must not break production flows — but it must be
      // observable. Counted + throttled log (never rethrown).
      logFailure(err);
    }
  }
}
