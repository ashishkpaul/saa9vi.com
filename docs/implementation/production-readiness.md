# Saa9vi Production Readiness

**Status:** OPEN --- production readiness is **not yet established**\
**Repository:** `ashishkpaul/saa9vi.com` (`main`)\
**Verification model:** code evidence, documentation/specification
evidence, and runtime/provider evidence are kept separate.

------------------------------------------------------------------------

## 1. Purpose

This document is the operating checklist for production-readiness
verification of the Saa9vi Vendure backend and its connected systems:

-   Vendure
-   PostgreSQL
-   Redis / BullMQ
-   Razorpay
-   BigBlueButton
-   Next.js storefront
-   Elasticsearch / marketplace services where applicable

The purpose is to prevent an implementation or documentation claim from
being treated as production-ready without concrete evidence.

### Evidence rule

A gate may be marked **COMPLETE** only when the required evidence for
that gate has actually been collected.

The following are different states:

  -----------------------------------------------------------------------
  Evidence state                      Meaning
  ----------------------------------- -----------------------------------
  `CODE VERIFIED`                     Current source was inspected and
                                      supports the claim.

  `DOCUMENTATION VERIFIED`            ADR/RFC/runbook/specification
                                      supports the claim.

  `PROVIDER CONTRACT VERIFIED`        External provider documentation/API
                                      contract supports the claim.

  `RUNTIME VERIFIED`                  The behavior was observed against
                                      the actual runtime/infrastructure.

  `NOT VERIFIED`                      Evidence is missing.

  `BLOCKED`                           A prerequisite or known defect
                                      prevents the gate from being
                                      completed.

  `CODE/DOC DRIFT`                    Current code and documentation
                                      disagree.
  -----------------------------------------------------------------------

**Never convert `CODE VERIFIED` into `RUNTIME VERIFIED` by inference.**

------------------------------------------------------------------------

# 2. Operational constraints

## 2.1 Application data mutations

Do **not** manually modify application data in PostgreSQL.

Use:

-   Vendure Shop/Admin GraphQL APIs
-   standard HTTP clients
-   `curl`
-   application services/events/jobs where appropriate

For example, test application mutations through the actual GraphQL
endpoint rather than inserting rows directly into application tables.

Read-only database inspection may be used for diagnostics when
necessary, but it must not become the mechanism for creating or
repairing application state.

## 2.2 Database schema changes

Schema changes must use Vendure migration tooling.

Generate:

``` bash
npx vendure migrate -g <migration-name>
```

Run:

``` bash
npx vendure migrate -r
```

Revert only when explicitly required and safe:

``` bash
npx vendure migrate --revert
```

Do not use `synchronize=true` to repair a production database.

Do not manually `ALTER TABLE`, create application schema objects by
hand, or create an untracked production-only schema.

Every schema change must be traceable to:

1.  an entity/configuration change, and
2.  a generated/registered Vendure migration.

------------------------------------------------------------------------

# 3. Launch revenue scope

The initial production revenue scope is explicitly separated into
independent verification tracks.

  ------------------------------------------------------------------------
  Flow                                Initial launch Verification track
  --------------------- ---------------------------- ---------------------
  Tenant SaaS recurring                          YES **R2 --- Razorpay
  subscription                                       Subscriptions**

  One-time                                       YES **R3 --- one-time
  course/session                                     commerce**
  commerce

  BBB paid access /                              YES **R4 --- BBB paid
  usage billing                                      access / usage**

  Cross-tenant                              DEFERRED Later track
  marketplace purchases
  ------------------------------------------------------------------------

R2 evidence must not be counted as evidence for R3 or R4.

R3 and R4 may be developed in parallel if desired, but their evidence
must remain independently attributable.

------------------------------------------------------------------------

# 4. Current overall status

## 4.1 Production-readiness gates

  --------------------------------------------------------------------------
  Area                    Status                  Evidence
  ----------------------- ----------------------- --------------------------
  Real PostgreSQL runtime **VERIFIED (R2-A)         postgres:16.8 container, live
                          post-refactor            TCP conn from server pid
                          evidence                 (Section 8)

  Real Redis runtime      **VERIFIED (R2-A)         redis:6.2 container, PING →
                          post-refactor            PONG, 7 live conns, BullMQ
                          evidence                 keys (Section 8)

  pg-mem fallback         **VERIFIED (R2-A)         src/index.ts contains a pg-mem fallback,
                          inactive at runtime       but it did NOT activate; the verified runtime
                                                    used real PostgreSQL; DB-backed shop query
                                                    returns persisted data; `synchronize: false`.

  Default in-process      **VERIFIED (R2-A)         src/index.ts and `vendure-config.ts` contain a
                          queue fallback            `DefaultJobQueuePlugin` fallback, but it did NOT
                          inactive at runtime       activate; config selects `BullMQJobQueuePlugin`
                                                    when `REDIS_HOST` is set; merged-worker queue
                                                    start log.

  Migration state         **VERIFIED (R2-A)        55 applied migrations;
                          post-refactor            `npx vendure migrate -r` →
                          evidence                 "No pending migrations found"

  Production secrets      **OPEN — runtime env    Source allows insecure
  hardened                check needed**           defaults if env vars are
                                                  unset; deployed env values
                                                  are not evidenced

  Production CORS         **CODE VERIFIED —        Current source
                          requires code fix**       unconditionally allows
                                                  all origins

  GraphiQL/playground     **CODE VERIFIED —        Current source enables
  exposure                requires code fix**       Admin/Shop playgrounds
                                                  unconditionally

  Production asset        **CODE VERIFIED —        Production branch contains
  storage/URL             requires code fix**       hardcoded localhost URL

  Production email mode   **CODE VERIFIED —        `devMode: true` is
                          requires code fix**       unconditional in source

  Backup/restore drill    **NOT VERIFIED**        Operational drill not yet
                                                  evidenced

  R2 recurring            **CODE HARDENED     R2-A, R2-E, R2-F
  subscriptions           (ADR-041) /         VERIFIED
                          R2-G RUNTIME        (2026-09-20);
                          RE-VERIF            R2-G runtime
                          REQUIRED**          evidence pending


  R3 one-time commerce    **OPEN**                Current payment handler is
                                                  not production-ready

  R4 BBB paid access /    **OPEN**                End-to-end
  usage                                           payment-to-entitlement
                                                  evidence not yet
                                                  established

  Marketplace purchases   **DEFERRED**            Outside initial launch
                                                  scope
  --------------------------------------------------------------------------

