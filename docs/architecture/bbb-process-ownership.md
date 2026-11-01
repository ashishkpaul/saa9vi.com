# BBB Scheduled Work and Process-Specific Side Effects (C-17)

**Date:** 1 November 2026  
**Status:** AUDIT — no code changed in this task.

---

## Per-process registration (correct as-is)

| Plugin | Hook | Side effect | Classification | Verdict |
|---|---|---|---|---|
| `TenantPlugin` | `onApplicationBootstrap` | Registers `CustomerDeletionService` handlers (in-memory array push) | Per-process setup | **Correct** — no guard needed |
| `TenantPlugin` | `configuration()` | Pushes custom permissions into `authOptions.customPermissions` | Per-process config | **Correct** — idempotent (deduped by Vendure) |

`TenantPlugin.onApplicationBootstrap()` pushes two closures into in-memory arrays in `CustomerDeletionService`. This runs in both server and worker. It is **not** a database or remote operation — it is registration only. The handler functions themselves (which DO touch the DB) are called later by the deletion orchestrator and must be idempotent. No worker-only guard is needed on the registration.

---

## BBB scheduled tasks (from `bigbluebutton.plugin.ts` `configuration()`)

| Task ID | Schedule | Side effect | Classification | Idempotency |
|---|---|---|---|---|
| `bbbReconciliationTask` | Periodic | DB: fixes stuck provisioning, reconciles rooms/billing | Worker-only (job queue) | Idempotent — advisory locks per room |
| `bbbCapacityAlertTask` | Periodic | DB + webhook: checks capacity thresholds, sends alerts | Worker-only | Idempotent — alert log dedup |
| `bbbMeteringTask` | Per-minute | DB: writes `BbbMeetingSample` rows | Worker-only | Idempotent — `ON CONFLICT (meetingId, bucketMinute) DO NOTHING` |
| `bbbMeteringPruneTask` | Periodic | DB: deletes old metered samples | Worker-only | Idempotent — DELETE by age |
| `bbbDailyAllowanceTask` | Periodic | DB: creates daily capacity grants | Worker-only | Idempotent — unique per (server, date) |
| `bbbServerHealthTask` | Periodic | Network: probes BBB server health endpoint | Worker-only | Idempotent — last-write-wins on `BbbServer.healthy` |

All tasks are registered via `config.schedulerOptions.tasks` with an id-dedupe guard in the `configuration()` function. Vendure's scheduler runs these only in the worker process. No additional `ProcessContext` guard is needed for these.

---

## BBB external webhook registration

| Component | Side effect | Classification | Idempotency |
|---|---|---|---|
| `BbbHooksService.ensureWebhook()` | Network: POST to BBB server to register hook callback | Worker/server startup | **Must be idempotent** — BBB hook registration is per-server; duplicate registration returns the same hook ID |

**Risk:** If both server and worker call `ensureWebhook()`, or if multiple worker replicas start, the same hook may be registered multiple times. BBB handles this gracefully (returns the existing hook), but the registration call itself should be retried safely.

**Recommendation:** Verify `BbbHooksService` registration is guarded by `ProcessContext.isWorker` or by a distributed lock if multiple replicas are deployed. The current code path should be inspected in C-19 (BBB code splitting) if issues arise.

---

## BBB queue processors

| Processor | Queue | Idempotency mechanism |
|---|---|---|
| `BbbProvisioningWorkerService` | `bbb-provisioning` | Per-room advisory lock; idempotent room state transitions |
| `PaymentWebhookQueueService` | `payment-webhook-reconciliation` | Event-ID dedup via `PaymentWebhookEvent` unique constraint |
| BBB webhook processor | `bbb-webhook` | Event-ID dedup via `BbbWebhookEvent` unique constraint |

All queue processors use durable database uniqueness/locks for billing facts. Multiple replicas processing the same job are safe.

---

## Summary

| Concern | Status |
|---|---|
| TenantPlugin handler registration | Correct — per-process, no guard needed |
| BBB scheduled tasks | Correct — worker-only by Vendure scheduler design |
| BBB webhook registration | Verify in C-19 if multi-replica; currently safe for single worker |
| BBB queue processors | Correct — advisory locks and event-ID dedup |
| Billing facts | Correct — append-only ledgers with immutable subscribers |
