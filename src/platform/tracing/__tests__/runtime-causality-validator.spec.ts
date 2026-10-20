import { describe, expect, it } from "vitest";

import { EventLog, EventLogSource } from "../entities/event-log.entity";
import { RuntimeCausalityValidator } from "../runtime-causality-validator";
import { RuntimeTraceStore } from "../runtime-trace-store";

let nextId = 1;

function makeEvent(
  correlationId: string,
  eventType: string,
  timestamp: Date,
  status: "pending" | "processed" | "failed" = "processed",
): EventLog {
  return new EventLog({
    id: nextId++,
    eventType,
    payload: {},
    source: EventLogSource.EVENTBUS,
    correlationId,
    parentEventId: null,
    timestamp,
    status,
    errorMessage: null,
    triggeredBy: null,
  });
}

describe("RuntimeCausalityValidator", () => {
  it("reports an empty trace store as NO DATA (not verified, not a pass)", async () => {
    const validator = new RuntimeCausalityValidator(new RuntimeTraceStore());
    const result = await validator.check();

    expect(result.passed).toBe(false);
    expect(result.severity).toBe("warning");
    expect(result.message).toContain("No runtime traces available");
    expect(result.message).toContain("NOT verified");
    // The no-data message must not reuse the verified wording.
    expect(result.message).not.toContain("All runtime causality rules verified");
  });

  it("passes a trace whose events satisfy the configured chain in order", async () => {
    const store = new RuntimeTraceStore();
    store.record(makeEvent("corr-ok", "PaymentSettledEvent", new Date("2026-10-20T10:00:00Z")));
    store.record(
      makeEvent("corr-ok", "OrderStateTransitionEvent", new Date("2026-10-20T10:00:01Z")),
    );

    const result = await new RuntimeCausalityValidator(store).check();

    expect(result.passed).toBe(true);
    expect(result.message).toContain("1 trace(s)");
  });

  it("fails a trace missing the expected chain and names the correlation id", async () => {
    const store = new RuntimeTraceStore();
    // Only the first half of the chain — payment settled with no order transition.
    store.record(makeEvent("corr-broken", "PaymentSettledEvent", new Date("2026-10-20T10:00:00Z")));

    const result = await new RuntimeCausalityValidator(store).check();

    expect(result.passed).toBe(false);
    expect(result.details).toContain("[corr-broken]");
    expect(result.details).toContain("Missing expected chain");
  });

  it("fails a trace whose events appear in the wrong order", async () => {
    const store = new RuntimeTraceStore();
    store.record(
      makeEvent("corr-reversed", "OrderStateTransitionEvent", new Date("2026-10-20T10:00:00Z")),
    );
    store.record(makeEvent("corr-reversed", "PaymentSettledEvent", new Date("2026-10-20T10:00:01Z")));

    const result = await new RuntimeCausalityValidator(store).check();

    expect(result.passed).toBe(false);
    expect(result.details).toContain("[corr-reversed]");
  });

  it("evaluates every trace: one violating trace fails the check even when others pass", async () => {
    const store = new RuntimeTraceStore();
    store.record(makeEvent("corr-good", "PaymentSettledEvent", new Date("2026-10-20T10:00:00Z")));
    store.record(
      makeEvent("corr-good", "OrderStateTransitionEvent", new Date("2026-10-20T10:00:01Z")),
    );
    store.record(makeEvent("corr-bad", "PaymentSettledEvent", new Date("2026-10-20T11:00:00Z")));

    const result = await new RuntimeCausalityValidator(store).check();

    expect(result.passed).toBe(false);
    expect(result.message).toContain("1 runtime causality violation(s)");
    expect(result.details).toContain("[corr-bad]");
    expect(result.details).not.toContain("[corr-good]");
  });

  it("tolerates interleaved unrelated events between the chained events", async () => {
    const store = new RuntimeTraceStore();
    store.record(makeEvent("corr-mixed", "PaymentSettledEvent", new Date("2026-10-20T10:00:00Z")));
    store.record(makeEvent("corr-mixed", "UnrelatedEvent", new Date("2026-10-20T10:00:00.500Z")));
    store.record(
      makeEvent("corr-mixed", "OrderStateTransitionEvent", new Date("2026-10-20T10:00:01Z")),
    );

    const result = await new RuntimeCausalityValidator(store).check();

    expect(result.passed).toBe(true);
  });
});