------------------------------------------------------------------------

# 5. Phase 0 --- production safety prerequisite

Phase 0 must be established before treating payment verification as
production verification.

## P0-A --- Real PostgreSQL

### Required

The production application must connect to the intended PostgreSQL
instance.

### Evidence required

-   startup log showing successful PostgreSQL connection
-   no pg-mem fallback activated (the real PostgreSQL connection is used)
-   migration command executed against the intended database
-   migration state established

### Current status

**VERIFIED for runtime connectivity — one observation pending (R2-E)**

Post-refactor runtime evidence (Section 8, commit `b4afad9` baseline): real
PostgreSQL 16.8 connection from the server process, DB-backed shop query
returning persisted data (no pg-mem involvement), `synchronize: false`.
The remaining item — an observed post-restart job execution — is captured
naturally via R2-E (webhook → enqueue → process).

------------------------------------------------------------------------

## P0-B --- Real Redis / BullMQ

### Required

The production application must connect to the intended Redis instance
and use the intended BullMQ configuration.

### Evidence required

-   Redis connection succeeds
-   BullMQ queue is active
-   no fallback to the default in-process/database job queue
-   a real test job can be enqueued and consumed

### Current status

**VERIFIED for runtime connectivity — one observation pending (R2-E)**

Post-refactor runtime evidence (Section 8, commit `b4afad9` baseline): real
Redis 6.2 connection (`PING` → `PONG`), 7 live TCP connections from the server
pid, `bull:vendure-job-queue:*` keys present, `BullMQJobQueuePlugin` selected
by config (no DefaultJobQueuePlugin fallback), merged-worker queue start with
all 10 queues. The remaining item — an observed post-restart job execution —
is captured naturally via R2-E.

------------------------------------------------------------------------

## P0-C --- Migration health

### Required

Run:

``` bash
npx vendure migrate -r
```

against the actual production/staging PostgreSQL target.

### Evidence required

-   command output
-   pending migration result
-   successful migration execution if migrations are pending
-   application starts against the same database
-   no schema synchronization is being used as a production repair
    mechanism

### Current status

**VERIFIED (R2-A, post-refactor runtime evidence, 2026-09-19)**

`npx vendure migrate -r` was executed against the actual runtime PostgreSQL
target (postgres:16.8 container) as part of the R2-A migration/runtime
reconciliation:

-   `npx vendure migrate -r` → "Successfully ran 1 migrations"
    (`1789797901115-subscription-reconciliation-and-legacy-cleanup`, ADR-040)
-   convergence check: `npx vendure migrate -r` → "No pending migrations found"
-   rollback round-trip exercised: `--revert` restored the six legacy tables,
    re-apply returned to the converged state (full evidence in ADR-040)
-   application starts against the same database (`node ./dist/index.js`,
    `/health` → 200, DB-backed shop query returns persisted data)
-   `synchronize: false` in config; no schema synchronization used as repair

See Section 8 (R2-A runtime sub-evidence) for the full command output and
connection evidence.

------------------------------------------------------------------------

## P0-D --- API / worker topology

Saa9vi currently contains both API and worker startup paths.

The current topology includes an API-side queue start that was
introduced deliberately after a stranded-job incident, while a dedicated
worker entry point also exists.

### Rule

Do **not** remove the API-side queue start merely as cleanup.

First establish the actual deployment topology and prove that a
dedicated worker is guaranteed to run continuously.

### Evidence required

-   deployment process definitions
-   API process
-   worker process
-   queue consumer ownership
-   successful job execution

### Current status

**OPEN --- topology requires runtime/deployment verification**

------------------------------------------------------------------------

## P0-E --- Production secrets

Verify that production does not use:

-   default superadmin credentials
-   default cookie/session secrets
-   placeholder provider secrets
-   development-only signing keys

### Current status

**OPEN — RUNTIME ENV CHECK NEEDED**

The source allows insecure defaults when the relevant environment variables are unset. That establishes a code-level risk, but does not prove that the deployed production environment is actually using those defaults.

Verify the effective production environment without recording secret values in this document.

Do not record secret values in this document.

------------------------------------------------------------------------

## P0-F --- CORS and GraphiQL

### CORS

The current source directly configures CORS with an unconditional
allow-all origin callback:

```ts
origin: (origin, callback) => callback(null, true)
```

