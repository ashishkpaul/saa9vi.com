export type CausalityNodeType = "event" | "action" | "entity" | "rule";
export type CausalityEdgeType = "triggers" | "precedes" | "follows" | "produces" | "consumes";

export interface CausalityNode {
  id: string;
  type: CausalityNodeType;
  name: string;
  layer: "static" | "inferred" | "runtime";
  properties: Record<string, unknown>;
  timestamp?: Date;
  correlationId?: string;
}

export interface CausalityEdge {
  id: string;
  source: string;
  target: string;
  type: CausalityEdgeType;
  layer: "static" | "inferred" | "runtime";
  properties: Record<string, unknown>;
}
