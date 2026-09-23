# Saa9vi — Free Basic Plan + Storefront Commercial Integration (v3, evidence-verified)

**Repo:** `ashishkpaul/saa9vi.com` · **Branch:** `main`
**Verified HEAD (local clone):** `4f3a9cf` = `4f3a9cfac502152e86fdc0e1989750cf1f05b482`
**Working tree at review:** clean except untracked `.kiro/` and this document
**Verification date:** 2026-09-22 · **Method:** local clone — `git rev-parse`, `git merge-base --is-ancestor`, `grep`/`sed` over `src/`, `docs/`, `schema-shop.graphql`, `node_modules/@vendure/core`

> **Evidence rule.** Every claim in §0/§2 carries a `file:line` reference that was read at the verified HEAD.
> Classification vocabulary: `CONFIRMED` (repo evidence) · `UNVERIFIED` (plausible, not proven) · `PROPOSED` (design, needs an ADR) · `DRIFT` (doc ≠ code).
> Nothing in this plan may be implemented on the strength of this document alone; re-run §6 first.

---

## 0. Verification ledger — previous reviewer's claims, corrected

This section exists because this plan is version 3 and two prior reviews disagreed. Each row is what the local clone actually shows.

| # | Claim reviewed | Repo evidence at `4f3a9cf` | Verdict |
|---|---|---|---|
| 0.1 | "Only `4f3a9cf` matches; `5856f71` and `5e41d35` are not commits on current `main`" | `git cat-file -t 5856f71` → `commit`; `git cat-file -t 5e41d35` → `commit`; `git merge-base --is-ancestor 5856f71 HEAD` → true; same for `5e41d35`. Both appear in `git log --oneline`. `6ff4ba04` → MISSING (frontend repo) | **REVIEWER WRONG.** Three of four hashes are local history; only the frontend hash is absent |
| 0.2 | `subscribeToPlan()` requires `providerPlanId` + provider | `subscription.service.ts:143-154` (throw when `!plan.providerPlanId`; throw when no provider) | `CONFIRMED` |
| 0.3 | `subscribeToPlan()` has no $0 / provider-free path | `subscription.service.ts:190-203` writes `status: 'pending_provider_auth'`; only provider webhooks drive `active` | `CONFIRMED` |
| 0.4 | Registration creates no `OrganizationSubscription` | `tenant-registration.service.ts:327-344` — Seller → Channel → Role → Admin → TenantProfile → `autoProvisionChannelResources()` (shipping/payment/stock only) | `CONFIRMED` |
| 0.5 | **NEW — the upgrade/regression blocker** | `subscription.service.ts:131-134`: `if (existing && existing.status !== "cancelled") throw`. Admin schema has exactly **three** mutations — `createSubscriptionPlan`, `updateSubscriptionPlan`, `subscribeToPlan` (`subscription-admin.schema.ts:217-227`, mirrored in `schema.graphql:966-972`); the resolver exposes exactly those three (`subscription-admin.resolver.ts:157,167,182`). No cancel, no change-plan, no pause/resume. Precise scope (added after the §6.1 preflight run): the **provider-side primitives exist and have zero call sites** — `cancelSubscription` / `pauseSubscription?` / `resumeSubscription?` on the interface (`recurring-billing.provider.ts:63-72`), implemented in `razorpay-subscription.provider.ts:124-149` — so slice 3 must *wire* them, not build them | **CONFIRMED — P0 blocker.** Auto-provisioning Free Basic at registration would permanently disable the platform's only paid-subscribe path for that channel |
| 0.6 | ADR-042 exists, accepted, not implemented | `adr-042-…md:3,7` ("Accepted — implementation pending", "not yet present in `src/`"); `SubscriptionPlan` (`subscription-plan.entity.ts`) has no `marketplaceListingEnabled`; `OrganizationSubscription` has no `marketplaceGraceUntil`; `marketplace-indexer.service.ts:252-262` gates only on `visibility === 'PUBLIC'` + `SCHEDULED|LIVE` | `CONFIRMED` |
| 0.7 | INV-024 already documented | `invariants.md:336-343` already contains INV-024 verbatim from ADR-042 §"Invariant additions" | `CONFIRMED` — the doc half is done |
| 0.8 | No runtime invariant checker for ADR-042 | `src/platform/invariants/*.ts` has **zero** matches for `marketplaceListing`/`ADR-042`; `adr.checker.ts:8-16` registers 7 sub-checks, including `tenantThemeInvariants()` for ADR-043 (`adr.checker.ts:224-267`) | `CONFIRMED` — per `.clinerules` §9 a checker sub-check must be added |
| 0.9 | ADR-042 references a workstream that does not exist | ADR-042:7 says "the marketplace entitlement workstream (**M0**) will implement it"; `grep -n 'M0' integration-gaps-worklist.md` → no match | `DRIFT` (minor, doc-only) |
| 0.10 | Tenant-facing Shop subscription API absent | `schema-shop.graphql` → **zero** matches for `subscription`/`Subscription`. Shop resolvers expose `myTenantTheme` (`tenant-shop.resolver.ts:108-111`) but nothing commercial | `CONFIRMED` |

| 0.11 | UI-1 decided: reads allowed, Shop mutation deferred pending a NEW ADR | `integration-gaps-worklist.md:561-580`: "the storefront may READ the tenant's own subscription state (status, providerStatus, providerShortUrl) but performs no subscription mutations"; option (c) "requires a NEW ADR"; "Do not expose the existing Admin `subscribeToPlan(channelId, planId)` through the Shop API" | `CONFIRMED` — build the read contract, do **not** build the mutation |
| 0.12 | ADR-043 opening contradicts its own status tables | `adr-043-…md:15` ("there is no tenant theming system… no theming data structure or delivery mechanism exists") vs. ✅ tables at `:71-73`, `:85-89`, `:210-219`; theming commits `4d94844`, `4145e13`, `5e41d35`, `4f3a9cf` are all dated 2026-09-21 | `CONFIRMED` — one-line doc fix |
| 0.13 | Stale "REMAINING (B-1/B-2)" comment in registration service | `tenant-registration.service.ts:86-90` still says registration "does not assign the platform hostname … or seed the domain→channel mapping (B-1/B-2)". B-2 is **IMPLEMENTED 2026-09-15** (`integration-gaps-worklist.md:77`); `tenant-profile.service.ts:216-243` seeds `{tenantSlug}.{TENANT_PLATFORM_DOMAIN}` → `Channel.token` and publishes `TenantRegisteredEvent`; registration calls `tenantProfileService.create()` (`tenant-registration.service.ts:327`) | `CONFIRMED DRIFT` — comment fix |
| 0.14 | D-5 (R2 halted recovery) is "still open because the provider has no recovery operation" | Worklist D-5 (`:481-500`) still says the provider lacks a recovery operation, **but** commit `5856f71` (ancestor of HEAD) rewrote `production-readiness.md` + `what-next.md`: "the existing successful-charge finalization path can transition … to `active` … no `halted` exclusion in the CAS — only `cancelled` is excluded. Runtime evidence … remains open. Previously stated as 'no code path' which was incorrect." | **DRIFT.** R2-G is still not closed, but the correct reason is *runtime evidence pending*, not *capability missing* |
| 0.15 | `BbbPlatformCapacityPolicy` contents were `UNVERIFIED` | Entity: `entities/bbb-platform-capacity-policy.entity.ts`; service: `services/bbb-platform-capacity-policy.service.ts` implements a 4-tier cascade (`:74-125`) — channel override → plan-matched row for subscription `status IN ('trialing','active')` → platform default (`channelId IS NULL AND subscriptionPlanId IS NULL`) → hardcoded fallback. It governs **room participant capacity only** (`defaultRoomCapacity`, `maxRoomCapacity`, `maxConcurrentParticipants`) — not minutes, not concurrent meeting count | **RESOLVED** |
| 0.16 | "With `dummyPaymentHandler`, orders reach `PaymentSettled` immediately, so R4 is testable end-to-end" | `node_modules/@vendure/core/dist/config/payment/dummy-payment-method-handler.js`: `automaticSettle` has `defaultValue: false`; `createPayment` returns `state: args.automaticSettle ? 'Settled' : 'Authorized'`. `scripts/smoke/persona-b-journey.sh:330-345` documents exactly this and calls Admin `settlePayment` to reach `PaymentSettled`. The e2e specs that *do* get auto-settle pass `automaticSettle: true` explicitly (`marketplace/e2e/commission.e2e-spec.ts:313,363`) | **REVIEWER WRONG on mechanism.** R4 is testable today, but only with an explicit settle step (or a payment method configured with `automaticSettle: true`) |
| 0.17 | R4 fulfilment already exists → verification, not construction | Listener on `OrderStateTransitionEvent` → `toState === "PaymentSettled"` (`listeners/order-fulfillment.listener.ts:37-45`) creating `bbb_session` / `bbb_room` entitlements; `bbbFulfillmentHandler` is the **FulfillmentHandler** path (Admin `addFulfillmentToOrder`), idempotent on `orderLineId` + `BbbProductAccess` room entitlement (`config/bbb-fulfillment.ts:70-167`); `BbbEntitlementService.hasAccess(ctx, customerId, type, resourceId)` is channel-scoped via `ctx.channelId` (`bbb-entitlement.service.ts:107-125`) | `CONFIRMED` |
| 0.18 | ADR-039 says only provider webhooks drive `→ active`, so a provider-free `active` needs an amendment | ADR-039:31 "Only provider lifecycle events drive transitions to `active`"; entity docstring `organization-subscription.entity.ts:21-26` repeats it. Status is a **varchar with no DB enum** (ADR-039:73) | `CONFIRMED` — amendment required, migration not |

