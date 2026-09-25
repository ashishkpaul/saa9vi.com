# Known Bugs

> **Purpose:** Track all confirmed bugs. Updated as bugs are found and fixed. When a bug is fixed, move it to release-notes.md.

---

## Active Bugs

_None._ BUG-036 (provisioning capacity/`isUnbounded`) was fixed and runtime-reproduced on 2026-09-23 in `d711940`; BUG-037 (the `bbb-channel-isolation` e2e harness could not pass) was found and fixed on 2026-09-24; BUG-038 (`bbbFulfillmentHandler` read the never-loaded `order.lines`, so no `order`-source capacity grant could ever be written) was found and fixed on 2026-09-25 while producing the Slice 10 / R4 runtime-lifecycle evidence. All three archived entries are below; the fixes are recorded in `release-notes.md`.

---

## BUG-036 — Provisioning capacity check ignored `isUnbounded` — ✅ FIXED (`d711940`, 2026-09-23)

> **Status:** fixed and runtime-verified 2026-09-23 (commit `d711940`). The sections
> below are retained as the pre-fix record — every symptom in them was
> reproduced at runtime before the fix and is now covered by tests.

**Severity:** High · **Discovered:** 2026-09-22 (static code reading); **runtime-reproduced:** 2026-09-23 · **Components:** `bbb-provisioning-worker.service.ts` (`doProvisionMeeting`), `bbb-organization.service.ts` (overhead grant), `grant-reader.service.ts`

**What the code does.** `BbbOrganizationService.create()` auto-provisions an unbounded overhead grant per organization (`isUnbounded: true`, `grantedMinutes: -1`, `validUntil: 2099-12-31`). `doProvisionMeeting()` selects a grant with `exhausted = false`, an in-window `validFrom`/`validUntil`, ordered `validUntil ASC, createdAt ASC` — then rejects the meeting when `(grant.grantedMinutes ?? 0) - (grant.consumedMinutes ?? 0) <= 0`. That check never consults `isUnbounded`; only `GrantReaderService.getRemainingMinutes()` treats unbounded grants as `Infinity`.

**Failure modes.**

1. **Severe:** an organization whose only valid grant is the overhead grant can never provision a meeting — selection picks the overhead grant, computes `-1 - consumed <= 0`, and throws `"No minutes remaining on plan"`.
2. **Misleading:** once a commercial grant reaches its limit it is flagged `exhausted = true`, which *excludes* it from selection; the resolver then lands on the overhead grant and throws the same message — so an exhausted allowance is reported as a missing one, and the real commercial state never reaches the caller.

**Why it matters now.** Tenants register without a purchased grant, and the planned Free Basic tier adds a per-day allowance on this table. Shipping the allowance without fixing selection would leave the free tier depending on a fall-through path that throws.

**Decision and fix (`d711940`).** Both fix options were taken, plus the accuracy gap between them:

- Config: new `services/grant-selection.policy.ts` is the single home for the rules that had been duplicated and drifted — `TENANT_SELECTABLE_SOURCE_TYPES` (`order`, `subscription`; `internal_overhead` is ops headroom, never a customer allowance), `remainingMinutesForGrant()` (Infinity for `isUnbounded`, matching what `getRemainingMinutes()` always did) and `hasProvisionableMinutes()`.
- `doProvisionMeeting()`: selection now uses a **positive** `sourceType IN (:...sourceTypes)` clause (not `!= 'internal_overhead'`, so a future third source type cannot slip through by default), the minutes gate calls `hasProvisionableMinutes()`, and a failure-path probe distinguishes **"allowance exhausted"** from **"no allowance at all"** — the two previously produced the same message.
- `GrantReaderService.getRemainingMinutes()` now uses the same helper and excludes `internal_overhead` (counting overhead would report every organization as unbounded). Both call sites therefore cannot drift again.

**Runtime reproduction (2026-09-23) — the evidence this entry previously lacked.** The three new cases in `bbb-meeting-concurrency.e2e-spec.ts` were first executed against the **pre-fix** worker; all three failed with exactly the documented symptoms:

| Case (real Postgres) | Pre-fix behaviour | Post-fix |
|---|---|---|
| Only grant is the auto-created `internal_overhead` grant | `"No minutes remaining on plan"` (failure mode 1) | `"No active capacity grant found for this organization…"` |
| Commercial grant at its limit (`exhausted = true`) | `"No active capacity grant found…"` — an exhausted allowance reported as *missing* (failure mode 2) | `"Your plan's meeting minutes for this period are exhausted. Please purchase or renew a plan to continue."` |
| Tenant-selectable grant with `isUnbounded: true` and the `-1` sentinel | `"No minutes remaining on plan"` (the `-1 − consumed ≤ 0` arithmetic) | Reaches the BBB transport (gate passed) |

Post-fix: `bbb-meeting-concurrency.e2e-spec.ts` **4/4** and `grant-selection.policy.spec.ts` **8/8** (infra-free).

