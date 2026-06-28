import { CausalityGraphStore } from "./graph-store";
import type { CausalityNode, CausalityEdge } from "./entities/causality-node.entity";
import { EventLog } from "../tracing/entities/event-log.entity";

export class TraceReconstructionService {
  private graphStore: CausalityGraphStore;

  constructor(graphStore: CausalityGraphStore) {
    this.graphStore = graphStore;
  }

  reconstructFromEventLogs(eventLogs: EventLog[]): void {
    const nodesByCorrelation = new Map<string, CausalityNode[]>();

    for (const log of eventLogs) {
      const node: CausalityNode = {
        id: String(log.id),
        type: "event",
        name: log.eventType,
        layer: "runtime",
        properties: {
          source: log.source,
          status: log.status,
          errorMessage: log.errorMessage,
          triggeredBy: log.triggeredBy,
        },
        timestamp: log.timestamp,
        correlationId: log.correlationId,
      };

      this.graphStore.addNode(node);

      const list = nodesByCorrelation.get(log.correlationId) || [];
      list.push(node);
      nodesByCorrelation.set(log.correlationId, list);

      if (log.parentEventId) {
        const edge: CausalityEdge = {
          id: `${log.parentEventId}-${log.id}`,
          source: log.parentEventId,
          target: String(log.id),
          type: "triggers",
          layer: "runtime",
          properties: {},
        };
        this.graphStore.addEdge(edge);
      }
    }

    for (const [, nodes] of nodesByCorrelation) {
      const sorted = nodes.sort((a, b) => (a.timestamp?.getTime() || 0) - (b.timestamp?.getTime() || 0));
      for (let i = 0; i < sorted.length - 1; i++) {
        const edge: CausalityEdge = {
          id: `seq-${sorted[i].id}-${sorted[i + 1].id}`,
          source: sorted[i].id,
          target: sorted[i + 1].id,
          type: "precedes",
          layer: "runtime",
          properties: { order: i },
        };
        this.graphStore.addEdge(edge);
      }
    }
  }
}