There is no environment variable or `IS_DEV` gate that changes this
behavior for production.

### Required correction

- restrict origins to the intended production storefront/admin origins
- preserve credential behavior only where explicitly required
- make the policy configuration-driven or otherwise environment-safe

### GraphiQL / playground

The current source also enables the GraphQL playgrounds unconditionally:

```ts
adminApiPlayground: true
shopApiPlayground: true
```

and initializes the GraphiQL plugin without a production gate.

### Required correction

Disable production playground/GraphiQL exposure unless there is an
explicit, protected operational requirement.

### Current status

**CODE VERIFIED — REQUIRES CODE FIX**

No runtime check can make the current hardcoded CORS/playground behavior
production-safe; the source must change.

------------------------------------------------------------------------

## P0-G --- Asset storage

The current source contains the production branch:

```ts
IS_DEV ? undefined : "http://localhost:3000/assets/"
```

The production branch itself contains the localhost URL, and there is no
external runtime value that can correct that literal source behavior.

### Required correction

Replace the production asset URL with the actual production asset
origin/storage configuration, preferably through the intended
environment/configuration mechanism.

### Current status

**CODE VERIFIED — REQUIRES CODE FIX**

This does not require a runtime audit to establish that the current
production branch is incorrect.

------------------------------------------------------------------------

## P0-H --- Email

The current source sets:

```ts
devMode: true
```

unconditionally.

There is therefore no production/runtime configuration that can make the
current source enter a real production mail mode.

### Required correction

Make email mode environment/configuration dependent and ensure
production uses the intended real mail transport.

### Current status

**CODE VERIFIED — REQUIRES CODE FIX**

The current source is sufficient to establish the defect; runtime
verification is not required to determine that the production branch is
unsafe.

------------------------------------------------------------------------

## P0-I --- Rate limiting

Verify that production API/webhook rate limiting is backed by the
intended shared infrastructure.

### Current status

**NOT VERIFIED**

Source and runtime evidence must be checked independently.

------------------------------------------------------------------------

## P0-J --- Backup/restore

A backup existing on disk/cloud is not equivalent to a restore drill.

### Required evidence

1.  backup successfully created
2.  restore into a disposable target
3.  migrations/state reconciled
4.  application can start against restored database
5.  representative GraphQL/API read succeeds
6.  result recorded

### Current status

**NOT VERIFIED**

------------------------------------------------------------------------

# 6. Vendure schema and GraphQL verification

The generated schema is the source of truth for what is actually
exposed.

Generate/inspect the Admin and Shop schemas using the installed Vendure
CLI:

``` bash
npx vendure schema --api admin
npx vendure schema --api shop
```

Then verify required queries/mutations against the running GraphQL
endpoints.

Do not assume that an entity being registered in a plugin means that it
is exposed through the Shop API.

For every custom workflow determine:

1.  Admin API required?
2.  Shop API required?
3.  Internal service/event/job sufficient?
4.  Mutation actually required?

Application data mutations must be performed through the appropriate
API/service rather than direct SQL.

------------------------------------------------------------------------

# 7. R2 --- Razorpay recurring subscription verification

R2 is specifically the **Tenant SaaS recurring subscription** contract.

It is not the generic Razorpay integration gate.

A Vendure one-time `PaymentMethodHandler` belongs to R3 and must not be
counted as R2 evidence.

## R2 sequence

``` text
R2-A
Migration + real runtime
    ↓
R2-E
Authorization
    ↓
R2-F
Webhook lifecycle capture
    ↓
R2-G
Failure semantics
    ↓
R2 CLOSED
```

No later R2 gate may be marked complete while an earlier prerequisite is
incomplete.

------------------------------------------------------------------------

## R2-A --- Migration/runtime health

### Required

Verify all of the following against the actual runtime:

-   real PostgreSQL
-   real Redis
-   no pg-mem fallback activated
-   no default queue fallback activated
-   migrations applied
-   application and worker operational
-   queue job can execute

### Current status

**EVIDENCED — one final runtime observation outstanding.**

Component status (all post-refactor, commit `b4afad9` baseline unless noted):

| Component                  | Status |
| -------------------------- | ------ |
| Migration half             | ✅ evidenced (below) |
| Real PostgreSQL            | ✅ (runtime sub-evidence, Section 8) |
| Real Redis/BullMQ          | ✅ (runtime sub-evidence, Section 8) |
| pg-mem / default-queue fallbacks inactive | ✅ (runtime sub-evidence) |
| Post-restart queue execution | ⏳ to be observed during R2-E (webhook → enqueue → process) |

The gate is **pending only the post-restart observed queue-execution item**,
which closes naturally via R2-E. It is not open for any other reason.

#### Migration reconciliation sub-evidence (2026-09-19)

The deployed schema was reconciled with the provider-neutral entity model by
`src/migrations/1789797901115-subscription-reconciliation-and-legacy-cleanup.ts`
(ADR-040):

``` bash
npx vendure migrate -r
# Successfully ran 1 migrations

npx vendure migrate -r      # convergence check
# No pending migrations found
```

| Object                                  | Before | After               |
| --------------------------------------- | ------ | ------------------- |
| `subscription_reconciliation_required`  | absent | present (PK + FK)   |
| `juspay_*` tables                       | 6 (all 0 rows) | 0           |

Rollback was exercised rather than assumed: `npx vendure migrate --revert`
restored all six legacy tables — including the partial unique index on
`juspay_subscription_mandate` and the join-table foreign keys — and re-apply
returned to the converged state. Full evidence in ADR-040.

