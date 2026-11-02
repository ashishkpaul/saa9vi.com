# Saa9vi — Kiro CLI Execution Plan: Vendure Refactoring and Learning Domain

**Review date:** 1 November 2026  
**Target:** Existing Saa9vi Vendure project; recent project context identifies Vendure **3.8.1**. Kiro must verify the actual installed version in `package.json` and the lockfile before making changes.  
**Purpose:** Turn the combined refactoring assessment and Course Domain proposal into a safe, sequenced implementation register.  
**Status:** Design and task specification only. No source code, migrations, or database state has been changed by this review.
**Revision:** Updated after the 1 November implementation-guidance note: strategy wiring is now marked confirmed, C-02/C-03 sequencing and single-writer behavior are clarified, and C-07/C-08 are limited to auditing existing integrations.

---

## Kiro CLI operating procedure

This document is the execution specification. Save it in the backend repository as `docs/implementation/saa9vi-kiro-cli-execution-plan.md` (create the parent directory if needed), or provide Kiro with the exact path where you saved it. Kiro must use the checked-out repository as the source of truth and execute the task register below in dependency order. Do not ask Kiro to implement all 34 tasks in one unbounded turn.

### A. Start and verify the local Kiro CLI

From the Saa9vi backend repository root:

```bash
kiro-cli --version
kiro-cli --help
kiro-cli chat --help
```

Use the command syntax supported by the installed CLI version. The current official Kiro CLI documentation describes `kiro-cli chat` as the interactive session entry point and `kiro-cli chat --resume` for resuming the previous session in the directory. Do not use `--trust-all-tools` for this project.

### B. First session: read-only planning

1. Start `kiro-cli chat` from the backend repository root.
2. Select **Plan** mode from the workflow/agent selector (or use `Shift+Tab` to switch to Plan mode where supported by the installed terminal UI).
3. Plan mode is read-only. Ask Kiro to perform C-00 discovery only: inspect the checkout, verify versions/configuration/scripts/migrations and produce a baseline. It must not edit files, run migrations, alter the database, or change code in this stage.
4. Review the baseline and ask Kiro to list discrepancies between this plan and the checked-out source. A source discrepancy must be recorded, not silently resolved by trusting this document.
5. Switch to the default execution agent only after the baseline is accepted.

Suggested initial prompt:

```text
Read docs/implementation/saa9vi-kiro-cli-execution-plan.md (or the exact supplied path to this file) completely. Work in the current Saa9vi backend checkout. Start with C-00 only and operate in read-only Plan mode. Verify the exact Vendure/CLI versions, authOptions.customerChannelAssignmentStrategy wiring, plugin list, entityAccessControlStrategy, migrations, existing tests/scripts, BBB checksum configuration, Razorpay handler/webhook implementation, and the current admission/deletion code. Do not edit files, generate/apply migrations, change configuration, access production services, or modify data. Return a source-grounded baseline with file paths and line references, plus any differences from this plan. Stop after C-00.
```

### C. Execute in bounded task batches

After approving C-00, switch to the default execution agent. Assign one task per Kiro request, or at most one tightly coupled pair (C-02 then C-03). Ask Kiro to:

1. Re-read the task and relevant source files before editing.
2. State a short implementation plan and list the exact files it expects to change.
3. Write/adjust the regression test first where practical.
4. Make the smallest change that satisfies the task; do not perform opportunistic refactors.
5. Run targeted tests and `git diff --check`; inspect the complete diff.
6. Update `docs/implementation/kiro-progress.md` with DONE/PARTIAL/BLOCKED, evidence, tests and unresolved decisions.
7. Stop and report. Do not proceed to the next task unless explicitly assigned.

Resume the same conversation from the same repository with `kiro-cli chat --resume` when continuing. Use Kiro's inline shell facility (`!command`) only for commands you have reviewed and approved. Approve destructive, remote, migration or deployment operations individually.

### D. Recommended Kiro work sessions

| Session | Scope | Expected output | Stop condition |
|---|---|---|---|
| K0 — Baseline | C-00 only | `kiro-baseline.md` / `kiro-progress.md` baseline, verified commands and gaps | Stop for owner review |
| K1 — Tenant security | C-01 | Cross-channel profile tests and fix | Stop after tests/diff review |
| K2 — Admission | C-02 then C-03 | Admission state machine/log/API; deletion service uses admission service | Stop after deletion e2e |
| K3 — Channel assignment/payment safety | C-04, C-05, C-06 | Strategy behavior tests; merchant ADR/gate; role reconciliation | Stop if payment exposure is unresolved |
| K4 — Integration audits | C-07, C-08 | BBB checksum audit and Razorpay webhook test report | No rebuild unless evidence requires it |
| K5 — Boundary cleanup | C-09 through C-17 | ID helpers, admission port, access inventory, DTOs, overrides and worker audit | Stop before legacy conversion |
| K6 — BBB legacy transition | C-18, optional C-19, conditional C-20 | Safe access migration plan/implementation; only approved payment work | Review before destructive cleanup |
| K7 — Learning specification | C-21 only | Approved course-domain ADR/entity/API mini-spec | Stop for owner decisions |
| K8 — Learning backend | C-22 through C-28 | Plugin, entities, registry, templates, enrollment, Agenda, BBB tool and announcements | Stop after backend acceptance |
| K9 — Storefront and release | C-29, C-30 | Frontend, cross-tenant regression, final report | No production migration/deployment without approval |

C-31 to C-33 are continuous gates, not a final batch.

### E. Per-task prompt template

```text
Implement only task C-XX from the Saa9vi Kiro CLI execution plan. First inspect the current checkout and all relevant callers/tests. Reconcile the plan with actual source; if the source differs, report the discrepancy before choosing a behavior. Give me the exact files and test plan before editing. Preserve Vendure defaults and all Saa9vi invariants. Write regression tests, make the minimal change, run targeted tests plus git diff --check, review the diff, update kiro-progress.md, and stop. Do not proceed to the next task. Do not commit, push, apply a production migration, alter production data, deploy, or use live payment/BBB credentials.
```

### F. Owner approval gates

Kiro must stop for an explicit owner decision when any of these applies:

- C-05: the platform Razorpay PaymentMethod is exposed in tenant checkout, or the seller payment/admission model is not settled.
- C-14: the required effects of academy suspension on content, BBB join, existing entitlements or checkout are not decided.
- C-18: a legacy access consumer has no verified replacement or data-conversion behavior.
- C-20: per-tenant online Razorpay is proposed despite the existing seller-collected-payment model.
- C-21: unresolved course cardinality, templates, role multiplicity, session association, invitation/hostname and privacy decisions.
- Any migration would drop/alter existing data, any operation targets production, or a Vendure default/invariant must be changed.

### G. Required task report

```text
Task: C-XX — <title>
Status: DONE | PARTIAL | BLOCKED
Checkout commit/branch: <branch + commit>
Vendure/core/CLI versions: <exact versions>
Files changed: <paths>
Migration: none | generated <path, not applied> | applied to isolated test DB
GraphQL: Admin API <fields> | Shop API <fields> | none
Authorization: <actor, permission, tenant boundary, negative test>
Tests run: <exact command + result>
Tests skipped: <command + reason>
Invariants checked: <names + status>
Diff review: <diff --check, diff stat, risk>
Open decisions/blockers: <items>
Next task proposed: C-XX (do not start without instruction)
```

---

## 0. Instructions Kiro must follow

1. **Start with the checked-out repository, not this document alone.** The uploaded source snapshot is useful but does not contain `vendure-config.ts`, the complete tenant GraphQL SDL, the migrations directory, `package.json`/lockfile, or the `edu-frontend` repository. Read those files from the actual working tree before making claims about their current contents.
2. Verify the installed versions of `@vendure/core`, `@vendure/cli`, `@vendure/dashboard`, TypeScript, NestJS and the database driver. Do not upgrade Vendure or any dependency as part of these tasks unless a separate decision explicitly authorizes it.
3. For every task, inspect the current implementation and tests first. Some features in the original action plan already exist. Do not recreate an existing service, resolver, webhook controller, queue or entity under a second name.
4. Preserve the platform invariants, especially Channel = Tenant, immutable billing facts, persist-first webhooks, entitlement-based access and INV-027's shared room preview/join policy. If a task appears to require changing an invariant, stop and write an ADR proposal rather than silently weakening it.
5. Do not perform direct/manual PostgreSQL data changes. Schema changes must be represented by reviewed Vendure migrations. Operational mutations must use the relevant Vendure Admin API/Shop API service paths. Isolated automated tests may use the project's existing fixture/seeding pattern.
6. Do not enable TypeORM `synchronize` in production. Do not hand-edit generated migration SQL to make an incorrect schema diff appear to pass. Review the generated migration and resolve unexpected diffs at the entity/configuration level.
7. Preserve Vendure's built-in behavior unless a task has a documented Saa9vi requirement to customize it. Where a Vendure strategy is overridden, test the behavior that the strategy does **not** cover as well as the behavior it does cover.
8. Do not store Razorpay API secrets or webhook secrets in ordinary Vendure configurable-operation arguments. The current payment implementation explicitly avoids handler args for secrets; retain that security boundary unless a reviewed, version-supported secret-storage mechanism is proven.
9. Keep the one-time Razorpay payment lifecycle in `PaymentsPlugin` separate from recurring subscription billing in `SubscriptionPlugin`. Do not merge their webhook inboxes or queues.
10. Do not retire `BbbOrganizationMember` or `BbbOrganizationMembership` as part of a generic `BbbEnrollment` cleanup. They have separate trainer/admin and internal-staff responsibilities.
11. Do not introduce a second BBB access evaluator. `BbbRoomAccessService` remains the shared policy evaluation point for room status/preview and joining.
12. Kiro CLI should implement one task at a time, run its listed acceptance checks, update the task register, and produce a concise changed-files/test report before proceeding to the next task. Prefer small commits or clean checkpoints for high-risk refactors.

