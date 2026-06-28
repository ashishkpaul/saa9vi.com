import { EventLog } from "./entities/event-log.entity";

export interface ExecutionTrace {
  correlationId: string;
  events: Array<{
    id: string;
    eventType: string;
    source: string;
    timestamp: Date;
    status: string;
    parentEventId?: string;
  }>;
  startedAt: Date;
  endedAt: Date;
  outcome: "success" | "failed" | "partial";
}

export class RuntimeTraceStore {
  // In-memory store for demonstration; production would use EventLog repository.
  private traces: Map<string, EventLog[]> = new Map();
  private store: EventLog[] = [];

  record(log: EventLog): void {
    this.store.push(log);
    const key = log.correlationId;
    const existing = this.traces.get(key) || [];
    existing.push(log);
    this.traces.set(key, existing);
  }

  getTrace(correlationId: string): ExecutionTrace | undefined {
    const events = this.traces.get(correlationId);
    if (!events || events.length === 0) return undefined;

    const sorted = [...events].sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
    const hasFailure = sorted.some(e => e.status === "failed");
    const hasSuccess = sorted.some(e => e.status === "processed");

    let outcome: ExecutionTrace["outcome"] = "success";
    if (hasFailure && !hasSuccess) outcome = "failed";
    else if (hasFailure && hasSuccess) outcome = "partial";

    return {
      correlationId,
      events: sorted.map(e => ({
        id: String(e.id),
        eventType: e.eventType,
        source: e.source,
        timestamp: e.timestamp,
        status: e.status,
        parentEventId: e.parentEventId || undefined,
      })),
      startedAt: sorted[0].timestamp,
      endedAt: sorted[sorted.length - 1].timestamp,
      outcome,
    };
  }

  queryByCorrelation(correlationId: string): EventLog[] {
    return this.store.filter(e => e.correlationId === correlationId);
  }

  queryByParent(parentEventId: string): EventLog[] {
    return this.store.filter(e => e.parentEventId === parentEventId);
  }

  queryByStatus(status: string): EventLog[] {
    return this.store.filter(e => e.status === status);
  }

  clear(): void {
    this.traces.clear();
    this.store = [];
  }
}
