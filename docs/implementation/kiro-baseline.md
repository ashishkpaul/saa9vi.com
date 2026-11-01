# Saa9vi — Kiro CLI Baseline Report (C-00)

**Generated:** 1 November 2026  
**Branch:** `fix/phase-1a-hotfixes`  
**Latest commit:** `47e69b6` — "docs: record live BBB participant-count semantics from API Mate"  
**Checkout state:** 7 files modified (uncommitted); 3 new docs (untracked)  
**Mode:** Read-only baseline — no code, migrations, or database changed.

---

## 1. Installed versions

| Component | `package.json` | Lockfile (resolved) |
|---|---|---|
| `@vendure/core` | `3.8.1` | `3.8.1` ✓ |
| `@vendure/cli` | `3.8.1` (devDep) | `3.8.1` ✓ |
| `@vendure/dashboard` | `3.8.1` | `3.8.1` ✓ |
| `@vendure/testing` | `3.8.1` (devDep) | present ✓ |
| TypeORM | — (transitive) | `0.3.31` |
| TypeScript | `5.8.2` (devDep) | `5.8.2` ✓ |
| NestJS core | — (transitive) | `12.3.2` |
| PostgreSQL driver (`pg`) | `8.21.0` | `8.21.0` ✓ |
| `ts-node` | `10.9.2` (devDep) | `10.9.2` ✓ |
| `vitest` | `^4.1.10` (devDep) | `4.1.12` |
| `bullmq` | `^5.79.0` | `5.81.5` |
| Node.js (runtime) | — | `v22.22.2` |

**Note:** TypeORM `0.3.31` is a transitive Vendure dependency, not a direct `package.json` entry. Do not add it as a direct dependency.

---

## 2. `authOptions.customerChannelAssignmentStrategy`

**Status: Present in working tree, NOT YET COMMITTED.**

`git diff HEAD -- src/vendure-config.ts` shows:

```diff
+import { TenantChannelAssignmentStrategy } from "./plugins/tenant-plugin/config/tenant-channel-assignment.strategy";
...
+    // Phase 1b: invitation-aware channel assignment.
+    customerChannelAssignmentStrategy: new TenantChannelAssignmentStrategy(),
```

The HEAD commit on `fix/phase-1a-hotfixes` does **not** include this line. The execution plan's Section 8 says it is "confirmed in `vendure-config.ts`" — that is true only in the working tree.

**Action required before C-04:** Commit the working-tree changes so the strategy registration is in a stable, reviewable state before behavioral tests are written against it.

**Strategy implementation:** `src/plugins/tenant-plugin/config/tenant-channel-assignment.strategy.ts`  
- Queries `TenantLearnerMembership` repository directly (string-named `getRepository(ctx, TenantLearnerMembership)`).  
- Checks `status: 'ACTIVE'` for the `(customerId, channelId)` pair.  
- Fails closed (returns `false`) if `this.connection` is null.  
- Known limitation: `false` does not block API access, only prevents persistent channel assignment.

---

## 3. `entityAccessControlStrategy`

**Status: NOT SET — Vendure `DefaultEntityAccessControlStrategy` is active.**

No `entityAccessControlStrategy` key appears in `vendure-config.ts` (working tree or HEAD). Matches the execution plan.

---

## 4. Plugin registration order

From `src/vendure-config.ts` `plugins` array:

1. `GraphiqlPlugin` (dev/test only)
2. `AssetServerPlugin`
3. `DefaultSchedulerPlugin`
4. `BullMQJobQueuePlugin` (when `REDIS_HOST` set) / `DefaultJobQueuePlugin`
5. `RedisCachePlugin` (when `REDIS_HOST` set)
6. `DefaultSearchPlugin`
7. `EmailPlugin`
8. `DashboardPlugin`
9. `HardenPlugin`
10. `TenantPlugin`
11. `BigBlueButtonPlugin`
12. `CmsPlugin`
13. `ReviewsPlugin`
14. `LoadSimulationPlugin`
15. `MarketplaceIndexerPlugin`
16. `CustomerSuspensionPlugin`
17. `PlatformDashboardPlugin`
18. `PaymentsPlugin`
19. `SubscriptionPlugin`

**TenantPlugin imports:** `PluginCommonModule`, `CustomerDeletionModule`, `CommercialEntitlementModule`.

