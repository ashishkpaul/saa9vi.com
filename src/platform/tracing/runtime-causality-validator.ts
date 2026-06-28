import { CheckResult, Checker } from "../invariants/runner";
import { RuntimeTraceStore, ExecutionTrace } from "./runtime-trace-store";

export interface RuntimeCausalityRule {
  name: string;
  description: string;
  expectedChain: string[];
}

export class RuntimeCausalityValidator implements Checker {
  name = "runtime-trace-causality";

  private traceStore: RuntimeTraceStore;

  constructor(traceStore: RuntimeTraceStore) {
    this.traceStore = traceStore;
  }

  async check(): Promise<CheckResult> {
    const traces = this.getAllTraces();
    const rules = this.getRules();
    const violations: string[] = [];

    for (const trace of traces) {
      for (const rule of rules) {
        const result = this.validateRule(trace, rule);
        if (!result.passed) {
          violations.push(`[${trace.correlationId}] ${result.message}`);
        }
      }
    }

    const passed = violations.length === 0;

    return {
      checker: this.name,
      name: "runtime-causality",
      passed,
      severity: "warning",
      message: passed ? "All runtime causality rules verified" : `${violations.length} runtime causality violation(s) found`,
      details: passed
        ? "Execution traces match expected causality chains"
        : violations.join("\n\n"),
    };
  }

  private validateRule(trace: ExecutionTrace, rule: RuntimeCausalityRule): { passed: boolean; message: string } {
    const eventTypes = trace.events.map(e => e.eventType);
    const chainFound = this.findChainInSequence(eventTypes, rule.expectedChain);

    if (!chainFound) {
      return {
        passed: false,
        message: `Missing expected chain ${rule.expectedChain.join(" → ")} in trace ${trace.correlationId}`,
      };
    }

    return { passed: true, message: "" };
  }

  private findChainInSequence(sequence: string[], chain: string[]): boolean {
    if (chain.length === 0) return true;

    let chainIndex = 0;
    for (const event of sequence) {
      if (event === chain[chainIndex]) {
        chainIndex++;
        if (chainIndex === chain.length) return true;
      }
    }

    return false;
  }

  private getAllTraces(): ExecutionTrace[] {
    // In production, this queries the EventLog repository.
    // Here we return the in-memory store contents.
    const result: ExecutionTrace[] = [];
    const allLogs = (this.traceStore as any).store || [];
    const traces = (this.traceStore as any).traces as Map<string, any[]>;

    for (const [correlationId, events] of traces) {
      if (events.length > 0) {
        const trace = (this.traceStore as any).getTrace(correlationId);
        if (trace) result.push(trace);
      }
    }

    return result;
  }

  private getRules(): RuntimeCausalityRule[] {
    return [
      {
        name: "payment-settled-to-order",
        description: "PaymentSettledEvent MUST precede Order creation",
        expectedChain: ["PaymentSettledEvent", "OrderStateTransitionEvent"],
      },
      {
        name: "order-to-entitlement",
        description: "OrderStateTransitionEvent MUST create Entitlement",
        expectedChain: ["OrderStateTransitionEvent", "Entitlement"],
      },
      {
        name: "webhook-persist-before-process",
        description: "BbbWebhookEvent received MUST precede BullMQ processing",
        expectedChain: ["BbbWebhookEvent", "bbb-webhook-processor:started"],
      },
    ];
  }
}