**Related but distinct — resolved.** `GrantReaderService.findEarliestValidGrant()` filtered only on `exhausted` and ordered by `validUntil`, ignoring its declared validity window *and* its `_sourceTypes` parameter. Re-verified with `grep -rn findEarliestValidGrant src/`: a single occurrence — its own definition — so it was dead code rather than a live path (the same was true of `getRemainingMinutes()`, which had no callers either; `doProvisionMeeting()` was the only live enforcement point). It was **deleted** in `d711940` rather than repaired, so the bug family cannot be reintroduced through it. The planned F-7 rule (a provider-free subscription must keep `currentPeriodStart`/`currentPeriodEnd` NULL so the paid renewal scan does not discover it) is a design constraint for the Free Basic activation slice, not part of this defect. Both are tracked in `saa9vi-comprehensive-integration-and-commercial-plan.md` §0.19.

---

## BUG-037 — `bbb-channel-isolation.e2e-spec.ts` could not pass (harness drift) — ✅ FIXED (2026-09-24)

> **Status:** fixed and runtime-verified 2026-09-24 — `npm run test:e2e:bbb-isolation` → **13/13** against real Postgres. Found while re-running the BBB suites as regression cover for BUG-036; the spec itself was never touched by that fix (last modified in `48ad7c7`).

**Severity:** High (missing evidence, not live runtime behaviour) · **Discovered:** 2026-09-24 (first execution of the suite since `48ad7c7`) · **Components:** `src/plugins/bigbluebutton-plugin/__tests__/bbb-channel-isolation.e2e-spec.ts` only — **no product code changed**.

**Why it matters.** This suite is the runtime evidence cited for **INV-001** (cross-tenant channel isolation) by `docs/architecture/security.md` §SEC-002 and `docs/adr/platform-adr.md`. It had silently become impossible to pass, so the "Phase A isolation suite green" claim rested on a suite that could not execute — the same class of drift BUG-033 fixed for the other specs.

**Symptom.** `7 failed / 6 skipped (13)`. The first failure was `registerNewTenant` → `The permission "CreateCmsArticle" may not be assigned`; every later failure was a cascade of `undefined` variables from that. Once registration worked, the next layer surfaced: `createBbbOrganization` → `You are not currently authorized to perform this action`.

**Root causes (three, all harness-side).**