## 1. Vendure behavior constraints for this plan

These are the framework constraints that tasks below must respect.

### 1.1 Plugin and GraphQL extension model

Vendure plugins are NestJS modules enhanced with plugin metadata. They may register entities, providers, controllers, configuration hooks, Admin API extensions, Shop API extensions and Dashboard extensions. Use those extension points rather than patching Vendure core.

- Use `adminApiExtensions` only for operations intended for Admin API actors.
- Use `shopApiExtensions` only for storefront/customer operations that are actually required there.
- Do not automatically expose every mutation through both APIs.
- Generate and inspect the effective Admin and Shop schemas after changes.
- The React Dashboard plugin extension uses the plugin's `dashboard` entry point and `defineDashboardExtension`; that is separate from the Next.js storefront UI.

Vendure references:
- [Plugin system](https://docs.vendure.io/current/framework/developer-guide/plugins)
- [Extending GraphQL](https://docs.vendure.io/current/framework/developer-guide/extend-graphql-api)
- [Dashboard extensions](https://docs.vendure.io/current/framework/extending-the-dashboard/extending-overview)
- [defineDashboardExtension](https://docs.vendure.io/current/framework/reference/dashboard/extensions-api/define-dashboard-extension)

### 1.2 Channel behavior and row-level access

Vendure's default Channel contains all entities; other Channels can contain a subset of **ChannelAware** entities. Entities that only have a scalar `channelId` do not thereby acquire Vendure's automatic ChannelAware behavior. If Saa9vi uses scalar `channelId` on a custom entity, every read and write must explicitly scope it to the authoritative request channel or a deliberately authorized platform operation.

`DefaultEntityAccessControlStrategy` preserves the ordinary permission checks but does not automatically add row-level filtering. The custom `EntityAccessControlStrategy` supports row-level query-builder filtering, but Vendure currently documents it as developer preview/experimental. Do not make it the tenancy foundation in this plan. Continue with explicit, tested service/resolver assertions unless a later ADR approves a stable alternative.

References:
- [Channels](https://docs.vendure.io/current/framework/core-concepts/channels)
- [EntityAccessControlStrategy](https://docs.vendure.io/current/framework/reference/typescript-api/auth/entity-access-control-strategy)

### 1.3 CustomerChannelAssignmentStrategy: exact scope and limitation

Vendure 3.7+ provides `authOptions.customerChannelAssignmentStrategy`. The default strategy automatically assigns an authenticated Customer to the active Channel. A custom strategy can decide whether that automatic assignment happens.

Important limits from Vendure's docs:

- It controls **channel assignment**, not authorization to call the API.
- Returning `false` prevents that automatic assignment; it does not block the request.
- It is skipped for the default channel, `disableAuth`, and registration/checkout flows.

Therefore, the strategy alone cannot implement academy admission. Registration, checkout, course enrollment and BBB access need their own service-level/admission checks. Kiro must test those paths independently.

Reference: [CustomerChannelAssignmentStrategy](https://docs.vendure.io/current/framework/reference/typescript-api/auth/customer-channel-assignment-strategy)

### 1.4 PaymentMethod and secret storage

Vendure's `PaymentMethod` entity is `ChannelAware` and can be assigned to one or more Channels. `PaymentMethodHandler` supplies the payment integration logic and receives its configured arguments.

However, the documented `ConfigArgType` list is `string`, `int`, `float`, `boolean`, `datetime` and `ID`; there is no standard password/secret argument type in that list. Do not assume a handler argument is encrypted or masked. The existing Saa9vi one-time handler deliberately declares `args: {}` and reads process-level credentials because handler args are stored in configuration and accessible through Admin API configuration surfaces.

If Saa9vi later supports tenant-owned Razorpay credentials, use a separately secured encrypted account/credential entity or another explicitly reviewed secret store. A tenant-scoped PaymentMethod can refer to the account without containing its secret. The webhook must resolve the correct account securely before validating the raw request body.

References:
- [PaymentMethod](https://docs.vendure.io/current/framework/reference/typescript-api/entities/payment-method)
- [PaymentMethodHandler](https://docs.vendure.io/current/framework/reference/typescript-api/payment/payment-method-handler)
- [ConfigArgType](https://docs.vendure.io/current/framework/reference/typescript-api/configurable-operation-def/config-arg-type)
- [Payment flow](https://docs.vendure.io/current/framework/core-concepts/payment)

### 1.5 Order and payment state transitions

Keep payment and order state changes inside Vendure's payment/order services and state machines. Use the existing handler and `OrderService` payment methods for normal flows and webhook reconciliation; do not directly update Payment or Order rows. A browser redirect is not provider truth.

References:
- [Order lifecycle](https://docs.vendure.io/current/framework/core-concepts/orders)
- [OrderService](https://docs.vendure.io/current/framework/reference/typescript-api/services/order-service)

### 1.6 Lifecycle hooks, server and worker

Vendure plugin/Nest lifecycle hooks run in both server and worker contexts. `ProcessContext` exposes `isServer` and `isWorker`. Use it to place process-specific work in the correct process. Do **not** blindly guard every `onApplicationBootstrap` handler as worker-only: some registration, API-server or per-process initialization must happen in both. Also, `isWorker` alone does not guarantee one execution across multiple worker replicas; queue uniqueness, idempotency or a distributed lock is needed for singleton work.

References:
- [Plugin lifecycle](https://docs.vendure.io/current/framework/developer-guide/plugins)
- [ProcessContext](https://docs.vendure.io/current/core/reference/typescript-api/common/process-context)
- [Scheduled tasks](https://docs.vendure.io/current/framework/developer-guide/scheduled-tasks)

### 1.7 Migration CLI

The current Vendure CLI documentation shows:

```bash
# Interactive mode
npx vendure migrate

# Non-interactive generation
npx vendure migrate -g add-learning-course-tables

# Run pending migrations
npx vendure migrate -r

# Optional custom output directory
npx vendure migrate -g add-learning-course-tables -o ./src/migrations
```

Do not use `npx vendure migrate <plugin-name>` as a presumed plugin-selection syntax. Do not use a bare `--generate` without the required migration name. Kiro must verify `npx vendure migrate --help` against the installed project's CLI and use the migration location already configured by the repository.

Reference: [Vendure CLI and migrations](https://docs.vendure.io/current/framework/developer-guide/cli) and [Migration workflow](https://docs.vendure.io/current/framework/developer-guide/migrations)

---

## 2. Code-grounded current-state baseline

The uploaded plugin source snapshot covers the BBB, Tenant, Payments, Subscription, Customer Suspension, Marketplace, CMS and other plugin code. The platform and customer-deletion files were also attached. The following are source findings, not claims that a full build or runtime test was executed during this review.

| Area | Current state observed in supplied source | Consequence for Kiro CLI |
|---|---|---|
| BBB API | `BbbApiService` already implements request signing and create/join/getMeetingInfo/end API operations. `checksumAlgorithm` is currently a plugin option limited to `sha1`/`sha256`, defaulting to SHA-256. Known-answer tests cover both. | Do not port/rebuild the PHP API library. Verify deployed server compatibility and harden existing adapter only where evidence requires it. |
| BBB lifecycle | Existing room, scheduled-session, meeting, server selection, capacity, provisioning, webhooks, metering, attendance and reconciliation services exist. | Learning should call existing boundaries instead of creating another live-class subsystem. |
| BBB access | `BbbRoomAccessService` is the INV-027 shared evaluator. The current policy has multiple sources, including membership, legacy member, entitlement and enrollment paths. | Preserve one preview/join policy. Inventory and retire individual legacy inputs only after a consumer audit. |
| BBB entitlement | `BbbEntitlementService` is used by fulfillment and grant paths. The entitlement history deliberately allows revoke/re-grant history and has locking/idempotency behavior. | Do not add a plain unique `(customerId,type,resourceId)` constraint that would destroy the intended history model. |
| BbbEnrollment | Legacy entity and admin mutation/UI still exist. The manual `createBbbEnrollment` path checks an ACTIVE `TenantLearnerMembership`; the order-fulfillment listener's room product path currently creates a `bbb_room` entitlement, although comments still describe a legacy enrollment path. | Inspect every reader/writer. Do not assume fulfillment still writes `BbbEnrollment`; update stale comments after verifying all callers. Keep historical rows during the transition. |
| Organization roles | `BbbOrganizationMember` stores organization trainer/org-admin membership and is referenced by scheduled sessions as the trainer. `BbbOrganizationMembership` models a separate internal-staff access path. | Neither is equivalent to student enrollment. Keep both until their separate responsibilities have approved replacements. |
| Learner admission | `TenantLearnerMembership` entity and service exist. Service methods include create/find/activate/updateActivity/suspend/revoke. The current `create()` returns an existing row unchanged. The BBB Admin resolver reads membership using string-named repository access in its H1/H2 checks. No production workflow creating memberships was identified in the supplied source search; e2e fixtures seed rows. | Add reachable admission operations and a typed cross-plugin boundary. Explicitly handle re-admission; do not rely on `create()` to reactivate old rows. |
| Channel assignment | `TenantChannelAssignmentStrategy` exists, checks for ACTIVE membership and is registered in `vendure-config.ts` under `authOptions.customerChannelAssignmentStrategy` per the subsequent checkout review. It queries the membership repository directly rather than calling `TenantLearnerMembershipService`. | Registration is confirmed; C-04 is behavioural verification only. C-10 should provide the typed admission contract and then update the strategy to use it if the injectable-strategy lifecycle permits clean resolution. |
| Tenant profile | The Admin resolver accepts `channelId` for tenant-profile reads and passes `input.channelId` to the update service. A tenant administrator's channel ownership is not checked in that resolver before the service call. | Add cross-channel read and update tests and derive tenant scope from `ctx`; retain an explicit SuperAdmin cross-channel path if required. |
| Customer deletion | `CustomerDeletionService` has channel-scoped and full-delete handler registries. BBB, Tenant and Reviews plugins register handlers. The supplied Tenant deletion handler anonymizes instructor profiles; membership lifecycle cleanup was not present in the supplied path. | Register membership leave/revoke behavior through the existing deletion registry; do not introduce a second deletion orchestrator. |
| Customer suspension | `CustomerChannelStatus` blocks new checkout at `ArrangingPayment`; its service records reasons and change logs. `TenantLearnerMembership.status` is an admission status and is used by H1/H2. Their semantics are not currently identical. | Do not merge them automatically. First specify whether suspension affects new checkout only, all course access, existing entitlements, or several of these. |
| One-time Razorpay | `PaymentsPlugin` already has `razorpayPaymentHandler`, `RazorpayCheckoutService`, raw-body HMAC-SHA256 verification, `PaymentWebhookEvent`, persist-first controller and BullMQ reconciliation. Settling events are currently `payment.captured` and `order.paid`. The handler has empty config args and uses environment credentials. | Audit and extend tests; do not create a duplicate handler/controller/inbox/queue. |
| Recurring Razorpay | `SubscriptionPlugin` has a separate recurring billing webhook flow and provider inbox. | Preserve the separation from one-time commerce. |
| Tenant payment provisioning | `TenantRegistrationService` currently assigns the platform Razorpay PaymentMethod to new tenant channels. The one-time handler uses platform process credentials. | This conflicts with seller-owned payment collection. Do not enable platform-credentialed checkout as a tenant payment method by default. |
| Course domain | No persistent `LearningCourse`, `CourseTemplate`, `CourseTool` or `CourseEnrollment` aggregate was found in the supplied backend source. `LearningCourse` in `myLearningDashboard` is a GraphQL projection over entitlements and scheduled sessions, not a course entity. | Build a distinct LearningPlugin. Do not rename or repurpose the current dashboard projection as the course entity. |
| Course-adjacent building blocks | `BbbScheduledSession`, `BbbSessionTemplate`, `SessionAttendance`, `BbbInstructorAssignment`, `TenantLearnerMembership` and instructor profiles exist. | Reuse them through service boundaries; avoid duplicating schedule, attendance or instructor records. |
| Built-in resolver overrides | Tenant resolver source overrides built-in `administrators`, `administrator`, `roles` and `role` query fields to implement Saa9vi's channel-specific visibility requirements. | Keep an explicit known-overrides register and regression tests across Vendure upgrades. |

### Evidence still to verify in the actual checkout

- `package.json` and lockfile (exact installed versions and available scripts). The supplied follow-up says the Vendure version has not yet been read.
- `vendure-config.ts` and plugin registration should be read to reconfirm the reported line-166 strategy wiring, the unset/default `entityAccessControlStrategy`, the configured BBB checksum option, order processes, database options and worker setup. The follow-up reports these facts, but Kiro must confirm against the exact current checkout before editing.
- Tenant plugin GraphQL SDL / API extensions (to verify exact current input types).
- Migrations directory and migration configuration. The follow-up source review reports five migration files and identifies `1793512608531-add-tenant-learner-membership.ts` as the latest; confirm the actual checkout and applied migration history before generating anything.
- `edu-frontend` repository (Next.js routes, GraphQL documents/codegen, auth and tenant routing).
- Deployment topology and actual configured BBB server versions/checksum capabilities.

Kiro must not fill these gaps with assumptions.

---

## 3. Decisions to record before implementation

| Decision | Proposed default for this plan | Must be confirmed / why |
|---|---|---|
| D1 — Academy admission | `TenantLearnerMembership` remains the academy-admission record, owned by TenantPlugin. | Confirm open admission vs approval/invitation and re-admission semantics. |
| D2 — Seller payments | Preserve the previously discussed seller-owned collection model: the academy collects its own course fees; Saa9vi does not hold seller funds. | Confirm whether Saa9vi should offer tenant-hosted online checkout at all, or only discovery plus external collection/trusted admission callbacks. Do not assume a per-tenant Razorpay gateway is required. |
| D3 — Tenant suspension | Do not merge `CustomerChannelStatus` and `TenantLearnerMembership.status` yet. | Define whether “suspended” blocks only new orders (current INV-014) or also course access and existing BBB entitlements. |
| D4 — Course/session link | Prefer `CourseScheduledSession` join entity in LearningPlugin; BBB keeps owning its session lifecycle. | Decide whether one BBB session can appear in multiple courses and enforce the chosen cardinality. |
| D5 — Course roles | Start with one primary `courseRole` per `(course, customer)` enrollment unless the business requires simultaneous roles. | If multiple roles are needed, use a separate role-assignment model instead of overloading one scalar role. |
| D6 — Templates | Platform default plus optional tenant override; course creation snapshots template tools into the course. | Decide whether templates are versioned and whether a tenant override can be changed after a course has been created. Existing courses should not silently change when a template changes. |
| D7 — Course lifecycle | Define explicit draft/published/closed/archived behavior before Shop API operations. | Define who may publish/close, whether closed courses remain visible and how existing enrollments behave. |
| D8 — Trainer to BBB role | Course `TRAINER` does not automatically imply BBB moderator. | Require an explicit mapping to an active `BbbOrganizationMember` trainer/admin identity before returning a moderator join URL. |
| D9 — Domain / invitations | Use only verified tenant domains for durable academy invitation links until wildcard routing is confirmed in the actual frontend/deployment. | Current `tenantSlug` is an internal identifier, not proof of a provisioned hostname. |
| D10 — Learning tool MVP | Course description, Users/roster, Agenda, Announcements and Videoconference. | Confirm initial visibility defaults per course. Screenshot eye icons are a visual reference, not a configuration specification. |
| D11 — Global vs tenant privacy | Platform-level staff may have cross-tenant operations only through explicit SuperAdmin permissions and audited paths. | Decide data retention/privacy rules for learners, especially minors, before adding extra profile/assessment data. |

---

## 4. Sequenced Kiro task register

Tasks are deliberately ordered by dependency. Kiro should not start Phase 3 while Phase 0 admission/security blockers remain open.

### Phase 0 — Baseline verification and platform safety

#### C-00. Verify the checkout, installed Vendure behavior and task commands

**Files/areas:** `package.json`, lockfile, `vendure-config.ts`, `src/migrations`, plugin registration, test scripts, `docs/architecture/*`.

**Steps:**
1. Read `package.json` and the lockfile to record exact `@vendure/core`, CLI, Dashboard, TypeORM and Node versions; run the installed CLI's `--help` before selecting commands.
2. Confirm the plugin load order and configuration hooks.
3. Confirm the already-reported registration under `authOptions.customerChannelAssignmentStrategy` in `vendure-config.ts`: `customerChannelAssignmentStrategy: new TenantChannelAssignmentStrategy()`. If confirmed, record it as complete; do not add another strategy or registration.
4. Confirm `entityAccessControlStrategy` is unset/default, or document the actual configured strategy.
5. Record the existing `bbb checksumAlgorithm: 'sha256'` setting and the probe evidence comment; verify against actual deployed BBB servers as part of C-07.
6. Record all existing test scripts and exact paths for tenant, BBB, customer-deletion, payment and Vendure channel-isolation tests.
7. Inventory existing migrations. The follow-up review reports five migration files and `1793512608531-add-tenant-learner-membership.ts` as latest; confirm in the checkout and inspect applied migration history without applying/reverting anything.
8. Confirm whether storefront source is available in the workspace.

**Done when:** `docs/implementation/kiro-baseline.md` lists exact versions, plugin/config wiring (including verified strategy registration), checksum setting/evidence, commands, test paths, migration inventory and missing artifacts. No application code changed.

**Follow-up evidence already reported:** strategy registration under `authOptions.customerChannelAssignmentStrategy` in `vendure-config.ts`; `entityAccessControlStrategy` unset/default; BBB plugin checksum option `sha256`; five migration files with `1793512608531-add-tenant-learner-membership.ts` latest. Treat these as confirmation targets, not substitutes for reading the actual files.

#### C-01. Fix tenant-profile cross-channel read/write authorization (F3)

**Known area:** `src/plugins/tenant-plugin/api/tenant-admin.resolver.ts`, `TenantProfileService`, profile SDL and tenant profile e2e tests.

**Steps:**
1. Add failing tests for tenant A admin attempting to query tenant B's `tenantProfile(channelId)`, update B's profile, and change B's `customDomain`.
2. Derive channel scope from `ctx.channelId` for tenant callers. Do not trust an input `channelId` as their authorization boundary.
3. If SuperAdmin needs cross-channel profile management, expose/retain an explicit SuperAdmin-only path with a clear permission check and audit trail; do not accidentally remove platform operations.
4. Verify `createTenantProfile` has the correct Create permission rather than reusing Update permission, if supported by the current permission model.
5. Inspect service-level query scoping as well as resolver checks; test direct API paths, not only the dashboard.

**Done when:** cross-channel tenant-admin reads and writes fail; own-channel operations pass; SuperAdmin behavior is explicitly tested; `customDomain` cannot be changed cross-tenant.

#### C-02. Make academy learner admission an operational workflow (F1)

**Known area:** `src/plugins/tenant-plugin/entities/tenant-learner-membership.entity.ts`, `services/tenant-learner-membership.service.ts`, TenantPlugin Admin/Shop resolvers and SDL.

**Steps:**
1. Keep `TenantLearnerMembership` as the academy admission record. Do not create a second academy membership entity.
2. Define and implement an explicit transition model for `PENDING`, `ACTIVE`, `SUSPENDED`, `REVOKED`, `LEFT`.
3. Change the existing-row behavior deliberately: `create()` may remain idempotent for `PENDING`/`ACTIVE` (and policy-approved `SUSPENDED`) rows, but it must not silently return a terminal `LEFT` or `REVOKED` row as a successful admission. Require an explicit re-admission transition/use case.
4. Add explicit admission/re-admission/leave methods with actor, reason and timestamps. The transition model must define which statuses may transition to which others.
5. Add append-only `TenantLearnerMembershipLog` recording membership ID, old/new status, reason, actor and transition timestamp. Preserve historical log rows on re-admission.
6. Fix `suspend(reason)` in this task: it currently accepts a reason but discards it. Persist the reason in the transition log (and on the membership row only if there is a documented quick-read requirement). Keep one authoritative write path for status transitions.
7. Expose typed GraphQL operations for authorized academy staff. Suggested names: `admitTenantLearner`, `activateTenantLearner`, `suspendTenantLearner`, `revokeTenantLearner`, and a paginated `tenantLearners` directory. Reuse the existing Shop API `leaveAcademy` path for self-service departure.
8. Define/register a tenant-oriented permission such as `TenantManageAdmissions` or `TenantManageLearners` here so C-06 can reconcile it into roles; do not use a BBB permission for general academy admission.
9. Decide whether each operation belongs in Admin API or Shop API based on the actual frontend and actor model; do not duplicate all mutations in both APIs by default.

**Done when:** e2e covers new admission, duplicate admission, activation, suspension with reason, re-admission, revocation and unauthorized actor. Status transition logs contain the expected actor/reason/time.

#### C-03. Integrate membership with existing account leave/deletion orchestration (F4) — run immediately after C-02

**Known area:** `src/platform/customer-deletion/customer-deletion.service.ts`, `src/plugins/tenant-plugin/tenant-plugin.plugin.ts`, `TenantDeletionService`, `TenantLearnerMembershipService`, customer-deletion e2e.

**Steps:**
1. Register a TenantPlugin handler through the existing `CustomerDeletionService.registerChannelScopedHandler()` and `registerFullDeleteHandler()` hooks.
2. On `leaveAcademy`, transition only the current channel's membership to `LEFT`.
3. On full account deletion, transition all academy memberships to `REVOKED` (unless the deletion policy ADR selects another explicit terminal state) while retaining audit history.
4. Inject `TenantLearnerMembershipService` into `TenantDeletionService` (or the agreed admission port if it has already been implemented). This constructor/DI change is required; do not fall back to the already-available `TransactionalConnection` and write `TenantLearnerMembership` directly. Both paths must call the admission service/transition API added in C-02, preserving the single-writer rule and appending the transition log. When C-10 introduces `LearnerAdmissionPort`, refactor this dependency to the port in that task.
5. Keep handler behavior idempotent because deletion handlers may be retried after partial failures; skip a transition when the membership is already in the target terminal state.
6. Make sure admission/BBB access denies LEFT/REVOKED membership where required.
7. Do not delete immutable BBB usage, payment or order history.

**Done when:** `customer-deletion.e2e-spec.ts` asserts membership state and logs for both leave-channel and full-delete paths; repeated handler execution is safe.

#### C-04. Verify the already-registered CustomerChannelAssignmentStrategy behavior (F2)

**Known area:** `src/plugins/tenant-plugin/config/tenant-channel-assignment.strategy.ts`, actual `vendure-config.ts`.

**Steps:**
1. Record that the strategy is already registered in `vendure-config.ts` (reported in the `authOptions.customerChannelAssignmentStrategy` configuration); confirm this in the current checkout. Do not add another strategy registration or implementation.
2. Verify the configured instance is the intended `TenantChannelAssignmentStrategy` and its `init()` resolves dependencies correctly.
3. Add a focused test where an authenticated customer switches to a different tenant Channel with no ACTIVE `TenantLearnerMembership`; verify the strategy declines persistent Channel assignment.
4. Assert Vendure's documented limitation: returning `false` does **not** block API use in that Channel for the current session. Every tenant data/API path must independently enforce admission and channel assertions.
5. Add tests confirming the strategy is skipped on registration and checkout. For checkout, explicitly assert that an unadmitted customer may still reach `ArrangingPayment` with respect to this strategy; do not interpret this as proof that checkout is protected or authorized by academy admission. The strategy is not the checkout gate.
6. Test the independent policies separately: `CustomerChannelStatus` plus the existing CustomerSuspension OrderProcess governs channel checkout suspension; ACTIVE academy membership and the H1/H2 service-level checks govern academy admission/BBB entitlement operations. Confirm each policy's actual scope and do not merge their expected outcomes.
7. Keep service-level tenant membership and explicit channel checks as the authorization boundary for protected course/BBB APIs.

**Done when:** strategy registration is documented as already complete; tests establish the AuthGuard assignment behavior, the session-without-persisted-assignment behavior, registration/checkout skip behavior and independent service-level denial for unadmitted customers.

#### C-05. Inspect tenant Razorpay exposure and record the seller-payment ownership decision (F5)

**Known area:** `src/plugins/payments/config/razorpay-payment-handler.ts`, `RazorpayCheckoutService`, `src/plugins/tenant-plugin/services/tenant-registration.service.ts`, PaymentMethod provisioning and payment role fixtures.

**Steps:**
1. Record the currently agreed seller-owned collection model: Saa9vi marketplace discovery; academy collects its own course fees; Saa9vi bills its own platform services separately.
2. Determine whether tenant course purchases are external to Vendure or whether Vendure should record an offline/manual payment and require tenant staff reconciliation. Do not assume a per-tenant online Razorpay integration is needed.
3. Do not remove or silently change the existing tenant PaymentMethod assignment before the merchant-model ADR is decided. First verify via the Shop API and a tenant-channel checkout test whether this platform-credentialed method is actually exposed to buyers.
4. Add a clearly scoped warning/comment and an ADR stub documenting that tenant channels currently receive a PaymentMethod whose handler reads platform environment credentials; this must not be represented to a seller as the seller's own merchant account.
5. If the method is exposed in tenant checkout, mark the issue as a production-risk blocker. The C-05 Done condition then requires an explicit product/merchant decision recorded in the ADR, plus a tested action to remove, replace or explicitly authorize that exposure. Do not unilaterally remove it or assume it is safe. **C-21 and all Phase 3 course-sales work must not start while this exposure is confirmed and the ADR remains unresolved.** If it is not exposed, record the Shop API and checkout evidence and close the ADR with the selected seller-payment/admission model before Phase 3.
6. Keep platform-owned one-time payment flows separate from recurring subscription billing in `SubscriptionPlugin`.
7. If a future decision requires a tenant's own Razorpay merchant integration, design an encrypted `TenantPaymentAccount` or equivalent credential store. Use trusted order/channel context to resolve the account. Do not store key secrets in ordinary handler args. Design webhook routing so the correct account secret is resolved securely before raw-body signature validation.
8. Check manual/offline payment capabilities already available in the installed Vendure version before adding custom handlers.

**Done when:** the ADR records money flow, payment ownership, admission confirmation and refund responsibility; tenant-channel checkout exposure is known and tested; any exposure of platform credentials is explicitly resolved. If exposed, no Phase 3 work may proceed until the ADR and remediation/authorization decision are complete. Existing behavior is not changed before the decision.

#### C-06. Repair tenant role permissions without expanding payment privileges

**Known area:** tenant registration/role reconciliation, tenant role fixtures and `PaymentHygieneChecker`.

**Steps:**
1. Add the admission permission to the intended academy roles only.
2. Preserve the project's current read-only `ReadPaymentMethod` posture where appropriate; do not grant `CreatePaymentMethod`, `UpdatePaymentMethod` or `DeletePaymentMethod` to tenant roles by accident.
3. Update role reconciliation and e2e fixtures/snapshot tests.
4. Verify existing tenants receive the intended permission through the approved repair operation.

**Done when:** role-repair operation is idempotent; permission checker and tenant role tests pass; no tenant role gains unintended payment-method administration.

#### C-07. Document and validate the existing BBB checksum configuration (do not rebuild the adapter)

**Known area:** `BbbApiService`, BBB plugin options, `BbbServer`, `BbbHooksService`, checksum tests and production readiness documentation.

**Current facts from the follow-up checkout review:** `vendure-config.ts` sets `checksumAlgorithm: 'sha256'` and includes probe evidence in a comment. `BbbApiService` already supports SHA-1 and SHA-256 through the plugin option. The inbound webhook-auth worker is reported to infer the hook checksum algorithm from digest length; verify the implementation and its tests. No per-server column or schema change is currently justified.

**Steps:**
1. Re-read the `vendure-config.ts` SHA-256 probe comment and verify the evidence is current for every deployed BBB server in the pool.
2. Confirm the standard API adapter uses the configured SHA-256 algorithm and that the existing SHA-1 compatibility tests still pass.
3. Inspect `workers/bbb-webhook-auth.ts` and verify digest-length inference maps to the supported webhook-hook checksum algorithms; add tests for each supported digest size and malformed values.
4. Distinguish outbound standard API checksum handling from inbound BBB webhook-hook checksum verification. Use actual deployed BBB server versions/configuration and the documented API/PHP reference rather than assuming one global algorithm rule.
5. Create `docs/architecture/bbb-checksum-audit.md` recording server versions, probe evidence, configured algorithm, hook verification behavior and legacy compatibility.
6. Do not add a `checksumAlgorithm` database column or migration unless a verified heterogeneous server pool proves the plugin-level setting insufficient and an ADR approves it. Do not add SHA-512 merely because it is available in a recent BBB release.

**Done when:** the configured SHA-256 setting and probe evidence are verified; the inbound hook verifier is tested; the audit document is complete; no code/schema change is made unless evidence requires it.

#### C-08. Audit and test the existing Razorpay webhook reconciliation (do not create a duplicate)

**Known area:** `PaymentsPlugin`, `RazorpayPaymentsWebhookController`, `PaymentWebhookEvent`, `PaymentWebhookQueueService`, `RazorpayCheckoutService`, plus the separate recurring `SubscriptionPlugin` webhook flow.

**Current fact:** the one-time payment controller already validates the raw request body with HMAC-SHA256, persists an immutable inbox event before queueing, uses `x-razorpay-event-id` as an idempotency key, and delegates processing to BullMQ. The worker currently allows `payment.captured` and `order.paid` as settling event types and settles through Vendure's order/payment pipeline. The checkout handler re-reads provider state.

**Steps:**
1. Trace the whole flow from `createCheckoutOrder` through `addPaymentToOrder`, webhook receipt, inbox persistence, queue retry and order settlement.
2. Add/verify tests for missing/invalid signature, raw-body byte handling, missing event ID, duplicate event delivery, persistence success plus enqueue failure recovery, unknown events, out-of-order events, already-settled orders and provider mismatch.
3. Confirm browser redirect alone cannot settle the payment.
4. Verify state changes use `OrderService`/Vendure payment services and not direct database updates.
5. Preserve the current separation between one-time `PaymentWebhookEvent` and recurring `ProviderWebhookEvent`.
6. If tenant-owned payment is later approved, extend this pipeline using per-account secret resolution; do not add a second uncoordinated controller/inbox.

**Done when:** test suite proves raw-body signature validation, durable persist-first behavior, idempotent retry/reconciliation and correct Vendure order states. Existing implementation remains single-sourced.

### Phase 1 — Admission boundary, tenant consistency and access-model cleanup

#### C-09. Normalize Channel IDs and entity IDs as separate concerns (F9)

**Steps:**
1. Implement a `channelIdOf(ctx)` utility for the repository's chosen Channel ID representation.
2. Extract the existing private `rawId()` helper from `TenantDeletionService` (and compare it with BBB's own decoder helper) into a shared entity-ID decoding utility; do not invent a second decoder.
3. Do not combine channel-ID normalization and entity-ID decoding in one helper.
4. Replace duplicated casts/decoders incrementally; do not do a blind global codemod across code that legitimately accepts Vendure `ID` types.
5. Explicitly inventory the current `InstructorProfile.channelId` integer/`Number(channelId)` storage against the varchar/string `TenantLearnerMembership.channelId` representation. Decide whether to retain compatibility or convert via a reviewed migration; never silently switch the value type.
6. Add tests for production ID strategy and the test ID strategy used by e2e fixtures.

**Done when:** helpers have clear contracts; known number/string mismatch regressions pass; no unreviewed bulk coercion remains.

#### C-10. Add a typed learner-admission port for cross-plugin use

**Known area:** BBB resolver currently uses `getRepository(ctx, "TenantLearnerMembership")` for H1/H2 checks.

**Steps:**
1. Define a neutral `LearnerAdmissionPort` contract/token with operations needed by BBB, initially `isActiveMember(ctx, customerId, channelId)`.
2. Keep the membership entity and service in TenantPlugin unless a separate ADR makes admission a platform-owned domain.
3. Register the TenantPlugin implementation through an explicit provider token/export/import arrangement. Avoid circular plugin imports.
4. Replace string-named entity repository access in BBB with the port.
5. After the port exists, update `TenantChannelAssignmentStrategy` to call the admission service contract rather than querying the membership repository directly, provided the strategy's `init(injector)` can resolve the provider without a plugin dependency cycle. Keep the direct same-plugin implementation until this task; do not pull the C-10 dependency into C-04.
6. Keep the channel scope derived from the request/resource, and fail closed if the admission service cannot be resolved or checked.

**Done when:** BBB plugin has no string-named membership repository access; cross-tenant H1/H2 e2e still passes; dependency graph has no plugin cycle.

#### C-11. Write a complete BbbEnrollment consumer and writer inventory before changing legacy access

**Steps:**
1. Search all source for `BbbEnrollment` reads/writes: `RoomAccessService`/policy, admin mutations, dashboard enrollment UI, Shop API, learning dashboard, order listeners, deletion handlers, tests and storefront generated operations.
2. Record actual writers separately from stale comments. The uploaded order-fulfillment code currently creates `BbbEntitlement` for both session and room product paths; do not rewrite it as though it still writes `BbbEnrollment`.
3. Record which active legacy enrollment rows are currently necessary for `BbbRoomAccessService.evaluate()`.
4. Decide the conversion mapping and entitlement source values before building the conversion mutation.
5. Preserve historical `BbbEnrollment` rows for audit initially. Do not drop the table in this task.

**Done when:** `docs/architecture/bbb-enrollment-consumers.md` lists every call site and a verified transition plan; no behavior change has been made.

#### C-12. Preserve separate BBB organizational roles and the INV-027 access evaluator

**Steps:**
1. Keep `BbbOrganizationMember` because it stores organization trainer/admin role and is referenced by `BbbScheduledSession.trainer`.
2. Keep `BbbOrganizationMembership` for internal staff role/access semantics.
3. Keep `BbbEntitlement` as the grant record, and `BbbRoomAccessService` as the single authorization evaluator.
4. Do not add a direct course-role-to-BBB-moderator shortcut.
5. Update architecture docs to distinguish student enrollment, academy admission, organization staff membership, and BBB entitlement.

**Done when:** entity responsibilities are documented; no table is retired by assumption; `RoomAccessChecker` and trainer/admin access tests remain green.

#### C-13. Verify admission permission boundaries with role-level tests

**Steps:**
1. Use the permission definition introduced in C-02 and the role assignments reconciled in C-06; do not register or grant a duplicate permission here.
2. Reuse the C-02 admission authorization e2e tests where they already prove the role boundary. Add new tests only for uncovered permission-plane cases; an almost empty C-13 is acceptable if C-02 already proves the ordinary allow/deny cases.
3. Verify admission operations require the tenant-oriented admission permission, not `BBBManage*` permissions or generic customer-edit permissions.
4. Verify BBB infrastructure/session/room permissions do not implicitly grant academy-wide learner-admission rights.
5. Include SuperAdmin behavior and tenant-channel role scoping in the test matrix.

**Done when:** authorization tests demonstrate separation between academy admission, BBB infrastructure administration and platform SuperAdmin privileges.

#### C-14. Document academy-admission suspension vs customer checkout suspension

**Current source semantics:**
- `CustomerChannelStatus` is read by the `CustomerSuspension` order process and blocks new checkouts at `ArrangingPayment`; the plugin documentation says existing entitlements continue until natural expiry.
- `TenantLearnerMembership.status` controls academy admission and is checked by BBB H1/H2.

**Depends on:** C-02 must be complete, including the membership transition log and the `suspend(reason)` persistence fix. If C-02 is incomplete, block C-14 and report the missing dependency; do not create a second log or duplicate the reason fix here.

**Steps:**
1. Document the separate semantics in an ADR note: `CustomerChannelStatus` currently blocks new checkout under INV-014; `TenantLearnerMembership.status` represents academy admission/lifecycle and is checked by BBB H1/H2.
2. Inventory every read/write in `CustomerSuspensionService`, `CustomerStatusOrderProcess`, admission operations, BBB H1/H2 and deletion handling.
3. Decide whether academy admission suspension should additionally block course enrollment/content, new BBB joins or existing BBB entitlements. Do not assume the current checkout suspension automatically means these other effects.
4. If access revocation is required, implement it as an explicit coordinated policy transition and preserve the existing status-change log; do not simply delete one entity or treat the statuses as interchangeable.
5. Preserve platform-wide suspension independently.
6. Verify C-02 has fixed `TenantLearnerMembershipService.suspend(reason)` and records its reason once in the membership transition log; do not add a duplicate second log here.

**Done when:** a behavior matrix defines effects on new checkout, course access, BBB joins/entitlements, other academies and platform-wide status. Tests cover each selected behavior.

#### C-15. Type the tenant resolver inputs and remove unsafe entity mass-assignment

**Known area:** Tenant Admin resolver methods use `input: any`; services contain object-copy patterns.

**Steps:**
1. Read the full tenant SDL from the repository and define typed GraphQL input/TypeScript DTOs matching it.
2. Replace `input: any` with typed arguments.
3. Replace `Object.assign(entity, input)` with explicit allow-listed field mapping.
4. Separate trusted server-derived fields (`channelId`, creator, actor) from user-writable profile fields.
5. Add tests for attempts to set IDs, channel IDs, status, domain verification flags or other server-owned fields.

**Done when:** tenant mutation inputs are typed and mass-assignment tests reject protected fields.

#### C-16. Document and regression-test built-in Vendure resolver overrides

**Known area:** Tenant Admin resolver currently overrides `administrators`, `administrator`, `roles`, `role` for Saa9vi's INV-016 behavior.

**Steps:**
1. Add these fields to `docs/architecture/known-vendure-overrides.md` with the exact reason and expected SuperAdmin/tenant-admin behavior.
2. Verify each override retains the needed Vendure permission guard, relations, filtering, sorting and pagination semantics.
3. Add e2e tests for tenant admin, SuperAdmin, cross-channel records, global SuperAdmin exclusion and role detail visibility.
4. On Vendure upgrades, inspect upstream resolver/schema changes before accepting an override unchanged.
5. Do not patch Vendure core or silently replace the built-in behavior with a less capable implementation.

**Done when:** known-overrides document and tests capture the expected contract; GraphQL schema generation has no duplicate-field/schema errors.

#### C-17. Audit BBB scheduled work and process-specific side effects

**Known area:** Vendure lifecycle hooks execute in both server and worker contexts. `TenantPlugin.onApplicationBootstrap()` registering customer-deletion handlers is a per-process registration operation and is correct as-is; it must not be guarded worker-only simply because it is a lifecycle hook.

**Steps:**
1. Inventory BBB scheduled tasks, queue processors, external webhook registration and startup reconciliation; distinguish these from per-process handler/provider registration.
2. Record `TenantPlugin` deletion handler registration as confirmed per-process setup. It is an in-memory callback registration/push in each process; it is not itself a database or remote side effect and does not need an artificial idempotency guard or worker-only guard. The idempotency requirement applies to the registered handler functions when they execute; test those function executions for safe retries.
3. Label each actual side effect as server-only, worker-only, per-process, or distributed singleton.
4. Use `ProcessContext.isServer`/`isWorker` only for the appropriate scheduled/external side effect. Do not blanket-guard all `OnApplicationBootstrap` hooks.
5. For singleton work across multiple worker replicas, use the existing Vendure scheduled-task/queue uniqueness mechanism or a distributed lock; `ProcessContext.isWorker` alone does not ensure one execution across replicas.
6. Review BBB capacity reconciliation and webhook registration for repeat execution; make remote registration and reconciliation idempotent.
7. Keep queue processors and billing facts idempotent using durable database uniqueness/locks.

**Done when:** a process-ownership table exists; TenantPlugin handler registration remains correctly per-process; BBB scheduled/remote work has deliberate ownership and idempotency; no unintended duplicate effects occur.

### Phase 2 — BBB legacy-access transition and targeted refactoring

#### C-18. Deprecate and migrate the legacy BbbEnrollment access path safely

**Depends on:** C-10, C-11, C-12 and the consumer inventory.

**Steps:**
1. Add any missing, justified `EntitlementSource` values only after identifying actual source semantics. Do not add synonyms for the same event.
2. Change the manual enrollment admin workflow to create the appropriate `bbb_room` entitlement only if all behavior and auditing requirements are met; keep the old path read-compatible during transition.
3. Build an idempotent, platform-authorized Admin API conversion operation for historical active `BbbEnrollment` rows. Do not change existing business data via migration SQL.
4. Use the existing entitlement advisory-lock/history semantics; do not add a simple unique index that blocks revoke/re-grant history.
5. Switch readers one by one behind tests/feature flag where needed.
6. Remove the legacy enrollment source from `deriveRoomAccess` only after the converted population and every consumer are verified.
7. Retain the historical table/entity for audit until a separate retention decision approves removal. Do not drop it in the same change as the conversion.

**Done when:** conversion is idempotent, no user loses legitimate access, legacy reads are no longer required for active access, and INV-027 room-access tests remain green.

#### C-19. Split BBB resolver/service code only after behavior contracts are pinned

**Known areas:** large `bbb-admin.resolver.ts`, `bbb-meeting.service.ts`, `bbb-reconciliation.service.ts` and the existing 75-operation admin API surface.

**Steps:**
1. Record method/permission/assertion inventory before moving code.
2. Split resolvers by bounded domains (infrastructure, rooms, sessions, members/roles, entitlements/access, metering/billing, webhook/ops) only where the current plugin boundaries support it.
3. Keep the same GraphQL field names and return types unless a separately approved schema migration is required.
4. Preserve every `@Allow` permission, ADR-048 assert and service transaction boundary.
5. Extract service responsibilities incrementally; do not split purely to reach an arbitrary line-count target.
6. Run the relevant e2e/invariant suite after each extraction.

**Done when:** no behavior/schema regression, assertion-coverage checker and channel-isolation e2e remain green, and each split has a focused commit/checkpoint.

#### C-20. Implement tenant-owned payment integration only if D2 requires it

**Gate:** If D2 remains seller-owned external collection, do not build a per-tenant Razorpay gateway. Build only the trusted admission confirmation integration required by the selected seller payment process.

**If tenant-hosted Razorpay checkout is explicitly approved:**
1. Add an encrypted tenant payment account entity/service with key ID, API secret, webhook secret, provider account identifier, verification status and channel scope. Keep secrets out of handler args and Shop API responses.
2. Ensure only platform operators or the authorized tenant owner can configure the account; use separate read/write permissions and never return secrets after save.
3. Ensure each tenant `PaymentMethod` is assigned only to its intended channel and that the handler resolves the tenant account from trusted channel/order context.
4. Add a secure per-account webhook route or equivalent account resolution so HMAC is checked with the correct secret before payload data is trusted.
5. Retain raw-body HMAC-SHA256, persist-first inbox, event-ID idempotency and BullMQ processing; do not fork the controller/queue design.
6. Keep recurring platform subscription billing separate.
7. Test two tenant accounts in sandbox with distinct credentials and negative cross-tenant webhook cases.

**Done when:** the chosen merchant ownership model is enforced end to end; secrets are never exposed in GraphQL, logs or persisted handler args; cross-tenant payment/webhook tests pass.

### Phase 3 — LearningPlugin and Chamilo-inspired course domain

#### C-21. Confirm course-domain decisions and produce an entity/API mini-spec

**Steps:**
1. Confirm D4–D10 above before defining indexes or public GraphQL contracts.
2. Define course lifecycle and who can create, edit, publish, close and archive courses.
3. Define whether a course enrollment row has one role or multiple role assignments.
4. Define platform default template scope vs tenant override and snapshot semantics.
5. Define whether a BBB scheduled session may link to multiple courses.
6. Define course enrollment eligibility: ACTIVE academy membership, course lifecycle, enrollment window and invitation/admission state.
7. Define the difference between course enrollment and BBB room/session entitlements. Do not make course enrollment automatically grant all current/future BBB rooms or sessions.
8. Avoid a `CourseAccessPolicy` table unless there is a demonstrated policy configuration requirement not already handled by membership, course enrollment and service rules.

**Done when:** `docs/architecture/learning-domain.md` records entities, state machines, cardinality, GraphQL actors, permissions, scope and invariants. No implementation before approval of unresolved cardinalities.

#### C-22. Scaffold LearningPlugin with Vendure CLI

**Files:** new `src/plugins/learning-plugin/` folder; VendureConfig plugin registration.

**Steps:**
1. Check `npx vendure add --help` and the installed CLI version before choosing a scaffold command. Do not assume a non-interactive `--plugin` argument exists in this installed version. If the supported CLI flow is interactive, use it only if it is reliable in the current environment. If the CLI does not support the needed non-interactive form or scaffolding fails, manually create the minimal plugin structure by following an existing working plugin (for example `cms.plugin.ts` or `tenant-plugin.plugin.ts`); do not loop on an unsupported flag.
2. Register `LearningPlugin` in the project's actual plugin list.
3. Add the project's compatible Vendure version range consistent with the other plugins and installed core version.
4. Add plugin metadata only for features actually implemented: entities, providers, Admin/Shop GraphQL extensions and `dashboard` extension entry point if a Vendure Dashboard admin page is required.
5. Use `defineDashboardExtension` for Vendure React Dashboard navigation/routes. Keep Next.js storefront views as a separate frontend task.
6. Register permissions through `config.authOptions.customPermissions` without overwriting permissions registered by other plugins.

**Done when:** backend and worker bootstrap with the plugin; generated Admin/Shop schema is valid; no pre-existing plugin configuration is lost.

#### C-23. Implement tenant-scoped course/template/tool entities

**Proposed domain model, subject to C-21:**

- `LearningCourse`: tenant-owned course identity, slug, title/description and lifecycle fields.
- `CourseTemplate`: platform-default or tenant-specific reusable configuration.
- `CourseTemplateTool`: ordered tool defaults for a template.
- `CourseTool`: per-course tool snapshot, visibility, order and validated settings.
- `CourseEnrollment`: customer/course relationship, status and agreed course role.
- `AdmissionInvitation`: single-use/expiring invitation if direct learner invitations are approved.
- `CourseScheduledSession`: course-to-existing-BBB-session association if Option B is approved.
- `CourseAnnouncement`: if announcements are included in MVP and no existing CMS model provides the required course-scoped behavior.

**Steps:**
1. Use the project's approved Channel = Tenant pattern. For each new tenant-scoped entity, either implement the appropriate Vendure `ChannelAware` association and assign through Vendure's channel service, or use scalar `channelId` with explicit service-level read/write assertions and a documented reason. Do not assume a scalar field gains automatic channel filtering.
2. Keep global platform defaults explicitly global; do not accidentally expose them through the default Channel to tenant APIs.
3. Add uniqueness/indexes only after cardinality decisions. Typical candidates include `(channelId, slug)`, `(channelId, courseId, toolKey)` and the selected enrollment natural key.
4. Do not add a unique constraint to BBB entitlements that conflicts with existing historical grant semantics.
5. Use TypeORM entity relations only where lifecycle and ownership are clear; avoid cross-plugin circular dependencies.

**Done when:** entity/unit tests prove tenant scoping, unique constraints, valid lifecycle states and intended cardinality; migration is generated and reviewed.

#### C-24. Implement CourseToolRegistry and template snapshot creation

**Tool definition contract:**

- Stable unique key (for example `videoconference`, `agenda`, `users`).
- Category (`AUTHORING`, `INTERACTION`, `ADMINISTRATION`).
- Label, icon identifier and fixed application route key.
- Default visibility and role visibility behavior.
- Required permission / server authorization function.
- Optional settings validator/schema and settings version.

**Steps:**
1. Build a registry that supports plugin contributions and detects duplicate keys at startup.
2. Keep routes and component mappings in trusted code; never let tenant-provided settings define arbitrary executable routes/components.
3. Validate `CourseTool.settings` on both create/update and reads of legacy data. Use an existing project validator or add a dependency only after checking current dependencies; do not assume Zod is installed.
4. `createLearningCourse(templateId?)` must create the course and copy tool rows from the resolved template inside one transaction.
5. Store a snapshot of template tool key/order/visibility/settings on the new course so future template edits do not silently mutate existing courses.
6. Validate unknown/inactive tool keys and template/channel ownership.
7. Treat visibility as presentation/configuration only; every tool's server operations must independently authorize the caller.

**Done when:** registry unit tests cover duplicate/unknown tool keys, invalid settings, role visibility, tenant template boundaries and atomic rollback on partial creation failure.

#### C-25. Implement CourseEnrollment and the Users/roster tool

**Steps:**
1. Implement enrollment operations through the LearningPlugin service, using `LearnerAdmissionPort`/TenantLearnerMembership checks.
2. Require ACTIVE academy admission before course enrollment, unless a specific controlled invitation acceptance flow creates/activates academy membership and course enrollment atomically.
3. Define statuses such as invited/enrolled/suspended/completed/withdrawn only as required by the approved model; do not copy Chamilo's entire lifecycle without need.
4. Enforce the chosen course role (`LEARNER`, `TRAINER`, `ASSISTANT`) independently from BBB organization role.
5. Ensure a course trainer is not automatically a BBB moderator. Require explicit authorized mapping to `BbbOrganizationMember` before moderator actions.
6. Use idempotent invitation acceptance, hashed invitation tokens, expiry, single-use semantics and tenant binding if invitations are implemented.
7. Implement the Users course tool as a LearningPlugin feature over CourseEnrollment. It is not the academy-wide TenantLearnerMembership directory.
8. Add paginated roster API and prevent cross-tenant roster/customer enumeration.

**Done when:** e2e covers active/inactive academy membership, course enrollment, role permissions, invite expiry/reuse, cross-tenant IDs, trainer restrictions and deletion/leave effects.

#### C-26. Implement Agenda and course-to-BBB session association

**Steps:**
1. Implement the approved `CourseScheduledSession` relationship (if Option B remains selected).
2. Query and display title/start/end/trainer/status from the authoritative `BbbScheduledSession`; do not duplicate those scheduling facts in a second source of truth.
3. Validate the associated session belongs to the same tenant channel as the course.
4. Define whether a session may belong to multiple courses and enforce the chosen relationship cardinality.
5. Ensure cancel/reschedule/session status changes are reflected in Agenda without requiring a duplicate schedule update.

**Done when:** Agenda lists only sessions associated with the course and current tenant; cross-tenant linking is rejected; session changes are reflected correctly.

#### C-27. Implement the Videoconference tool as an adapter to existing BBB services

**Steps:**
1. The BBB plugin contributes a `videoconference` tool definition/adapter to the registry through a typed provider/port; avoid a circular plugin dependency.
2. The LearningPlugin stores the course-to-session relationship; BBB plugin continues owning room/session/meeting lifecycle.
3. Start/join requests must use existing `BbbScheduledSessionService`, `BbbMeetingService`, `BbbRoomAccessService` and entitlement/capacity services as appropriate.
4. Do not expose BBB API secrets or call BBB directly from the browser.
5. Do not create a second room/session/meeting entity or join authorization evaluator.
6. Do not automatically grant every room/session when a learner is added to a course. Grant access only for explicitly associated resources under the approved commercial/access policy.
7. Ensure course trainer role alone does not cause a moderator join URL.

**Done when:** teacher start and learner join pass through the existing Saa9vi authorization path; unauthorized, unentitled, inactive and cross-tenant users are rejected; INV-027 checker remains green.

#### C-28. Implement course description and announcements tools

**Steps:**
1. Use `LearningCourse` for course description unless a specific existing CMS content relation is approved.
2. Decide whether existing CMS plugin can represent course announcements safely or a dedicated `CourseAnnouncement` entity is needed. Do not duplicate CMS content without a requirement.
3. Scope all announcements to channel and course; include publish/draft ordering only if MVP needs it.
4. Keep tool visibility separate from server authorization.

**Done when:** course pages show authorized description/announcements; cross-course and cross-tenant access tests pass.

#### C-29. Implement Next.js course home and learner/staff routes

**Repository:** `edu-frontend` (not present in the supplied source attachments; Kiro must inspect the actual repository).

**Steps:**
1. Inspect current locale routing, tenant routing, auth/session utilities, generated GraphQL documents, dashboard/account pages and existing design system before creating files.
2. Generate/refresh Shop API types from the effective schema; do not hand-type generated API shapes.
3. Render the course home from `course.tools` data. Unknown/hidden tools should not render, but their API endpoints still enforce authorization.
4. Keep the Academy Users directory separate from the per-course Users roster.
5. Add academy staff course creation/template selection and course roster pages using the established authenticated API pattern.
6. Add learner course list/detail pages and invitation acceptance using verified tenant routes.
7. Keep `myLearningDashboard` semantics intact or version the API deliberately; do not silently replace its current BBB entitlement/session projection.
8. Confirm exact routes and domain handling from the frontend repository; do not assume `tenantSlug` is a provisioned hostname.

**Done when:** frontend type generation/build passes; own tenant/course routes work; unknown and cross-tenant course IDs return safe not-found/forbidden behavior; existing sign-in/verification flows remain green.

#### C-30. Add complete LearningPlugin and platform regression coverage

**Required test matrix:**

- Platform default template vs tenant override.
- Template snapshot remains stable after template edit.
- Course create failure rolls back all copied tools.
- Unknown/duplicate tool definition rejected.
- Hidden tool not rendered; direct API call still denied unless authorized.
- Tenant A admin cannot view/edit tenant B course/template/tool/enrollment/announcement.
- Learner cannot enroll if academy membership is not ACTIVE.
- LEFT/REVOKED/SUSPENDED behavior matches the approved policy.
- Course role cannot elevate BBB role.
- Only explicitly associated BBB sessions appear in Agenda.
- BBB join uses INV-027 and current entitlement policy.
- Course enrollment/leave/deletion operations are idempotent.
- Built-in Vendure resolver override tests remain green.
- Existing order, payment, suspension, customer deletion, marketplace and BBB access behavior is not regressed.

**Done when:** all tests run in isolated test schemas; no production data or manual SQL used; no unresolved invariant failures remain.

### Standing task — apply to every phase

#### C-31. Generate and review migrations with the installed Vendure CLI

1. Check `npx vendure migrate --help` for the installed version.
2. Generate using `npx vendure migrate -g <descriptive-name>` or the interactive workflow.
3. Use the repository's configured migration folder; use `-o` only when intentionally changing the migration output path and runtime configuration supports it.
4. Review generated SQL and up/down behavior. Verify the migration does not recreate existing tables or overwrite legacy history.
5. Apply pending migrations using the approved deployment workflow (`npx vendure migrate -r` where appropriate) before application bootstrap.
6. Never run a migration against production as part of autonomous Kiro work without explicit deployment authorization.

**Done when:** entity/migration diffs reconcile; migration is reviewed; isolated schema tests pass; production schema synchronization remains disabled.

#### C-32. Update architecture docs, invariants and known-upstream-overrides

Update the relevant files, including:
- `docs/architecture/invariants.md`
- `docs/adr/platform-adr.md` / current ADR file
- `docs/architecture/known-bugs.md`
- a new `docs/architecture/known-vendure-overrides.md`
- course-domain and BBB enrollment consumer documents

Record new invariants only when they have an executable checker/test. Keep the known built-in resolver overrides (`administrators`, `administrator`, `roles`, `role`) documented with their Vendure version review obligations.

**Done when:** documentation matches implementation and each new invariant has an automated test/checker.

#### C-33. Run project-accurate build, lint, invariant and e2e checks

1. Read scripts from the actual `package.json`; do not assume a script name from this plan.
2. Run backend typecheck/build and relevant lint.
3. Run `verify:invariants` and the specific `RoomAccessChecker`, billing, permission, migration and channel-isolation checks that exist in the checkout.
4. Run tenant admission/profile e2e, BBB room/channel isolation e2e, customer-deletion e2e, payment/webhook e2e, order/suspension tests and any Vendure 3.7.2/3.7.3 regression suites that still exist in this 3.8.1 checkout.
5. Run storefront GraphQL codegen/build and relevant sign-in/verification tests if the frontend repository is available.
6. Report any test not run and why; do not turn a skipped or unavailable suite into a claimed pass.

**Done when:** task-specific tests and agreed regression gates pass; output contains exact commands, pass/fail/skip status and test counts.

---

## 5. Release gates and implementation order

Recommended order:

1. **C-00** baseline verification.
2. **C-01** tenant-profile cross-channel read/write security.
3. **C-02** academy admission workflow, transition log, terminal-state re-admission rules and `suspend(reason)` fix.
4. **C-03** membership leave/deletion integration immediately after C-02; all transitions go through the admission service.
5. **C-04** assignment-strategy behavioral tests; configuration is already reported as registered.
6. **C-05 → C-08** tenant payment exposure/merchant decision, role repair, BBB checksum audit and Razorpay webhook audit.
7. **C-09 → C-17** ID-helper extraction, admission port, legacy consumer inventory, role/access boundaries, suspension semantics, resolver DTOs/known overrides and BBB scheduled-work audit.
8. **C-18** legacy enrollment conversion only after its consumer inventory and access contract are proven.
9. **C-19** BBB resolver/service splitting only when justified and with behavior tests; it is not a prerequisite for LearningPlugin.
10. **C-20** tenant-owned payment only if the approved merchant model requires it.
11. **C-21 → C-30** LearningPlugin and frontend course implementation.
12. **C-31 → C-33** continuous standing gates throughout; final release gate after Phase 3.

### Do not start LearningPlugin implementation until these minimum gates pass

- Cross-tenant TenantProfile read/write is denied.
- Academy learner admission has a reachable, tested creation/re-admission workflow.
- Leave/deletion changes academy membership appropriately.
- Actual `CustomerChannelAssignmentStrategy` wiring is confirmed in `vendure-config.ts`, and the AuthGuard/registration/checkout limitations are covered by tests.
- The active membership/BBB access dependency is expressed through a stable port or service boundary.
- No new course role can elevate BBB moderator permissions.
- C-05 merchant-model ADR is closed. If the platform-credentialed Razorpay PaymentMethod is exposed in tenant checkout, the exposure has been removed/replaced or explicitly authorized by a documented product decision; unresolved exposure blocks C-21 and all Phase 3 course-sales work.

---

## 6. Important corrections to the earlier pasted C-01–C-29 list

1. **C-04 registration is already complete:** `vendure-config.ts` registers `TenantChannelAssignmentStrategy` under `authOptions.customerChannelAssignmentStrategy` per the follow-up review. Search by the property key, not a remembered line number. C-04 must verify behavior only. Vendure skips the strategy during registration/checkout and a false return does not block current-session API access; test those limits explicitly.
2. **C-05/C-20 must not put tenant secrets in handler args:** Vendure's standard `ConfigArgType` list has no password/secret type. Use encrypted account storage if per-tenant credentials are approved. Given the agreed seller-collects-own-payment model, first decide whether a tenant Razorpay handler is necessary at all.
3. **C-07 must not assume SHA-512 is the BBB default:** current Saa9vi code supports SHA-1/SHA-256 with SHA-256 default. Verify actual server capability; distinguish regular API checksums and hook checksum compatibility. Add per-server configuration only if the current load pool requires it.
4. **C-08 is primarily an audit/test task:** raw-body HMAC-SHA256, persist-first `PaymentWebhookEvent`, event-ID idempotency and BullMQ reconciliation already exist for one-time Razorpay.
5. **C-14 must preserve the semantic difference between suspension and academy admission:** `CustomerChannelStatus` blocks new checkout; academy membership controls admission. Do not consolidate both into one status without explicit product behavior.
6. **C-17 must not guard every lifecycle hook as worker-only:** classify each side effect; server and worker both instantiate plugins, and multiple workers require distributed singleton/idempotency controls.
7. **Migration generation must be version-verified:** current Vendure CLI documentation shows `npx vendure migrate -g <name>` to generate and `npx vendure migrate -r` to run pending migrations. Kiro must still check the installed CLI help and project migration configuration before execution; no migration should be applied to production without explicit release authorization.
8. **C-11/C-18 must reflect current fulfillment code:** session and room product fulfillment already create `BbbEntitlement` in the supplied listener. The comment about a legacy BbbEnrollment-based room path is stale; verify all remaining manual/dashboard/policy consumers before migrating.
9. **Do not retire `BbbOrganizationMember`:** it is the trainer/org-admin identity used by scheduled sessions. `BbbOrganizationMembership` is a separate internal-staff model.
10. **Do not add an entitlement unique index without review:** revoke/re-grant history is intentional and protected by the existing lock/history design.
11. **C-29 test commands must be discovered from the checkout:** the attached source did not include `package.json`; use actual scripts and report unrun tests honestly.
12. **Dashboard and storefront are separate:** `defineDashboardExtension` is for Vendure's React Dashboard; course learner/staff pages must be built in the actual Next.js `edu-frontend` repository.

---

## 7. Kiro execution report template

For each task, Kiro should return:

```text
Task: C-XX — <title>
Status: DONE | BLOCKED | PARTIAL
Vendure version verified: <version>
Files changed: <paths>
Migration: none | generated <file> (not applied) | applied to isolated test schema
GraphQL changes: Admin API <fields> / Shop API <fields> / none
Authorization: <checks and permissions>
Tests run: <exact commands and results>
Tests skipped: <command + reason>
Invariants checked: <names + status>
Open decisions/blockers: <items>
```

Kiro CLI must not claim a task is complete if tests were skipped, a migration was not reviewed, or authorization was inferred rather than exercised.


## 8. Follow-up implementation guidance incorporated

The subsequent implementation-guidance note adds these checkout-confirmed facts and refinements; Kiro must verify each against the current working tree before changing code:

- `vendure-config.ts` registers `new TenantChannelAssignmentStrategy()` under `authOptions.customerChannelAssignmentStrategy`; search for this property key in the current file rather than relying on a line number, which will change as the file evolves. Do not create or register another strategy.
- `TenantLearnerMembershipService.isActiveMember()` exists. Promote it into the `LearnerAdmissionPort` in C-10. Until then, retain the current direct strategy implementation.
- `TenantLearnerMembershipService.create()` returns an existing row unchanged for any status; make re-admission explicit for `LEFT`/`REVOKED`.
- `suspend(reason)` currently discards the reason; fix this in C-02 alongside the membership transition log, not later in C-14.
- `TenantDeletionService` does not currently transition academy membership in either leave or full-delete handling; C-03 must call the C-02 admission transition API so it remains the single writer.
- `TenantPlugin.onApplicationBootstrap()` registering per-process deletion callbacks is correct; do not add an arbitrary worker-only guard. Audit BBB scheduled/external work in C-17 instead.
- The private `rawId()` pattern already exists in `TenantDeletionService`; C-09 extracts/standardizes it and separately resolves `InstructorProfile.channelId` numeric storage versus string membership storage.
- The one-time Razorpay webhook already has raw-body HMAC, immutable persist-first inbox, event ID deduplication and BullMQ reconciliation; C-08 is a test/audit task.
- The BBB checksum option is already configured as `sha256` with probe evidence; C-07 documents and validates the configured standard API and inbound hook behavior, without adding a per-server DB field unless deployment evidence requires it.
- The strategy's `false` result is not request denial. A customer may still use the Channel for the current session; all sensitive API/service operations must check membership independently.

**Immediate Phase 0 order:** C-00 → C-01 → C-02 → C-03 → C-04 → C-05/C-06/C-07/C-08. C-03 is directly after C-02; C-04 only verifies the already-configured strategy.


## 9. Kiro CLI and Vendure documentation references

- Kiro CLI commands and session resume: https://kiro.dev/docs/cli/reference/cli-commands/
- Kiro CLI Plan mode and read-only restrictions: https://kiro.dev/docs/cli/chat/planning-agent/
- Kiro CLI quick start, workflow selection and approval prompts: https://kiro.dev/docs/cli/quick-start/
- Kiro project configuration scopes (`.kiro/`, steering, specs, workflows): https://kiro.dev/docs/cli/chat/configuration/
- Vendure plugin system, GraphQL extension, Channel, customer assignment, payments, lifecycle and migration references are listed in Section 1.

**Version note:** Kiro CLI changes frequently. The operator must run the installed `kiro-cli --version` and help commands; use the installed CLI's actual Plan-mode selector and command syntax. The task plan does not require a particular model or harness version.