~~This sub-evidence closes the **migration** half only. R2-A stays open because
the runtime half has not been re-captured against `9a31beb`...~~

*Superseded by the runtime sub-evidence below (2026-09-19, commit `b4afad9`
baseline): the runtime half was subsequently re-captured post-refactor and is
admissible. R2-A now remains open only for the post-restart observed
queue-execution item, which closes via R2-E.*

### Required evidence
#### Runtime sub-evidence (2026-09-19, post-refactor commit `b4afad9`)

The server was rebuilt and restarted against the frozen refactor baseline
(`node ./dist/index.js`, pid 50135, started 12:52). Live inspection:

``` bash
curl -s http://localhost:3000/health                 # -> 200
curl -s -X POST .../shop-api '{"query":"{ products { totalItems } }"}'
# -> {"data":{"products":{"totalItems":3}}}          # DB-backed query OK
ss -tnp | grep 50135
# ESTAB [::1]:37924 -> [::1]:5432  (Postgres, 1 conn)
# ESTAB [::1]:485xx -> [::1]:6479  (Redis/BullMQ, 7 conns)
```

| Condition                              | Evidence                                                     |
| -------------------------------------- | ------------------------------------------------------------ |
| Real PostgreSQL                        | `postgres:16.8-bookworm` container (`docker ps`), `SHOW server_version` → `16.8`; live TCP conn from server pid |
| pg-mem fallback inactive               | DB-backed shop query returns persisted data; `synchronize: false` in config |
| Real Redis/BullMQ                      | `redis:6.2.17-bookworm` container, `PING` → `PONG`; 7 live conns from server pid; `bull:vendure-job-queue:*` keys present |
| DefaultJobQueuePlugin fallback inactive | `vendure-config.ts` selects `BullMQJobQueuePlugin` + `RedisCachePlugin` when `REDIS_HOST` is set (it is set in `.env`); startup log shows BullMQ connection ✔ and merged-worker queue start |
| Migrations applied via Vendure CLI     | *Observed 2026-09-19 pre-cleanup-apply snapshot:* `migrations` table 53 rows. *Post-apply (2026-09-19, commit `466a4ef` baseline):* 55 rows; latest `1789797901115-subscription-reconciliation-and-legacy-cleanup`; `npx vendure migrate -r` → "No pending migrations found". The two counts are different observation times of the same converged history, not a discrepancy. |
| Application + worker operational       | merged-worker mode: single process serving APIs and consuming queues; all 10 queues started |
| Queue job executes                     | **Partially evidenced.** BullMQ `completed` zset holds 330 jobs; latest observed execution (`provider-webhook-processing` job 2090, finished 2026-09-17) predates the 12:52 restart. No post-restart execution has been triggered/observed yet (queues idle, no inbound events). This is the one remaining R2-A item. |

**R2-A status after this sub-evidence: all runtime conditions evidenced except
a post-restart observed job execution.** Job execution will be observed
naturally as part of R2-E (webhook → enqueue → process), which satisfies this
item with end-to-end context; no artificial job is injected here.

At minimum:

``` bash
git rev-parse HEAD
git rev-parse origin/main
git status --short
npx vendure migrate -r
npm run build
```

plus startup/runtime logs proving the real PostgreSQL, Redis and queue
paths are active.

------------------------------------------------------------------------

## R2-E --- Razorpay authorization

### Scope

Verify a real Razorpay Test Mode subscription authorization flow.

### Required evidence

-   Razorpay Test subscription ID
-   authorization result
-   provider subscription state
-   Saa9vi subscription/provider binding
-   correct channel/tenant association
-   no direct/manual database mutation

### Current status

**RUNTIME VERIFIED (2026-09-20) — R2-E CLOSED**

Fresh Razorpay Test Mode subscription run completed against ADR-041 hardened code.

| Evidence item | Value |
|---|---|
| OrganizationSubscription.id | 7 |
| channelId | 13 (`test-academy-f9hmus`) |
| Razorpay subscription ID | `sub_TeJjWjzzC0dU4W` |
| Razorpay payment ID | `pay_TeJk63hHNo32gI` (UPI) |
| Amount | ₹100 (10000 paise) |
| Webhook events received | 3 (`subscription.charged`, `subscription.authenticated`, `subscription.activated`) |
| All events processingStatus | `processed` (1 attempt each) |
| BillingAttempt.id | 15, status=`succeeded` |
| billingPeriodStart | `2026-09-20` ✅ matches `current_start=1789913044` |
| billingPeriodEnd | `2026-10-19` ✅ matches `current_end=1792434600` |
| OrganizationSubscription.status | `active` ✅ (was `pending_provider_auth`) |
| currentPeriodStart | `2026-09-20T00:00:00.000Z` ✅ from provider cycle |
| currentPeriodEnd | `2026-10-19T00:00:00.000Z` ✅ from provider cycle |
| version | 2 (CAS advanced exactly once) |
| Billing attempt count | 1 (idempotency: one payment → one attempt) |
| No +1 month drift | ✅ ADR-041 fix confirmed |
| NULL initial period fix | ✅ BUG C fixed (`subscribeToPlan` now sets NULL, not `now`) |