### 0.19 New findings not present in any prior review

**F-1 `includedBbbMinutes` is already wired to a grant writer — reuse it, do not write a second one.**
`subscription-renewal.service.ts:582-591` publishes `SubscriptionRenewedEvent(ctx, sub, channelId, periodStart, periodEnd, sub.plan.includedBbbMinutes)`; `bbb-subscription.listener.ts:31-63` consumes it and creates a `BbbCapacityGrant` with `sourceType: 'subscription'`, `isUnbounded: false`, `validFrom = billingPeriodStart`, `validUntil = billingPeriodEnd`, idempotent on `(organization, validFrom, sourceType: 'subscription')`. Registered at `bigbluebutton.plugin.ts:150`. Three consequences the earlier drafts miss:

1. The free allowance should be granted through **this same seam**, not a new grant writer.
2. That listener **silently drops the grant when no `BbbOrganization` exists yet** (`bbb-subscription.listener.ts:23-29` — warn + `return`), and org provisioning is itself event-driven off `TenantRegisteredEvent`. A free activation that publishes before the org exists loses the allowance with only a log line.
3. A provider-free plan has **no renewal event, ever** (no provider charge → no `finalizeAfterPayment`), so a billing-period free allowance would never refresh. The daily-allowance layer (§3.3) is therefore not cosmetic — it is the only refresh mechanism a free plan can have.

**F-2 `maxStudents` and `customDomainEnabled` are decorative today.** Only `whitelabelEnabled` has enforcement call sites (`tenant-commercial-eligibility.service.ts:62-71` → `TenantThemeService`, asserted structurally at `adr.checker.ts:243-246`). `maxStudents` appears only in the entity, the Admin schema, and one e2e fixture; `customDomainEnabled` only in the entity and Admin schema. §3.6 must mark each matrix field *enforced* vs *declared-but-unenforced*.

**F-3 The free "1 live room" limit has no home in the capacity policy.** Concurrent meeting count is enforced from `BbbOrganization.concurrentMeetingLimit` — default `5` at org creation from form input (`bbb-organization.service.ts:213`), checked in `assertCanCreateMeeting` (`:189-194`, throws) and again in `reserveProvisioningCapacity` (`bbb-provisioning-worker.service.ts:107`, returns false → meeting stays `PENDING` with only a warning log). `BbbPlatformCapacityPolicy` does not model concurrent meetings, and `syncOrganizationCache` syncs only `maxParticipantsPerMeeting` (`bbb-platform-capacity-policy.service.ts:151-165`). A plan-derived concurrency limit needs an explicit sync point — none exists.

**F-4 `isUnbounded` is not honoured at provisioning time (latent bug the free tier will hit).** The overhead grant is auto-created per org with `isUnbounded: true`, `grantedMinutes: -1`, `validUntil: 2099-12-31` (`bbb-organization.service.ts:232-245`). `doProvisionMeeting` selects grants with `exhausted = false`, inside validity, ordered `validUntil ASC, createdAt ASC` (`bbb-provisioning-worker.service.ts:168-179`), then rejects when `grantedMinutes - consumedMinutes <= 0` (`:184-189`). `isUnbounded` is honoured **only** in `GrantReaderService.getRemainingMinutes()` (`grant-reader.service.ts:96`). The failure modes, in order of severity:

1. **Severe — provisioning is impossible.** An org whose *only* valid grant is the overhead grant can never start a meeting: selection picks it (it is the only non-exhausted, in-window grant), then the capacity check computes `-1 − consumedMinutes ≤ 0` and throws. The unbounded grant is not usable at all through this path — so a tenant with no purchased grant cannot go live even though an unbounded grant exists.
2. **Misleading — refusal with the wrong reason.** When the commercial grant hits its limit it is flagged `exhausted = true` (CAS at `bbb-reconciliation.service.ts:326-338`) and therefore excluded by the selection predicate `exhausted = false`. Selection then lands on the overhead grant, which throws `"No minutes remaining on plan"`. The system *does* refuse — but the error misdescribes why, and the caller is never told that a commercial allowance was exhausted rather than missing.
3. The `exhausted` flag silently removes a grant from selection instead of producing a domain-level "allowance exhausted" outcome (§3.3 prerequisite 2).

> **Correction (2026-09-22, second review round).** Earlier wording here implied the fall-through to the overhead grant *allowed* the meeting (calling it "the never-exhausting overhead grant"). That was wrong: the fall-through **throws**. The severity ordering above is the accurate reading, and it changes how the fix is scoped — honour `isUnbounded` in the capacity check **and** decide explicitly whether `internal_overhead` is selectable for tenant sessions at all.

**Static read only; runtime-unverified.** Filed as **BUG-036** in `known-bugs.md`. Settle this before layering a free allowance on top.

*Adjacent gap in the same family:* `GrantReaderService.findEarliestValidGrant()` filters only on `exhausted = false` and orders by `validUntil ASC` — it applies **no** validity-window predicate despite its name and its exposed `validFrom`/`validUntil` fields. It currently has **zero callers** (`grant-reader.service.ts:74` is the only occurrence in `src/`), so it is a dead seam rather than a live defect: fix it as part of adopting that method as a selection seam, not as a separate incident.

**F-5 Provider-free detection must not rely on `providerStatus IS NULL`.** ADR-039:21 records that the *legacy* `subscribeToPlan()` set `status: 'active'` immediately with no provider interaction — so pre-ADR-039 rows already exist that are `active` with `providerStatus = null` and no binding. The only reliable, migration-free discriminator that already exists in this codebase is the plan's own provider mapping: **provider-free ⇔ `plan.providerPlanId IS NULL`** (the same gate ADR-039 uses at `subscription.service.ts:145`). Make it an invariant: `monthlyPriceInPaise > 0 ⇒ providerPlanId IS NOT NULL`.

**F-6 The capacity-grant entity decision is split three ways (RFC vs code vs invariant harness).** RFC-001 §4 is explicit: "`RecurringCapacityGrant` is a **separate entity** from `BbbCapacityGrant` rather than a discriminator on it" (`docs/adr/rfc-001-continuous-commerce-loop.md:255-260`). The shipped implementation chose the discriminator instead (`sourceType: 'subscription'` on `BbbCapacityGrant`, written at `bbb-subscription.listener.ts:50-59`), while the entity docstring still describes it as a Phase-2 placeholder (`bbb-capacity-grant.entity.ts:10-14`). The invariant harness still looks for the RFC name (`src/platform/invariants/event-chain/event-causality-validator.ts:78-115`, `event-trace-collector.ts:73-74`, `rfc.checker.ts:78`), which is why `npm run verify:invariants` emits a permanent, pre-existing warning:

```text
⚠️ [runtime-causality] [subscription-renewed-event] … Missing subsequent actions: RecurringCapacityGrant, Order
```

Before building the daily allowance on this table, amend RFC-001 §4 to record the discriminator decision (or accept the separate entity) — do not let the free tier inherit an unresolved modeling split. And treat that specific warning as **known**, not as a regression introduced by this work.

**F-7 A Free Basic row with a non-NULL `currentPeriodEnd` would enter the paid renewal pipeline (missed by rounds 1–3; directly shapes the activation slice).**

`SubscriptionRenewalService.processRenewals()` discovers work with `sub.currentPeriodEnd < :now AND sub.status IN ('active','trialing')` (`subscription-renewal.service.ts:71, 106-108`). A provider-free subscription provisioned at status `active` **with a non-NULL past period end** therefore becomes a renewal candidate:

```text
free row (active, currentPeriodEnd in the past)
  → discovered by processRenewals()
  → executeRenewal() records an attempt at plan.monthlyPriceInPaise   (service :223)
  → waits for a Razorpay webhook that a provider-free plan can never produce
  → attempt stays 'initiated'; the abandonment window (SUBSCRIPTION_CHARGE_ABANDON_TIMEOUT_MS,
     default 3_600_000 = 1 h; service :57) makes it eligible again
  → rediscovered on the next scan → orphan-attempt loop
```

