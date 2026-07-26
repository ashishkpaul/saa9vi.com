# What Next — Saa9vi Platform: Cline Development Prompt

**Generated:** 2026-07-25
**Based on:** All plugin codebases, Vendure live docs

---

## Documentation Architecture

The documentation has been refactored into focused documents:

| Directory | Document | Purpose |
|---|---|---|
| `docs/architecture/` | `platform-adr.md` | Enduring architectural decisions only |
| `docs/architecture/` | `domain-model.md` | Every aggregate, its purpose, lifecycle, relationships |
| `docs/architecture/` | `plugin-map.md` | Plugin ownership, entities, events, API surfaces |
| `docs/architecture/` | `runtime-flow.md` | Event-driven flows, service interactions, queues |
| `docs/architecture/` | `invariants.md` | Non-negotiable rules (INV-001 through INV-015) |
| `docs/product/` | `platform-story.md` | Capability-based actor lifecycles |
| `docs/product/` | `glossary.md` | Domain term definitions |
| `docs/implementation/` | `roadmap.md` | Future work only, by phase |
| `docs/implementation/` | `known-bugs.md` | Active and fixed bugs |
| `docs/implementation/` | `release-notes.md` | Completed work, chronologically |

---

## Priority Order

```
P0 — CRITICAL BUGS (block tenant onboarding)
  BUG-022: Fix bbbRoomStatus/myBbbRooms/myBbbEnrollments to read BbbEntitlement
  BUG-023: Fix MarketplaceIndexerService academySlug/channelToken/customDomain

PHASE 1 FINAL BLOCKERS
  SEC-004 Rate limiting                        [ADR §13]
  Custom domain Redis mapping                  [SEC-006]

PHASE 1.5 BLOCKERS
  FEAT-002 Overhead Capacity Grant (migration)  [ADR §8A OP-005]
  myLearningDashboard domain API                [ADR-013 INV-006]

CORRECTNESS / RELIABILITY
  GrantReaderService scaffold                   [RFC-001 Q-009]

CAPACITY INTELLIGENCE
  Full Capacity Intelligence System             [ADR §6A CI-001 to CI-006]
  k6 load testing integration                   [Vendure docs compliance]

PHASE 3 PREREQUISITE
  CommissionLedger $0-row pattern               [DL-030]
```

See `docs/implementation/roadmap.md` for full details.
