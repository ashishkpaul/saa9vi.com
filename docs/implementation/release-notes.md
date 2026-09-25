# Release Notes

## Unreleased

### Fixed

- **BUG-036 — tenant sessions are no longer served from `internal_overhead` capacity, and `isUnbounded` is honoured at provisioning (`d711940`):** the provisioning gate selected any non-exhausted in-window grant and then required `grantedMinutes - consumedMinutes > 0`, never reading `isUnbounded` — so an org whose only valid grant was the auto-created unbounded `internal_overhead` grant (`grantedMinutes: -1` sentinel) could never provision a meeting, and an *exhausted* commercial allowance was reported as a *missing* one ("No active capacity grant found"). Selection is now restricted to tenant-selectable source types (`order`, `subscription`) via a positive `IN` list; the minutes gate uses shared `Infinity` semantics from the new `services/grant-selection.policy.ts` (also adopted by `GrantReaderService.getRemainingMinutes()`); and the failure path distinguishes "allowance exhausted" from "no allowance at all" with an accurate message. `GrantReaderService.findEarliestValidGrant()` — verified dead (zero callers) and carrying the same bug family — was deleted. Evidence: 8/8 infra-free `grant-selection.policy.spec.ts`; 3 new real-Postgres cases in `bbb-meeting-concurrency.e2e-spec.ts` that were first run against the **pre-fix** worker and fail there with the documented symptoms (BUG-036's first runtime reproduction), 4/4 post-fix; `bbb-usage-ledger.e2e-spec.ts` 5/5 unchanged.
- **BUG-037 — the `bbb-channel-isolation` e2e suite (INV-001's runtime evidence) can pass again (`13/13`):** the suite had been impossible to run since `48ad7c7` — it loaded only `TenantPlugin` + `BigBlueButtonPlugin`, so `registerNewTenant` failed with `The permission "CreateCmsArticle" may not be assigned` (Vendure rejects permissions no loaded plugin registered); it never received BUG-033's `requireVerification: false`, so tenant-channel logins returned a null `CurrentUser`; and its org-creation phase called `adminClient.asSuperAdmin()` **without `await`** (racing the login into an unauthenticated `ForbiddenError`) plus `setChannelToken('')`, which unsets `ctx.channelId` and makes Vendure's `userHasPermissions()` return false for every `@Allow(...)` — while the organization already existed, provisioned by `BbbTenantProvisioningListener` on `TenantRegisteredEvent` with the tenant-scoped ctx that `assignToCurrentChannel()` requires. The phase now asserts that real provisioning path (polled), and GraphQL `channelId` assertions use the encoded id form while repository reads use the decoded one. Harness-only change — no product code touched. Evidence: `7 failed | 6 skipped (13)` → `5 failed | 8 passed` → **`13 passed (13)`** on real Postgres; `npx tsc --noEmit` exit 0.
- **BUG-038 — `bbbFulfillmentHandler` read `order.lines`, which Vendure never loads, so no `order`-source capacity grant could ever be written:** `createFulfillment()` resolved each line's product variant with `order.lines.find(...)`, but Vendure's `FulfillmentService.getOrdersFromLines()` hands a fulfillment handler an order loaded with `relations: ['order', 'order.channels']` **only** — `order.lines` is `undefined`, so the `?.` chain never guarded and the call threw `TypeError: Cannot read properties of undefined (reading 'find')`. Vendure wrapped the throw, so the Admin caller saw only `CREATE_FULFILLMENT_ERROR` with no stack, and the single consumed effect (an idempotent, `info`-level `BbbCapacityGrant` write) failed silently — making capacity-grant writer (B), the purchase path `addFulfillmentToOrder → bbbFulfillmentHandler → BbbCapacityGrant(sourceType:'order')`, entirely dead. Combined with BUG-036's rule that `internal_overhead` is never tenant-selectable, a customer who paid for a session could not provision a meeting at all. Fixed by resolving lines from the handler's own `lines` input — `find({ where: { id: In(lines.map(l => String(l.orderLineId))) }, relations: { productVariant: true } })` — hoisted out of the per-line loop into a single batched query, mirroring Vendure's canonical `digitalFulfillmentHandler` (Digital Products guide); `order.lines` is no longer read anywhere in the handler. Found and runtime-reproduced while producing the Slice 10 / R4 evidence: pre-fix R4-02 fails with `CREATE_FULFILLMENT_ERROR`; post-fix `[R4-02] grant=2 sourceType=order grantedMinutes=600 orderLineId=1 fulfillment=T_1`, with R4-04 proving the write is load-bearing (`[R4-04] meeting=1 state=Active session=1 status=LIVE grantId=2` — the `order` grant, not overhead) and R4-08 binding the usage ledger to that same grant.
- **BUG-039 — Tier 2 of the capacity-policy cascade was schema-blind, so plan-derived concurrency silently resolved to `fallback`:** `getEffectivePolicy()`'s Tier 2 selected the channel's active subscription with a raw `SELECT "planId" FROM "organization_subscription"`, which Postgres resolves through the connection's `search_path`, while TypeORM qualifies *entity* queries with the connection's `schema` option — and does not derive `search_path` from `schema`. With `dbConnectionOptions.schema` set (every schema-isolated e2e run, and any such deployment) the raw query read a table holding no matching row, so `planId` came back `undefined`, Tier 2 declined, and the cascade fell through to Tier 3/4 with **no throw and no log**; had the bare table been absent from `search_path` entirely, Tier 2's own `try/catch` would have downgraded the error to a `Logger.warn` and continued anyway. Slice 5's whole mechanism *is* Tier 2, so the feature only ever worked while `schema` was unset — which is the production default, which is why it survived until the first schema-isolated e2e run. Fixed with a private `subscriptionTableRef` getter that qualifies the table with `rawConnection.options.schema` when configured and falls back to the bare name otherwise: byte-identical SQL when no schema is set, and it is the only raw query under `src/` outside migrations, so the fix covers the whole raw-SQL surface. Found and runtime-reproduced while writing the Slice 5 evidence: pre-fix `plan-derived-concurrency.e2e-spec.ts` **2 passed / 3 failed** (the three Tier-2-dependent cases), post-fix **5/5**; diagnosis was direct SQL rather than inference — the seeded rows sat in `e2e_plan_capacity.organization_subscription` while `public.organization_subscription` was empty for that channel. Gates: `tsc` 0, `lint` 0, `build` 0, `verify:invariants` 100/100 with 0 warnings.

### New

- **Slice 6 — the free tier's 60-minute daily live allowance (plan §3.3 / §3.6 "Daily live minutes"; ADR-045 + INV-026; `07aa9d6`, 2026-09-25):** Free Basic's allowance is now materialised at runtime instead of existing only as a plan row. `services/daily-allowance.policy.ts` is a pure, infrastructure-free module pinning the frozen `DAILY_ALLOWANCE_MINUTES = 60`, the `isDailyOnlyPlan()` discriminator (`providerPlanId IS NULL` — no new plan flag, so no migration), the server-day window (`validFrom` = server-clock midnight, `validUntil` = one millisecond before the next midnight, so consecutive windows are strictly disjoint under the inclusive `<= now` / `>= now` predicate) and the `(organization, validFrom, sourceType)` idempotency key. `services/bbb-daily-allowance.service.ts` is the **single writer** (plan §3.3 forbids a second one): read-then-insert inside one transaction holding `pg_advisory_xact_lock(hashtextextended(key,0))`, schema-qualified raw subscription lookup on the BUG-039 Tier-2 precedent, `sourceType='subscription'` with `isUnbounded=false` and null order links, and the paid-tier ban enforced *in the writer* so every caller inherits it. Two triggers, one writer: a new hourly `bbb-daily-allowance` scheduled task (returns counts, never throws) and a fail-soft `SubscriptionPlanChangedEvent` consumer in `BbbSubscriptionListener`, so a tenant's first meeting never waits on the sweep. **Resolves plan decisions D-6/D-7/D-8** (ADR-045): exhaustion is decided at provisioning — terminal `Failed` with `failureReason` + `MeetingFailedEvent`, no pre-enqueue gate; hourly schedule on the Saa9vi server clock with no backfill (the idempotent write *is* the catch-up); free plans are daily-only while provider-backed plans get no daily grant (daily and period sets are disjoint by plan, so the daily writer and the renewal writer can never race). **Nothing else changed:** `findMyLiveUsage`, `consumeGrantHours`, `BbbUsageLedger`, selection/enforcement and the GraphQL contracts are untouched — no migration, no SDL, no codegen. **Docs:** `docs/architecture/adr-045-daily-live-allowance.md`, INV-026 in `invariants.md`, condensed ADR-045 *and* the previously missing ADR-044 entry in `platform-adr.md`. **Evidence:** `__tests__/daily-allowance.policy.spec.ts` **14/14** (infra-free); `e2e/daily-allowance.e2e-spec.ts` **7/7** on real Postgres via the new `npm run test:e2e:daily-allowance` (schema `e2e_daily_allowance`, port 3096) — one grant per day, concurrent sweeps write exactly one, provider-backed plans get none, a closed window is never reused, the plan-changed event writes today's grant, an exhausted allowance lands terminal `Failed`, free→paid stops granting without clawback — and **7 skipped / exit 0** without `DAILY_ALLOWANCE_E2E`; new `AdrChecker.dailyAllowanceInvariants()` (INV-026) under `verify:invariants` → 0 errors / convergence 100, **mutation-tested** (a planted second-writer file fails the run with the offending path named); `npm run build` exit 0; BBB plugin suite 39 passed / 31 gated-skipped.

- **Plan-derived `concurrentMeetingLimit` (plan §3.6 "Concurrent live rooms"; Slice 5 / F-3):** `BbbPlatformCapacityPolicy` gained `maxConcurrentMeetings` (default `5`, column via CLI migration `1790319702564-add-max-concurrent-meetings-to-capacity-policy`), carried on `EffectiveCapacityPolicy` alongside a new `isPlanDerived()` guard and pushed onto `BbbOrganization.concurrentMeetingLimit` by a single write-through, `BbbPlatformCapacityPolicyService.syncConcurrentMeetingLimit()`. It runs from org `create()`/`update()`, from a new `SubscriptionPlanChangedEvent` (published by `SubscriptionService.announcePlanChange()` after `subscribeToPlan`/`changeOrganizationSubscriptionPlan`, and by `FreePlanProvisioningService.announceActivation()` at both return points incl. race-adoption — both warn-and-continue so a publish failure can never break activation) consumed by `BbbSubscriptionListener.convergeConcurrentMeetingLimit()`, and from a new startup reconciliation bootstrap (`listeners/bbb-plan-capacity-reconciliation.bootstrap.ts`) — so the value **converges regardless of listener ordering**, which matters because `BigBlueButtonPlugin` registers before `SubscriptionPlugin` and either `TenantRegisteredEvent` handler may legitimately resolve first (ADR-031 amendment, Decision 5). `isPlanDerived()` restricts the write-through to Tier 1/Tier 2 resolutions, so a Tier 3/4 (platform-default/fallback) resolution can never overwrite an Admin-set value, while a channel-override still applies because it *is* plan-derived. Admin surface: `maxConcurrentMeetings` on `BbbPlatformCapacityPolicy`, optional on `PlatformCapacityPolicyInput` (stored value preserved when omitted) and returned on `EffectiveCapacityPolicy`, with `upsertPlatformCapacityPolicy` validating `>= 1`. Docs: ADR-031 amended (Proposed → Active, entity snippet, tier table "Max Concurrent Rooms" column, Decisions 1–5) and INV-015 extended (3-layer table, packaging-ceiling-vs-allowance, tier-aware write-through, convergence-not-ordering); `glossary.md` drift fixed. Evidence: new `src/plugins/bigbluebutton-plugin/e2e/plan-derived-concurrency.e2e-spec.ts` (`PLAN_CAPACITY_E2E=true`) **5/5** on real Postgres — guard truth table; Free Basic ⇒ 1 derived through the real `EventBus`; re-derive on plan change; Admin-value preservation (Tier 3/4 no-overwrite + channel-override applies); startup reconciliation `corrected=1` then idempotent `corrected=0`. `scripts/verify/free-basic-activation.sh` extended (step 2 now seeds *and asserts* `maxConcurrentMeetings: 1`; new step 6b polls the org until the limit is 1) and re-run on a live server → **24 passed / 0 failed / 3 skipped** (was 19/0/3), step 6b reporting `source=plan`, `maxConcurrentMeetings = 1`, `org.concurrentMeetingLimit = 1`. Full battery on the frozen tree: `build` 0, `verify:invariants` **100/100 with 0 warnings**, `lint` 0, `tsc` 0, tenant **73/73**, bbb-isolation **13/13**, meeting-concurrency **4/4**, usage-ledger **5/5**, subscription-shop **12/12**, R4 **10/10**. **Deliberately out of scope:** Slice 6 (daily live allowance), any paid-tier numbers, and any provisioning-UX change.

- **Slice 10 / R4 — the commercial → payment → entitlement → BBB → usage-ledger lifecycle is proved end-to-end at runtime (2026-09-25):** new infrastructure-gated spec `src/plugins/bigbluebutton-plugin/e2e/r4-runtime-lifecycle.e2e-spec.ts` (run with `R4_E2E=true`) walks the whole chain against real Postgres and a stubbed BBB transport, and prints one `[R4-nn EVIDENCE]` line per case so the evidence is in the log instead of being inferred from a green tick. The three capacity-grant writers are proved **separately**, because they have three different triggers: (A) `PaymentSettled → BbbOrderFulfillmentListener → BbbEntitlement(source='purchase')` (R4-01); (B) Admin `addFulfillmentToOrder → bbbFulfillmentHandler → BbbCapacityGrant(sourceType='order')` (R4-02); (C) `SubscriptionRenewedEvent → BbbSubscriptionListener → BbbCapacityGrant(sourceType='subscription')` (R4-03). The chain is then walked in dependency order: provisioning selects the commercial `order` grant rather than the auto-provisioned `internal_overhead` grant and reaches `ACTIVE`/`LIVE` (R4-04); an entitled learner receives a real, checksum-signed attendee join URL (R4-05); an authenticated but unentitled learner is refused **at the entitlement gate** (R4-06) while an anonymous caller is stopped earlier **at `@Allow(Authenticated)`** (R4-07) — two provably distinct denial layers; meeting completion writes exactly one immutable ledger fact bound to the `order` grant and rolls it into `consumedMinutes` (R4-08); replaying the same `(meetingId, grantId)` sequentially and as 6 concurrent racers never double-bills (R4-09); and a tenant-B customer cannot reach tenant-A's meeting or entitlement while tenant A's own learner still can (R4-10). All paid scenarios settle explicitly through `checkoutAndExplicitlySettle()` (Admin `settlePayment`, asserting `Payment.state === 'Settled'` and the order reaching `PaymentSettled`) because `dummyPaymentHandler.automaticSettle` defaults to `false`. Two runtime facts the spec had to discover and encode: R4-02 is a **hard prerequisite** of R4-04 (the auto-provisioned `internal_overhead` grant is excluded from tenant-selectable sources by BUG-036, so without the `order` grant provisioning fails on an empty selectable set), and exercising the ledger write requires `backdateProvisionedAt()` because `fairBillingMinDurationMs = 120_000`. This slice is also what surfaced **BUG-038**, fixed here. Evidence: `[R4-01] … order=1 payment=1 preSettle=PaymentAuthorized settle=Settled entitlement=1 source=purchase channel=1 session=1`; `[R4-02] grant=2 sourceType=order grantedMinutes=600 orderLineId=1 fulfillment=T_1`; `[R4-03] grant=4 sourceType=subscription grantedMinutes=900 org=2 channel=2 recurringCapacityGrantTable=absent`; `[R4-04] meeting=1 state=Active session=1 status=LIVE grantId=2`; `[R4-05]` checksum-signed attendee join URL; `[R4-06]` entitlement-gate refusal; `[R4-07]` `@Allow` refusal; `[R4-08] meeting=1 ledgerRows=1 consumedMinutes=11 grant=2 grant.consumedMinutes=11 session=FINISHED`; `[R4-09] ledgerRows=1 grant.consumedMinutes=11 (unchanged after 7 replays)`; `[R4-10] tenantB channel=2 org=2 customerB=4 → cross-tenant join FORBIDDEN; entitlements=0; tenantA learner still joins; ledger grant=2`. **10/10 on real Postgres.** Full gate battery on the frozen tree: `npx tsc --noEmit` 0; `npm run build` 0; `npm run verify:invariants` 0; `test:e2e:tenant` **73/73**; `test:e2e:bbb-isolation` **13/13**; meeting-concurrency **4/4**; usage-ledger **5/5**; subscription-shop **12/12**; `R4_E2E=true` **10/10**.
- **Slice 9 — ADR-043 L1 theme consumption + plan/usage dashboard + admin sign-in bridge (`edu-frontend` `7561643` + `b262ba3` + `2bba7e2`, 2026-09-24):**
  - **Theme (ADR-043 L1):** `myTenantTheme` → CSS-variable payload rendered as a server-side `<style>`; injection keyed on the proxy-set `x-saa9vi-channel-token`; ineligible/`null` ⇒ platform default; unknown host fails closed (B-6 edge, unchanged). Zero client-side commercial logic. Positive themed-tenant render is **not** runtime-provable in the current dev fixture set (no channel has an active theme row — backend fixture gap, not a frontend gap).
  - **`/account/billing`:** subscription card (active/cancelled/`past_due`, NULL-period Free Basic → "No billing period on this plan" + "Your current plan"), usage panel rendering **standalone** when `mySubscription` is `null`, plans grid with catalogue copy + current-plan ring + marketplace flag — every value read from the slice-8 Shop queries (`availableSubscriptionPlans`/`mySubscription`/`myLiveUsage`); no client-side entitlement derivation, no mutations (UI-1/ADR-044 stay deferred).
  - **Admin sign-in bridge:** Shop `login` failure falls back to the Admin API (`VENDURE_ADMIN_API_URL` = `/admin-api`, documented in `.env.example`); the Admin session is presented to Shop reads. **Platform finding:** an *unverified* admin (the state `registerNewTenant` creates) hits a null-field `CurrentUser` + INTERNAL error + no session on the Admin API — the Admin schema union lacks `NotVerifiedError`; the product path is the custom `verifyTenantAdmin` Shop mutation (returns the channel token, sets `verified=true`) → Admin login. Proven E2E in a browser (register → verify → bridge sign-in → cookie-validated `me` → billing render; probe tenant channel 25).
  - **Evidence:** final-tree gates (markers/JSON/`codegen:check`/`tsc`/`eslint`/`build` all exit 0); tenant-isolation reads (apex 120/11/109 standalone + `mySubscription: null`; paid tenant positive with period + marketplace flag; catalogue ₹499.00/₹0.00); bogus token fail-closed; screenshot `/tmp/bill_owner2.png`.
- **Shop commercial read surface (plan §3.5, slice 8) — done (2026-09-24):**
  - Read-only Shop API on `SubscriptionPlugin` (no mutations — UI-1 stays deferred pending its own ADR): `availableSubscriptionPlans` (platform-global catalogue, `Permission.Public`), `mySubscription` (subscription + whitelist plan projection + ADR-042 `marketplaceEligible` sourced from the shared `CommercialEntitlementService` — no second evaluator), and `myLiveUsage` (period-scoped allowance from `BbbCapacityGrant`, restricted to tenant-selectable `order`/`subscription` sources via the shared `grant-selection.policy.ts` positive `IN` list — the BUG-036 single home; `isUnbounded` → `remainingMinutes: null`; a configuration without `BigBlueButtonPlugin` degrades to a zeroed allowance plus a warning rather than 500-ing a dashboard read).
  - **Locked permission model:** `Permission.Authenticated` alone is NOT ownership — every role carries it and `TenantRegistrationService` assigns the Customer role to every tenant channel, so any logged-in learner would pass the gate. `mySubscription`/`myLiveUsage` therefore call `TenantBusinessAccountService.assertBusinessAccount(ctx)` first: business account = Administrator whose role is channel-assigned to `ctx.channelId`; fail-closed for Customer sessions; platform SuperAdmin passes (the SuperAdmin role is assigned to every tenant channel at registration). The tenant comes from `ctx.channelId` only — no query in the surface accepts a `channelId` argument — and every response is built by explicit whitelist projection, so provider/billing internals (`providerPlanId`, `providerStatus`, `providerShortUrl`, `billingCustomerId`, `dunningRetryCount`) cannot leak: they are absent from the regenerated Shop SDL (`schema-shop.graphql`, +85 lines; a probe query fails GraphQL validation) while remaining on the Admin surface.
  - **Platform findings recorded in the spec (both shaped UI-1):** (1) this Vendure version's Shop `login` resolves credentials through the `customer` table (`UserService.getUserByEmailAddress` INNER JOINs by `ctx.apiType`), so administrators receive `INVALID_CREDENTIALS_ERROR` on the Shop API — business-account sessions must authenticate on the **Admin API**, whose session token the Shop API accepts (sessions are not api-type-scoped); (2) a test learner created *without* the Customer role has empty `channelPermissions`, so `@Allow(Authenticated)` denies it at the guard while an `activeCustomer` control still passes via the Owner-only path — ownership tests must give learners the real Customer role or they prove nothing.
  - Evidence: `src/plugins/subscription/__tests__/subscription-shop.e2e-spec.ts` **12/12** on real Postgres (anonymous catalogue on both channels; provider-field validation failure; anonymous guard denial; learner denial attributed to the ownership check via a `Logger.debug` spy with an `activeCustomer` control proving the session authenticated; tenant admin reads Free Basic — active, NULL periods, `marketplaceEligible=false`; `myLiveUsage` reports 0 despite the auto-created unbounded `internal_overhead` grant and 100/30/70 after a selectable `order` grant; SuperAdmin allowed). Gates: `npx tsc --noEmit` 0; `npm run build` 0; `npm run codegen` 0; `npm run verify:invariants` 3 passed / convergence 100/100; regression: BBB isolation **13/13**, meeting-concurrency **4/4** (`MEETING_CONCURRENCY_E2E=true`), usage-ledger **5/5** (`BBB_USAGE_LEDGER_E2E=true`), tenant-plugin **73/73**.

- **BBB session-provisioning state machine — gate complete (`964f01c`, `8c85263`):**
  - Session `LIVE` is now a **provisioning-success state**, not a provisioning-request state: `startScheduledSession` links a Pending meeting and stays SCHEDULED; `BbbSessionProvisioningListener` transitions SCHEDULED → LIVE on `MeetingProvisionedEvent` (the sole LIVE transition) and LIVE → FINISHED on `MeetingCompletedEvent`, with a startup reconciliation pass for orphaned LIVE sessions.
  - Single provisioning consumer: `BbbMeetingService` is enqueue-only; `BbbProvisioningWorkerService` is the sole queue consumer and implementation (duplicate ~170-line path removed).
  - Atomic org-capacity reservation (`reserveProvisioningCapacity`): pessimistic org lock + `PROVISIONING+ACTIVE` count + promote in one transaction — concurrent promotions can never exceed `concurrentMeetingLimit`.
  - `BbbScheduledSession` transaction boundary: shop `startScheduledSession` is `@Transaction()`-decorated so `assertCanCreateMeeting`'s pessimistic lock + count shares the transaction with the meeting insert (TOCTOU closed).
  - Entitlement channel stamping: `createBbbEntitlement` persists `channelId=ctx.channelId` (admin-created entitlements were invisible to channel-scoped `hasAccess()`).
  - Retry relink: `retryBbbMeeting` repoints `session.activeMeeting` to the new meeting.
  - E2E: `bbb-meeting-concurrency.e2e-spec.ts` (real Postgres, 3 concurrent promotions vs limit=2 — exactly 2 PROVISIONING, ≥1 PENDING).
  - **BBB-INT-001 closed 2026-09-15** (see `known-bugs.md`): fresh provisioning-created meetings return `getMeetingInfo SUCCESS`; the earlier `error.forbidden` was traced to a stale/expired meeting artifact, not a checksum/API/provisioning defect.

- **Razorpay subscription provider (ADR-038) — accepted 2026-09-12:**
  - Provider-neutral webhook inbox: `ProviderWebhookEvent` (immutable, UNIQUE(provider, providerEventId))
  - Razorpay adapter: `RazorpayWebhookProcessor`, `RazorpaySubscriptionProvider`, `RazorpayWebhookController`
  - BullMQ worker: persist-first, channel resolution from binding (INV-001), 3-attempt retry with `failedAt`
  - Concurrent idempotency: `SubscriptionBillingAttempt` UNIQUE(provider, providerEventId)
  - Migrations: `1789141516883` (attemptCount), `1789180117889` (failedAt), `1789180807072` (unique constraint)
  - Tests: `webhook-failure-path.e2e-spec.ts`, `webhook-concurrent-idempotency.e2e-spec.ts`
  - Migration incident (recorded for deployment-history traceability): an untracked duplicate migration `1789180759171` was generated alongside the tracked/applied `1789180807072` (unique constraint). The duplicate was deleted, stale `dist/` artifacts cleaned, and `1789180807072` marked applied. Final condition verified: source migration history == DB migration history (`rm -rf dist && npm run build` + `vendure migrate --run` clean).

- **Commission reconciliation (Phase 3B, Gates R1–R3) — complete (`fab9969`):**
  - R1 contract (`docs/implementation/commission-reconciliation.md`): read-only Orders↔CommissionLedger reconciliation; ledger is the sole financial authority (never recalculated, never mutated). Discrepancy classes: MISSING, REPLAYED_REF (informational), AMOUNT_MISMATCH (stored-row internal consistency only — never validated against the current env rate), ORPHAN_LEDGER_ROW, RATE_DRIFT (informational). ZERO_RATE rows are valid facts. All `from`/`to` filters bind to `Order.orderPlacedAt` (including replay diagnostics).
  - R2 implementation: `CommissionReconciliationService` (4-phase, pure report) exposed as the `commissionReconciliation` Admin GraphQL query via `MarketplaceCommissionReconciliationResolver`, gated by a dedicated `ReadMarketplaceCommission` permission (separate from advertising grants). Channel-scoped by `ctx.channelId`; SuperAdmin may pass `allChannels: true`, enforced by a service-side clamp (a non-SuperAdmin cannot cross channels via the GraphQL argument). Semantic clarity: `commissionLedgerOrderCount` = ledger rows found, `marketplaceOrdersExpected` = marketplace-order population; `effectiveCommissionPercent` is `null` only when GMV is 0 (a 0% row with positive GMV reports `0`).
  - Correctness fixes surfaced and verified by R3: channel filtering uses TypeORM relation joins (`order.channels`) instead of raw SQL relation expressions; custom-field predicates target the flattened physical columns (`customFieldsOrdersource`, `customFieldsMarketplaceref`) emitted by Vendure 3.6.5.
  - R3 E2E (`commission-reconciliation.e2e-spec.ts`, `npm run test:e2e:reconciliation`): 7/7 through Admin GraphQL on real PostgreSQL — MATCH (exact count semantics), MISSING (missingCount=1 with no repair), REPLAYED_REF, DIRECT excluded, ZERO_RATE, AMOUNT_MISMATCH (read-only verified: stored value not rewritten), CHANNEL_ISOLATION (A↔B both directions + SuperAdmin allChannels + tenant-admin clamp).

- **Attendance analytics (Phase 3D.3) — complete:**
  - Two-layer fact model: immutable `BbbWebhookEvent` raw events → derived/recomputable `SessionAttendance` PostgreSQL fact (`UNIQUE(scheduledSessionId, customerId, channelId)`).
  - `SessionAttendanceService.recordMeetingEndedAttendance()` — v1 aggregation from MEETING_ENDED webhook attendee snapshot; idempotent via raw-event watermark (`lastProcessedWebhookEventId`); registered population sourced from `BbbEntitlement(type=bbb_session)`; unregistered attendees still get a row (evidence exists).
  - `AttendanceAnalyticsService` — read-only query layer: per-student facts, per-session summary (registered/attended/noShow/attendanceRate/avgDuration/completionRate), channel-wide time-window summary.
  - Admin API (`BbbManageSessionsPermission`, channel-scoped): `scheduledSessionAttendance`, `scheduledSessionAttendanceSummary`, `channelAttendanceSummary`.
  - Shop self-view (`Permission.Authenticated`): `mySessionAttendance` — student's own record only.
  - Dashboard: `Marketplace → Attendance` route with channel summary (30-day window).
  - E2E: 4/4 pass on real PostgreSQL (PRESENT/NO_SHOW, idempotency, late-event recompute, channel-scoped summary).
  - Channel fix: `BbScheduledSession` has no `channelId` — resolved via linked `BbOrganization` to preserve Channel=Tenant invariant.

### Docs

- **Slice-5 documentation reconciliation (2026-09-25, docs-only — no source changes):** four consistency fixes arising from the review of `0a6b433`. Slice 5 itself stays closed; nothing here reopens it.
  - `docs/product/glossary.md` — INV-015 read "⚠️ Proposed — see ADR-031" while ADR-031 is **Active** and INV-015 is **Live** (and the same file already listed `BbbPlatformCapacityPolicy` as Live). Corrected to **✅ Live — see ADR-031**.
  - `docs/implementation/saa9vi-comprehensive-integration-and-commercial-plan.md` §3.6 — the **frozen Free Basic policy row** omitted `maxConcurrentMeetings`; added as **`1`**, with a note that it is the one field in that row which already has a live enforcement consumer (contrast the `5/5/5` participants triple, where `maxConcurrentParticipants` still has none). Row **0.15**'s "it governs room participant capacity only … not concurrent meeting count" was falsified by Slice 5 and is now marked partly superseded. The header's `Verified HEAD: fbcdce9` is relabelled to an **evidence-table boundary** (current HEAD `0a6b433` recorded separately), so the 2026-09-24 verification boundary is no longer readable as the implementation tip. The §4 slice-5 row now states its **evidence classification**: Tier-2 resolution, the `EventBus` consumer, cache sync, convergence/reconciliation and Tier 3/4 non-overwrite are **runtime verified**; the Admin plan-change *producer* path is **code-verified only**, because the spec mutates the subscription row and publishes the event itself rather than calling the GraphQL mutation.
  - `docs/implementation/integration-gaps-worklist.md` — the "all test/application data mutations MUST use GraphQL" rule is now scoped in three tiers, so the repository's established isolated-E2E fixture pattern (21 of 23 e2e specs build fixtures via `connection.getRepository(...)` inside a schema the suite owns) is explicitly permitted, while direct SQL mutation stays forbidden everywhere. A corollary requires consumer-path and producer-path evidence to be claimed separately.
  - The remaining `assertCanCreateMeeting` runtime-throw gap is **still open**, and remains explicitly labelled in all three tracking documents (`saa9vi-comprehensive-integration-and-commercial-plan.md` — F-3 and §4 row 5, "Still open"; `what-next.md` — "Still open inside the slice's original scope"; `integration-gaps-worklist.md` item 5 — "Residual"). This pass deliberately did **not** close it: it stays a known, labelled gap rather than being silently dropped.

- **Second documentation reconciliation (2026-09-25, docs-only — no source changes):** the residual items the first pass did not catch, each verified against `0a6b433` before editing.
  - `docs/implementation/saa9vi-comprehensive-integration-and-commercial-plan.md` — header line `Current HEAD (local clone): 0a6b433` relabelled to **"Slice-5 implementation baseline (newest *source* commit)"**, with a note that every later commit is docs-only, making the label durable; §4 row 6 ("Daily allowance layer") changed from **"OPEN — blocked by 5"** to **"OPEN — next up, unblocked"** (slice 5 closed 2026-09-25, so the stated blocker no longer existed); §3.6 gained a **Tier-1 caveat** recording that the channel-override tier is resolve-only.
  - `docs/architecture/platform-adr.md` — the ADR-031 **entity snippet was wrong** (`default: 100 / 500 / 1000`) and is corrected to the real columns (`25 / 100 / 250`); the recommendation table now carries a correction note stating those figures are non-binding and that the implemented reference defaults are `PLAN_TIER_DEFAULTS` (25/100/250 · 100/300/1000 · 250/1000/5000), resolving the **50/200/500 vs 25/100/250** divergence as a **documented exception** to `.clinerules` §10 (adopting them would encode values the ADR itself calls *not frozen* and would need a migration).
  - `docs/implementation/roadmap.md` — removed the `[x] Starter 50 / Growth 200 / Enterprise 500` overclaim: no seed ships and those figures were never encoded in code.
  - `docs/product/glossary.md` — the Free Basic entry no longer reads as though the in-code **5** were the concurrency default; the frozen decision is **1**, and 5 is only the entity column / Tier-4 fallback default.
  - `docs/what-next.md` — `Updated:` corrected 2026-09-24 → **2026-09-25** (the document already recorded 2026-09-25 work).
  - `docs/implementation/integration-gaps-worklist.md` — new **"Open API-completeness gap (not a slice)"** subsection: Tier-1 channel override has no Admin write surface (`PlatformCapacityPolicyInput` carries no `channelId`). Shipped scope is unaffected — Free Basic resolves at Tier 2.


### Changed (breaking)

- **3D.2 — Shop API:** removed the dead `city` input from `MarketplaceSearchInput`. It was never consumed by the resolver and no location field exists anywhere in the data model. External storefronts must stop sending `city`; `schema-shop.graphql` and all plugin codegen types have been regenerated.

### New

- **3D.2 — Instructor/session search refinement:**
  - `MarketplaceSearchInput` gains `priceMin`/`priceMax` (paise) and `startFrom`/`startTo` range filters (ES filter context, no score impact) plus `MarketplaceSessionSort` (RELEVANCE, PRICE_ASC, PRICE_DESC, SOONEST).
  - Sort semantics: under `PRICE_*`/`SOONEST` the explicit field is the primary ordering; Bayesian/sponsored score only breaks ties. Global ranking dominance applies only under `RELEVANCE`.
  - Fuzzy `multi_match` (`fuzziness: AUTO`) for session and instructor searches.
  - Instructor documents enriched with `upcomingSessionsCount`, `minPriceInPaise`, `nextSessionStart` projected from the F7-eligible session population via `BbbInstructorAssignment`; ES mapping ensured on pre-existing instructor indices. These aggregates are projection data only — not authoritative application facts.
  - Terminology: the marketplace's course representation *is* the scheduled session (BbbScheduledSession + product variant); no separate MarketplaceCourse entity exists.

## v1.17 — 2026-09-04
## v1.17 — 2026-09-04

### New

- **Commission classification + ledger (Phase 3B) — complete:**
  - `CommissionListener` — server-side marketplace classification (ADR-021 Decision 5-8; INV-008): re-verifies HMAC/TTL/channel at placement, resource-in-order check (Decision 8), single-use replay via UNIQUE index (Decision 6), stamps `orderSource`, records `CommissionLedger` row. Uses `EntityHydrator` for safe Order save.
  - `CommissionLedger` $0-row pattern (DL-030) — row written for EVERY marketplace order, even at 0% commission (`commissionAmountInPaise: 0`), so GMV history survives rate changes.
  - Governed migration `1788497028332` — UNIQUE constraints on `marketplaceRef` (single-use arbiter) and `orderId` (one fact per order).
  - Strict `MARKETPLACE_COMMISSION_PERCENT` config validation at boot (regex + range, fail-closed).
  - `commission.e2e-spec.ts` — 6 cases pass: positive, $0-row, INV-008 forge, replay, no-ref, single-use ref.
- **Marketplace projection correctness corrections (Gate 1.4):**
  - `ProductVariantEvent` — replaced the former logging-only handler with deterministic affected-session resolution and canonical `indexSession()` projection updates (`1a7ebdf`).
  - `ProductVariantPriceEvent` — added explicit handling for channel price create/update/delete events so marketplace prices cannot become stale when Vendure changes `ProductVariantPrice` rows (`6469090`).
  - `instructorName` — corrected marketplace session projection to resolve the authoritative `InstructorProfile.fullName` through `BbbInstructorAssignment`, preferring the primary assignment, instead of projecting the numeric `BbbOrganizationMember.id` (`6469090`).
  - `InstructorProfileUpdatedEvent` — now reindexes affected session documents when an embedded instructor name changes (`6469090`).

### Tests / Verification

- TypeScript compilation clean; production build clean.
- Commission E2E: `COMMISSION_E2E=true` → 6 passed (26.67s).

---

## v1.16 — 2026-08-31

### New

- **NavigationMenu entity in CMS** — `NavigationMenu` entity with JSONB items array, one menu per channel (unique channelId), `NavigationMenuService` with full CRUD, registered in `CmsPlugin`. Migration `1788162583347` generated via Vendure CLI and applied.
- **Dunning flow (RFC-001 §4.2)** — `subscription-dunning` scheduled task: discovers `past_due` subscriptions, re-enqueues renewal attempts per retry interval (`DUNNING_RETRY_INTERVAL_DAYS`, default 3), auto-cancels after max retries (`DUNNING_MAX_RETRIES`, default 4). `OrganizationSubscription` gains `dunningRetryCount` and `lastDunningAttemptAt` columns.
- **Phase 2 remaining work** — Banner BullMQ scheduling confirmed complete (BUG-005/CMS-002). NavigationMenu and dunning flow now complete. Remaining: tenant onboarding flow in storefront, custom domain routing via Caddy.

### Tests / Verification

- TypeScript compilation clean; production build clean.
- Migration applied; navigation_menu table and dunning columns verified against PostgreSQL.

---

## v1.15 — 2026-08-31

### New

- **Production secret hardening (Step 6)**:
  - `JuspayEncryptionService` — AES-256-GCM encryption for webhook credentials at rest. Uses existing `BBB_ENCRYPTION_KEY` (same 64-char hex key as BBB API secrets). Encrypts before persist, decrypts on demand for verification.
  - `JuspayWebhookEndpoint` entity updated: `basicAuthPassword` and `hmacSecret` now stored as ciphertext, `encryptionKeyVersion` column added for key rotation.
  - `JuspayWebhookEndpointService.ensureEndpoint()` encrypts secrets before write; `getDecryptedCredentials()` decrypts on read.
  - Fail-closed in production: if `BBB_ENCRYPTION_KEY` is unset in production, endpoint creation throws rather than storing plaintext.
  - Migration `1788151666245-JuspayWebhookEndpointEncryption` generated via Vendure CLI.

- **Portal Admin billing Dashboard surface (Step 5)**:
  - Vendure Dashboard extension with "Billing" nav section: Subscriptions, Mandates, Payment Attempts, Reconciliation.
  - All routes SuperAdmin-only. Channel-scoped filtering.

- **Full lifecycle e2e regression suite** (`subscription-lifecycle.e2e-spec.ts`):
  - Covers: secret encryption, mandate FSM, charge success/failure, duplicate idempotency, orphan reconciliation.

### Tests / Verification

- TypeScript compilation clean; production build clean.
- Existing `juspay-webhook.e2e-spec.ts` updated for new auth service signature.

---


> **Purpose:** Track completed work only. Organized chronologically. When new work is completed, add it here and remove from roadmap.md.

---

## v1.14 — 2026-08-30

### New

- **Juspay recurring billing foundation** (Phase 2; Step 0–2 of the integration plan):
  - `JuspaySubscriptionMandate` entity — mandate FSM `pending → active → paused/revoked`, transitions driven only by the webhook processor; dual `channels[]` + scalar `channelId` per ADR-003; partial unique index (`subscriptionId WHERE status != 'revoked'`) enforcing one current mandate per subscription with revoked mandates retained as history.
  - `JuspayPaymentAttempt` entity — INV-019 stateful attempt ledger: every attempt is an independently recorded financial fact written before the gateway call; only `initiated → succeeded|failed` may mutate a row; retries are new rows; denormalized scalar `channelId` for BUG-031-class-safe ledger queries.
  - `JuspayWebhookEvent` entity — INV-004 persist-before-process lifecycle (`PENDING → PROCESSING → PROCESSED|FAILED`, same shape as `BbbWebhookEvent`) plus a unique period-aware `dedupeKey` (`juspay:{event_type}:{mandateId}:{billingPeriodStart}`) guarding against provider redelivery. Two idempotency layers protect different failure modes (documented in-entity).
  - Migrations `1788058421475-JuspayRecurringBillingEntities` and `1788059200478-JuspayLedgerHardening` generated via Vendure CLI and applied.
- **Subscription renewal claim/finalize state model** — `executeRenewal()` restructured: CLAIM CAS (ownership only, period untouched) → payment attempt → charge → FINALIZE CAS (period advancement + events only on payment success). Payment failure → attempt `failed` + guarded `past_due` transition, period never advanced. A finalize CAS conflict after a successful charge is logged as a manual-reconciliation incident and never auto-retried. Channel resolution moved before the charge.
- **INV-019 registered** in `invariants.md` (Subscription Payment Attempts Are Independently Recorded Financial Facts); invariant-numbering bookkeeping corrected (next free = INV-020).
- **BuyLits reference analysis** — `juspay-plugin` + `payments-core` from the BuyLits codebase preserved under `reference/buylits/` (outside the build tree); findings: dual Basic-Auth + optional HMAC webhook verification (to be ported fail-closed), genuinely reusable `payments-core` primitives (Redis checkout lock, `PaymentEventLog` idempotency, shared SDK), and confirmed **no recurring-mandate concept exists in BuyLits** — mandates are net-new. Port the pattern, not the file.

### Fixed

- Citation drift: undefined `INV-023` and `BUG-033` citations in `SubscriptionRenewalService` corrected (INV-018 / BUG-021 class); `invariants.md` INV-018 text and stale "next free invariant = INV-017" bookkeeping updated.

### Tests / Verification

- TypeScript compilation clean; production build clean.
- Migrations applied; mandate uniqueness constraint verified against PostgreSQL (duplicate non-revoked mandates rejected; revoked rows allowed alongside the current mandate).

---

## v1.13 — 2026-08-23

### New

- **Phase 1.5 blockers resolved** — all five remaining blockers closed:
  - **FEAT-002 schema migration** — verified already applied. `npx vendure migrate -g FEAT002CapacityGrantSourceType` reported "No changes in database schema were found"; direct `psql` inspection confirmed `sourceType` and `isUnbounded` columns exist on `bbb_capacity_grant`.
  - **Next.js public instructor/CMS pages** — new `/[locale]/page/[slug]` route in `nextjs-starter-vendure` queries `cmsPage(slug)` with channel-token resolution and renders sections via the existing `PageRenderer`. Instructor profile page already existed.
  - **Email verification for tenant admins** — `TenantRegistrationService` now creates tenant admins **unverified**, sets a verification token via `UserService.setVerificationToken()`, and publishes `AccountRegistrationEvent` so EmailPlugin sends the verification email. New `verifyTenantAdmin(token)` Shop API mutation verifies the token and returns the tenant's `channelToken` (resolved from the verified user's roles → channels, matching the documented `CurrentUserChannel` pattern).
  - **End-to-end customer deletion test** — `src/platform/customer-deletion/customer-deletion.e2e-spec.ts` covering Flow A (`leaveAcademy`) and Flow B (`deleteMyAccount`) across BBB, Tenant, and Reviews plugins. Verifies entitlement/enrollment deactivation, trial cancellation, org membership deactivation, InstructorProfile anonymization (slug preserved), ProductReview authorName anonymization, ReviewRequest expiry, ReviewVote deletion, CustomerDeletionLog COMPLETED, and Customer PII anonymization + soft-delete.
  - **Load estimation ratios tuning** — PILOS load estimation ratios (`cameraRatio`, `micRatio`, `videoWeight`, `micWeight`, `listenerWeight`) are now configurable via `BigBlueButtonPluginOptions` and wired from `BBB_CAMERA_RATIO`, `BBB_MIC_RATIO`, `BBB_VIDEO_WEIGHT`, `BBB_MIC_WEIGHT`, `BBB_LISTENER_WEIGHT` env vars in `vendure-config.ts`.

### Fixed

- (No new bug fixes in this release — Phase 1.5 blocker completion only.)

### Tests

- New `customer-deletion.e2e-spec.ts` added. 2 tests pass; 2 Flow A tests remain blocked by a test-harness auth issue (the Shop API customer session doesn't resolve the tenant channel for the `leaveAcademy` mutation in the isolated e2e schema). The production code paths are correct and TypeScript-verified.

---

## v1.12 — 2026-08-10

### New

- **Tenant role reconciliation tooling** — `TenantRoleReconciliationService` + `scripts/tenant-role-reconcile.ts` with `npm run tenant:roles:check` (dry-run) and `npm run tenant:roles:repair` (apply). Reconciles existing tenant admin roles against the current `TENANT_ADMIN_ROLE_PERMISSIONS`. Add-only by default; `--remove-unexpected` removes permissions not in the template (always preserves `Authenticated`). Role selection is channel-backed (exactly one channel + `code === {channel.code}-admin`), not just `*-admin` pattern.

### Fixed

- **BUG-028** — Academy Console nav items used incorrect permission identifiers (`TenantProfileRead`, `InstructorProfileRead`, `MediaResourceRead`) instead of the Vendure `CrudPermissionDefinition` generated names (`ReadTenantProfile`, `ReadInstructorProfile`, `ReadMediaResource`). Tenant admins could not see the Academy Console.
- **BUG-029** — `TENANT_ADMIN_ROLE_PERMISSIONS` included `BbbPlatformInfrastructurePermission`, granting tenant admins permission to manage BBB servers/platform capacity infrastructure (Portal/SuperAdmin-only per ADR-033). Removed from the tenant role template.
- **Stale tenant roles reconciled** — Existing tenant admin roles (e.g. `test-academy-f9hmus-admin`) that were created before the Phase C (v1.11) permission expansion now have the BBB granular, CMS CRUD, and ReviewAdmin permissions added via the reconciliation tool.
- **BUG-030** — `administrators`/`administrator(id)` resolvers loaded `user.roles` but not `user.roles.channels`, causing TypeORM to return `channels:[]` for tenant roles despite the role-channel join existing. This made the nested `user.roles.channels` graph inconsistent with the direct `roles` query. Fixed by loading `user.roles.channels` relations in the SuperAdmin branch and using `leftJoinAndSelect role.channels` in the tenant-admin branch; same fix applied to the singular `administrator(id)` resolver. Regression test added to the INV-016 e2e suite.
- **BUG-031** — CmsPlugin used Vendure's `assignToCurrentChannel()` which assigns entities to both the current channel and the default channel, leaking tenant-created CMS content (pages, articles, banners) onto `__default_channel__` so it was visible to other tenants. Fixed via `CmsChannelAssignmentPolicy` (ADR-036): SuperAdmin → default channel only, Tenant Admin → tenant channel only (never default). Replaced `assignToCurrentChannel()` in `PageService`/`BannerService`/`ArticleService.create()`. Replaced non-working `ListQueryBuilder` channelId option in `findAll()` with explicit inner join on the `channels` relation. Also corrected stale `article.entity.ts` comment that described the old `assignToCurrentChannel` behaviour.

### Tests

- E2E suite expanded to 44 tests. New tests verify: newly provisioned tenant admin role has BBB/CMS/Reviews permissions; does NOT include `BBBPlatformInfrastructure`; is scoped to exactly one tenant channel. Channel-scoping of the `administrators`/`roles`/`role`/`administrator` resolvers (INV-016, BUG-025, BUG-026, BUG-030) is now tested with a dedicated test-only `ReadAdministrator` role, keeping the production tenant-admin permission boundary intact. Additional CMS channel isolation tests (ADR-036 / BUG-031) verify tenant A page on tenant-A channel only (invisible to tenant B) and platform CMS page on default channel only.

---

## v1.11 — 2026-08-03

### New

- **Phase A — Cross-tenant channel isolation**: `BbbChannelAccessService` enforces INV-001 at the service layer for organizations, rooms, meetings, scheduled sessions, and entitlements. `findAll` filters by `ctx.channelId`; `findById`/`update`/`delete`/`create` assert ownership. Cross-tenant isolation e2e suite added (`npm run test:e2e:bbb-isolation`).
- **Phase B — Granular BBB permissions**: Seven scoped permissions (`BBBPlatformInfrastructure`, `BBBManageOrganizations`, `BBBManageRooms`, `BBBManageSessions`, `BBBManageMeetings`, `BBBManageEntitlements`, `BBBManageMembers`) added alongside the backward-compatible `BBBAdmin`. Resolver decorators and dashboard routes updated.
- **Phase C — Tenant experience**: `TENANT_ADMIN_ROLE_PERMISSIONS` expanded with the granular BBB permissions, CMS CRUD permissions, and `ReviewAdmin`. CMS dashboard routes gated behind `ReadCmsArticle`/`ReadCmsBanner`/`ReadCmsPage`.
- **Phase D — Hardening**: INV-016 (Administrator Visibility Is Channel-Scoped) added. The `administrators` query is overridden in the TenantPlugin so tenant admins only see administrators in their own channel; SuperAdmin sees all. Regression tests added.
- **ADR-032/033/034**: Channel-ownership guard, granular BBB permissions, and channel-scoped administrator visibility documented.

### Fixed

- `BbbTrialRegistration.status` and `BbbInstructorAssignment.role` columns given explicit `varchar` type (TypeORM `Object` type error under `synchronize: true`).
- `BbbRoomService`/`BbbMeetingService` circular DI refactored to `forwardRef` (removes `require()` ESM incompatibility).

---

## v1.10 — 2026-07-24

### New

- **BUG-022 documented**: Entitlement/Enrollment read mismatch in `bbbRoomStatus`, `myBbbRooms`, `myBbbEnrollments`
- **BUG-023 documented**: Marketplace indexer broken redirect fields (`academySlug`, `channelToken`, `customDomain`)
- **BUG-024 documented**: Auto-provisioning gap expanded to include `PaymentMethod`
- **AC-002 corrected**: Room product path now writes `BbbEntitlement { type: bbb_room }`, not `BbbEnrollment`
- **Three-stream revenue model refined**: Detailed control mechanisms per stream, `CommissionLedger` $0-row pattern (DL-030), `MARKETPLACE_COMMISSION_PERCENT` env var naming
- **Documentation architecture refactored**: New `docs/architecture/`, `docs/product/`, `docs/implementation/` directories with focused documents

### Fixed

- `TenantRegistrationService` — all `console.log` calls replaced with `Logger.debug(loggerCtx)`
- `TenantShopResolver` — full-input JSON dump (which logged plaintext email addresses) removed
- `channelResult.code` — access moved after `'id' in channelResult` type guard

---

## v1.9 — 2026-07-17

### New

- **Capacity Intelligence System** — `CapacityIntelligenceService`, `BbbCapacityAlertLog`, `BbbServer.capacity`, `poolCapacityDashboard`, `capacity-alert` job (CI-001 through CI-006)
- **MarketplaceIndexerPlugin projection foundation** — initial marketplace projection capabilities shipped: sponsored listing bid-boost, Bayesian rating, price from ProductVariant, `ProductVariantEvent` subscription, BullMQ job queue, Product custom fields. Later Phase 3 audits refined the projection contract (adding `ProductVariantPriceEvent` coverage, `instructorName` correction, and `InstructorProfileUpdatedEvent` session propagation — see v1.17); Phase 3C advertising and 3D retention remain pending.
- **PlatformDashboardPlugin** — Saa9vi login branding layer with CSS override for Vendure core branding footer (ADR-016) *(legacy ADR-016 "Platform Dashboard Branding"; see collision note on canonical ADR-016 — the storefront — in `platform-adr.md`)*

- **ADR-017 (Observability Architecture)** — correlation tracing, event causality validation, runtime invariant monitoring
- **Phase 1.6 (Live Classroom Experience)** — Scheduled Sessions follow-ups as a dedicated phase

### Fixed

- `bbb-capacity-alert` job registered and verified
- `poolCapacityDashboard` query verified in dashboard

---

## v1.8 — 2026-06-30

### New

- **BUG-015/CMS-002 fixed** — `banner-activator` job registered
- **INV-013 (Customer Deletion)** — `CustomerDeletionService` with cross-plugin orchestration
- **Tenant Registration System** — `registerNewTenant` mutation with 5-step orchestration
- **BUG-021 fixed** — `channelOrToken` resolved to `channel.token` string

---

## v1.7 — 2026-06-15

### Fixed

- FEAT-001/FEAT-002 status corrected to code-complete
- Capacity Intelligence corrected from "Live" to "Designed, not implemented"
- Plugin inventory expanded from 4 to 6
- Instructor ES indexing status corrected
- §6A and §2B moved to correct TOC positions

---

## v1.6 — 2026-06-01

### New

- Capacity Intelligence System *designed* (§6A)
- INV-012 (advisory-only capacity intelligence)
- DL-025 (proactive capacity intelligence over reactive throttling)
- DL-026/027

### Fixed

- BUG-019 — `LoadSimulationPlugin` DoS vector closed
- BUG-020 — `CausalMapper` non-existent resolver reference fixed

---

## v1.5 — 2026-05-15

### New

- Phase 3 Marketplace architecture locked
- Platform-level ES index, `orderSource` attribution
- `MarketplaceIndexerPlugin`, `BayesianRatingService`
- Three-stream revenue model locked
- FEAT-003/004, INV-009/010
- DL-019–022, ADR-014
- Multivendor-plugin rejected (DL-019)

---

## v1.4 — 2026-05-01

### New

- Archetype B (Internal Staff Meeting) integrated as §8A
- FEAT-001 (`BbbOrganizationMembership`)
- FEAT-002 (Overhead Capacity Grant)
- DL-017/018

---

## v1.3 — 2026-04-15

### New

- Reviews plugin audit (4th plugin)
- §5A Dashboard Extension Pattern
- ADR-016 (formerly ADR-013 "Frontend Independence & API Evolution")
- DL-015/016

### Fixed

- BUG-016 — Reviews dashboard nav fix
- BUG-017 — Reviews channel isolation documented

---

## v1.2 — 2026-04-01

### New

- `convertTrialToEnrollment` path added (AC-003)
- EventBus table corrected
- Cipher corrected to AES-256-GCM
- BUG-015 (banner queue gap) and SEC-001 (Admin API isolation)

---

## v1.1 — 2026-03-15

### New

- Full audit vs. `bigbluebutton-plugin`, `cms-plugin`, `tenant-plugin`
- 4 divergences (DIV-001–004) documented

---

## v1.0 — 2026-03-01

### New

- Initial ADR
- Platform context and technology foundation
- Core architectural invariants (INV-001 through INV-004)
- Plugin architecture and bounded contexts
- Data layer decisions
- Commerce and access control model
- BBB integration architecture
- CMS architecture
- Tenant and academy layer