Supporting facts: the period columns are **nullable** (migration `1789885988242-make-billing-period-start-nullable`), so NULL is a legal and meaningful value; and a free plan never fires `finalizeAfterPayment()` (it requires `attempt.status === 'succeeded'`, a webhook-driven terminal state — §0.19 F-1), so nothing will ever clear the condition.

**Required rule (belongs in the activation slice's acceptance criteria, not in a later cleanup):** a provider-free row must either keep `currentPeriodStart`/`currentPeriodEnd` **NULL** (preferred — it also matches ADR-041's "NULL = first provider webhook wins" semantics for a row that will never receive one), or `processRenewals()` must gain an explicit paid-only guard. Pick one and assert it in a test; do not rely on both.

---

## 1. Product decision

Every tenant lands on a permanent **Free Basic** plan at registration — no card, no trial clock, no "no subscription" state. Free Basic supports the real business: commerce, courses, students, orders, instructors, a basic marketplace listing, and limited live learning. Paid plans add capacity (concurrent live rooms, daily live minutes, participants/room, staff, students) and selected entitlements (hosted academy / custom domain, white-label theming).

A **professional/custom storefront is a professional-services engagement, not a plan flag.** It is a replaceable client of the same GraphQL contract and the same Vendure Channel as the shared Saa9vi storefront.

### Non-negotiable architecture

- **Channel = Tenant**; `ctx.channelId` is authoritative (INV-001). No caller-supplied `channelId` may authorize anything (INV-025 precedent, `domain-model.md:658`).
- Business rules live in Vendure; the storefront renders backend decisions and never evaluates them.
- Two independent revenue layers, never used as evidence for one another: **R2** (Saa9vi → tenant subscription) and **R3/R4** (tenant → learner commerce and live access).
- Marketplace listing (entitlement, ADR-042) ≠ marketplace promotion (separate advertising subsystem). Do not add `marketplacePromotionEnabled` for symmetry.
- Tenant theming never leaks to the marketplace, admin, or another tenant (INV-025).
- Do not introduce `customUiEnabled` / `customDevelopmentEnabled`.

---

## 2. Baseline at `4f3a9cf` — reuse, do not rebuild

| Area | Evidence | Status | Next action |
|---|---|---|---|
| Tenant registration | `tenant-registration.service.ts:113-350` (Seller → Channel → Role → Admin → TenantProfile → `autoProvisionChannelResources` at `:443-475`) | Implemented | Extend for Free Basic only |
| Hostname provisioning | `tenant-profile.service.ts:216-243` seeds Redis + publishes `TenantRegisteredEvent`; B-2 IMPLEMENTED 2026-09-15 (`worklist:77`) | Implemented | Fix stale comment only (`tenant-registration.service.ts:86-90`) |
| TenantTheme (ADR-043 L1) | entity/lifecycle/entitlement gate + public `myTenantTheme` (`tenant-shop.resolver.ts:108-111`); INV-025 checker at `adr.checker.ts:224-267` | Implemented | Frontend consumption + ADR-043 opening fix |
| BBB core | rooms, sessions, provisioning worker, grants, usage ledger, reconciliation, Shop/Admin APIs | Implemented | Add commercial allowance only (see F-3/F-4) |
| BBB lifecycle gates | `assertCanCreateMeeting` (`bbb-organization.service.ts:155-196`); `reserveProvisioningCapacity` (`bbb-provisioning-worker.service.ts:82-110`); per-meeting grant binding at `:168-231` | Implemented | These are the enforcement boundaries for the free allowance |
| BBB purchase fulfilment (R4) | `order-fulfillment.listener.ts:37-45` on `PaymentSettled`; `bbbFulfillmentHandler` idempotent on `orderLineId` (`config/bbb-fulfillment.ts:70-104`); `BbbEntitlementService.hasAccess()` (`bbb-entitlement.service.ts:107-125`) | Implemented | **Verification only** (§5.4) — and note the settle caveat (0.16) |
| Subscription → capacity grant seam | `SubscriptionRenewedEvent` → `bbb-subscription.listener.ts:31-63`; published at `subscription-renewal.service.ts:582-591` | Implemented | Reuse for the free allowance (F-1) |
| Razorpay recurring (R2) | provider, binding, webhook inbox/queue, attempts, renewal/dunning/reconciliation | Implemented; R2-G partially verified (`what-next.md:41`) | Unchanged by this plan; D-5 wording drift to fix (0.14) |
| R3 one-time checkout | `paymentMethodHandlers: [dummyPaymentHandler]` (`vendure-config.ts:149`) | Not implemented | Separate launch gate (§3.9) |
| Marketplace listing entitlement | Implemented 2026-09-23 (plan §3.4 / slice 7): `SubscriptionPlan.marketplaceListingEnabled` + `OrganizationSubscription.marketplaceGraceUntil`, shared policy, indexer gate; INV-024 documented **and** checked | Implemented — `AdrChecker.marketplaceEntitlementInvariants()` | Verify: `npm run verify:invariants` |
| Tenant-facing commercial API | `schema-shop.graphql` contains no subscription surface at all | Absent | Read-only contract (§3.5) |
| Upgrading / cancelling a subscription | Admin schema exposes only 3 mutations (`subscription-admin.schema.ts:217-227`); `subscribeToPlan` rejects any non-cancelled existing row (`subscription.service.ts:131-134`) | **Absent** | **P0 — see §3.1** |

### 2.1 Enforcement map (which mechanism owns which limit today)

| Commercial limit | Existing enforcement point | Plan-aware today? |
|---|---|---|
| Concurrent live meetings | `BbbOrganization.concurrentMeetingLimit` → `assertCanCreateMeeting`, `reserveProvisioningCapacity` | No — org field, default 5, form-supplied (F-3) |
| Participants per room / room capacity | `BbbPlatformCapacityPolicy` 4-tier cascade → `BbbRoom` creation; cached to `org.maxParticipantsPerMeeting` | Yes — Tier 2 matches subscription `status IN ('trialing','active')` |
| Live minutes (per billing period) | `BbbCapacityGrant` exhaustion via `consumeGrantHours` CAS | Partially — grant is created from `plan.includedBbbMinutes` on renewal only |
| White-label theming | `TenantCommercialEligibilityService.canUseWhitelabel()` | Yes |
| Marketplace listing | `CommercialEntitlementService.channelMarketplaceEligible()` + `MarketplaceIndexerService.indexSession()` gate | Yes (2026-09-23) |
| Students / custom domain | none (decorative) | No (F-2) |

---

## 3. Gaps, in dependency order

### 3.1 G-1 — Plan change and cancellation (P0, ships with or before G-2)

**Why first.** `subscribeToPlan()` throws whenever the channel has any non-cancelled subscription (`subscription.service.ts:131-134`), and there is no other mutation in the entire subscription Admin API. If G-2 auto-provisions a Free Basic row at registration, the platform's only paid-subscribe path is dead for every tenant — shipping G-2 alone is a **regression**, not a feature.

**Required (Admin/SuperAdmin only — UI-1 forbids a Shop mutation, see 0.11):**

```text
changeOrganizationSubscriptionPlan(channelId, targetPlanId)   // PROPOSED name
  ├─ resolve current subscription for channelId (no caller-supplied channel identity)
  ├─ target plan has providerPlanId?
  │    ├─ NO  → provider-free target: local update only (plan FK + status/period rules)
  │    └─ YES → provider-wired target:
  │             create provider subscription + SubscriptionProviderBinding
  │             (reuse the ADR-039 ordering: validate → provider call → one narrow
  │              local transaction covering subscription row + binding)
  └─ every branch: supersede the existing row inside the SAME local transaction
```

Design constraints to respect:

- **Do not cancel-then-create.** The partial unique index is `@Index(['channelId'], {unique: true, where: '"status" != \'cancelled\''})` (`organization-subscription.entity.ts:29`). A cancelled-then-new sequence only works if the cancel commits first, and no cancel mutation exists; superseding in place inside one transaction avoids the window entirely.
- **A cancel/already-cancelled semantics still has to exist** for real churn. `cancelAtPeriodEnd`/`cancelledAt` columns exist and are currently written only by the webhook bridge `markCancelledFromWebhook()`. The slice's shape is therefore four small parts, not a provider integration: (1) Admin mutation, (2) local FSM transition that *requests* cancellation, (3) provider call through the already-implemented `cancelSubscription()`, (4) dashboard affordance. ADR-039's rule holds — only the provider webhook *settles* a paid cancellation.

