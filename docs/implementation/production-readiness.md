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
  Real PostgreSQL runtime **NOT VERIFIED**        Runtime evidence required

  Real Redis runtime      **NOT VERIFIED**        Runtime evidence required

  pg-mem fallback absent  **NOT VERIFIED**        Runtime startup evidence
                                                  required

  Default in-process      **NOT VERIFIED**        Runtime startup evidence
  queue fallback absent                           required

  Migration state         **NOT VERIFIED**        `npx vendure migrate -r`
  verified against                                evidence required
  runtime DB

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

  R2 recurring            **OPEN**                R2-A prerequisite not yet
  subscriptions                                   closed

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
-   no pg-mem fallback
-   migration command executed against the intended database
-   migration state established

### Current status

**NOT VERIFIED / BLOCKED**

The current application contains a fail-open development fallback to
pg-mem when PostgreSQL is unavailable. Therefore a successful process
start alone is not evidence of real PostgreSQL health.

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

**NOT VERIFIED / BLOCKED**

The current application has a fallback path when Redis is unavailable.
Runtime evidence is therefore mandatory.

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

**NOT VERIFIED**

Migration source files exist, but source existence does not prove that
the migrations have been applied to the actual runtime database.

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
-   no pg-mem fallback
-   no default queue fallback
-   migrations applied
-   application and worker operational
-   queue job can execute

### Current status

**NOT COMPLETE — runtime half outstanding.**

The **migration** half of this gate is now evidenced (below). The **runtime**
half is not: there is no post-refactor proof of real PostgreSQL/Redis
connection, no proof the pg-mem / default-queue fallbacks stayed inactive, and
no evidence of a queue job executing against commit `9a31beb`.

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

This sub-evidence closes the **migration** half only. R2-A stays open because
the runtime half has not been re-captured against `9a31beb`; the startup log on
record predates the refactor and is therefore not admissible as post-refactor
runtime evidence.

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
| Migrations applied via Vendure CLI     | `migrations` table: 53 rows; latest `1789797901115-subscription-reconciliation-and-legacy-cleanup`; `npx vendure migrate -r` → "No pending migrations found" |
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

**NOT COMPLETE**

R2-A must be closed before R2-E is declared complete.

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

### Known code blocker

The current Razorpay webhook processor directly persists a
`SubscriptionBillingAttempt` rather than going through the authorized
`SubscriptionBillingAttemptService`.

This is a confirmed code-level invariant violation.

### Required correction

The webhook path must use the authoritative billing-attempt service
rather than bypassing it.

### Current status

**BLOCKED / NOT COMPLETE**

Do not mark R2-F complete until the writer path is corrected and the
real webhook lifecycle is evidenced.

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

The current webhook processor does not explicitly handle
`subscription.pending`; unhandled events fall through to warning/log
behavior.

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

**BLOCKED / NOT COMPLETE**

R2-G cannot be complete while `subscription.pending` remains unhandled
or while the intended state transition is not evidenced.

------------------------------------------------------------------------

# 8. R2 migration evidence

The repository contains a migrations directory and recurring-billing migration activity has been observed in the repository.

However, the specific Razorpay migration files and the exact unique `(provider, providerEventId)` index described by earlier audit material have **not been independently re-verified in the current pass**.

### Current status

**NOT INDEPENDENTLY VERIFIED**

Do not treat the following as currently checked facts until the relevant migration files are directly inspected:

- Razorpay-specific creation of `subscription_provider_binding`
- Razorpay-specific creation of `subscription_billing_attempt`
- unique `(provider, providerEventId)` billing-attempt index

The earlier audit's claims remain useful leads, but they are not sufficient evidence under the repository-truth rule.

### Required verification

Inspect the actual migration files on the current `main` revision and confirm:

1. the entities/tables created,
2. foreign keys/indexes,
3. the provider-event uniqueness constraint,
4. the migration names and timestamps.

Then verify separately that the migrations have actually been applied to the runtime PostgreSQL database using:

```bash
npx vendure migrate -r
```

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
  P0-A              Real PostgreSQL     NOT VERIFIED      Runtime connection
                                                          evidence

  P0-B              Real Redis/BullMQ   NOT VERIFIED      Runtime connection + queue
                                                          evidence

  P0-C              Migration health    NOT VERIFIED      `npx vendure migrate -r`

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

  R2-A              Migration/runtime   **NOT COMPLETE**  Real Postgres/Redis +
                    prerequisite                          migration evidence

  R2-E              Authorization       NOT STARTED       R2-A

  R2-F              Webhook lifecycle   BLOCKED           Attempt-service bypass +
                                                          runtime evidence

  R2-G              Failure semantics   BLOCKED           `subscription.pending`
                                                          handling + runtime
                                                          evidence

  R3                One-time commerce   OPEN              `dummyPaymentHandler` /
                                                          full payment evidence

  R4                BBB paid access     OPEN              Payment → entitlement →
                                                          usage evidence

  Marketplace       Cross-tenant        DEFERRED          Outside initial launch
                    purchases
  ----------------------------------------------------------------------------------

------------------------------------------------------------------------

# 15. Immediate next action

The next action is **R2-A**, not R2-E, R2-F, or R2-G.

Run against the actual Saa9vi runtime:

``` bash
cd ~/edu/saa9vi_com

git fetch origin
git rev-parse HEAD
git rev-parse origin/main
git status --short

npx vendure migrate -r

npm run build
```

Then start the intended production/staging API and worker topology and
capture logs proving:

``` text
PostgreSQL = real/healthy
Redis = real/healthy
pg-mem fallback = not activated
DefaultJobQueue fallback = not activated
migrations = current
worker/queue = operational
```

Only after that evidence exists should R2-E be attempted.

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