**TenantPlugin custom permissions registered** (via `configuration()`):
- `TenantProfilePermission` (CRUD)
- `InstructorProfilePermission` (CRUD)
- `MediaResourcePermission` (CRUD)

**Gap:** No `TenantManageAdmissions` or `TenantManageLearners` permission exists anywhere in the codebase. Required by C-02.

**Also in working-tree (uncommitted):**

```diff
+  entities: [..., TenantLearnerMembership],
+  providers: [..., TenantLearnerMembershipService],
```

`TenantLearnerMembership` entity and `TenantLearnerMembershipService` provider are added to `TenantPlugin` in the working tree but not yet committed.

---

## 5. Migration inventory

**Location:** `src/migrations/` (configured via `dbConnectionOptions.migrations`).  
**Count:** 5 files.

| Filename | Date | Description |
|---|---|---|
| `1793082717736-fresh.ts` | 2026-10-28 | Full initial schema (226 KB) |
| `1793265688264-add-bbb-server-load-fields.ts` | 2026-10-29 | BBB server load columns |
| `1793346434025-mcp_init.ts` | 2026-10-30 | MCP init |
| `1793511014520-add-reason-enrolled-to-bbb-enrollment.ts` | 2026-11-01 | Adds `reason`, `enrolledByUserId`, `enrolledAt` to `bbb_enrollment` |
| `1793512608531-add-tenant-learner-membership.ts` | 2026-11-01 | Creates `tenant_learner_membership` with unique index `(customerId, channelId)` |

**Applied state:** Cannot be determined without a live DB connection. Do not assume all 5 are applied.

**Migration/entity sync risk:** The `bbb-enrollment.entity.ts` working-tree diff adds `reason`, `enrolledByUserId`, `enrolledAt` columns. Migration `1793511014520` adds those same columns. Both exist on the branch; the entity change is uncommitted. If the migration has been applied to the DB but the entity is uncommitted, the schema is ahead of tracked code. Verify before generating new migrations.

**Migration CLI (verified from package.json):** Uses `npx vendure migrate`. Run `npx vendure migrate --help` to confirm installed flag syntax before use.

---

## 6. Test scripts and suites

**Test runner:** `vitest` with `vitest.config.mts`

### Named scripts

| Script | Spec file path |
|---|---|
| `npm run test:e2e` | All e2e specs |
| `npm run test:e2e:tenant` | `src/plugins/tenant-plugin/e2e/tenant-plugin.e2e-spec.ts` |
| `npm run test:e2e:bbb-isolation` | `src/plugins/bigbluebutton-plugin/__tests__/bbb-channel-isolation.e2e-spec.ts` |
| `npm run test:e2e:bbb-tiers` | `src/plugins/bigbluebutton-plugin/__tests__/bbb-permission-tiers.e2e-spec.ts` |
| `npm run test:e2e:room-access` | `src/plugins/bigbluebutton-plugin/__tests__/room-access.e2e-spec.ts` |
| `npm run test:e2e:bbb-room-linkage` | `src/plugins/bigbluebutton-plugin/__tests__/session-room-linkage.e2e-spec.ts` |
| `npm run test:e2e:bbb-webhook-http` | `src/plugins/bigbluebutton-plugin/e2e/bbb-webhook-controller.e2e-spec.ts` |
| `npm run test:e2e:bbb-lifecycle` | `src/plugins/bigbluebutton-plugin/e2e/s7a-lifecycle-characterization.e2e-spec.ts` |
| `npm run test:e2e:subscription-self-serve` | `src/plugins/subscription/__tests__/adr-046-self-serve.e2e-spec.ts` |
| `npm run test:e2e:webhook-signature` | `src/plugins/subscription/__tests__/webhook-signature-http.e2e-spec.ts` |
| `npm run verify:invariants` | `src/platform/invariants/cli.ts` |
| `npm run lint` | `tsc --noEmit` |

### Suites without named scripts (run via `test:e2e` or direct vitest path)

| Suite | Path |
|---|---|
| Customer deletion e2e | `src/platform/customer-deletion/customer-deletion.e2e-spec.ts` |
| Channel isolation | `src/platform/security/vendure-373-channel-isolation.e2e-spec.ts` |
| Financial boundary | `src/platform/security/vendure-373-financial-boundary.e2e-spec.ts` |
| Payment tests (unit) | `src/plugins/payments/__tests__/` (3 files) |
| Phase 1a hotfixes (NEW, uncommitted) | `src/plugins/bigbluebutton-plugin/__tests__/phase-1a-hotfixes.e2e-spec.ts` |