**Amendment (2026-09-23, CONFIRMED at implementation time):** part (2) is NOT sufficient on its own. The renewal sweep (`SubscriptionRenewalService.executeRenewal()`) did **not** honour `cancelAtPeriodEnd` — its discovery predicate (`status IN ('active','trialing') AND currentPeriodEnd < now`) matches a scheduled cancellation, so an `atPeriodEnd: true` request would have been **billed** at the next scan instead of completed. The sweep now carries an explicit ADR-044 completion branch (idempotent CAS → `cancelled`), and scheduled-cancel rows are deliberately left **discoverable** so that branch remains the webhook-loss safety net. Also required for correctness: the `atPeriodEnd: true` path must call the provider `cancelSubscription({ cancelAtCycleEnd: true })`, because Razorpay owns recurring execution — a locally-flagged row with no provider-side cancellation is still charged.
- **FSM change ⇒ ADR.** Superseding a provider-free subscription with a provider-wired one is a new transition class in the ADR-039 FSM. Per `.clinerules` §9 and UI-1's own note, this needs its own short ADR (call it ADR-044) *before* implementation — it is not a "refactor".
- **Reuse the provider primitives that already exist.** `cancelSubscription` / `pauseSubscription?` / `resumeSubscription?` are on `RecurringBillingProvider` (`recurring-billing.provider.ts:63-72`) and implemented for Razorpay (`razorpay-subscription.provider.ts:124-149`), with **zero call sites** anywhere in `src/` (verified by the §6.1 run). Slice 3 therefore *wires* provider cancellation into the local operation — the genuinely new work is the local, transactional, FSM-aware plan-change/request path, not Razorpay integration. Guard the transaction boundary the way ADR-039 does: validate (no tx) → provider call (no tx) → one narrow local transaction.
- The old guard's error text ("already has an active or trialing subscription") does not match its condition (any non-cancelled state) — fix the message while touching it.

**Stop-and-revise trigger:** if implementation starts to look like "relax the guard and hope `subscribeToPlan` behaves" — stop. Relaxing the guard would let a paid subscribe overwrite a provider-free row in place without creating a binding for the new provider cycle.

### 3.2 G-2 — Provider-free Free Basic activation

**Required:** resolve the Free plan → create/activate the tenant's subscription locally → grant the free allowance → no Razorpay call → no fake `SubscriptionProviderBinding` → idempotent on retry.

> **SLICE 4 — CODE COMPLETE + RUNTIME-VERIFIED 2026-09-23 (uncommitted).** Shipped: `FreePlanProvisioningService` / `FreePlanProvisioningListener` (subscription plugin) + plugin option `freePlanSlug` (default `free-basic`, overridable via `FREE_PLAN_SLUG`) + entity/ADR-039 docstring amendments. The trigger is `TenantRegisteredEvent`, the same seam the BBB plugin uses for org provisioning — no tenant→subscription coupling (.clinerules §1).
>
> **Runtime evidence** (`scripts/verify/free-basic-activation.sh`, live server): **19 passed / 0 failed / 3 skipped**. A real `registerNewTenant` produced **exactly one** `OrganizationSubscription` — status `active`, plan `free-basic`, `providerPlanId` NULL, `currentPeriodStart`/`currentPeriodEnd` NULL, `cancelAtPeriodEnd` false — with **zero** provider mandates and **zero** payment attempts, and `subscribeToPlan` correctly refused with the ADR-044 guard message naming `changeOrganizationSubscriptionPlan`.
>
> Two harness defects were found and fixed by that run, which is why the scripts are worth executing rather than reading: (a) `vars="${5:-{}}"` silently appended a literal `}` to every variables payload (bash ends a parameter expansion at the first `}`), so every request body was corrupt and the failure looked server-side; (b) the admin session is a **cookie**, not the login payload's `id` as a bearer token. Both defects were also present in `adr-044-acceptance.sh`, so that script had never been able to run either — it is now auth-correct, though executing its provider-wired scenarios still requires a real Razorpay test plan id.
>
> Two decisions taken from the table below rather than re-derived: **status `active`** (D-1) and **period fields NULL** (F-7). The `providerPlanId IS NULL` test (D-2) is enforced as a rejection, not merely a discriminator: a plan carrying a `providerPlanId` is refused with an error log rather than activated locally, because the paid renewal scan and webhook pipeline both expect such a row to be provider-backed.
>
> **Not in this slice, by design:** no capacity grant (the org's unbounded `internal_overhead` grant already exists — F-4 evidence — and the free plan's live allowance is the DAILY grant in §3.3/slice 6, whose `sourceType: 'subscription'` key must not be written twice from two places); no plan-derived `concurrentMeetingLimit` sync (slice 5).
>
> **Still open:** scenarios 9 (duplicate event delivery — `TenantRegisteredEvent` is not replayable over GraphQL) and 10 (renewal-sweep exclusion — scheduler-driven) are `SKIP`-marked with manual procedures; the Free tier's `BbbPlatformCapacityPolicy` row (5/5/5 per §3.6) remains an Admin `upsertPlatformCapacityPolicy` call, which the script performs idempotently.

Concrete design decisions the earlier drafts left open:

| Decision | Recommendation | Basis |
|---|---|---|
| Which status? | Reuse `active` | `status` is a varchar with no DB enum (ADR-039:73), and every downstream reader already treats `active` as eligible: `TenantCommercialEligibilityService` (theme), `BbbPlatformCapacityPolicyService` Tier 2, ADR-042's future window, INV-024 |
| How to detect "provider-free"? | `plan.providerPlanId IS NULL` | F-5: `providerStatus IS NULL` is not safe (legacy pre-ADR-039 rows are `active` with no provider) |
| New enum value / new column? | None needed. If a dedicated marker is later required (e.g. for dashboards), it must come with an ADR — do not add it speculatively | ADR-042's own rule against inventing fields |
| Period fields | **Keep `currentPeriodStart`/`currentPeriodEnd` NULL for provider-free rows** (F-7) — a correctness requirement, not a preference: a non-NULL past `currentPeriodEnd` makes the row a paid renewal candidate and produces an orphan-attempt loop. NULL also matches ADR-041's "NULL = first provider webhook wins" semantics for a row that will never receive one. If a free grant is still published through `SubscriptionRenewedEvent`, pass an explicit deterministic `billingPeriodStart` rather than deriving it from the (NULL) entity column, because the listener's idempotency key is `(organization, validFrom, sourceType)` | F-1, F-7 |
| Doc amendment | One-line amendment to ADR-039 ("only provider webhooks drive → active") plus the entity docstring (`organization-subscription.entity.ts:21-26`) recording the provider-free exception | 0.18 |
| Idempotency | Upsert against the partial unique index (`channelId` where status != cancelled). Registration retries and double-publishes are both plausible | `organization-subscription.entity.ts:29` |
| Grant creation ordering | The `SubscriptionRenewedEvent` listener **drops the grant if no `BbbOrganization` exists yet** (F-1). Either create the org synchronously before the grant, or make the grant step retryable/lazy (the daily-allowance job in §3.3 is the natural place to guarantee eventual existence) | F-1 |
| Failure isolation | Registration must not fail because the subscription/allowance step failed — the existing `autoProvisionChannelResources` pattern already swallows and logs. But a silently-missing Free Basic row must be **detectable**: log + expose it in the tenant dashboard read API | `tenant-registration.service.ts:443-475` |

**Do not** create a `BbbCapacityGrant` with `sourceType: 'internal_overhead'`, and do not create a second unbounded grant. The org-level overhead grant already exists and is unbounded (F-4).

### 3.3 G-3 — Daily live allowance (and the grant-selection correctness it depends on)

`includedBbbMinutes` is documented as "BBB meeting minutes included per **billing period**" (`subscription-plan.entity.ts:40-42`, default 600) and is consumed only by the renewal path (F-1). A rule like **1 live room + 60 minutes/day** is a different commercial policy and needs its own layer.

Keep the three concepts separate — this is the point of the slice:

```text
BbbPlatformCapacityPolicy = infrastructure/packaging ceiling (participants, room capacity)
Commercial live policy    = tenant allowance (concurrent rooms/day, daily minutes/day)
BbbUsageLedger            = immutable usage fact (append-only, one row per (meeting, grant))
```

**Prerequisite work, before writing any allowance code (F-3 + F-4):**

1. Decide and document the grant-selection contract for tenant live sessions: should `sourceType = 'internal_overhead'` grants be selectable at all in `doProvisionMeeting`? Today they are, and they fail the `remainingMinutes <= 0` check (`bbb-provisioning-worker.service.ts:184-189`); when a commercial grant is exhausted (and therefore invisible to selection) the resolver can fall through to the overhead grant.
2. Decide what "allowance exhausted" must produce at each boundary:
   - creation time → `assertCanCreateMeeting` throws (user-visible, good);
   - provisioning time → `reserveProvisioningCapacity` returns false and the meeting silently stays `PENDING` with only a log (`bbb-provisioning-worker.service.ts:101-108`). That is *not* acceptable UX for a commercial limit — it needs a distinct terminal state/notification or a pre-check before enqueueing.
