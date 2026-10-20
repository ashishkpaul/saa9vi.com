# Cline Execution Plan: Reduce Redundant Code Around Vendure 3.8.0

## Mission

Review and implement a narrow, test-backed cleanup of the Saa9vi Vendure backend so the application delegates framework-level work to Vendure 3.8.0 wherever possible, while preserving Saa9vi-specific education, tenant, billing, security, and audit behavior.

This is **not** a broad rewrite. Treat the existing implementation as production-sensitive. Make small, independently reviewable changes, run tests after each phase, and report anything blocked by an unresolved business/data-retention decision.

## Non-negotiable repository rules

1. Start by checking `git status`, current branch/HEAD, and `@vendure/core` in `package.json`/lockfile. The source review was performed against a clean snapshot at `b1c43ab` with `@vendure/core@3.8.0`, but verify the actual checkout; **do not reset, checkout, or overwrite user changes**.
2. Read and follow `.clinerules` and the repository's migration instructions.
3. Do not manually change business records in the database. Data mutations must use supported GraphQL APIs/HTTP clients. Test fixtures may follow the repository's established isolated-test-schema conventions.
4. Schema changes and migrations must be produced and managed through the Vendure CLI workflow (`npx vendure migrate --generate`, then inspect and apply migrations using the project's documented `npx vendure migrate` workflow). Never hand-edit production database rows or silently edit an already-applied migration.
5. Do not remove tenant/channel isolation, authorization checks, idempotency, webhook inbox persistence, immutable billing/audit records, or compatibility paths merely to reduce line count.
6. Do not add `@vendure/telemetry-plugin` or another dependency automatically. First establish whether existing OpenTelemetry coverage is adequate and propose a dependency addition only if genuinely required.
7. Never report a test as passed unless it was actually run and its result was observed. Do not suppress, skip, or weaken tests to obtain a green result.
8. Keep changes focused. Prefer one logical change per commit if commits are part of the current workflow; do not create commits without the user's established repository workflow/permission.

## Phase 0 — Establish the baseline (no edits)

1. Inspect the actual checkout, the relevant `.clinerules`, `package.json`, lockfile, Vendure config, and migration configuration.
2. Confirm the installed/locked Vendure Core version is 3.8.0. If it differs, stop assuming 3.8-specific behavior and report the difference before using any version-sensitive refactor.
3. Inspect these sources before editing:
   - `src/plugins/tenant-plugin/services/tenant-registration.service.ts`
   - `src/platform/invariants/cli.ts`
   - `src/platform/tracing/*` and `src/platform/tracing/README.md`
   - `src/platform/invariants/runner.ts` and `src/platform/tracing/runtime-causality-validator.ts`
   - `src/plugins/bigbluebutton-plugin/entities/bbb-organization.entity.ts`
   - `src/plugins/tenant-plugin/entities/tenant-profile.entity.ts`
   - `docs/implementation/known-bugs.md` and the relevant domain-model/ADR docs
   - `src/plugins/bigbluebutton-plugin/entities/bbb-enrollment.entity.ts`
   - `src/plugins/bigbluebutton-plugin/entities/bbb-entitlement.entity.ts`
4. Record baseline build/typecheck and targeted test results using the package's actual scripts. Do not start editing until existing failures are distinguished from failures introduced by this work.
5. Produce a brief baseline note in the final report: branch/HEAD, Core version, relevant existing failures, and commands actually run.

## Phase 1 — Refactor tenant registration to supported Vendure services

**Priority:** highest. The current registration service already uses `SellerService.create`, `ChannelService.create`, and `RoleService.create`, but also manually creates a `User`, a `NativeAuthenticationMethod`, password hash, role association, and `Administrator` record through repositories.

### Required work

1. Read the installed Vendure 3.8.0 service implementations/types and the repository's existing tenant-registration tests. Do not rely solely on current online docs or assumptions about service signatures.
2. Identify which manual steps can safely be replaced by `UserService`, `AdministratorService`, `RoleService`, authentication APIs, or another supported core service.
3. Preserve the established behavior and security invariants:
   - `TenantRegistrationLog` is persisted as `PENDING` before tenant creation begins.
   - Registration rate limiting under SEC-003 remains active.
   - The new administrator is created unverified and the verification email/event flow continues.
   - The custom `TENANT_ADMIN_ROLE_PERMISSIONS` role remains scoped to the new tenant channel and is not replaced by SuperAdmin.
   - BUG-024/INV-030 auto-provisions only the intended Razorpay payment method; tenant roles must not gain payment-method write privileges.
   - Channel, Seller, administrator, stock-location, hostname, and profile provisioning behavior remains intact.
4. The existing repository-based role-to-channel association is a known workaround for the permission checks on a newly-created channel. **Keep it unless a supported, tested native-service/context-sequencing path is demonstrated.** Vendure 3.8's `ChannelService.create()` assigning default roles does not replace the custom tenant admin role assignment.
5. Remove manual user/authentication/administrator persistence only where an equivalent supported path preserves verification, events, password handling, role links, and channel visibility. Do not bypass one permission check by introducing a broader privilege grant.
6. Update comments to document remaining framework workarounds accurately; delete stale comments only after the replacement is proven.

### Required regression suites

Run the repository-supported commands for these existing suites (verify the exact paths/scripts first):

- `src/plugins/tenant-plugin/e2e/tenant-plugin.e2e-spec.ts`
- `src/plugins/marketplace/e2e/marketplace.e2e-spec.ts`
- `src/plugins/marketplace/e2e/convergence.e2e-spec.ts`
- `src/plugins/subscription/__tests__/adr-046-self-serve.e2e-spec.ts`

Also run the relevant typecheck/build. Preserve all tests; do not weaken assertions.

### Acceptance criteria

- Registration uses supported Vendure services for the framework responsibilities that those services can correctly perform.
- Existing registration/audit/verification/role/channel/payment provisioning behavior remains unchanged.
- The role-to-channel repository workaround is either retained with its reason documented or replaced by a demonstrated supported path.
- All applicable existing regression suites pass, or failures are clearly identified as pre-existing/environmental with evidence.

## Phase 2 — Fix the vacuous runtime-causality check

**Priority:** next; this is an independent correctness fix.

### Problem to verify

The current invariant CLI constructs a fresh empty `RuntimeTraceStore` and runs `RuntimeCausalityValidator` against it. If the validator loops over zero traces and returns success, the CLI reports a green check without verifying any runtime causality.

### Required work

1. Reconfirm the behavior in the current checkout; inspect `cli.ts`, `RuntimeTraceStore`, `RuntimeCausalityValidator`, `CheckResult`, and `InvariantRunner`.
2. Choose the smallest safe correction:
   - Prefer loading actual persisted traces only if a reliable, documented data source and appropriate runtime context are already available; otherwise
   - make an empty trace store report an explicit **no data / not verified** result that cannot be counted as a successful verification. If the existing result contract has no skipped/unknown status, extend it minimally and update reporting/tests; do not silently map “no data” to pass.
3. Validate that configured rules are actually evaluated when traces are present.
4. Add focused tests for at least:
   - empty store is not reported as verified/pass;
   - a trace satisfying the rule passes;
   - a trace violating the rule fails and reports the violation;
   - multiple rules/traces are accounted for as expected.
5. Ensure `verify:invariants` no longer gets an artificially successful score from the empty store. Update documentation so “no runtime evidence available” is distinguishable from “runtime invariants verified.”

### Acceptance criteria

- Empty data cannot produce “All runtime causality rules verified.”
- Real traces are validated when supplied.
- CLI output and aggregate invariant scoring represent pass/fail/no-data honestly.

## Phase 3 — Consolidate tracing scaffolding (wire-or-delete)

**Goal:** keep useful observability, eliminate dead or misleading scaffold, and preserve durable business audit records.

### Verify actual call sites before editing

Search the entire repository (not only `src/platform`) for imports, providers, injection points, instantiations, direct calls, tests, docs, and configuration references to:

- `CorrelationInterceptor`
- `WebhookRecorder`
- `BullMQTracer`
- `EventBusInterceptor`
- `EventLog`
- `RuntimeTraceStore`
- `RuntimeCausalityValidator`
- `PlatformTracingModule`
- `@opentelemetry/api` and any Vendure telemetry package

The prior review found `CorrelationInterceptor` registered globally; no call sites for `WebhookRecorder`'s recording methods; no observed use of `BullMQTracer`; `EventBusInterceptor` not registered; and BBB API spans already using `@opentelemetry/api`. Reverify all of these against the live checkout.

### Decision rules

1. **Keep `CorrelationInterceptor`** if still globally active and useful; do not replace it without demonstrating an equivalent correlation-ID propagation path.
2. For `WebhookRecorder`, `BullMQTracer`, and `EventBusInterceptor`, choose and implement one explicit outcome per component:
   - wire it to a concrete required use case with appropriate tests, or
   - remove genuinely unused scaffolding, its providers/exports/imports, tests and stale README claims.
   Default to deleting unused scaffold in this cleanup rather than inventing new production behavior, unless an existing documented requirement proves it is needed.
3. Do not add a second copy of BBB webhook records. Keep `BbbWebhookEvent` and its retention/reconciliation behavior as the BBB webhook inbox unless code evidence establishes otherwise.
4. Preserve business/audit records, including `BbbWebhookEvent`, `TenantRegistrationLog`, `SubscriptionBillingAttempt`, deletion/revocation audit fields, and any event ledger with a proven business use. These are not interchangeable with OpenTelemetry spans.
5. Keep or remove `EventLog` and runtime causality infrastructure only after verifying who writes and reads it. Do not drop a durable table simply because one writer is currently unregistered; first establish whether persisted data, other writers, tests, or reconstruction consumers rely on it. If it has no live writer and no proven consumer, document this and scope any table-removal migration separately.
6. Do not install `@vendure/telemetry-plugin` as part of this change. If there is a real coverage gap, report a separate recommendation; retain current BBB spans unless a focused replacement test proves they remain covered.
7. Update `src/platform/tracing/README.md` and other affected docs to describe actual wiring, not planned wiring.

### Acceptance criteria

- Every retained tracing component has a real, documented use, and every removed component has no remaining references.
- No durable business audit path is lost.
- Build/typecheck and tracing-related tests pass.

## Phase 4 — Remove the unused `BbbOrganization.tenantProfileId` column

### Required work

1. Search the full repository, migrations, tests, scripts, docs, and generated code for `tenantProfileId`; confirm it is nullable, never written, and never read by an active code path in the current checkout.
2. Confirm that the authoritative association remains `BbbOrganization.channelId` and that `TenantProfile.tenantSlug` remains the slug source of truth. `BbbOrganization.channelId` has a unique index enforcing one organization per channel; **do not delete or weaken it**.
3. Generate a migration through the approved Vendure CLI workflow. Inspect the generated migration for unintended schema changes; never hand-edit live data or rewrite an applied migration.
4. Update the known-bugs/domain-model documentation to remove the obsolete 1:1 linkage language and record the resolved legacy column.
5. Run the tenant onboarding/provisioning, BBB organization, channel-isolation, migration, and relevant invariant tests.

### Acceptance criteria

- No live code path relies on `tenantProfileId`.
- The migration only removes the intended legacy schema element.
- The unique channel-to-organization invariant and slug synchronization remain covered by tests.
- Documentation agrees with the schema and implementation.

## Phase 5 — Resolve `BbbEnrollment` to `BbbEntitlement` migration safely

**Goal:** move toward the canonical entitlement model without losing existing access or audit history.

### What is already established

- `BbbEntitlement` is the target access primitive.
- `BbbEnrollment` is explicitly deprecated as a legacy access-control path and remains in use for some room-access and paid-fulfillment cases.
- `room-access.policy.ts` / `deriveRoomAccess()` is the canonical authorization evaluation and has a deliberate evaluation order. Keep it as the common gate for the room-status preview and join action.
- Existing code and ADR documentation defer cleanup partly to preserve trial-conversion audit history.

### Required work in this execution

1. Audit every writer, reader, Shop/Admin GraphQL operation, order-fulfillment branch, revocation path, customer deletion handler, trial-conversion path, import path, dashboard view, and test involving `BbbEnrollment` or `BbbEntitlement`.
2. Create a source-by-source migration matrix for at least `purchase`, `admin`, `invite`, `import`, and `trial_conversion`, including validity dates, room/session mapping, order IDs, revocation stamps, and duplicate/grant semantics.
3. Confirm whether the ADR already decides how `trial_conversion` and `import` records should be represented and whether historical rows must be retained. If not, do **not** invent a retention policy or delete the legacy table/path. Produce a clear decision-needed report and leave compatibility behavior intact.
4. If policy is explicit and the mapping is lossless, propose and test an additive, idempotent migration/compatibility stage first. Preserve audit trails and revocation semantics. Do not drop the old table/path until all consumers have been moved, a compatibility period is defined, and rollback is credible.
5. Keep the existing shared `deriveRoomAccess()` policy, ordering, and authorize-before-provisioning invariant unchanged unless a separately approved test-backed change is necessary.

### Acceptance criteria

- No learner loses or accidentally gains access through a migration.
- Trial-conversion/import history and revocation audit are preserved.
- The canonical access decision remains shared by preview and join.
- If business retention policy is unresolved, no destructive migration is made; the report states the exact decision required.

## Phase 6 — Final verification and report

1. Run the focused tests and build/typecheck for every changed area, plus the relevant full test suites where feasible.
2. Run the invariant CLI and show the corrected causality-check result; no-data must not be scored as a verified pass.
3. Inspect `git diff --check`, the final diff, all generated migrations, and `git status`.
4. Search for imports/references to removed classes/columns and update docs/tests/configuration as needed.
5. Do not make unrelated formatting or refactoring changes.

## Required Cline completion report

Return a concise but evidence-based report with:

- **Implemented:** each change and files affected.
- **Preserved:** security, channel scoping, billing/audit, verification, webhook persistence, and compatibility behaviors checked.
- **Commands run:** exact command and observed pass/fail result.
- **Migration status:** generated migration names, reviewed operations, and whether applied in the configured local/test environment. Never imply production migration was applied unless it was.
- **Remaining issues:** environmental failures, pre-existing failures, unresolved retention/policy decisions, or any item only audited but not implemented.
- **Git diff summary:** changed files and whether any unrelated/user changes were present.

Do not claim the project is fully verified if a relevant test could not run or if the runtime causality checker has no evidence to inspect.