### BBB unit test suites (no e2e DB needed)

- `bbb-checksum.spec.ts` — SHA-256/SHA-1 known-answer vectors
- `bbb-webhook-auth.spec.ts` — Bearer + checksum (sha1/sha256/sha384/sha512)
- `bbb-api-url.spec.ts`, `bbb-api-errors.spec.ts`
- `tenant-role-bbb-boundary.spec.ts`

---

## 7. Admission workflow — `TenantLearnerMembershipService`

**File:** `src/plugins/tenant-plugin/services/tenant-learner-membership.service.ts`

### Methods present

| Method | Status |
|---|---|
| `findOne(ctx, customerId, channelId)` | ✓ |
| `findByCustomer(ctx, customerId)` | ✓ |
| `findActiveByChannel(ctx, channelId)` | ✓ |
| `create(ctx, input)` | ✓ — but returns any existing row unchanged, including `LEFT`/`REVOKED` |
| `activate(ctx, customerId, channelId)` | ✓ |
| `updateActivity(ctx, customerId, channelId)` | ✓ |
| `suspend(ctx, customerId, channelId, reason?)` | ✓ — **reason parameter is silently discarded** |
| `revoke(ctx, customerId, channelId)` | ✓ |
| `isActiveMember(ctx, customerId, channelId)` | ✓ — used by `TenantChannelAssignmentStrategy` |

### Confirmed gaps (C-02 work)

- `create()` returns a `LEFT` or `REVOKED` row unchanged — no re-admission guard.
- `suspend(reason)` discards the reason — no `reason` column, no log row written.
- No `TenantLearnerMembershipLog` entity exists.
- No GraphQL mutations: `admitTenantLearner`, `activateTenantLearner`, `suspendTenantLearner`, `revokeTenantLearner` do not exist.
- No `TenantManageAdmissions` or `TenantManageLearners` permission is defined.

### `TenantDeletionService`

**File:** `src/plugins/tenant-plugin/services/tenant-deletion.service.ts`

- Anonymizes `InstructorProfile` rows only.
- Does **not** touch `TenantLearnerMembership` in `removeFromChannel()` or `fullDelete()`.
- Has a private `rawId()` helper (`configService.entityIdStrategy.decodeId()`).
- **C-03 required.** When implementing C-03, inject `TenantLearnerMembershipService` into `TenantDeletionService`; do not write `TenantLearnerMembership` rows directly.

---

## 8. BBB checksum configuration and webhook authentication

### Outbound API (standard calls)

- Plugin option `checksumAlgorithm: 'sha256'` set in `vendure-config.ts` (working tree).
- Probe comment in config confirms SHA-256 verified live against `meeting.saa9vi.com` on 2026-10-09.
- `BbbApiService` supports `sha1` / `sha256` via plugin option; unknown algorithms fall back to `sha256`.
- Tests: `bbb-checksum.spec.ts` — SHA-256 and SHA-1 known-answer vectors, fallback behavior.

### Inbound webhook verification

- **File:** `src/plugins/bigbluebutton-plugin/workers/bbb-webhook-auth.ts`
- `algorithmFromDigestLength()` maps: 40→sha1, 64→sha256, 96→sha384, 128→sha512.
- All 4 algorithms supported; unknown lengths are rejected before comparison.
- Both bearer mode (`Authorization: Bearer`) and checksum mode (`?checksum=`) supported.
- All compares are constant-time.
- Tests: `bbb-webhook-auth.spec.ts` — covers all 4 digest sizes, bearer mode, tampered/wrong/missing values.

**Note:** Outbound API checksum and inbound hook verification are **independent code paths**. The plugin-level `checksumAlgorithm` option governs outbound calls only. Inbound hook verification infers the algorithm from the incoming digest length.

**C-07 action:** Create `docs/architecture/bbb-checksum-audit.md`. No code change expected unless deployed server evidence requires it.

---

## 9. Razorpay PaymentMethod and webhook reconciliation

### Handler