3. Wire the concurrency limit to the plan. `concurrentMeetingLimit` is currently form-supplied, default 5 (F-3). The plan-tier value must be applied at org provisioning *and* on plan change (G-1), analogous to how `syncOrganizationCache` writes `maxParticipantsPerMeeting` from the policy.
4. Close the grant-entity modeling split before extending the table (F-6): RFC-001 §4 says a separate `RecurringCapacityGrant` entity; the code uses a `sourceType` discriminator. Adding a *second* grant semantics on top of an unresolved split is how a duplicate writer gets born.

**Then the allowance layer itself.** Shape recommendation (PROPOSED — it defines a new grant lifecycle and needs a decision record):

- Daily grants, one per tenant per day, `sourceType: 'subscription'` (already reserved for this: `bbb-capacity-grant.entity.ts:10-14`), created by a **scheduled job** — not by the renewal event, which a free plan never receives (F-1).
- Idempotency key `(organization, validFrom = startOfDay, sourceType = 'subscription')` so the existing `SubscriptionRenewedEvent` writer and the scheduled job cannot both create a duplicate for the same window.
- Reuse `consumeGrantHours` unchanged: the ledger insert plus the CAS increment (`bbb-reconciliation.service.ts:280-360`) is the only supported debit path; `BbbUsageLedger` semantics must not change.
- Read remaining allowance for the dashboard from the same tables (sum of non-exhausted, non-unbounded grants inside the window) — never computed in the storefront.

### 3.4 G-4 — Marketplace listing entitlement (ADR-042, implement verbatim)

ADR-042 is accepted; implement it as written — do not redesign it.

1. `SubscriptionPlan.marketplaceListingEnabled` (boolean, default `false`).
2. `OrganizationSubscription.marketplaceGraceUntil` (nullable timestamp).
3. Grace transitions written only by `SubscriptionRenewalService`: set on `markPastDueFromWebhook()`, cleared on `finalizeAfterPayment()` and `markCancelledFromWebhook()`.
4. Eligibility evaluated by a **shared platform-level policy**, not a second evaluator — the header comment of `TenantCommercialEligibilityService` (`:21-24`) already anticipates exactly this: "If commercial eligibility becomes a shared cross-plugin policy (e.g. when ADR-042 marketplace eligibility needs the same commercial-state window), extract the policy into a platform-level service instead of adding further per-plugin entity-query duplicates." Note the two windows are **not identical**: theming admits `{trialing, active, past_due}`; ADR-042 admits `{active} ∪ {past_due ∧ within grace}`. The extracted policy must take the window per entitlement.
5. Enforcement at `MarketplaceIndexerService.indexSession()` alongside the existing F7 gate (`marketplace-indexer.service.ts:252-262`) — ineligible ⇒ delete from index; `false` is not an error.
6. Two migrations generated with `npx vendure migrate -g …` (never hand-written).
7. Expose `marketplaceListingEnabled` on the plan type/input and `marketplaceGraceUntil` on the subscription type (Admin schema, `subscription-admin.schema.ts`).
8. **Add the INV-024 structural sub-check** to `AdrChecker.check()`'s array (`src/platform/invariants/adr.checker.ts:8-16`), modelled on `tenantThemeInvariants()` — INV-024 is documented (`invariants.md:336-343`) but has no runtime checker (0.8).
9. Do **not** add `marketplacePromotionEnabled`; promotion/advertising is already a separate subsystem.

> ✅ **IMPLEMENTED 2026-09-23** — all nine items delivered (file-level mapping: ADR-042's implementation-status table). Two CLI migrations applied to the dev DB; shared policy in `src/platform/commercial/`; grace stamped by `SubscriptionRenewalService` on **every** transition into `past_due` (including `markSubscriptionPastDue()`, per ADR-042 §3's wording) and cleared on recovery/cancellation; Admin schema fields exposed; `AdrChecker.marketplaceEntitlementInvariants()` green under `npm run verify:invariants`. Evidence: 25/25 `marketplace-listing-entitlement.spec.ts` (infra-free) and 73/73 `tenant-plugin.e2e-spec.ts` (real Postgres, incl. the delegated whitelabel window); the indexer e2e matrix lives in `marketplace.e2e-spec.ts` and needs `MARKETPLACE_E2E=true` (Elasticsearch) to execute. Known residual: instructor documents are outside §4's scope (recorded in the ADR).

### 3.5 G-5 — Tenant-facing Shop commercial API (read-only)

Per 0.11 the storefront may read subscription state and must not mutate it. Required surface:

```text
mySubscription              plan (name/slug/price), status, currentPeriodStart/End,
                            providerStatus, providerShortUrl, marketplaceGraceUntil
myLiveUsage                 daily allowance + remaining, billing-period grant remaining
availableSubscriptionPlans  catalogue for the upgrade CTA (prices from Saa9vi, never computed client-side)
```

Rules:

- Resolve the tenant from `RequestContext` (`ctx.channelId`) only. No `channelId` argument — replicating the Admin mutation's signature into the Shop API is explicitly forbidden by UI-1.
- Do not expose plugin-internal persistence rows (bindings, billing attempts, incidents) through the storefront contract.
- No upgrade mutation in this slice. The CTA links to the current phase's admin-mediated flow; the mutation lands with G-1 under its own ADR.

### 3.6 G-6 — Freeze the commercial matrix (with enforcement status)

The in-code values (600 minutes/billing period, 100 students, 5 concurrent meetings, room-capacity defaults 25/100/250) are seed/fallback values, not product decisions. Freeze one canonical table and record, per row, **which mechanism enforces it and whether that mechanism exists yet**:

> **SLICE 1 — FROZEN 2026-09-22 (product sign-off).** The values below are decisions, not seeds (D-1 resolved). Rows marked **marketing copy** are *declared-but-unenforced* (D-2 resolved): they may appear in copy but must never be presented to tenants as enforced limits.

| Capability | Free Basic | Paid | Enforced by | Exists today? |
|---|---|---|---|---|
| Concurrent live rooms | **1** | per-plan `org.concurrentMeetingLimit` (Admin-set) | `org.concurrentMeetingLimit` (`assertCanCreateMeeting`) | Mechanism exists; **not plan-derived** (F-3) — plan-derived sync is slice 5 |
| Daily live minutes | **60/day** | — (billing-period pool instead) | daily `BbbCapacityGrant` + refresh job | **To build** (§3.3, slice 6) |
| Live minutes per billing period | **—** (daily only; D-8 default) | `includedBbbMinutes` (600 = seed, value per plan) | renewal grant (`SubscriptionRenewedEvent`) | Exists for provider-backed plans |
| Participants per room | **5** (default *and* ceiling, via free-tier policy row) | plan tier (`PLAN_TIER_DEFAULTS` / Portal Admin rows) | `BbbPlatformCapacityPolicy` Tier 2 → `resolveRoomCapacity()` (default from `defaultRoomCapacity`, ceiling at `maxRoomCapacity`) | Exists; **free-tier row must be created** (spec below) |
| Instructors / staff | **de-scoped** — not offered, not promised, on any tier | de-scoped | — | **Nothing exists** |
| Students | **100 — marketing copy** (declared, not enforced) | per-plan — **marketing copy** (declared, not enforced) | `plan.maxStudents` (decorative) | **Decorative (F-2)**; no enforcement in this programme |
| Custom domain | no — flag itself is **marketing copy** when offered (declared, not enforced) | yes — **marketing copy** (declared, not enforced) | `plan.customDomainEnabled` (decorative) | **Decorative (F-2)**; hostname provisioning itself is done (B-2) |
| White-label theming | no | yes | `canUseWhitelabel()` | Exists |
| Marketplace basic listing | **yes** | yes | ADR-042 gate | **To build** (§3.4, slice 7) |
| Marketplace promotion/advertising | separate paid subsystem | — | existing advertising subsystem | Exists |

Any row with an empty or decorative "Enforced by" cell is an aspirational statement, not a limit — either build the enforcement in this programme or label it as marketing copy.

**Free-tier capacity-policy row is part of this freeze (added 2026-09-22, second review round).** Plan-matched **Tier 2** of `BbbPlatformCapacityPolicyService` resolves capacity by querying `organization_subscription` directly for `status IN ('trialing','active')` and matching a policy row on `subscriptionPlanId` (`bbb-platform-capacity-policy.service.ts:88-110`). A Free Basic row at `active` therefore **already drives Tier 2** the moment such a policy row exists — while `PLAN_TIER_DEFAULTS` defines only `starter`/`growth`/`enterprise` (`:19-23`). Consequence: the freeze must decide the **Free tier's policy row** (default room capacity, max room capacity, max concurrent participants), not just minutes and concurrent-room count. If no free-tier row is created, free tenants silently inherit the Tier 3 default or Tier 4 hardcoded fallback (25/100/250).

**FROZEN free-tier policy row (slice-1 deliverable, 2026-09-22):**

