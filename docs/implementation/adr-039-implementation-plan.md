# Implementation Record — ADR-039 Provider-Wired Subscription Lifecycle

**Status: COMPLETED (2026-09-16).** All steps executed and runtime-verified. Retained below as the implementation record (original plan structure preserved).

| Step | Status | Evidence |
|---|---|---|
| 1 — Schema (CLI migration) | ✅ COMPLETE | migration `1789549563835-add-provider-subscription-fields` (3 nullable columns); commit `c79e6ca` |
| 2 — Provider wiring in `subscribeToPlan` | ✅ COMPLETE | commit `801588e`; transaction boundary corrected to ADR-039 ordering (no `@Transaction()` on the mutation; provider call outside any DB tx; one explicit narrow transaction for subscription + binding) |
| 3 — Webhook side | ✅ COMPLETE | envelope unwrapping fix + `pending_provider_auth → active` transition; commit `30d38e1` |
| 4 — Runtime verification | ✅ COMPLETE — C-1 CLOSED | C-1-A/B/C/C-idempotency/D/E all passed live; evidence in `integration-gaps-worklist.md` |
| UI-1 — Dashboard visibility | ✅ COMPLETE | commit `91ca476` |

> **Later amendments affecting this record (2026-09-22):**
> - ADR-039 now carries a **provider-free activation exception** (a Free Basic subscription activates locally to `active` with no provider subscription and no binding) — see the amendment block near the top of `docs/architecture/adr-039-provider-wired-subscription-lifecycle.md`.
> - The Free→Paid transition is **not** covered by this record: no cancel/change-plan mutation exists, so a supersede operation plus **ADR-044** must be designed before any registration-time subscription provisioning ships.
> - Programme context: `docs/implementation/saa9vi-comprehensive-integration-and-commercial-plan.md` §3.1 (plan change) and §3.2 (provider-free activation).


## Step 1 — Schema (Vendure CLI migration only)

1. Add `providerPlanId: string | null` to `SubscriptionPlan` entity; expose in admin GraphQL schema (`SubscriptionPlanInput`, `SubscriptionPlan` type).
2. Add `providerStatus: string | null`, `providerShortUrl: string | null` to `OrganizationSubscription`; expose in admin GraphQL.
3. Generate migration: `npx vendure migrate` (never hand-written). Register nothing manually — plugin-scoped entities are picked up by the CLI.

## Step 2 — Provider wiring in `SubscriptionService.subscribeToPlan`

**Step 2 gate — adapter input-contract corrections (REQUIRED before wiring, per 2026-09-16 review):**

The exact request sent to `POST /v1/subscriptions` must contain only documented schema fields:

| Field | Source | Notes |
|---|---|---|
| `plan_id` | `SubscriptionPlan.providerPlanId` | the only pricing/frequency carrier |
| `total_count` | explicit; Saa9vi adapter local default `12` when omitted (application default — the API has none; required unless `end_at`) | |
| `quantity` | `1` | |
| `customer_notify` | explicit boolean | documented field; governs Razorpay-side notifications |
| `start_at` / `expire_by` | optional | `total_count` XOR `end_at` |
| `notes` | `channelId`, `tenantProfileId`, `planId` | correlation only — `customerId`/`organizationId` keys dropped (no Saa9vi/Razorpay customer object exists) |
| ~~`notify_info`~~ | **REMOVED** | Create Subscription *Link* API field, not Create Subscription; the live API schema 400-rejects undocumented fields |

`CreateRecurringSubscriptionInput` is slimmed accordingly (`planId`, `totalCount?`, `startAt?`, `expireBy?`, `channelId`); `customerEmail`/`customerPhone`/`customerId`/`organizationId`/`amount`/`currency`/`frequency` leave the required contract. `billingCustomerId` on `OrganizationSubscription` remains legacy Juspay-oriented and is NOT assigned Razorpay semantics.

1. Resolve `plan.providerPlanId`; fail closed with a clear error when unset (no silent local-only fallback).
2. Resolve customer contact (email/phone) and `organizationId` from the channel's organization/customer records — no new mutation inputs.
3. Build `CreateRecurringSubscriptionInput` and call `provider.createSubscription(...)` (provider resolved exactly as the webhook path does: Razorpay only, omitted-default, unsupported-rejected).
4. Create the local `OrganizationSubscription` with `status: 'pending_provider_auth'` (retiring unconditional `'active'`), assign to channel (existing INV-001 pattern).
5. Call `createProviderBinding(ctx, channelId, 'razorpay', providerSubscriptionId, plan.providerPlanId, providerStatus, { source: 'subscription-creation' })` **in the same request path**.
6. Persist `providerStatus` + `providerShortUrl` on the subscription; return both to the admin caller.
7. Failure semantics: **external-side-effect model per ADR-039** — validate locally first, provider call second, persistence third; a local-persist failure after provider success surfaces the orphan `providerSubscriptionId` + correlation notes in the mutation error (orphan pre-auth subs never charge and expire; reconciled via dashboard). No claim of cross-system atomicity.

## Step 3 — Webhook side (no change)

* Worker channel resolution and fail-closed behavior stay exactly as is (INV-018).
* Processor's existing `authenticated`/`activated` handling transitions binding → active and (new) transitions the subscription `pending_provider_auth` → `active` — the only code change on this side, still inside the channel-scoped processor.

## Step 4 — Verification (GraphQL-only + read-only SQL)

* C-1-B: create plan (with `providerPlanId` via admin GraphQL) → `subscribeToPlan` → assert exactly one binding; scalar `channelId` + `channels[]` join both correct.
* C-1-C: retry/repeat creation; concurrent duplicate attempt → unique index holds; evaluate `providerSubscriptionId`-only pre-lookup against composite identity.
* C-1-D: cross-channel read isolation of the binding.
* C-1-E: replay a signed `subscription.authenticated` webhook for the binding's `providerSubscriptionId` → `processed`, channel resolved from binding, subscription → `active`.
* Full C-1 gate closes only after 1–4 pass.

## Explicitly out of scope

* One-time commerce `PaymentMethodHandler` (ADR-038 separation).
* Juspay anything (dormant).
* Worker `notes.channelId` fallback (rejected by ADR-039).
