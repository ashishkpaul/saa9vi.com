# Platform Invariant Verification System

This module provides automated drift detection between architecture documentation (`docs/architecture/`) and code behavior in the Saa9vi platform.

## Purpose

Prevent architectural drift by continuously verifying that:

- ADR invariants (Channel=Tenant, entitlement-only access, ledger immutability, meeting FSM) hold in code
- RFC lifecycle flows (subscription → invoice → grant → order) are structurally present
- STORY user journeys (commerce loop, webhook pipeline, trial conversion) remain intact
- Event causality chains match RFC specifications (static inference of intended event flows)

## Usage

```bash
npm run verify:invariants
```

Exit codes:

- `0` — all checks passed
- `1` — one or more invariant violations detected
- `2` — runner crashed

## Architecture

### Static Layer (ADR/RFC/STORY checkers)

Structural validation of code against documented invariants:

- `adr.checker.ts` — ADR invariant checks
- `rfc.checker.ts` — RFC lifecycle structural checks
- `story.checker.ts` — STORY flow completeness

### Event-Chain Inference Layer (`event-chain/`)

Static analysis layer that:

- Extracts event emissions from source code
- Infers intended causal chains between events and actions
- Validates these chains against RFC causality rules

**Important:** This is a static inference layer, not a runtime observer. It verifies that the code is structured to produce correct event chains, not that those chains actually occurred at runtime.

Components:

- `event-trace-collector.ts` — scans source to extract event emissions and triggered actions
- `event-causality-validator.ts` — validates inferred chains against RFC rules
- `runtime-invariant-runner.ts` — orchestrator for event-chain checks

## Extending

To add a new invariant check:

1. Add a method to the appropriate checker class, or create a new checker class implementing `Checker`
2. Register it in `cli.ts`
3. Document the invariant in `docs/architecture/platform-adr.md` first

## Design Notes

- This is a **detection layer only**. It does not modify business logic.
- Static checks use regex-based source analysis.
- The event-chain layer performs static inference of intended causality, not runtime validation.
- Future work: integrate real runtime event capture (EventBus interception, BullMQ tracing, webhook execution logging) to validate actual execution traces.