| Field | Value |
|---|---|
| `channelId` | `NULL` (plan-scoped so Tier 2 matches it) |
| `subscriptionPlanId` | id of the Free Basic `SubscriptionPlan` (row created once the plan exists) |
| `defaultRoomCapacity` | **5** |
| `maxRoomCapacity` | **5** |
| `maxConcurrentParticipants` | **5** (= 1 concurrent room × 5 participants) |

Mechanism: created through the existing Admin mutation `upsertPlatformCapacityPolicy` (`bbb-admin.schema.ts:760`, resolver `bbb-admin.resolver.ts:1117-1138`) — no migration or seed script exists or is needed (none found 2026-09-22). Enforcement caveat (static read 2026-09-22): `maxConcurrentParticipants` has **no enforcement consumer** today — it is stored, upserted and returned, but never read by any check; participants-per-room is enforced through `resolveRoomCapacity()` using `defaultRoomCapacity` (default) and `maxRoomCapacity` (ceiling). The value is still spec'd at 5 so the row is correct once enforcement lands. Tier 1 channel overrides continue to beat this row per the cascade.

### 3.7 G-7 — Documentation drift fixes (all one-liners, all `CONFIRMED`)

> **Status: EXECUTED 2026-09-22** (docs-only sweep, no source changes). All six items below are applied, plus two drifts found while sweeping: the `BbbCapacityGrant` source-type list in `domain-model.md`/`glossary.md` (a `wallet` type that does not exist in the entity) and the subscription-slot wording in `domain-model.md` (any non-`cancelled` status occupies the slot, not just authorization states). The same sweep registered this programme in `what-next.md`, `roadmap.md`, `integration-gaps-worklist.md` (**FREE-1**), `plugin-map.md` and `adr-039-implementation-plan.md`, and added a superseded banner to the three Juspay-era mandate documents. Full record: `production-readiness.md` §12 → "Drift sweep record".

1. `adr-043-…md:15` — the opening claims no theming system exists while the ADR's own ✅ tables (and four shipped commits) say otherwise.
2. `tenant-registration.service.ts:86-90` — "REMAINING (B-1/B-2)" contradicts B-2's IMPLEMENTED status (`worklist:77`).
3. ADR-039:31 and `organization-subscription.entity.ts:21-26` — record the provider-free activation exception (G-2).
4. `integration-gaps-worklist.md:481-500` (D-5) vs `production-readiness.md:861-866` and `what-next.md:23,44` — reconcile: the capability exists; what remains is runtime evidence (0.14).
5. ADR-042:7 — remove or repair the reference to a non-existent "M0 workstream" (0.9).
6. RFC-001 §4 (`docs/adr/rfc-001-continuous-commerce-loop.md:255-260`) — record that the shipped design uses the `sourceType: 'subscription'` discriminator on `BbbCapacityGrant` rather than a separate `RecurringCapacityGrant` entity, and update `bbb-capacity-grant.entity.ts:10-14`'s "Phase 2: created by RecurringCapacityGrant renewal" wording. This also clears the permanent `verify:invariants` warning (F-6).

Do these as their own commit, before code, so the drift does not get folded into an implementation diff.

### 3.8 G-8 — `edu-frontend` consumption

- `myTenantTheme` → CSS variables, with Saa9vi defaults when the query returns `null` (ineligible ⇒ `null` ⇒ platform default is already the backend contract).
- Plan/usage dashboard sourced only from §3.5; no client-side entitlement logic.
- Prove at runtime: tenant A ≠ tenant B for theme and data; marketplace and admin never inherit tenant theme; unknown hostname fails **closed** in production.
- This repository was the only one inspected (`6ff4ba04` is not present here). Audit `edu-frontend` separately, including re-running codegen against the updated backend schema — UI-1 rule 2: backend contract → `npm run codegen` → UI, never UI-first.

### 3.9 G-9 — R3 one-time payment handler (independent launch gate)

`paymentMethodHandlers: [dummyPaymentHandler]` (`vendure-config.ts:149`). Independent of everything above and blocking nothing above. Do not conflate it with the subscription UX (UI-1 rule 4; `storefront-subscription-ui-audit.md` finding 5).

### 3.10 G-10 — R4 runtime verification (no new code expected)

Run the chain end to end with the existing dummy handler: checkout → payment → `PaymentSettled` → `BbbOrderFulfillmentListener` → `BbbEntitlementService.hasAccess()` → join. §5.4 records the settle caveat (0.16) and the two distinct fulfilment paths (0.17). Treat R4 as verification: if a real defect appears, fix it in place rather than building a parallel path.

---

## 4. Build order

Slices 3 and 4 are deliberately paired — see §3.1 for why shipping Free Basic activation (4) without the plan-change capability (3) is a regression.

| # | Slice | Deliverable | Gate |
|---|---|---|---|
| 1 | **Commercial matrix freeze** (§3.6) | ✅ **FROZEN 2026-09-22** — canonical capability table with enforcement status per row (§3.6); instructors/staff de-scoped, students + custom-domain = marketing copy (D-1/D-2 resolved); **Free tier policy row spec'd `5/5/5`** with the `maxConcurrentParticipants` no-consumer caveat, creatable via existing `upsertPlatformCapacityPolicy` (no migration) | Product sign-off received; docs-only, committed separately |
| 2 | **Doc drift sweep** (§3.7) | ✅ **DONE 2026-09-22** — the corrections plus programme registration across the docs tree | Recorded in `production-readiness.md` §12 |
| 3 | **ADR-044 + plan-change/cancel capability** (§3.1) | ✅ **CODE COMPLETE 2026-09-23 (uncommitted)** — ADR-044 (`docs/architecture/adr-044-local-plan-change-and-cancellation.md`) + `changeOrganizationSubscriptionPlan` / `cancelOrganizationSubscription` (service, resolver, Admin schema); provider-wired and provider-free branches; late/missed provider primitives now wired; **renewal-sweep `cancelAtPeriodEnd` branch added** (§3.1 amendment — without it the sweep would BILL a scheduled cancellation); `subscribeToPlan` guard message corrected to match its actual condition. Wiring signal = the binding row (any `active` state), provider-free test = `plan.providerPlanId IS NULL`. **Remaining:** dashboard affordance (frontend, slice 9) and runtime acceptance — the script exists (`scripts/verify/adr-044-acceptance.sh`, 13 scenarios) but has **not been executed** | Admin GraphQL acceptance (`npm run build` = EXIT 0; both mutations present in the emitted Admin SDL; `verify:invariants` baseline unchanged). Runtime run pending: needs a dev DB + Razorpay test key |
| 4 | **Free Basic activation** (§3.2) | ✅ **CODE COMPLETE 2026-09-23 (uncommitted)** — `FreePlanProvisioningService` + `FreePlanProvisioningListener` (subscription plugin) activated by `TenantRegisteredEvent`; plugin option `freePlanSlug` (default `free-basic`, env-overridable `FREE_PLAN_SLUG`); entity + ADR-039 docstrings carry the provider-free exception; `scripts/verify/free-basic-activation.sh` (10 scenarios). **Deliberately excluded:** capacity grants (the org's unbounded `internal_overhead` grant already exists — `BbbOrganizationService.create()` L232-245 — and the free plan's live allowance is the DAILY grant built in slice 6; a billing-period grant here would be a second writer on the same idempotency key) and `concurrentMeetingLimit` plan-sync (slice 5). **Remaining:** the free-tier policy row (`upsertPlatformCapacityPolicy`, 5/5/5) stays an ops/Admin step — the script performs it idempotently | ✅ **RUNTIME-VERIFIED 2026-09-23** — `scripts/verify/free-basic-activation.sh` on a live server: **19 passed / 0 failed / 3 skipped** (exit 0). Real `registerNewTenant` → exactly one subscription, `active`, provider-free plan, **NULL period**, zero mandates, zero attempts; `subscribeToPlan` refused with the ADR-044 guard message |
| 5 | **Grant-selection correctness** (§3.3 prerequisites) | Decide and implement the `internal_overhead` selection/exhaustion contract (honour `isUnbounded`; whether `internal_overhead` is selectable for tenant sessions at all), and make "allowance exhausted" produce a user-visible outcome at both boundaries; plan-derived `concurrentMeetingLimit` sync | Focused BBB tests + one runtime session attempt at the limit; static-read F-4 reproduced or refuted at runtime |
| 6 | **Daily allowance layer** (§3.3) | Scheduled daily-grant job with the `(org, startOfDay, subscription)` idempotency key; allowance read model. `consumeGrantHours` and `BbbUsageLedger` untouched | Runtime: 2 sessions in one day, second refused with the entitlement error; ledger rows append-only |
| 7 | **ADR-042 implementation** (§3.4) | ✅ **CODE COMPLETE 2026-09-23** — two entity fields, **two CLI-generated migrations** (`npx vendure migrate -g`, both applied), grace transitions in `SubscriptionRenewalService` (set on entry to `past_due` incl. `markSubscriptionPastDue()`, cleared on recovery/cancellation), shared platform policy (`src/platform/commercial/commercial-entitlement.service.ts`, window supplied per entitlement — theming window unchanged), `indexSession()` gate, Admin schema fields, `AdrChecker.marketplaceEntitlementInvariants()` | **Evidence:** `npm run verify:invariants` → INV-024 sub-check green; 25/25 `marketplace-listing-entitlement.spec.ts` (infra-free, real policy + real indexer); 73/73 `tenant-plugin.e2e-spec.ts` (real Postgres, delegated whitelabel window regression); indexer e2e matrix (eligible / ineligible / in-grace / after-grace / no-sub / prohibited-signals) added to `marketplace.e2e-spec.ts` — **not yet executed** (needs ES via `MARKETPLACE_E2E=true`) |
| 8 | **Shop read contract** (§3.5) | `mySubscription`, `myLiveUsage`, `availableSubscriptionPlans` (Public/Authenticated as appropriate); codegen regenerated | Tenant A/B isolation test; no `channelId` argument anywhere in the new surface |
| 9 | **Frontend** (§3.8) | Theme consumption + plan/usage dashboard | Runtime A/B isolation, marketplace/admin default theme, unknown hostname fails closed |
| 10 | **R4 runtime evidence** (§3.10) | End-to-end proof with the dummy handler + explicit settle | Evidence recorded in `production-readiness.md`, not here |
| 11 | **R3 payment handler** (§3.9) | One-time payment integration | Independent; separate launch gate |