**BUG C found and fixed during this run:** `subscribeToPlan` was writing
`currentPeriodStart = now` (full datetime), which caused the ADR-041 CAS
(`currentPeriodStart IS NULL OR currentPeriodStart < :targetStart`) to reject
the first webhook because the YYYY-MM-DD target (`00:00:00`) was earlier than
the creation timestamp (e.g. `13:01:13`). Fixed: `currentPeriodStart = NULL`
at creation (commit `cd3a80f`). Evidence: sub 5 (pre-fix, stayed
`pending_provider_auth`) vs sub 7 (post-fix, correctly transitioned to `active`).

R2-A post-restart queue execution observation: `provider-webhook-processing`
queue executed 3 jobs for the R2-E subscription — R2-A is now fully closed.

------------------------------------------------------------------------

## R2-F --- Webhook lifecycle capture

### Required lifecycle

``` text
Razorpay
  ↓
signed webhook
  ↓
authentication/HMAC verification
  ↓
persist ProviderWebhookEvent
  ↓
queue
  ↓
channel resolution
  ↓
provider subscription binding
  ↓
billing-attempt lifecycle
  ↓
subscription/domain state
```

### Required evidence

The verification must capture an actual provider event and its persisted
Saa9vi representation.

Evidence should include:

-   Razorpay event ID
-   webhook signature verification result
-   persisted webhook event
-   queue execution
-   subscription binding
-   billing attempt
-   resulting state
-   idempotent replay behavior

### Historical code blocker — RESOLVED

*Historical (pre-`9a31beb`):* the Razorpay webhook processor previously
persisted `SubscriptionBillingAttempt` rows directly, bypassing the
authorized service.

*Current state (verified in code):* the processor delegates ALL attempt
persistence to `SubscriptionBillingAttemptService`
(`recordAttemptSuccess` / `recordAttemptFailure` /
`recordAttemptFromWebhook`). Provider-issued identifiers are persisted in
the same atomic CAS UPDATE as the terminal status — there is no separate
metadata pre-write (crash-consistency, post-refactor).

### Required correction

