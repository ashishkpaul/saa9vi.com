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

    // Honest no-data outcome (fixes the vacuous-pass defect): a fresh,
    // empty in-memory store previously produced "All runtime causality rules
    // verified" because the rule loop below never executed. Zero inspected
    // traces means causality was NOT verified — reported as an explicit
    // warning-level failure so it lands in the warnings bucket of
    // InvariantRunner.report() and can never be counted as a verified pass.
    if (traces.length === 0) {
      return {
        checker: this.name,
        name: "runtime-causality",
        passed: false,
        severity: "warning",
        message:
          "No runtime traces available — causality NOT verified (0 traces inspected)",
        details:
          "The RuntimeTraceStore is empty, so no causality chain was checked. " +
          "This is a no-data result, not a verification. Runtime traces must be " +
          "recorded (EventLog-backed writers) before this checker can pass.",
      };
    }

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
      message: passed
        ? `All runtime causality rules verified across ${traces.length} trace(s), ${rules.length} rule(s)`
        : `${violations.length} runtime causality violation(s) found`,
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
    // Public store API (no private-field access); empty store ⇒ [] and the
    // caller reports an explicit no-data result.
    return this.traceStore.getAllTraces();
  }

  private getRules(): RuntimeCausalityRule[] {
    // Rule audit (2026-10-20, execution-plan Phase 2):
    // - The former "order-to-entitlement" rule asserted an eventType literal
    //   "Entitlement", which no code path in this repository publishes (the
    //   order-fulfillment listener creates BbbEntitlement rows without an
    //   EventBus event). An unverifiable rule would report a violation for
    //   every real trace, so it was removed rather than kept as fiction.
    // - The former "webhook-persist-before-process" rule asserted eventType
    //   names ("BbbWebhookEvent", "bbb-webhook-processor:started") that only
    //   the unwired WebhookRecorder/BullMQTracer scaffolding would emit; no
    //   live writer records them (Phase 3 evaluates that scaffolding). Removed
    //   for the same honesty reason.
    // Only rules whose event names are actually published (Vendure core's
    // PaymentSettledEvent / OrderStateTransitionEvent) remain.
    return [
      {
        name: "payment-settled-to-order-transition",
        description:
          "PaymentSettledEvent MUST be followed by an OrderStateTransitionEvent (the settled payment transitions the order)",
        expectedChain: ["PaymentSettledEvent", "OrderStateTransitionEvent"],
      },
    ];
  }
}