1. **Missing plugins.** The spec loaded `plugins: [TenantPlugin, BigBlueButtonPlugin]`, but `TENANT_ADMIN_ROLE_PERMISSIONS` grants CMS (`CreateCmsArticle`, …) and Reviews (`ReviewAdmin`) permissions, and Vendure rejects any permission that no loaded plugin has registered — so `registerNewTenant` failed while creating the tenant-admin role. Fixed by loading the set that makes the green `tenant-plugin.e2e-spec.ts` pass: `CmsPlugin`, `ReviewsPlugin`, `SubscriptionPlugin.init({})` (the subscription tables are additionally required by ADR-043's theming gate, which `TenantPlugin` reads via `TransactionalConnection`).
2. **Missed the BUG-033 fix.** `@vendure/testing`'s `testConfig` defaults `authOptions.requireVerification: true` while `registerNewTenant` creates admins with `user.verified = false`, so tenant-channel logins returned a null `CurrentUser`. BUG-033 added `requireVerification: false` to the marketplace / tenant-plugin / customer-deletion specs — **this spec was missed**. Added here.
3. **An org-creation phase that could not work.** Phase 2 created the org via `createBbbOrganization` as SuperAdmin:
   - `beforeAll` called `adminClient.asSuperAdmin()` **without `await`**. That is a login round-trip (`createTestEnvironment` does not pre-authenticate the admin client), so the mutation raced the login, ran unauthenticated, and Vendure returned its generic `ForbiddenError` (`RequestContext.userHasPermissions()` is false with no user). Vendure's SuperAdmin role was never the problem — `ensureSuperAdminRoleExists()` grants it all permissions, and `Permission.SuperAdmin` is `assignable: true`.
   - it then called `setChannelToken('')`, leaving `ctx.channelId` unset — and `userHasPermissions()` returns `false` outright when there is no channel, so even an authenticated SuperAdmin fails every `@Allow(...)` check.
   - the org already existed anyway: `BbbTenantProvisioningListener` provisions it on `TenantRegisteredEvent` using a ctx **scoped to the tenant channel**, which is required because `BbbOrganizationService.create()` calls `assignToCurrentChannel()` — a default-channel ctx mis-assigns the `channels` join (the BUG-004 / BUG-031 class).

   Phase 2 now asserts the real production path instead: each tenant channel resolves to exactly one organization, polled until the async listener has written it (same pattern as `marketplace.e2e-spec.ts`'s `ensureOrg`).

**Also corrected — latent assertions that could never have passed.** The spec compared the GraphQL `channelId` field against the *decoded* internal id: the API boundary encodes ids (`T_2`) while `tenantAChannelId` was normalised to `2` for repository reads (`channelId.replace(/^T_/, '')`, line 212). Both forms are now explicit — `tenantAChannelId` (internal, for repository reads) and `tenantAChannelIdEncoded` (GraphQL) — and all GraphQL assertions use the encoded form.

**Evidence (same machine, same Postgres, 2026-09-24).**

| Stage | Result |
|---|---|
| Pre-fix (as committed) | `7 failed \| 6 skipped (13)` |
| After root causes 1 + 2 | `5 failed \| 8 passed (13)` — registration and all six isolation cases green |
| After root cause 3 + id-form correction | **`13 passed (13)`** — `npx tsc --noEmit` exit 0 |

---



| Field | Detail |
|---|---|
| **ID** | BUG B |
| **Severity** | Critical |
| **Found** | 2026-09-20 (R2-E probe, pre-ADR-041 code) |
| **Fixed** | 2026-09-20 (ADR-041 G2–G7) |
| **Status** | ✅ Fixed and runtime-verified (R2-E run, subscription 7, 2026-09-20) |

### Description

The R2-E authorization probe demonstrated a concrete billing defect: one real ₹100 Razorpay Test payment produced a local subscription period **two months** in the future.

```
Razorpay provider cycle:  2026-09-20 → 2026-10-20
Saa9vi local result:      2026-11-16 → 2026-12-16   ← wrong by ~2 months
```

### Root cause

`finalizeAfterPayment()` computed the new billing period by arithmetic on the local `currentPeriodEnd`:

```ts
// PROHIBITED — the exact mechanism behind the drift
const newPeriodEnd = new Date(sub.currentPeriodEnd);
newPeriodEnd.setMonth(newPeriodEnd.getMonth() + 1);
```

Because the local `currentPeriodEnd` had drifted from the provider cycle during the initial authorization flow, this arithmetic produced a period two months ahead of the actual provider cycle. The same mechanism made replay non-idempotent: a replayed webhook would advance the period a second time.

The out-of-order failure guard in `markPastDueFromWebhook()` had a related flaw — it compared `currentPeriodEnd > new Date()` (wall clock) rather than comparing the provider cycle identity.

### Fix — ADR-041 G2–G7 (2026-09-20)

The provider cycle (`current_start` / `current_end` from Razorpay's subscription entity) is now the **authoritative identity** of every paid period. No local arithmetic substitutes for it on the provider-driven path.

Key changes (G2–G7, runtime-verified 2026-09-20):
- `NormalizedBillingEvent` carries `providerPeriodStart`/`providerPeriodEnd`; `assertProviderCyclePresent()` throws fail-closed before any mutation if fields are absent
- `subscription.charged` cycle validation is **unconditional** — `assertProviderCyclePresent` fires for every charged event regardless of `providerPaymentId` / `amountPaise` truthiness, satisfying INV-020's fail-closed requirement
- `SubscriptionBillingAttempt` gains nullable `billingPeriodEnd` (migration `1789883158253`); `billingPeriodStart` made nullable (migration `1789885988242`); **uniform NULL semantics** — initiated rows carry `NULL` in both period fields (renewal worker no longer passes a provisional local date); failed attempts without a provider cycle are also `NULL`; the `recordAttemptInitiated()` signature updated to reflect `billingPeriodStart` as optional
- `finalizeAfterPayment()` reads `billingPeriodStart`/`billingPeriodEnd` from the attempt row; absent `billingPeriodEnd` → reconciliation incident (no fallback)
- Cycle-monotonic CAS (`currentPeriodStart < :targetStart`) enforces monotonic progression
- `markPastDueFromWebhook()` uses cycle-identity freshness guard (`providerCycleStart <= localCurrentPeriodStart` → stale no-op)
- `updateBinding()` transactional; binding lookup provider-qualified

See `docs/architecture/adr-041-provider-cycle-billing-period-identity.md` for the full decision record.

### Runtime verification

The fix is runtime-verified by the R2-E run (2026-09-20):
- Subscription 7, channel 13, `sub_TeJjWjzzC0dU4W`, payment `pay_TeJk63hHNo32gI`
- `billingPeriodStart = 2026-09-20` ✅ matches Razorpay `current_start = 1789913044`
- `billingPeriodEnd = 2026-10-19` ✅ matches Razorpay `current_end = 1792434600`
- `OrganizationSubscription.status = active` ✅
- `currentPeriodStart = 2026-09-20T00:00:00.000Z` ✅ from provider cycle, not local arithmetic
- No +1 month drift ✅

---

## BUG-038 — `bbbFulfillmentHandler` read `order.lines`, which Vendure never loads — **every** `addFulfillmentToOrder` failed with `CREATE_FULFILLMENT_ERROR` — ✅ FIXED (2026-09-25)

> **Status:** fixed and runtime-verified 2026-09-25. Found while producing the
> Slice 10 / R4 runtime-lifecycle evidence (case **R4-02**); the pre-fix failure
> was reproduced at runtime before the fix.

**Severity:** Critical (the `order`-source capacity grant could never be written, so a paid order could never provision a meeting) · **Discovered:** 2026-09-25 (runtime) · **Components:** `src/plugins/bigbluebutton-plugin/config/bbb-fulfillment.ts` (`createFulfillment` only — no entity, no migration)

**What the code did.** `createFulfillment()` derived each line's product variant from the `order` object it is handed:

```ts
const orderLine = order.lines.find((l) => String(l.id) === String(line.orderLineId));
const productVariantId = orderLine?.productVariant?.id;
```

Vendure does not give a fulfillment handler an order with `lines` loaded. The `order` arrives from `FulfillmentService.getOrdersFromLines()`, which loads `relations: ['order', 'order.channels']` **only** — `order.lines` is `undefined`. The `&&` chain therefore never defended anything: `.find` is called on `undefined` and throws `TypeError: Cannot read properties of undefined (reading 'find')`.

**Why nobody noticed.** The throw happens *inside* the handler, so Vendure wraps it and the Admin caller only sees `CREATE_FULFILLMENT_ERROR` with no stack — indistinguishable from a bad input. The only consumed consequence, the `BbbCapacityGrant` write, is intentionally idempotent and silent (it logs at `info`), so nothing downstream failed loudly: the fulfillment row was simply never created and no capacity was granted.

**Why it matters.** Writer (B) of the three capacity-grant writers is the *purchase* path — `addFulfillmentToOrder` → `bbbFulfillmentHandler` → `BbbCapacityGrant(sourceType: 'order')`. With it dead, the only grants any tenant organization could hold were the auto-created `internal_overhead` grant and subscription grants. Combined with BUG-036's rule that `internal_overhead` is never tenant-selectable, a customer who paid for a session could not provision a meeting **at all** — the purchase → entitlement → BBB chain was severed at exactly the point Slice 10 exists to prove.

**Fixed.** The line is now resolved from the handler's own `lines` input, following Vendure's canonical `digitalFulfillmentHandler` in the Digital Products guide, and hoisted **out of the per-line loop** into a single batched query:

```ts
const resolvedLines = await connection.getRepository(ctx, OrderLine).find({
  where: { id: In(lines.map((l) => String(l.orderLineId))) },
  relations: { productVariant: true },
});
```

`order.lines` is no longer read anywhere in the handler. One query regardless of line count, and `productVariant` is loaded explicitly because the fulfillment handler has no other reason to have it.

**Runtime reproduction and verification (2026-09-25).** R4-02 calls the real Admin `addFulfillmentToOrder` against real Postgres. Pre-fix it fails with `CREATE_FULFILLMENT_ERROR`; post-fix it writes the grant and the change is causally load-bearing — R4-04 then provisions a meeting selecting **`grantId` of the `order` grant, not the overhead grant**:

| Evidence (real Postgres, `R4_E2E=true`) | Observed |
|---|---|
| R4-02 — Admin `addFulfillmentToOrder` | `grant=2 sourceType=order grantedMinutes=600 orderLineId=1 fulfillment=T_1` |
| R4-04 — provisioning selects it over `internal_overhead` | `meeting=1 state=Active session=1 status=LIVE grantId=2` |
| R4-08 — usage ledger binds to that same grant | `ledgerRows=1 consumedMinutes=11 grant=2 grant.consumedMinutes=11 session=FINISHED` |

BUG-036 declared `internal_overhead` unselectable, which is what makes R4-02 a hard prerequisite of R4-04: had the grant write still been broken, provisioning would have failed on an empty selectable set rather than silently borrowing ops headroom.

---

## BUG C — `subscribeToPlan` Initial Period Blocked ADR-041 CAS (fixed 2026-09-20)

| Field | Detail |
|---|---|
| **ID** | BUG C |
| **Severity** | Critical |
| **Found** | 2026-09-20 (R2-E runtime run) |
| **Fixed** | 2026-09-20 (commit `cd3a80f`) |
| **Status** | ✅ Fixed and runtime-verified |

### Description

`subscribeToPlan` created the `OrganizationSubscription` row with:

```ts
currentPeriodStart: now,   // e.g. 2026-09-20T13:01:13.619Z
currentPeriodEnd:   periodEnd,
```

The ADR-041 cycle-monotonic CAS condition is:

```sql
WHERE currentPeriodStart IS NULL OR currentPeriodStart < :targetStart
```

The provider webhook supplies `current_start` as a Unix timestamp that normalises
to a UTC calendar date (e.g. `2026-09-20T00:00:00.000Z`). Because the creation
timestamp (`13:01:13`) was always *after* midnight on the same day, the CAS
condition `currentPeriodStart < targetStart` evaluated to `false` — the finalization
was silently rejected as "not a newer cycle" and the subscription remained stuck in
`pending_provider_auth`.

Evidence: subscription 5 (channel 21, pre-fix) stayed `pending_provider_auth` even
after all three webhooks processed cleanly. Subscription 7 (channel 13, post-fix)
correctly transitioned to `active` with `currentPeriodStart = 2026-09-20T00:00:00.000Z`.

### Fix

Set `currentPeriodStart = NULL` and `currentPeriodEnd = NULL` at creation. The `IS NULL`
branch of the CAS fires correctly for the first provider webhook, and the period is
written from the authoritative provider cycle (`current_start`/`current_end`).

### Runtime verification

- Subscription 7, channel 13, `sub_TeJjWjzzC0dU4W`
- `currentPeriodStart = 2026-09-20T00:00:00.000Z` ✅ (from provider cycle)
- `currentPeriodEnd = 2026-10-19T00:00:00.000Z` ✅ (from provider cycle)
- `status = active` ✅
- `version = 2` ✅

---

## Active Integration Gaps

**Confirmed external-dependency mismatches that are not application bugs.** These block a production gate but the Saa9vi-side state machine is verified correct; the external dependency's configuration/behavior compatibility remains unresolved.

| ID | Severity | Component | Description | Status |
|---|---|---|---|---|
The BBB provisioning/join integration investigation (BBB-INT-001) is **resolved** — the reported `getMeetingInfo error.forbidden` was a stale-meeting artifact, not a defect.

## Closed: BBB-INT-001 (stale-meeting artifact)

| ID | Severity | Component | Description | Status |
| --- | --- | --- | --- | --- |
| BBB-INT-001 | Medium | BBB provisioning/join integration | Reported `getMeetingInfo error.forbidden` on provisioning-created meetings. **Resolved:** manual BBB control meeting (create/getMeetingInfo/join) and fresh Saa9vi-provisioned meetings (`bbb-10`) both return `getMeetingInfo SUCCESS` at t+0/1s/3s/10s. Expired/stale meetings correctly return `notFound`. No checksum, API-secret, endpoint, or provisioning defect reproduced. The existence validator's fail-open handling of ambiguous errors remains a reasonable availability measure; Saa9vi authorization gates (entitlement + LIVE + Active meeting) are unaffected. | ✅ Closed (2026-09-15) |

Diagnostic evidence: `scripts/diagnostics/bbb_diag.mjs` (read-only BBB protocol replica; diagnostic-only — it reads PostgreSQL directly and is **not** an application data-access pattern; application code must use Vendure services + `RequestContext`).

## Related fix (same-day): session channel stamping

`BbbScheduledSessionService.create()` stamped `channelId` from the request context instead of the organization. A superadmin creating a session for a channel-14 org under a channel-15 token produced a channel-mismatched session (FORBIDDEN at `startScheduledSession`). Fixed: the session's tenant scope is now derived from `organization.channelId` (INV-001 authoritative aggregate).

## Fixed (same-day): join-URL generation `error.forbidden` (type coercion)

| ID | Severity | Description | Fix |
| --- | --- | --- | --- |
| BBB-BUG-002 | High | `getJoinUrl` for an entitled learner in the meeting's own channel threw `ForbiddenError` (`error.forbidden`): `assertMeetingAccess` compared `meeting.organization.channelId !== ctx.channelId` with strict `!==` — numeric ctx channelId vs string denormalized column never matched. `assertSessionAccess`/`assertRoomAccess` already coerced with `String()`; `assertMeetingAccess` did not. | Normalized both sides with `String()` in `assertMeetingAccess`. Proven: learner dashboard now returns `canJoin=true, ctaAction=join, joinUrl != null` and the join URL redirects into BBB's HTML5 client (session token issued). |

## Clarified (same-day): unjoined meetings → BBB auto-destroy → Stale

BBB destroys meetings that are never joined after a server-side timeout. `BbbReconciliationService` correctly detects this (`getMeetingInfo` → `notFound`) and marks the meeting `Stale` (terminal, no usage ledger). The learner dashboard then correctly returns `ctaAction=none, joinUrl=null` for the affected session. This is **correct defense-in-depth behavior**, not a defect: fresh meetings return `getMeetingInfo SUCCESS` immediately after provisioning (t+0/1s/3s/10s proven).

---

## Fixed Bugs

| ID | Severity | Description | Fix |
|---|---|---|---|
| BUG-001 | Critical | `TenantProfileDetail.tsx` — `useState` instead of `useEffect`, form never populates on edit | ✅ Fixed |
| BUG-002 | Critical | `tenant-admin.resolver.ts` — `tenantProfile(channelId: '__current__')` always returns null | ✅ Fixed |
| BUG-003 | High | `BbbWebhookController` — webhook processed inline, no persist-first, no replay | ✅ Fixed |
| BUG-004 | High | `BbbOrganizationService.create` — `channels[]` join table never populated | ✅ Fixed |
| BUG-005 | High | `BbbOrderFulfillmentListener` — fulfillment resolved `productVariantId → BbbRoom`, not `→ BbbScheduledSession` | ✅ Fixed |
| BUG-006 | Medium | `Article`, `Page` entities — slug uniqueness application-level only, TOCTOU race | ✅ Fixed |
| BUG-007 | Medium | `PlansList.tsx` — `useEffect` dep on derived `organizations`, auto-select never fires | ✅ Fixed |
| BUG-008 | Medium | `BbbMeeting`, `BbbServer` — no `encryptionKeyVersion` column | ✅ Fixed |
| BUG-009 | Low | `BbbScheduledSession` — `(organizationId, slug)` composite unique missing | ✅ Fixed |
| BUG-010 | Low | Dashboard list pages (6 files) — `window.confirm` for destructive actions | ✅ Fixed |
| BUG-011 | Low | `MembersList.tsx`, `EnrollmentsList.tsx` — org auto-select never fires on first load | ✅ Fixed |
| BUG-012 | High | `constants.ts` — `STALE` meeting state absent from FSM | ✅ Fixed |
| BUG-013 | Medium | `BbbReconciliationService` — `CapacityExhaustedEvent` not published when `billingCapped = true` | ✅ Fixed |
| BUG-014 | Low | `BbbServerSelectionService` — `currentLoad` scoring semantics undocumented | ✅ Fixed |
| BUG-015 | Medium | `CmsPlugin`/`BannerService` — banner BullMQ queues not registered | ✅ Fixed |
| BUG-016 | High | `ReviewsPlugin`/`dashboard/index.tsx` — `navSections` uses `items` property (TS-2353) | ✅ Fixed |
| BUG-017 | Medium | `ReviewsPlugin` entities — `ProductReview`, `ReviewRequest`, `ReviewReport`, `ReviewReward`, `ReviewVote` did not implement `ChannelAware` — channel isolation relied solely on explicit `ctx.channelId` WHERE clauses in services. Fixed by adding `ChannelAware` (channels[] + channelId) to all 5 entities. | ✅ Fixed |
| BUG-018 | Medium | `BbbShopResolver.joinRoom()` — moderator role-routing has no trigger path | ✅ Fixed |
| BUG-019 | High | `LoadSimulationPlugin` — `runLoadTest` exposed on public Shop API (DoS vector) | ✅ Fixed |
| BUG-020 | Medium | `CausalMapper` — references non-existent `simulateBbbWebhook` resolver. Fixed the *reference* only (step returns `isPending: true`, skipped by LoadOrchestrator); the resolver itself remains unimplemented — see item 4 in `docs/adr-assessment.md`'s resolution table. | ✅ Fixed |
| BUG-021 | High | `TenantProfileService.create()` — `channelOrToken` passed as raw Channel entity instead of `channel.token` string | ✅ Fixed |
| BUG-022 | P0 | `bbb-shop.resolver.ts` — `bbbRoomStatus`, `myBbbRooms`, and `myBbbEnrollments` read from `BbbEnrollment` only, while `BbbOrderFulfillmentListener` writes `BbbEntitlement` for room purchases. Fixed by also reading from `BbbEntitlement` in all three methods. | ✅ Fixed |
| BUG-023 | P1 | `marketplace-indexer.service.ts` — `academySlug` hardcoded to `''`, `channelToken` set to raw `channelId` instead of `Channel.token`, `customDomain` not indexed. Fixed by resolving `Channel.token` and `BbbOrganization.slug` in both session and instructor indexing. | ✅ Fixed |
| BUG-024 | P2 | `TenantRegistrationService` — `ShippingMethod`/`StockLocation`/`PaymentMethod` not auto-provisioned for new channels. Fixed by adding `autoProvisionChannelResources()` that assigns default channel's methods/locations to the new channel. | ✅ Fixed |
| BUG-025 | Medium | `tenant-admin.resolver.ts` — Vendure's built-in `roles` query was implicitly channel-scoped. Fixed by overriding `roles` in `TenantAdminResolver` (SuperAdmin sees all, tenant admin channel-scoped). | ✅ Fixed |
| BUG-026 | Medium | `tenant-admin.resolver.ts` — Vendure's built-in `role(id)` and `administrator(id)` singular queries were implicitly channel-scoped, causing "not found" on the role/administrator detail pages for SuperAdmin. Fixed by overriding both singular queries in `TenantAdminResolver` (SuperAdmin sees all, tenant admin channel-scoped). | ✅ Fixed |
| BUG-027 | P1 | `product-review-shop.resolver.ts` — `pendingReviewRequests` accessed `options.take`/`options.skip` on `undefined`. Fixed by forwarding `options?.take`/`options?.skip`; the service already defaults take→10, skip→0. | ✅ Fixed |
| BUG-028 | Medium | `tenant-plugin/dashboard/index.tsx` — Academy Console nav items used incorrect permission identifiers (`TenantProfileRead`, `InstructorProfileRead`, `MediaResourceRead`) instead of the Vendure `CrudPermissionDefinition` generated names (`ReadTenantProfile`, `ReadInstructorProfile`, `ReadMediaResource`). Fixed by correcting the `academyPermissions` map. | ✅ Fixed |
| BUG-029 | High | `tenant-plugin/constants.ts` — `TENANT_ADMIN_ROLE_PERMISSIONS` included `BbbPlatformInfrastructurePermission`, granting tenant admins permission to manage BBB servers/platform capacity infrastructure (Portal/SuperAdmin-only per ADR-033). Fixed by removing it from the tenant role template. Existing roles with this permission can be cleaned up via `npm run tenant:roles:repair -- --remove-unexpected`. | ✅ Fixed |
| BUG-030 | Medium | `tenant-plugin/api/tenant-admin.resolver.ts` — administrators/administrator resolvers loaded `user.roles` but not `user.roles.channels`, so TypeORM returned `channels:[]` for tenant roles even though the role-channel join exists. This made the nested `user.roles.channels` graph inconsistent with the direct `roles` query. Fixed by loading `user.roles.channels` relations in the SuperAdmin branch and using `leftJoinAndSelect role.channels` in the tenant-admin branch; same fix applied to the singular `administrator(id)` resolver. Regression test added to the INV-016 e2e suite. | ✅ Fixed |
| BUG-031 | Critical | `src/plugins/cms/services/{page,banner,article}.service.ts` + `article.entity.ts` — CmsPlugin used Vendure's `assignToCurrentChannel()` which assigns an entity to the current channel AND the default channel, leaking tenant-created CMS content onto `__default_channel__` so it was visible to other tenants. Fixed by adding `CmsChannelAssignmentPolicy` (ADR-036): SuperAdmin → default channel only, Tenant Admin → tenant channel only (never default). Replaced `assignToCurrentChannel()` in `PageService`/`BannerService`/`ArticleService.create()`. Replaced non-working `ListQueryBuilder` channelId option in `findAll()` with explicit inner join on the `channels` relation. E2E: 44/44 pass, including new tests verifying tenant CMS isolation and platform CMS preservation. **Extended 2026-09-16 (same bug class, subscription domain):** `SubscriptionService.subscribeToPlan()`/`createProviderBinding()` used the same `assignToCurrentChannel()` helper, joining the platform default channel onto tenant-scoped `OrganizationSubscription`/`SubscriptionProviderBinding` rows. Replaced with tenant-only inline assignment (`channels = [channel]`, ADR-036 house policy); runtime-verified — tenant join rows are `{17}` only (no default-channel leak) and the Portal Admin Dashboard read path (channel-1 ctx) is unaffected, since `findAllSubscriptions` does not channel-filter unless `channelId` is passed explicitly. | ✅ Fixed |
| BUG-032 | Medium | `BbbSubscriptionListener` — not idempotent, writes multiple `BbbCapacityGrant` rows for the same billing period start. Fixed by adding existence check (`validFrom` + `sourceType: "subscription"`) before save. | ✅ Fixed |
| BUG-033 | High | e2e harness — admin login as a **tenant-channel** administrator failed with `Cannot return null for non-nullable field CurrentUser.id` (the login mutation returned a null CurrentUser). **Root cause found & fixed:** NOT channel resolution (as originally suspected) — `registerNewTenant` creates admins with `user.verified=false`, and `@vendure/testing`'s `testConfig` defaults `authOptions.requireVerification=true`, so Vendure returns a `NotVerified`/null CurrentUser for tenant-channel logins. SuperAdmin logins succeed only because seed users are pre-verified. **Fix:** `requireVerification:false` added to the e2e harness config in the marketplace spec (already present) and the **tenant-plugin + customer-deletion specs** (this change). Verified: marketplace Gate 1.5 suite **7/7 pass**; tenant-plugin suite **45/45 pass** (the 9 previously-blocked INV-016/CMS-isolation tests now run, exposing one real INV-016 gap fixed in `TenantAdminResolver` — SuperAdmin account leaked into tenant admin lists because Vendure's SuperAdmin role carries ALL channels; excluded via `SUPER_ADMIN_ROLE_CODE`). | ✅ Fixed |
| BUG-034 | High | `src/plugins/marketplace/e2e/commission.e2e-spec.ts` line 118 — `SetAddress` mutation declared with the incorrect GraphQL input type `AddressInput!` (a non-existent type). Vendure's Shop API declares `setOrderShippingAddress(input: CreateAddressInput!)`. The typo was introduced during a refactor of the test fixture and caused every test exercising the `setOrderShippingAddress` helper to fail at GraphQL validation time, blocking 6 commission E2E cases. **Root cause:** the original fixture used `AddressInput!`, but the actual Vendure contract requires `CreateAddressInput!`. **Fix:** corrected the mutation to `mutation SetAddress($input: CreateAddressInput!)`. Verified: commission E2E **6/6 pass** (positive, $0-row, INV-008 forge, replay, no-ref, single-use ref). Current source uses `CreateAddressInput!` matching the upstream Vendure schema. | ✅ Fixed |
| BUG-035 | High | `src/plugins/marketplace/e2e/commission.e2e-spec.ts` line 261 — the order-hydration query after `setOrderAddress` fetched the order without `relations: ['lines', 'surcharges']`, so `Order.lines` was empty. The INV-008 forged-reference test (`$0-row`) asserts that a forged `marketplaceRef` on an order with no matching resource lines is rejected; with an empty `lines` array the assertion `order.lines.some(l => l.productVariant.id === resourceVariantId)` always returned `false`, making the test pass for the wrong reason on a green-field DB but fail on any DB where real order lines existed from prior runs. **Root cause:** the hydration step was copied from a simpler fixture that didn't need line-level access and the relations array was never extended. **Fix:** added `relations: ['lines', 'surcharges']` to the order-hydration query. Verified: commission E2E **6/6 pass**, including the INV-008 forge case now correctly exercising the line-matching path. | ✅ Fixed |
| INV-008 | P1 | `src/lib/vendure/session-cta.ts` (deleted) + `learning-dashboard.service.ts` — `getSessionCta()` was a client-side entitlement isolation layer containing business logic (joinUrl precedence, trial eligibility, registration status) that violated the entitlement-only access invariant. Fixed by moving the CTA decision server-side: `LearningCourse` now carries server-driven `ctaAction`/`ctaLabel` computed in `LearningDashboardService.getDashboard()`. `course-card.tsx` renders these fields instead of re-deriving eligibility from the clock. `session-cta.ts` deleted. | ✅ Fixed |
| BUG-037 | High | `src/plugins/bigbluebutton-plugin/__tests__/bbb-channel-isolation.e2e-spec.ts` — the INV-001 "Phase A isolation" suite could not pass (7 failed / 6 skipped), so the isolation evidence cited by `security.md` §SEC-002 and `platform-adr.md` rested on a suite that could not execute. Three harness-only causes: (1) the spec loaded only `TenantPlugin` + `BigBlueButtonPlugin`, but `TENANT_ADMIN_ROLE_PERMISSIONS` grants CMS/Reviews permissions no loaded plugin had registered, so `registerNewTenant` failed with `The permission "CreateCmsArticle" may not be assigned`; (2) the spec never received the BUG-033 `requireVerification: false` fix, so tenant-channel logins returned a null `CurrentUser`; (3) phase 2 created the org as SuperAdmin via an **un-awaited** `adminClient.asSuperAdmin()` (login race → unauthenticated request → generic `ForbiddenError`) and `setChannelToken('')` (unset `ctx.channelId` → Vendure's `userHasPermissions()` returns false → every `@Allow` fails), while the org already existed — `BbbTenantProvisioningListener` provisions it on `TenantRegisteredEvent` with a tenant-scoped ctx, as `assignToCurrentChannel()` requires. Fix: load `CmsPlugin`/`ReviewsPlugin`/`SubscriptionPlugin` (the set the green tenant-plugin spec uses), add `requireVerification: false`, replace the creation phase with resolution of the real provisioning path (polled), and compare GraphQL `channelId` against the **encoded** form while repository reads use the decoded one. No product code changed. Verified: `npm run test:e2e:bbb-isolation` → **13/13** real Postgres (pre-fix 7 failed/6 skipped → 5 failed/8 passed → 13/13); `npx tsc --noEmit` exit 0. | ✅ Fixed |
| BUG-038 | Critical | `src/plugins/bigbluebutton-plugin/config/bbb-fulfillment.ts` — `createFulfillment()` resolved each line's product variant via `order.lines.find(...)`, but Vendure's `FulfillmentService.getOrdersFromLines()` hands the handler an order loaded with `relations: ['order', 'order.channels']` **only** — `order.lines` is `undefined`, so the `?.` chain never guarded and the call threw `TypeError: Cannot read properties of undefined (reading 'find')`. Vendure wrapped it, so the Admin caller saw only `CREATE_FULFILLMENT_ERROR` with no stack, and the sole consumed effect (an idempotent, `info`-level `BbbCapacityGrant` write) failed silently — meaning capacity-grant writer (B) `addFulfillmentToOrder → bbbFulfillmentHandler → BbbCapacityGrant(sourceType:'order')` was dead. With BUG-036 also making `internal_overhead` non-selectable, a customer who paid for a session could not provision a meeting at all. **Fix:** resolve lines from the handler's own `lines` input — `find({ where: { id: In(lines.map(l => String(l.orderLineId))) }, relations: { productVariant: true } })` — hoisted out of the per-line loop into one batched query, mirroring Vendure's canonical `digitalFulfillmentHandler` (Digital Products guide); `order.lines` is no longer read anywhere in the handler. Found and runtime-reproduced while writing the Slice 10 / R4 evidence: pre-fix R4-02 fails with `CREATE_FULFILLMENT_ERROR`; post-fix `[R4-02] grant=2 sourceType=order grantedMinutes=600 orderLineId=1 fulfillment=T_1`, and R4-04 proves it is load-bearing by provisioning `meeting=1 state=Active session=1 status=LIVE grantId=2` (the `order` grant, not `internal_overhead`), with R4-08 binding the ledger to the same grant. | ✅ Fixed |