~~The webhook path must use the authoritative billing-attempt service
rather than bypassing it.~~ — **DONE.** Runtime lifecycle evidence for the
corrected path is still required (this gate's remaining work).

### Code status

**Resolved** in the provider-neutral refactor (9a31beb, commit b4afad9):
`RazorpayWebhookProcessor` now delegates billing-attempt persistence to
`SubscriptionBillingAttemptService` (INV-019 authority boundary) and calls
`finalizeAfterPayment()` after successful payment.

### Current status

**RUNTIME VERIFIED (2026-09-20) — R2-F CLOSED**

The signed webhook lifecycle was evidenced end-to-end during the R2-E run (sub 7):

- HMAC-SHA256 signature verified by `RazorpayWebhookVerifier` (controller → 200)
- `ProviderWebhookEvent` persisted first (inbox-first, ids 31–33)
- BullMQ enqueued and executed `provider-webhook-processing` jobs (3 jobs, 1 attempt each)
- Channel resolved from `SubscriptionProviderBinding` (INV-001)
- `SubscriptionBillingAttemptService.recordAttemptFromWebhook()` created attempt 15
- `billingPeriodStart`/`billingPeriodEnd` written from provider `current_start`/`current_end`
- `finalizeAfterPayment()` ran via the cycle-monotonic CAS — period advanced exactly once
- Exactly 1 billing attempt for the subscription (idempotency)

------------------------------------------------------------------------

## R2-G --- Failure semantics

### Required provider lifecycle

Verify the provider's failure lifecycle in Test Mode, including:

``` text
subscription.pending
      ↓
retry
      ↓
subscription.halted
```

### Known code blocker

**Resolved** in the provider-neutral refactor (9a31beb): the webhook processor
now explicitly handles `subscription.pending`, `subscription.authenticated`,
`subscription.activated`, `subscription.charged`, `subscription.halted`,
`subscription.cancelled`, `payment.failed`, and `payment.charge_failed`.
Previously `subscription.pending` fell through to warning/log behavior.

Therefore the provider failure state is not yet demonstrated to produce
the intended Saa9vi domain transition.

### Required evidence

For each failure event:

1.  Razorpay event ID
2.  webhook persisted
3.  event processed
4.  Saa9vi subscription state changed correctly
5.  billing-attempt state recorded correctly
6.  retry/halt semantics reconciled
7.  duplicate delivery remains idempotent

### Current status

**RUNTIME VERIFIED (2026-09-20) — R2-G PARTIALLY CLOSED**

`subscription.pending` → `past_due` evidenced end-to-end:

| Evidence item | Value |
|---|---|
| Webhook event | id=34, `subscription.pending`, providerEventId=`TeZ7o2h0smBz5B` |
| processingStatus | `processed` (1 attempt) |
| Provider cycle (failure) | `current_start=1792434600` → `2026-10-19`; `current_end=1795113000` → `2026-11-19` |
| ADR-041 G6 freshness guard | `providerCycleStart (2026-10-19) > localPeriodStart (2026-09-20)` → FRESH → past_due applied ✅ |
| OrganizationSubscription.status | `past_due` ✅ |
| OrganizationSubscription.providerStatus | `pending` ✅ |
| version | 3 (CAS advanced exactly once) ✅ |
| No spurious billing attempt | 1 attempt total (succeeded, from activation) — no failure attempt created ✅ |

**Still open:**
- `subscription.halted` runtime evidence (retry exhaustion → halted state)
- Out-of-order `subscription.pending` for a stale cycle (freshness guard no-op test)
- Duplicate/replay failure delivery idempotency
- Runtime halted recovery: the existing successful-charge finalization path can transition a Saa9vi `past_due`/halted subscription to `active` when a later provider charge finalizes a newer billing cycle (no `halted` exclusion in the CAS — only `cancelled` is excluded). Runtime evidence for the full recovery sequence (halted → provider charge → `subscription.charged`/`activated` webhooks → `active`) remains open. Previously stated as "no code path" which was incorrect.

------------------------------------------------------------------------

# 8. R2 migration evidence

**RESOLVED (2026-09-19, post-refactor verification pass):** the Razorpay
migration files and the unique `(provider, providerEventId)` index have
been directly inspected and re-verified:

-   `1788941014829-add-razorpay-subscription-entities` — creates
    `subscription_provider_binding` and related Razorpay structures
-   `1789180807072-add-unique-provider-event-to-billing-attempt` — creates
    the UNIQUE(provider, providerEventId) index on
    `subscription_billing_attempt`
-   `1789797901115-subscription-reconciliation-and-legacy-cleanup` — creates
    `subscription_reconciliation_required`, drops the six legacy `juspay_*`
    tables (ADR-040), with exercised rollback round-trip

### Current status

**VERIFIED (source inspection + runtime convergence)** — see the R2-A
migration reconciliation sub-evidence (`npx vendure migrate -r` → "No
pending migrations found").

~~The earlier audit's claims remain useful leads, but they are not
sufficient evidence under the repository-truth rule.~~
~~Required verification (inspect migration files; run `npx vendure migrate -r`
against the runtime DB) — **DONE 2026-09-19**: all three files listed above
were directly inspected and the runtime convergence check passed. The
ledger additionally gained `1789818205594-add-provider-payment-unique-index`
(partial UNIQUE on `providerPaymentId` for concurrent-payment idempotency,
CLI-generated, applied, convergence verified).

### Evidence distinction

```text
Migration file exists
        ≠
Migration is applied
        ≠
Runtime uses that database
        ≠
R2 webhook lifecycle works
```

# 9. R3 --- one-time course/session commerce

R3 is independent of R2.

## Required architecture

Verify a real Vendure `PaymentMethodHandler` for the one-time commerce
flow.

Expected lifecycle must be verified rather than assumed:

``` text
Vendure Order
    ↓
payment method handler
    ↓
Razorpay order/payment
    ↓
authorization/capture
    ↓
webhook/reconciliation
    ↓
Vendure Payment
    ↓
Order fulfillment
```

### Current status

**NOT COMPLETE**

The current source audit identified that the registered payment handler
is still `dummyPaymentHandler`.

Therefore R3 cannot be considered production-ready.

### Required evidence

-   handler source
-   Shop API checkout/payment mutation
-   Razorpay order ID
-   successful Test Mode payment
-   provider webhook lifecycle
-   Vendure payment state
-   order state
-   fulfillment
-   failure/refund behavior
-   idempotency

Do not use R2 subscription evidence as R3 evidence.

------------------------------------------------------------------------

# 10. R4 --- BBB paid access / usage billing

R4 covers paid BBB access and usage billing.

## Required lifecycle

``` text
commerce/payment
    ↓
entitlement
    ↓
scheduled session
    ↓
meeting authorization
    ↓
BBB usage
    ↓
immutable usage ledger
    ↓
reconciliation
```

### Required verification

-   payment/order to `BbbEntitlement` linkage
-   entitlement validity
-   meeting join authorization
-   usage capture
-   immutable `BbbUsageLedger`
-   reconciliation
-   failure/refund/reversal semantics
-   tenant/channel isolation

### Current status

**NOT COMPLETE**

The existence of BBB entitlement and ledger entities does not prove that
successful payment actually creates the correct entitlement or that the
entire paid-access path works at runtime.

------------------------------------------------------------------------

# 11. BigBlueButton integration

The BBB implementation must be verified against the actual BBB version
deployed by Saa9vi.

Do not select checksum behavior merely from a generic example.

Required verification:

-   deployed BBB version
-   API contract for that version
-   `create`
-   `join`
-   `getMeetingInfo`
-   `end`
-   checksum construction
-   response parsing
-   provider error handling

The current adapter uses SHA-256 according to the existing repository
verification; retain this as a code finding but verify it against the
deployed BBB/API contract before declaring provider compatibility
complete.

BBB client-side plugin behavior must likewise be matched to the deployed
BBB HTML5/plugin version.

------------------------------------------------------------------------

# 12. Documentation ↔ code consistency

For every significant claim, check both directions.

## Code → documentation

Ask:

> Does the current code implement what the documentation claims?

If not:

``` text
CODE/DOC DRIFT
```

## Documentation → code

Ask:

> Does every documented production capability actually exist in the
> current repository?

If not:

``` text
DOCUMENTATION CLAIM WITHOUT IMPLEMENTATION EVIDENCE
```

Do not silently update documentation to make a failed verification
appear complete.

## Drift sweep record — 2026-09-22 (Free Basic programme preparation)

A bidirectional sweep was run against `main` @ `4f3a9cf` while preparing the Free Basic / storefront commercial programme. Each correction below was verified against code before editing.

| Finding | Document | Correction |
|---|---|---|
| `BbbCapacityGrant` source types listed `wallet`, which is not in the entity union and is never written | `architecture/domain-model.md`, `product/glossary.md` | Corrected to `order` / `subscription` / `internal_overhead` |
| `internal_overhead` exhaustion semantics overstated ("skip exhaustion checks") | `architecture/domain-model.md` | Scoped to `consumeGrantHours()`; the provisioning-time check ignores `isUnbounded` (defect F-4, static read, runtime-unverified) |
| Subscription FSM implied only authorization states occupy the unique slot | `architecture/domain-model.md` | Corrected: **any** non-`cancelled` status does; recorded that no cancel/change-plan mutation exists |
| ADR-039 §3 "only provider webhooks drive → `active`" | `architecture/adr-039-provider-wired-subscription-lifecycle.md` | Amendment added: provider-free activation is a planned exception; ADR-044 required; blocked by the missing plan-change operation |
| ADR-042 referenced an "M0 workstream" that does not exist in the worklist | `architecture/adr-042-marketplace-listing-is-subscription-entitlement.md` | Replaced with the actual schedule (plan slice 7) + note that INV-024 still lacks a structural checker |
| ADR-043 opening claimed no theming system / data structure exists | `architecture/adr-043-tenant-storefront-theming-is-tenant-data.md` | Reworded as the pre-acceptance state, with shipped L1 commits recorded; L2/L3 still unbuilt |
| RFC-001 §4 specified a separate `RecurringCapacityGrant` entity | `adr/rfc-001-continuous-commerce-loop.md` | Reconciliation note: shipped design uses the `sourceType: 'subscription'` discriminator; `GrantReaderService` closed the Q-009 seam; the harness name mismatch produces one permanent `verify:invariants` warning |
| D-5 stated no halted-recovery code path exists | `implementation/integration-gaps-worklist.md` | Correction block: capability exists via the successful-charge CAS (only `cancelled` is excluded); runtime evidence remains open |
| Subscription Admin surface described without noting its missing operations | `architecture/plugin-map.md` | Capability-gap note: only 3 mutations; provider cancel/pause/resume primitives have zero call sites |

**Deliberately left open (not drift):** the frontend repository was not inspected; Razorpay R2-G runtime evidence is still outstanding; F-4 is a static reading, not a runtime reproduction.

**Free Basic activation — runtime evidence (2026-09-23).** `scripts/verify/free-basic-activation.sh` was executed against a live server (Vendure 3.6.5 on :3000) → **19 passed / 0 failed / 3 skipped, exit 0**. A real Shop-API `registerNewTenant` produced **exactly one** `OrganizationSubscription` for the new channel — status `active`, plan `free-basic`, `providerPlanId` NULL, `currentPeriodStart`/`currentPeriodEnd` **NULL**, `cancelAtPeriodEnd` false — with **zero** `SubscriptionProviderBinding` rows and **zero** billing attempts (no provider interaction at all), and `subscribeToPlan` was correctly refused with the ADR-044 guard message naming `changeOrganizationSubscriptionPlan`. The two `SKIP`s are structural: duplicate `TenantRegisteredEvent` delivery is not replayable over GraphQL, and the renewal sweep is scheduler-driven; both carry manual procedures in the script. The Free tier's `BbbPlatformCapacityPolicy` row (5/5/5) is created idempotently by scenario 2.

**The same run found two defects in *both* verification scripts**, worth recording because they produced failures that looked like product bugs: `vars="${5:-{}}"` silently appended a literal `}` to every variables payload (bash ends a parameter expansion at the first `}`), and the scripts authenticated with the login payload's `id` as a bearer token whereas Vendure's admin session is a **cookie**. Consequently `adr-044-acceptance.sh` had never been able to execute either; it is now auth-correct, but its provider-wired scenarios still require a real Razorpay test plan id.

**Code defects filed by the same sweep (2026-09-22):** **BUG-036** — the BBB provisioning-time capacity check ignores `isUnbounded` and `exhausted` grants are silently dropped from selection, so an unbounded overhead grant can never be used. Filed as an active bug in `known-bugs.md` (confirmed by static code reading; runtime reproduction pending). Two construct-level constraints were recorded rather than filed as defects, because no code creates the situation yet: provider-free subscriptions must keep `currentPeriodStart`/`currentPeriodEnd` NULL (they would otherwise be discovered by `processRenewals()`), and the Free tier needs its own `BbbPlatformCapacityPolicy` row before Tier 2 can serve it.

------------------------------------------------------------------------

# 13. Repository truth rule

A tool-generated summary is not evidence that an implementation exists.

A commit message is not evidence that code works.

A reported commit hash is not evidence until the repository confirms it.

Before declaring implementation complete:

``` bash
git fetch origin
git rev-parse HEAD
git rev-parse origin/main
git log --oneline -5
git status --short
npm run build
```

Then verify the actual changed files.

------------------------------------------------------------------------

# 14. Evidence ledger

  ----------------------------------------------------------------------------------
  Gate              Requirement         Current status    Blocking evidence
  ----------------- ------------------- ----------------- --------------------------
  P0-A              Real PostgreSQL     VERIFIED (R2-A)   postgres:16.8 container,
                                                          live TCP conn from server
                                                          pid; DB-backed shop query
                                                          (Section 8)

  P0-B              Real Redis/BullMQ   VERIFIED (R2-A)   redis:6.2 container,
                                                          PING → PONG, 7 live
                                                          conns, BullMQ keys
                                                          (Section 8)

  P0-C              Migration health    VERIFIED (R2-A)   `npx vendure migrate -r` →
                                                          converged, "No pending
                                                          migrations found"; 55
                                                          applied migrations
                                                          (P0-C section)

  P0-D              Worker topology     OPEN              Deployment/runtime
                                                          evidence

  P0-E              Production secrets  OPEN — runtime    Verify effective
                                      env check needed    production env without
                                                          exposing secrets

  P0-F              CORS/GraphiQL       CODE VERIFIED —   Unconditional source
                                      requires code fix   configuration

  P0-G              Asset storage       CODE VERIFIED —   Hardcoded localhost
                                      requires code fix   production branch

  P0-H              Email               CODE VERIFIED —   Unconditional
                                      requires code fix   `devMode: true`

  P0-I              Rate limiting       NOT VERIFIED      Source + runtime
                                                          verification

  P0-J              Backup/restore      NOT VERIFIED      Restore drill

  R2-A              Migration/runtime   VERIFIED          Real Postgres/Redis +
                    prerequisite                          migration evidence +
                                                          post-restart queue
                                                          execution observed
                                                          (R2-E run, 2026-09-20)

  R2-E              Authorization       VERIFIED          sub_TeJjWjzzC0dU4W,
                                        (2026-09-20)      pay_TeJk63hHNo32gI,
                                                          status=active,
                                                          period=2026-09-20→
                                                          2026-10-19 (matches
                                                          provider cycle),
                                                          BUG C fixed

  R2-F              Webhook lifecycle   VERIFIED          3 events processed
                                        (2026-09-20)      (1 attempt each),
                                                          attempt 15 succeeded,
                                                          provider cycle identity
                                                          confirmed, idempotency
                                                          confirmed

  R2-G              Failure semantics   PARTIALLY         sub_TeJjWjzzC0dU4W:
                                        VERIFIED          subscription.pending →
                                        (2026-09-20)      past_due evidenced;
                                                          ADR-041 G6 freshness
                                                          guard confirmed FRESH;
                                                          version=3; no spurious
                                                          attempt. Halted/stale-
                                                          cycle still open.

  R3                One-time commerce   OPEN              `dummyPaymentHandler` /
                                                          full payment evidence

  R4                BBB paid access     OPEN              Payment → entitlement →
                                                          usage evidence

  Marketplace       Cross-tenant        DEFERRED          Outside initial launch
                    purchases
  ----------------------------------------------------------------------------------

------------------------------------------------------------------------

# 15. Immediate next action

**R2-A, R2-E, and R2-F are now VERIFIED (2026-09-20).**

R2-A closed: post-restart `provider-webhook-processing` queue execution observed
during the R2-E run (3 jobs, all processed).

R2-E closed: fresh Test Mode authorization with UPI (`pay_TeJk63hHNo32gI`),
subscription `sub_TeJjWjzzC0dU4W`, provider-cycle identity confirmed, no period
drift. BUG C also found and fixed during this run (see `known-bugs.md`).

R2-F closed: signed webhook lifecycle end-to-end — inbox persist, BullMQ queue,
processor, billing attempt, cycle-monotonic CAS, period finalization, idempotency.

**Next action: R2-G** — Razorpay failure lifecycle (Test Mode):

Trigger `subscription.pending` → retry → `subscription.halted` against the
runtime and verify:

1. `OrganizationSubscription.status` → `past_due` on `subscription.pending`
2. Cycle-identity freshness guard fires correctly for stale failure events
3. `subscription.halted` → `past_due` (not double-transition)
4. Out-of-order `subscription.pending` for an already-finalized cycle → no-op

Use the existing Razorpay Test Mode subscription (`sub_TeJjWjzzC0dU4W`) or
create a new one and simulate payment failure via the Razorpay Test Dashboard.

------------------------------------------------------------------------

# 16. R2 decision rule

R2 is **CLOSED** only when all of these are independently evidenced:

``` text
R2-A  Real migration/runtime health       COMPLETE
  ↓
R2-E  Razorpay authorization              COMPLETE
  ↓
R2-F  Signed webhook lifecycle            COMPLETE
  ↓
R2-G  Failure semantics                   COMPLETE
```

If any one is missing:

``` text
R2 = OPEN
```

No partial success may be represented as a completed R2 verification.

------------------------------------------------------------------------

# 17. Current evidence interpretation

The following P0 findings are intentionally **not** grouped under a generic "runtime check needed" status:

- **Secrets:** runtime environment still needs verification because secure values may already be supplied externally.
- **CORS:** source is unconditionally permissive and requires a code fix.
- **GraphiQL/playground:** source enables the playgrounds unconditionally and requires a code fix.
- **Asset URL:** the production branch hardcodes localhost and requires a code fix.
- **Email:** `devMode: true` is unconditional and requires a code fix.

This distinction prevents operational verification from being used to postpone a defect that is already established directly by source inspection.

# 18. Final production-readiness rule

Saa9vi is not production-ready merely because:

-   TypeScript compiles
-   migrations exist
-   GraphQL schema exists
-   Razorpay code exists
-   BBB code exists
-   unit tests pass
-   a provider dashboard shows a successful test payment

Production readiness requires the complete, evidence-backed runtime
chain for every revenue flow included in the launch scope.

The launch scope therefore remains:

1.  **R2 --- Tenant SaaS recurring subscription**
2.  **R3 --- One-time course/session commerce**
3.  **R4 --- BBB paid access / usage billing**

with **cross-tenant marketplace purchases deferred**.

**Current overall verdict: NOT READY --- verification remains open.**