Working rules for every slice: schema via `npx vendure migrate -g <name>` only (inspect, then `-r`); after any contract change regenerate both schemas + codegen + `npm run lint` + `npm run build`; the three static invariants checkers stay green (the single pre-existing event-chain warning is expected — F-6); no manual Postgres/Redis writes (read-only SQL for diagnostics is fine).

---

## 5. Acceptance / definition of done

### 5.1 Free Basic

```text
Shop registerNewTenant (GraphQL)
  → Channel + Seller + Role + Admin + TenantProfile (existing flow)
  → Free Basic OrganizationSubscription, status = active, once (idempotent on retry)
  → no Razorpay subscription, no SubscriptionProviderBinding, no charge
  → currentPeriodStart/End remain NULL, and renewal discovery excludes the free row
    (processRenewals() finds nothing; no SubscriptionBillingAttempt is ever created for it)
  → commerce works: product → cart → order (PaymentAuthorized via dummy handler)
  → marketplace listing eligible (plan flag + status window) and indexed
  → one live room starts inside the daily allowance
  → allowance exhausted → explicit, user-visible refusal + upgrade guidance
  → dashboard reads plan + usage from the Shop read API only
```

### 5.2 Isolation (both directions)

```text
Tenant A hostname → A data only     Tenant B hostname → B data only
```

Cover products, orders/customers, courses, scheduled sessions, entitlements, themes, admin visibility, and every new query added by §3.5. Unknown hostname fails closed in production (`TENANT_PLATFORM_DOMAIN` is env-driven — `tenant-profile.service.ts:15-16`).

### 5.3 Theme propagation

```text
A → theme A        B → theme B        no active theme → Saa9vi default
marketplace → Saa9vi platform theme   admin → Saa9vi/admin theme
```

### 5.4 R4 runtime path — with the settle caveat (0.16)

```text
checkout (dummy handler)          → order state: PaymentAuthorized
  → explicit Admin settlePayment  → OrderStateTransitionEvent(toState = PaymentSettled)
  → BbbOrderFulfillmentListener   → BbbEntitlementService.create() (idempotent)
  → BbbEntitlementService.hasAccess(ctx, customerId, type, resourceId)
  → join (Shop)
```

Reproduce the existing smoke sequence (`scripts/smoke/persona-b-journey.sh:330-345`; the script sets no `automaticSettle` and settles via Admin `settlePayment`), or configure the payment method with `automaticSettle: true` for the duration of the test. **Do not** write an acceptance test that assumes auto-settle: `automaticSettle` defaults to `false`, the order stops at `PaymentAuthorized`, the entitlement step never fires, and the test passes while proving nothing.

Also note the two fulfilment paths and test the one that matters: the `PaymentSettled` **listener** is the automated path; `bbbFulfillmentHandler` runs on Admin fulfilment (`addFulfillmentToOrder`) and is idempotent per `orderLineId` (0.17). Idempotency of the listener path rests on `BbbEntitlementService.create()`'s `(customerId, type, resourceId)` uniqueness, not on the fulfilment handler.

### 5.5 Upgrade path

```text
Free Basic → changeOrganizationSubscriptionPlan(target paid plan)
  → provider subscription created + binding written in one narrow local transaction
  → status/period follow the ADR-039 FSM (provider webhooks stay authoritative)
  → entitlements refresh; free-era grants remain historically intact
```

`subscribeToPlan` must keep working for channels that have never been subscribed. R2 evidence must never stand in for R3 or R4 evidence.

---

## 6. Preflight — re-run before writing code

```bash
git fetch origin && git rev-parse --short HEAD && git rev-parse --short origin/main
git status --short && git log --oneline -5

# The P0 blocker (0.5): how many subscription mutations exist?
grep -n "extend type Mutation" -A 12 src/plugins/subscription/api/schema/subscription-admin.schema.ts
grep -n "already has an active or trialing" -B 4 -A 2 src/plugins/subscription/services/subscription.service.ts

# Provider-free discriminator + status values
grep -n "providerPlanId" src/plugins/subscription/services/subscription.service.ts
grep -n "OrganizationSubscriptionStatus" -A 8 src/plugins/subscription/entities/organization-subscription.entity.ts

# Existing subscription→grant seam (do not duplicate it)
grep -rn "SubscriptionRenewedEvent" src/plugins/bigbluebutton-plugin src/plugins/subscription/services/subscription-renewal.service.ts

# Grant selection + unbounded handling (F-4)
sed -n '160,200p' src/plugins/bigbluebutton-plugin/services/bbb-provisioning-worker.service.ts
grep -rn "isUnbounded" src/plugins/bigbluebutton-plugin --include=*.ts | grep -v e2e

# Concurrency limit ownership (F-3)
grep -rn "concurrentMeetingLimit" src/plugins/bigbluebutton-plugin/services/*.ts

# ADR-042 surfaces
grep -rn "marketplaceListingEnabled\|marketplaceGraceUntil" src docs
grep -rn "marketplaceListing" src/platform/invariants   # expect: no match until slice 7

# Shop contract still has no subscription surface
grep -n "subscription\|Subscription" schema-shop.graphql   # expect: no match

# R4 settle behaviour
grep -n "automaticSettle" scripts/smoke/persona-b-journey.sh \
  node_modules/@vendure/core/dist/config/payment/dummy-payment-method-handler.js

# Renewal discovery — what a registration-provisioned row would enter (F-7)
grep -n "processRenewals" -A 45 src/plugins/subscription/services/subscription-renewal.service.ts \
  | grep -E "currentPeriodEnd|statuses|ABANDON"
grep -n "SUBSCRIPTION_CHARGE_ABANDON_TIMEOUT_MS\|monthlyPriceInPaise" \
  src/plugins/subscription/services/subscription-renewal.service.ts

# Free-tier capacity policy (Tier 2 already reads subscription state)
grep -n "PLAN_TIER_DEFAULTS" -A 6 src/plugins/bigbluebutton-plugin/services/bbb-platform-capacity-policy.service.ts

# Baseline health: 3 static checkers green; 1 pre-existing event-chain warning (F-6)
npm run verify:invariants
```

If any of these contradict this plan, update the plan first. Do not code against a stale assumption — and do not treat this document as evidence.

### 6.1 Preflight run record — executed 2026-09-22 (PASSED)

Run locally on a clone of this repository. `git fetch origin` succeeded and `origin/main` = `4f3a9cf` = local `HEAD`, so the reviewed tree is the published `main`. Every §6 expectation matched:

| Check | Expected | Observed | Result |
|---|---|---|---|
| HEAD / origin/main | equal | `4f3a9cf` / `4f3a9cf` | ✅ |
| P0-A: subscription Admin mutations | exactly 3 | `createSubscriptionPlan`, `updateSubscriptionPlan`, `subscribeToPlan` (`subscription-admin.schema.ts:217-227`); same 3 in `schema.graphql:966-972`; resolver exposes the same 3 (`:157,167,182`) | ✅ |
| P0-B: existing-subscription guard | throws on any non-cancelled row | `subscription.service.ts:132-134` | ✅ |
| P0-B3: local cancel/change-plan capability | absent | only provider primitives, zero call sites (`recurring-billing.provider.ts:63-72`, `razorpay-subscription.provider.ts:124-149`) | ✅ |
| Provider-free discriminator | `plan.providerPlanId` is the gate | `subscription.service.ts:145`; status union has no DB enum | ✅ |
| Subscription→grant seam | `SubscriptionRenewedEvent` → listener | `subscription-renewal.service.ts:578`; `bbb-subscription.listener.ts:17-63` | ✅ |
| Grant selection ordering + `isUnbounded` | selection on `exhausted`/validity, ordered `validUntil ASC`; `isUnbounded` only in `getRemainingMinutes` | `bbb-provisioning-worker.service.ts:168-190`; `grant-reader.service.ts:96,109`; `bbb-organization.service.ts:238-239` | ✅ (F-4 remains runtime-unverified) |
| Concurrency limit ownership | `org.concurrentMeetingLimit` | `bbb-organization.service.ts:189,213`; `bbb-provisioning-worker.service.ts:107` | ✅ |
| ADR-042 surfaces | absent in code, present in docs | no `marketplaceListingEnabled`/`marketplaceGraceUntil` in `src/` (only a comment at `tenant-commercial-eligibility.service.ts:59`) | ✅ |
| Shop subscription surface | absent | `schema-shop.graphql` → no match | ✅ |
| `automaticSettle` | defaults false; smoke script settles manually | handler `:37,78`; `scripts/smoke/persona-b-journey.sh` contains **no** `automaticSettle` | ✅ |
| `npm run verify:invariants` | 3 static checkers green, 1 known event-chain warning | `adr-invariants` ✅ `rfc-lifecycle` ✅ `story-flow` ✅; `runtime-causality` ⚠️ `RecurringCapacityGrant` (pre-existing, F-6); trace-causality ✅; convergence 100/100 | ✅ |

Re-run §6 after any merge into `main` before starting a slice; this record is a baseline, not a standing guarantee.

**Second-round verification (2026-09-22), after an independent review re-checked this plan's load-bearing claims.** Newly confirmed and now folded into the plan above:

| Claim | Evidence | Verdict | Folded into |
|---|---|---|---|
| A free `active` row with a non-NULL past `currentPeriodEnd` enters the paid renewal pipeline | `processRenewals()` discovery on `currentPeriodEnd < :now AND status IN ('active','trialing')` (`subscription-renewal.service.ts:71, 106-108`); attempt amount `plan.monthlyPriceInPaise` (`:223`); abandonment window 1 h (`:57`) | **CONFIRMED — new finding F-7** | §0.19 F-7, §3.2, §4 (slice 4 gate), §5.1 |
| Period columns are nullable | migration `1789885988242-make-billing-period-start-nullable` | `CONFIRMED` | §0.19 F-7 |
| Free-tier Tier 2 capacity resolution already reads subscription state; no free tier exists in `PLAN_TIER_DEFAULTS` | `bbb-platform-capacity-policy.service.ts:88-110`; `PLAN_TIER_DEFAULTS` = starter/growth/enterprise only (`:19-23`) | `CONFIRMED` | §3.6 addendum, §4 (slice 1) |
| F-4's fall-through *throws* rather than granting access | `remainingMinutes = granted − consumed; if (<= 0) throw` (`bbb-provisioning-worker.service.ts:184-189`) | `CONFIRMED` — my earlier wording was inaccurate; corrected | §0.19 F-4 |
| `GrantReaderService.findEarliestValidGrant()` ignores its validity window | `where: { organization, exhausted: false }, order: { validUntil: 'ASC' }` with no window predicate (`grant-reader.service.ts:74-82`) | `CONFIRMED`, but **zero callers** — dead seam, not a live defect | §0.19 F-4 adjunct |
| `markCancelledFromWebhook()` exists as the webhook bridge | present in `SubscriptionRenewalService` | `CONFIRMED` | §3.1 (cancel slice shape) |
| Repo hygiene: tracked scratch scripts, cached screenshots, a 1.2 MB sqlite artefact | `git ls-files` confirms all three are tracked | `CONFIRMED` (non-blocking) | §9 |

---

## 7. Operational constraints

- **Application data:** never mutate Postgres rows by hand. Use Vendure Shop/Admin GraphQL, normal services/events/jobs, or `curl`. Read-only SQL for diagnostics is allowed.
- **Schema:** Vendure CLI only (`npx vendure migrate -g <name>` → inspect → `npx vendure migrate -r`). Never hand-write migration files, never `ALTER TABLE` by hand, never `synchronize: true` as production repair.
- **GraphQL:** regenerate Admin + Shop schema → `npm run codegen` → `npm run lint` / `npm run build` → focused e2e. New storefront fields must be domain-oriented; do not expose plugin-internal persistence structures just because they exist.
- **Invariants:** the three static checkers (`adr-invariants`, `rfc-lifecycle`, `story-flow`) must stay green. Exactly one pre-existing event-chain warning is expected (`RecurringCapacityGrant`, F-6) — do not "fix" it by renaming entities; fix RFC-001 §4. New architecture-level invariants are documented in `docs/architecture/invariants.md` (INV-024 already is) **and** get a structural sub-check in `AdrChecker.check()`.
- **Evidence:** R2, R3 and R4 evidence is recorded separately; one is never proof for another. R2-G stays open until its runtime evidence exists (0.14).

---

## 8. Open decisions to settle before or during slice 1

| # | Decision | Owner | Blocks |
|---|---|---|---|
| D-1 | ~~Free-tier numbers~~ **✅ RESOLVED — FROZEN 2026-09-22 (§3.6):** 60 min/day · 1 concurrent room · 5 participants/room (policy row 5/5/5) · instructors/staff **de-scoped** · students 100 = marketing copy | Product | — |
| D-2 | **✅ RESOLVED 2026-09-22:** both "students" and "custom domain" are **marketing copy** — declared-but-unenforced; building their enforcement is explicitly out of scope for this programme | Product | — |
| D-3 | Provider-free discriminator: plan-derived (`providerPlanId IS NULL`) vs a new explicit column | Architecture | Slices 3–4 |
| D-4 | Upgrade semantics: supersede in place vs cancel-then-create (supersede recommended) | Architecture (ADR-044) | Slice 3 |
| D-5 | `internal_overhead` grant: exclude from tenant session selection, or honour `isUnbounded` in the provisioning check | Backend | Slices 5–6 |
| D-6 | "Allowance exhausted" at provisioning time: terminal meeting state + notification, or pre-enqueue check | Backend/UX | Slice 5 |
| D-7 | Daily-allowance refresh job: schedule, timezone (Saa9vi server clock, per ADR-042's rule for grace) and catch-up after downtime | Backend | Slice 6 |
| D-8 | Does the free plan get a billing-period allowance at all, or daily only? — §3.6 freeze defaults free to **daily only** (billing-period row `—`); confirm explicitly when slice 6 opens | Product | Slice 6 |

---

## 9. Unverified / explicitly out of scope

- **`edu-frontend`** — not present in this repository; none of its files were inspected. Its HEAD, GraphQL documents and generated types must be audited separately.
- **Razorpay runtime evidence** — R2-G failure paths (halted, stale-cycle no-op, duplicate replay, halted recovery) remain open; see `production-readiness.md:861-866` and `what-next.md:23,44`.
- **The `verify:invariants` event-chain warning** about `RecurringCapacityGrant` is pre-existing (F-6), not caused by this plan. Do not "fix" it by renaming entities; fix the RFC wording.
- **F-4** is a static code reading and has not been reproduced against a running stack. Treat it as a strong hypothesis requiring a runtime check before allowance work starts.
- **Production custom-domain routing/TLS**, secrets, CORS, GraphiQL exposure, asset URL/storage, email mode, API/worker topology, backup/restore — `production-readiness.md`, not this plan.
- **Any claim about a commit, migration or test that is not re-verified with §6** — per `.clinerules` §11.
- **Repository hygiene (non-blocking, noticed 2026-09-22; `git ls-files` confirmed tracked):** two scratch scripts at the repo root (`_edit_script.js`, `_fix_script.js`), cached preview screenshots under `static/assets/cache/preview/…` (~1.5 MB), and a 1.2 MB sqlite artefact `src/plugins/tenant-plugin/e2e/__data__/tenant-plugin.e2e-spec.sqlite`. None affect correctness. Housekeeping should be its own commit — never folded into a feature slice.

---

## 10. Stop-and-revise triggers

Stop and rewrite this plan (do not "work around" it) when:

1. A supposed gap turns out to already exist in code (as R4 did).
2. A new field duplicates an existing entitlement (e.g. a second capacity-grant writer beside `BbbSubscriptionListener`).
3. A change needs manual DB mutation or a hand-written migration.
4. The storefront starts evaluating business rules, or any tenant identity arrives as a client-supplied argument.
5. A second tenant-identity mechanism appears anywhere.
6. A slice would relax an FSM guard (0.5) instead of adding the missing operation.
7. An invariant would need to be weakened to make the change pass.
