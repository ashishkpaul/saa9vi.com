import { EventBus, VendureEvent } from "@vendure/core";
import { EventLog, EventLogSource } from "./entities/event-log.entity";
import { CorrelationContext } from "./correlation-context";

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
      // Non-fatal: tracing must not break production flows
    }
  }
}