**File:** `src/plugins/payments/config/razorpay-payment-handler.ts`  
- `args: {}` — no secrets in handler args. ✓  
- Reads `RAZORPAY_KEY_ID`/`RAZORPAY_KEY_SECRET` from environment via `RazorpayCheckoutService`.  
- `settlePayment` is a no-op (single-step settlement on `createPayment`).

### Webhook controller

**File:** `src/plugins/payments/api/razorpay-payments-webhook.controller.ts`  
- Endpoint: `POST /payments/razorpay/checkout-webhook`  
- Raw-body HMAC-SHA256 verification before any processing. ✓  
- Persist-first: saves `PaymentWebhookEvent` before enqueue. ✓  
- `x-razorpay-event-id` idempotency key. ✓  
- Duplicate-delivery recovery: re-enqueues pending duplicate events. ✓  
- BullMQ job queue (`payment-webhook-reconciliation`). ✓  
- Settling events: `payment.captured`, `order.paid`.

**C-08 action:** Audit/test — do not rebuild. Missing negative test cases to add: bad signature, missing event ID, duplicate event, persistence-success-plus-enqueue-failure, unknown event, out-of-order, already-settled, provider mismatch.

### Tenant PaymentMethod exposure (C-05 risk)

**File:** `src/plugins/tenant-plugin/services/tenant-registration.service.ts`

`autoProvisionChannelResources()` assigns every Razorpay-handler `PaymentMethod` from the default channel to each new tenant channel. Filter is correct (skips non-Razorpay methods), but the assigned method uses **platform environment credentials** — not the tenant's own merchant account.

**Risk:** If the Razorpay `PaymentMethod` appears in `eligiblePaymentMethods` on a tenant Shop API channel, buyers would be charged through the platform's Razorpay account, not the tenant's. This must be tested before Phase 3.

**`PaymentHygieneChecker`** (`src/platform/invariants/payment-hygiene.checker.ts`) verifies static source shape: tenant role is read-only on PaymentMethod, dummy handler is dev/test-gated, provisioning filters to Razorpay code, production boot guard is registered. Run via `npm run verify:invariants`.

---

## 10. Architecture invariants and known Vendure overrides

### Invariant checkers (`src/platform/invariants/`)

| Checker | File | Invariants covered |
|---|---|---|
| `AdrChecker` | `adr.checker.ts` | ADR compliance |
| `RfcLifecycleChecker` | `rfc.checker.ts` | RFC lifecycle |
| `StoryFlowChecker` | `story.checker.ts` | User story flows |
| `RoomAccessChecker` | `room-access.checker.ts` | INV-027 room access |
| `MeteredBillingChecker` | `metered-billing.checker.ts` | INV-028/029 billing |
| `PaymentHygieneChecker` | `payment-hygiene.checker.ts` | INV-030 payment method hygiene |
| `DashboardGraphqlContractChecker` | `graphql-contract.checker.ts` | Dashboard GraphQL contract |

Run: `npm run verify:invariants`

### Known Vendure built-in resolver overrides

**File:** `src/plugins/tenant-plugin/api/tenant-admin.resolver.ts`

| Overridden field | Bug/Invariant | Behavior |
|---|---|---|
| `administrators` (list) | INV-016, BUG-025 | Tenant: channel-scoped, SuperAdmin excluded. SuperAdmin: delegates to `AdministratorService.findAll` |
| `administrator(id)` | BUG-026 | Tenant: channel-scoped. SuperAdmin: direct repo lookup |
| `roles` (list) | BUG-025 | SuperAdmin: all roles. Tenant: channel-scoped, `__superadmin__` role hidden |
| `role(id)` | BUG-026 | Tenant: channel-scoped. SuperAdmin: direct repo lookup |

**`docs/architecture/known-vendure-overrides.md` does not exist.** C-16 must create it.

---

## 11. Working-tree uncommitted changes (Phase 1a hotfixes)

The following 7 files are modified but not committed. They implement H1/H2/H3 security hotfixes:

