# Saa9vi — Vendure-Compliant Refactoring and Learning Domain Task Plan for Cline

**Review date:** 1 November 2026  
**Target:** Existing Saa9vi Vendure project; recent project context identifies Vendure **3.8.1**. Cline must verify the actual installed version in `package.json` and the lockfile before making changes.  
**Purpose:** Turn the combined refactoring assessment and Course Domain proposal into a safe, sequenced implementation register.  
**Status:** Design and task specification only. No source code, migrations, or database state has been changed by this review.

---

## 0. Instructions Cline must follow

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
12. Cline should implement one task at a time, run its listed acceptance checks, update the task register, and produce a concise changed-files/test report before proceeding to the next task. Prefer small commits or clean checkpoints for high-risk refactors.

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

Therefore, the strategy alone cannot implement academy admission. Registration, checkout, course enrollment and BBB access need their own service-level/admission checks. Cline must test those paths independently.

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

Do not use `npx vendure migrate <plugin-name>` as a presumed plugin-selection syntax. Do not use a bare `--generate` without the required migration name. Cline must verify `npx vendure migrate --help` against the installed project's CLI and use the migration location already configured by the repository.

Reference: [Vendure CLI and migrations](https://docs.vendure.io/current/framework/developer-guide/cli) and [Migration workflow](https://docs.vendure.io/current/framework/developer-guide/migrations)

---

## 2. Code-grounded current-state baseline

The uploaded plugin source snapshot covers the BBB, Tenant, Payments, Subscription, Customer Suspension, Marketplace, CMS and other plugin code. The platform and customer-deletion files were also attached. The following are source findings, not claims that a full build or runtime test was executed during this review.

| Area | Current state observed in supplied source | Consequence for Cline |
|---|---|---|
| BBB API | `BbbApiService` already implements request signing and create/join/getMeetingInfo/end API operations. `checksumAlgorithm` is currently a plugin option limited to `sha1`/`sha256`, defaulting to SHA-256. Known-answer tests cover both. | Do not port/rebuild the PHP API library. Verify deployed server compatibility and harden existing adapter only where evidence requires it. |
| BBB lifecycle | Existing room, scheduled-session, meeting, server selection, capacity, provisioning, webhooks, metering, attendance and reconciliation services exist. | Learning should call existing boundaries instead of creating another live-class subsystem. |
| BBB access | `BbbRoomAccessService` is the INV-027 shared evaluator. The current policy has multiple sources, including membership, legacy member, entitlement and enrollment paths. | Preserve one preview/join policy. Inventory and retire individual legacy inputs only after a consumer audit. |
| BBB entitlement | `BbbEntitlementService` is used by fulfillment and grant paths. The entitlement history deliberately allows revoke/re-grant history and has locking/idempotency behavior. | Do not add a plain unique `(customerId,type,resourceId)` constraint that would destroy the intended history model. |
| BbbEnrollment | Legacy entity and admin mutation/UI still exist. The manual `createBbbEnrollment` path checks an ACTIVE `TenantLearnerMembership`; the order-fulfillment listener's room product path currently creates a `bbb_room` entitlement, although comments still describe a legacy enrollment path. | Inspect every reader/writer. Do not assume fulfillment still writes `BbbEnrollment`; update stale comments after verifying all callers. Keep historical rows during the transition. |
| Organization roles | `BbbOrganizationMember` stores organization trainer/org-admin membership and is referenced by scheduled sessions as the trainer. `BbbOrganizationMembership` models a separate internal-staff access path. | Neither is equivalent to student enrollment. Keep both until their separate responsibilities have approved replacements. |
| Learner admission | `TenantLearnerMembership` entity and service exist. Service methods include create/find/activate/updateActivity/suspend/revoke. The current `create()` returns an existing row unchanged. The BBB Admin resolver reads membership using string-named repository access in its H1/H2 checks. No production workflow creating memberships was identified in the supplied source search; e2e fixtures seed rows. | Add reachable admission operations and a typed cross-plugin boundary. Explicitly handle re-admission; do not rely on `create()` to reactivate old rows. |
| Channel assignment | `TenantChannelAssignmentStrategy` exists and checks for ACTIVE membership. The strategy class is present in TenantPlugin source. `vendure-config.ts` was not supplied, so its registration is unverified. | Verify actual strategy registration before assuming it is active. |
| Tenant profile | The Admin resolver accepts `channelId` for tenant-profile reads and passes `input.channelId` to the update service. A tenant administrator's channel ownership is not checked in that resolver before the service call. | Add cross-channel read and update tests and derive tenant scope from `ctx`; retain an explicit SuperAdmin cross-channel path if required. |
| Customer deletion | `CustomerDeletionService` has channel-scoped and full-delete handler registries. BBB, Tenant and Reviews plugins register handlers. The supplied Tenant deletion handler anonymizes instructor profiles; membership lifecycle cleanup was not present in the supplied path. | Register membership leave/revoke behavior through the existing deletion registry; do not introduce a second deletion orchestrator. |
| Customer suspension | `CustomerChannelStatus` blocks new checkout at `ArrangingPayment`; its service records reasons and change logs. `TenantLearnerMembership.status` is an admission status and is used by H1/H2. Their semantics are not currently identical. | Do not merge them automatically. First specify whether suspension affects new checkout only, all course access, existing entitlements, or several of these. |
| One-time Razorpay | `PaymentsPlugin` already has `razorpayPaymentHandler`, `RazorpayCheckoutService`, raw-body HMAC-SHA256 verification, `PaymentWebhookEvent`, persist-first controller and BullMQ reconciliation. Settling events are currently `payment.captured` and `order.paid`. The handler has empty config args and uses environment credentials. | Audit and extend tests; do not create a duplicate handler/controller/inbox/queue. |
| Recurring Razorpay | `SubscriptionPlugin` has a separate recurring billing webhook flow and provider inbox. | Preserve the separation from one-time commerce. |
| Tenant payment provisioning | `TenantRegistrationService` currently assigns the platform Razorpay PaymentMethod to new tenant channels. The one-time handler uses platform process credentials. | This conflicts with seller-owned payment collection. Do not enable platform-credentialed checkout as a tenant payment method by default. |
| Course domain | No persistent `LearningCourse`, `CourseTemplate`, `CourseTool` or `CourseEnrollment` aggregate was found in the supplied backend source. `LearningCourse` in `myLearningDashboard` is a GraphQL projection over entitlements and scheduled sessions, not a course entity. | Build a distinct LearningPlugin. Do not rename or repurpose the current dashboard projection as the course entity. |
| Course-adjacent building blocks | `BbbScheduledSession`, `BbbSessionTemplate`, `SessionAttendance`, `BbbInstructorAssignment`, `TenantLearnerMembership` and instructor profiles exist. | Reuse them through service boundaries; avoid duplicating schedule, attendance or instructor records. |
| Built-in resolver overrides | Tenant resolver source overrides built-in `administrators`, `administrator`, `roles` and `role` query fields to implement Saa9vi's channel-specific visibility requirements. | Keep an explicit known-overrides register and regression tests across Vendure upgrades. |

### Evidence not supplied / must be read in the actual checkout

- `vendure-config.ts` (including `customerChannelAssignmentStrategy`, `entityAccessControlStrategy`, order processes, database options, plugins and worker configuration).
- `package.json` and lockfile (exact versions and available scripts).
- Tenant plugin GraphQL SDL / API extensions (to verify exact current input types).
- Migrations directory and migration configuration (including the current baseline state).
- `edu-frontend` repository (Next.js routes, GraphQL documents/codegen, auth and tenant routing).
- Deployment topology and actual configured BBB server versions/checksum capabilities.

Cline must not fill these gaps with assumptions.

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

## 4. Sequenced Cline task register

Tasks are deliberately ordered by dependency. Cline should not start Phase 3 while Phase 0 admission/security blockers remain open.

### Phase 0 — Baseline verification and platform safety

#### C-00. Verify the checkout, installed Vendure behavior and task commands

**Files/areas:** `package.json`, lockfile, `vendure-config.ts`, `src/migrations`, plugin registration, test scripts, `docs/architecture/*`.

**Steps:**
1. Record exact installed versions; verify the CLI help for the installed project.
2. Confirm the plugin load order and configuration hooks.
3. Confirm whether `TenantChannelAssignmentStrategy` is actually configured.
4. Confirm `entityAccessControlStrategy` is default/unset or custom-configured.
5. Record all existing test scripts and exact paths for tenant, BBB, customer-deletion, payment, and Vendure channel-isolation tests.
6. Record all existing migrations and the current pending migration state without running a destructive command.
7. Confirm whether storefront source is available in the workspace.

**Done when:** `docs/implementation/cline-baseline.md` lists exact versions, plugin/config wiring, existing commands, test paths, migration location and missing artifacts. No application code changed.

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
3. Preserve `create()`'s current idempotent behavior or replace it deliberately; do not treat an existing LEFT/REVOKED row as a successful re-admission.
4. Add explicit admission/re-admission methods with actor, reason and timestamps.
5. Add append-only `TenantLearnerMembershipLog` recording membership ID, old/new status, reason, actor and transition timestamp. Preserve the historical log on re-admission.
6. Expose typed GraphQL operations for authorized academy staff. Suggested names: `admitTenantLearner`, `activateTenantLearner`, `suspendTenantLearner`, `revokeTenantLearner`, and a paginated `tenantLearners` directory. Reuse the existing Shop API `leaveAcademy` path for self-service departure.
7. Register a tenant-oriented permission such as `TenantManageAdmissions` or `TenantManageLearners`; do not use a BBB permission for general academy admission.
8. Decide whether Shop API or Admin API is used for each actor based on the actual frontend and role model; do not duplicate all mutations in both APIs by default.

**Done when:** e2e covers new admission, duplicate admission, activation, suspension with reason, re-admission, revocation and unauthorized actor. Status transition logs contain the expected actor/reason/time.

#### C-03. Integrate membership with existing account leave/deletion orchestration (F4)

**Known area:** `src/platform/customer-deletion/customer-deletion.service.ts`, `src/plugins/tenant-plugin/tenant-plugin.plugin.ts`, `TenantDeletionService`, customer-deletion e2e.

**Steps:**
1. Register a TenantPlugin handler through the existing `CustomerDeletionService.registerChannelScopedHandler()` and `registerFullDeleteHandler()` hooks.
2. On `leaveAcademy`, change only the current channel's membership to `LEFT`.
3. On full account deletion, transition membership records to `REVOKED` or the agreed terminal status while retaining audit history.
4. Keep handler behavior idempotent because deletion handlers may be retried after partial failures.
5. Make sure admission/BBB access denies LEFT/REVOKED membership where required.
6. Do not delete immutable BBB usage, payment or order history.

**Done when:** `customer-deletion.e2e-spec.ts` asserts membership state and logs for both leave-channel and full-delete paths; repeated handler execution is safe.

#### C-04. Verify and configure CustomerChannelAssignmentStrategy correctly (F2)

**Known area:** `src/plugins/tenant-plugin/config/tenant-channel-assignment.strategy.ts`, actual `vendure-config.ts`.

**Steps:**
1. Confirm whether the existing strategy is registered in `authOptions.customerChannelAssignmentStrategy`; the uploaded source does not include `vendure-config.ts`.
2. If not registered, add the existing strategy at the documented Vendure configuration point; do not create another implementation.
3. Preserve the strategy's intended meaning: allow automatic assignment only when an ACTIVE academy membership exists.
4. Add tests proving that an authenticated user is not automatically assigned to another tenant Channel merely by authenticating against that Channel.
5. Separately test registration and checkout. Vendure explicitly skips this strategy during those flows, so add the appropriate registration/admission and order/payment gates rather than assuming this strategy protects them.
6. Keep service-level tenant membership checks as the authorization boundary. A false strategy result is not an API authorization denial.

**Done when:** tests independently prove (a) authenticated channel auto-assignment policy, (b) registration behavior, (c) checkout behavior, and (d) service-level access denial for unadmitted customers.

#### C-05. Record the seller-payment ownership decision and remove unsafe tenant use of platform credentials (F5)

**Known area:** `src/plugins/payments/config/razorpay-payment-handler.ts`, `RazorpayCheckoutService`, `src/plugins/tenant-plugin/services/tenant-registration.service.ts`, PaymentMethod provisioning and payment role fixtures.

**Steps:**
1. Record the currently agreed seller-owned collection model: Saa9vi marketplace discovery; academy collects its own course fees; Saa9vi bills its own platform services separately.
2. Determine whether tenant course purchases are external to Vendure or whether Vendure should record an offline/manual payment and require tenant staff reconciliation. Do not assume a per-tenant online Razorpay integration is needed.
3. Stop assigning the platform Razorpay PaymentMethod to tenant channels unless an explicit, approved Saa9vi-central merchant model supersedes the seller-owned model.
4. Keep the platform Razorpay handler for Saa9vi's own platform/subscription commerce where required; keep recurring subscription billing separate.
5. If a future decision requires a tenant's own Razorpay merchant integration, design an encrypted `TenantPaymentAccount` or equivalent credential store. Use the active channel to resolve the account. Do not store key secrets in ordinary handler args. Design webhook routing so the correct account secret is resolved securely before raw-body signature validation.
6. Check manual/offline payment capabilities already available in the installed Vendure version before adding custom handlers.

**Done when:** ADR records money flow, payment ownership, admission confirmation and refund responsibility; the platform Razorpay credential is not silently presented as the seller's credential; tests cover the selected model.

#### C-06. Repair tenant role permissions without expanding payment privileges

**Known area:** tenant registration/role reconciliation, tenant role fixtures and `PaymentHygieneChecker`.

**Steps:**
1. Add the admission permission to the intended academy roles only.
2. Preserve the project's current read-only `ReadPaymentMethod` posture where appropriate; do not grant `CreatePaymentMethod`, `UpdatePaymentMethod` or `DeletePaymentMethod` to tenant roles by accident.
3. Update role reconciliation and e2e fixtures/snapshot tests.
4. Verify existing tenants receive the intended permission through the approved repair operation.

**Done when:** role-repair operation is idempotent; permission checker and tenant role tests pass; no tenant role gains unintended payment-method administration.

#### C-07. Audit BBB checksum configuration against deployed servers (do not rebuild the adapter)

**Known area:** `BbbApiService`, BBB plugin options, `BbbServer`, `BbbHooksService`, checksum tests and production readiness documentation.

**Current fact:** current `BbbApiService` already supports SHA-1 and SHA-256 through a plugin-level option, defaulting to SHA-256. It does not currently expose a per-server algorithm in the uploaded source.

**Steps:**
1. Query/document each deployed BBB server's accepted `supportedChecksumAlgorithms` and version. Do not infer algorithm capability from a generic “latest BBB” claim.
2. Verify whether every server in the load-balanced pool accepts the currently configured plugin-level algorithm.
3. If all servers use a common accepted algorithm, retain the existing option and add deployment validation/documentation rather than a schema migration.
4. If the pool is heterogeneous, propose per-server configuration only after confirming how the hook endpoints must be signed for each deployed BBB version.
5. Distinguish standard API checksum handling from webhook-hook checksum handling. In particular, BBB servers below 3.0 have a documented SHA-1-only hook compatibility constraint in the PHP API library.
6. Add SHA-384/SHA-512 only if the actual deployed server configuration accepts them and the adapter allow-list/tests are extended deliberately. Do not declare SHA-512 the universal default.

**Done when:** every provisioned server has a verified compatible algorithm; standard API and hook tests cover the applicable cases; legacy servers continue working; no unneeded entity migration is introduced.

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
2. Implement/retain a separate `rawId()`/entity-ID decoding utility where an encoded GraphQL ID is converted to the persistence representation.
3. Do not combine channel-ID normalization and entity-ID decoding in one helper.
4. Replace duplicated casts/decoders incrementally; do not do a blind global codemod across code that legitimately accepts Vendure `ID` types.
5. Resolve the `InstructorProfile.channelId` integer-vs-string inconsistency only through a reviewed migration and regression tests.
6. Add tests for production ID strategy and the test ID strategy used by e2e fixtures.

**Done when:** helpers have clear contracts; known number/string mismatch regressions pass; no unreviewed bulk coercion remains.

#### C-10. Add a typed learner-admission port for cross-plugin use

**Known area:** BBB resolver currently uses `getRepository(ctx, "TenantLearnerMembership")` for H1/H2 checks.

**Steps:**
1. Define a neutral `LearnerAdmissionPort` contract/token with operations needed by BBB, initially `isActiveMember(ctx, customerId, channelId)`.
2. Keep the membership entity and service in TenantPlugin unless a separate ADR makes admission a platform-owned domain.
3. Register the TenantPlugin implementation through an explicit provider token/export/import arrangement. Avoid circular plugin imports.
4. Replace string-named entity repository access in BBB with the port.
5. Keep the channel scope derived from the request/resource, and fail closed if the admission service cannot be resolved or checked.

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

#### C-13. Introduce tenant-oriented permissions for admission

**Steps:**
1. Register `TenantManageAdmissions` or `TenantManageLearners` as the admission permission.
2. Grant it only to roles that should manage academy learners.
3. Keep BBB infrastructure/session/room permissions separate.
4. Update role reconciliation and e2e role fixtures.

**Done when:** admission resolvers use the tenant-oriented permission and BBB permissions do not become an accidental proxy for academy admission.

#### C-14. Keep academy suspension and customer checkout suspension distinct until policy is decided

**Current source semantics:**
- `CustomerChannelStatus` is read by the `CustomerSuspension` order process and blocks new checkouts at `ArrangingPayment`; the plugin documentation says existing entitlements continue until natural expiry.
- `TenantLearnerMembership.status` controls academy admission and is checked by BBB H1/H2.

**Steps:**
1. Document these separate semantics in an ADR note.
2. Decide whether an academy suspension should additionally revoke existing course/live access or only block future purchases.
3. If access revocation is required, implement it as an explicit coordinated policy transition (and preserve the existing status-change log); do not simply delete one entity or treat the statuses as interchangeable.
4. Preserve platform-wide suspension independently.
5. Fix the existing `TenantLearnerMembershipService.suspend(reason)` behavior that currently accepts but does not persist the reason, either by adding fields/logging or by delegating to the membership log.

**Done when:** a behavior matrix defines effect on new checkout, existing course access, existing BBB entitlement, other academies and platform-wide status. Tests cover each chosen behavior.

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

#### C-17. Audit server/worker initialization and scheduled work

**Known area:** BBB plugin has queue processors, scheduled tasks, webhook setup/reconciliation and multiple `OnApplicationBootstrap` handlers. Lifecycle hooks execute in both server and worker.

**Steps:**
1. Inventory every plugin lifecycle hook, job queue processor, periodic task, external webhook registration and startup reconciliation.
2. Label each as server-only, worker-only, per-process, or distributed singleton.
3. Use `ProcessContext.isServer`/`isWorker` only for the appropriate work. Do not put CustomerDeletionService handler registration or all module initialization behind an arbitrary worker guard.
4. For singleton work across multiple worker replicas, use the existing queue scheduler/unique job or a distributed lock; a ProcessContext check alone is insufficient.
5. Check `BbbPlanCapacityReconciliationBootstrap` and BBB webhook registration for repeated server/worker or replica execution.
6. Keep queue processors idempotent and use durable database uniqueness/locks for billing facts.

**Done when:** a process ownership table exists; no unintended duplicate external registrations/scheduled work occur; worker/server bootstrap logs and tests are clean.

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
1. Use the installed project's supported `npx vendure add --plugin ...` flow after checking CLI help. The docs example is `npx vendure add --plugin cms`; use a valid kebab-case plugin name and the corresponding class name.
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

**Repository:** `edu-frontend` (not present in the supplied source attachments; Cline must inspect the actual repository).

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
6. Never run a migration against production as part of autonomous Cline work without explicit deployment authorization.

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
2. **C-01 → C-04** tenant profile security and operational admission.
3. **C-03** customer leave/deletion membership cleanup (after C-02).
4. **C-05 → C-08** payment ownership decision, role repair, BBB algorithm compatibility audit and Razorpay webhook audit.
5. **C-09 → C-17** tenant/id normalization, admission port, legacy consumer inventory, suspension semantics, resolver override protection and server/worker audit.
6. **C-18** legacy enrollment conversion only after its consumer inventory and access contract are proven.
7. **C-19** BBB code splitting only when needed and with behavior tests; it is not a prerequisite for LearningPlugin.
8. **C-20** tenant-owned payment only if the approved merchant model requires it.
9. **C-21 → C-30** LearningPlugin and frontend course implementation.
10. **C-31 → C-33** continuous standing gates throughout; final release gate after Phase 3.

### Do not start LearningPlugin implementation until these minimum gates pass

- Cross-tenant TenantProfile read/write is denied.
- Academy learner admission has a reachable, tested creation/re-admission workflow.
- Leave/deletion changes academy membership appropriately.
- Actual `CustomerChannelAssignmentStrategy` wiring is known, and its limits are covered by tests.
- The active membership/BBB access dependency is expressed through a stable port or service boundary.
- No new course role can elevate BBB moderator permissions.

---

## 6. Important corrections to the earlier pasted C-01–C-29 list

1. **C-04 needs a limitation note:** Vendure skips `CustomerChannelAssignmentStrategy` during registration/checkout and it does not block API access. Add separate gates and tests for those flows.
2. **C-05/C-17 must not put tenant secrets in handler args:** Vendure's standard `ConfigArgType` list has no password/secret type. Use encrypted account storage if per-tenant credentials are approved. Given the agreed seller-collects-own-payment model, first decide whether a tenant Razorpay handler is necessary at all.
3. **C-07 must not assume SHA-512 is the BBB default:** current Saa9vi code supports SHA-1/SHA-256 with SHA-256 default. Verify actual server capability; distinguish regular API checksums and hook checksum compatibility. Add per-server configuration only if the current load pool requires it.
4. **C-08 is primarily an audit/test task:** raw-body HMAC-SHA256, persist-first `PaymentWebhookEvent`, event-ID idempotency and BullMQ reconciliation already exist for one-time Razorpay.
5. **C-14 must preserve the semantic difference between suspension and academy admission:** `CustomerChannelStatus` blocks new checkout; academy membership controls admission. Do not consolidate both into one status without explicit product behavior.
6. **C-17 must not guard every lifecycle hook as worker-only:** classify each side effect; server and worker both instantiate plugins, and multiple workers require distributed singleton/idempotency controls.
7. **Migration commands in C-02/C-20/C-27 need correction:** use the installed CLI's supported `migrate -g <name>` or interactive mode, then `migrate -r`; do not assume `migrate <plugin-name>`.
8. **C-11/C-18 must reflect current fulfillment code:** session and room product fulfillment already create `BbbEntitlement` in the supplied listener. The comment about a legacy BbbEnrollment-based room path is stale; verify all remaining manual/dashboard/policy consumers before migrating.
9. **Do not retire `BbbOrganizationMember`:** it is the trainer/org-admin identity used by scheduled sessions. `BbbOrganizationMembership` is a separate internal-staff model.
10. **Do not add an entitlement unique index without review:** revoke/re-grant history is intentional and protected by the existing lock/history design.
11. **C-29 test commands must be discovered from the checkout:** the attached source did not include `package.json`; use actual scripts and report unrun tests honestly.
12. **Dashboard and storefront are separate:** `defineDashboardExtension` is for Vendure's React Dashboard; course learner/staff pages must be built in the actual Next.js `edu-frontend` repository.

---

## 7. Cline execution report template

For each task, Cline should return:

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

Cline must not claim a task is complete if tests were skipped, a migration was not reviewed, or authorization was inferred rather than exercised.