| File | Change |
|---|---|
| `src/vendure-config.ts` | Adds `TenantChannelAssignmentStrategy` import and registration |
| `src/plugins/tenant-plugin/tenant-plugin.plugin.ts` | Adds `TenantLearnerMembership` entity and `TenantLearnerMembershipService` provider |
| `src/plugins/bigbluebutton-plugin/api/bbb-admin.resolver.ts` | H1: removes caller `source` from `createBbbEntitlement`; adds `TenantLearnerMembership` ACTIVE check. H2: adds membership check to `createBbbEnrollment`; persists `reason`/`enrolledByUserId`/`enrolledAt` |
| `src/plugins/bigbluebutton-plugin/api/schema/bbb-admin.schema.ts` | SDL changes matching H1/H2 |
| `src/plugins/bigbluebutton-plugin/entities/bbb-enrollment.entity.ts` | Adds `reason`, `enrolledByUserId`, `enrolledAt` columns |
| `src/plugins/bigbluebutton-plugin/listeners/order-fulfillment.listener.ts` | H3: order-channel vs resource-channel mismatch guard |
| `src/plugins/bigbluebutton-plugin/dashboard/routes/entitlements/EntitlementsList.tsx` | Minor dashboard update |

**New untracked file:** `src/plugins/bigbluebutton-plugin/__tests__/phase-1a-hotfixes.e2e-spec.ts` — e2e tests for H1/H2/H3.

**Impact on subsequent tasks:**
- C-04 (strategy behavioral tests) depends on the `vendure-config.ts` change being committed.
- C-10 (LearnerAdmissionPort) will replace the string-named `getRepository(ctx, "TenantLearnerMembership")` calls added in H1/H2.
- C-02 (admission workflow) will formalize the `TenantLearnerMembershipService` provider registration added here.

**Recommended action:** Commit the Phase 1a hotfixes as a single checkpoint commit before starting C-01, so subsequent tasks have a clean, stable baseline.

---

## 12. Missing files and repositories

| Item | Status | Blocking which tasks |
|---|---|---|
| `edu-frontend` Next.js repository | Not present in workspace | C-29 |
| `docs/architecture/known-vendure-overrides.md` | Does not exist | C-16 must create |
| `docs/architecture/bbb-checksum-audit.md` | Does not exist | C-07 must create |
| `docs/architecture/bbb-enrollment-consumers.md` | Does not exist | C-11 must create |
| `docs/architecture/learning-domain.md` | Does not exist | C-21 must create |
| `docs/implementation/kiro-progress.md` | Does not exist | Create at C-01 start |

---

## 13. Recommended Phase 0 execution order

1. **Commit working-tree changes** (H1/H2/H3 hotfixes + TenantPlugin additions + strategy registration) before C-01. This gives every subsequent task a clean, auditable baseline.

2. **C-01** — Fix `tenantProfile` query and `updateTenantProfile` mutation: both trust caller-supplied `channelId`. Write cross-tenant failing tests first.

3. **C-02** — Admission workflow: add `TenantLearnerMembershipLog`, fix `suspend(reason)`, add GraphQL mutations, add `TenantManageAdmissions` permission, fix `create()` terminal-row behavior.

4. **C-03** — Immediately after C-02: inject `TenantLearnerMembershipService` into `TenantDeletionService`; add membership transitions to both deletion flows; write deletion e2e assertions.

5. **C-04** — Strategy behavioral tests only (registration already done in working tree).

6. **C-05 through C-08** — Payment exposure/ADR, role reconciliation, BBB checksum audit doc, Razorpay webhook test gaps.

---

## 14. Existing behavior that must not be duplicated

| Component | Location | Do not recreate |
|---|---|---|
| Razorpay payment handler | `payments/config/razorpay-payment-handler.ts` | Do not add a second handler |
| Razorpay webhook controller | `payments/api/razorpay-payments-webhook.controller.ts` | Do not add a second controller or inbox |
| `PaymentWebhookEvent` inbox | `payments/entities/payment-webhook-event.entity.ts` | Do not create a second inbox table |
| BBB webhook auth | `bigbluebutton-plugin/workers/bbb-webhook-auth.ts` | Do not add a second verifier |
| `BbbRoomAccessService` | INV-027 evaluator | Do not add a second access evaluator |
| `CustomerDeletionService` registry | `platform/customer-deletion/customer-deletion.service.ts` | Do not add a second deletion orchestrator |
| `TenantLearnerMembership` entity | `tenant-plugin/entities/` | Do not create a second academy-admission entity |
| `TenantChannelAssignmentStrategy` | `tenant-plugin/config/` | Do not register a second strategy |
