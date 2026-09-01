# Architectural Invariants

> **Purpose:** The non-negotiable rules that the platform must never violate. These are load-bearing — violating any one of them requires a full data migration to fix. Extracted from ADR §2 and §2B.

---

## INV-001: Channel = Tenant. One Identity System.

```
Channel (Vendure core)
    ↕  1:1
TenantProfile (TenantPlugin)
    ↕  1:1
BbbOrganization (BigBlueButtonPlugin)
    ↕  1:1
Seller (Vendure core — Phase 3)
```

**Rule:** Every entity that is tenant-scoped **must** implement `ChannelAware` and be persisted via `channelService.assignToCurrentChannel(entity, ctx)` before the first `save()`. Every read against a channel-scoped entity **must** use `ListQueryBuilder` with `RequestContext` or `findOneInChannel`.

**Exceptions (documented in Decision Log):**
- `InstructorProfile` — scalar `channelId` (DL-010)
- `BbbEntitlement` — scalar `channelId` (DL-011)
- `BbbOrganizationMembership` — scalar `channelId` (DL-017)

- **Channel assignment mechanism (ADR-036):** `CmsPlugin` entities (`Article`, `Page`, `Banner`) implement `ChannelAware` but do **not** use the generic `assignToCurrentChannel()` helper. Instead, `CmsChannelAssignmentPolicy.assign()` resolves channel assignment by the creator's role: SuperAdmin → default channel only; Tenant Admin → tenant channel only (never default). This two-class ownership model prevents tenant-created CMS content from leaking onto `__default_channel__` (BUG-031).

**Rejection criterion:** Any PR introducing a `tenantId` column that is not `ctx.channelId` is rejected without review.

---

## INV-002: Every Billing Fact Is an Immutable Ledger Row.

**Rule:** `BbbUsageLedger` rows are never updated. Never deleted. The source of billing truth is always `SUM(consumedMinutes) WHERE organizationId = X AND period`. Meeting state columns (`BbbMeeting.durationMinutes`) are operational convenience fields, never the authoritative billing source.

**Extended to:**
- `AdSpendLedger` (INV-010)
- `AdWalletLedger`
- `BbbCapacityAlertLog`
- `CommissionLedger` (DL-030)
- `TenantRegistrationLog` (DL-028)

**Rejection criterion:** Any service method that calls `.update()` on a ledger row is rejected.

---

## INV-003: One Access-Control System via Entitlement.

**Rule:** All access to paid content — live sessions, recorded courses, workshops, coaching packages — is gated through a single `Entitlement` entity with a uniform `hasAccess(ctx, customerId, type, resourceId)` interface.

**Current status:** `BbbEntitlement` entity and `BbbEntitlementService` are live. The primary room-access path (`joinRoom()` → `BbbEntitlementService.hasAccess()`) is migrated (ADR-002). `BbbEnrollment` is retained only for the trial-conversion audit trail (`convertTrialToEnrollment`), pending Phase 1.5 cleanup.

**Rejection criterion:** Any new entity named `*Enrollment` or `*Access` that is not `BbbEnrollment` backward-compatibility is rejected.

---

## INV-004: Webhooks Are Persisted Before Processing.

**Rule:** BBB webhooks follow this pattern:

```
POST /bbb/webhook
  → validate HMAC signature
  → persist BbbWebhookEvent { status: PENDING }
  → enqueue event ID to BullMQ
  → return { ok: true }

BullMQ processor
  → fetch BbbWebhookEvent by ID
  → process
  → mark PROCESSED or FAILED
```

**Rejection criterion:** Any webhook controller that calls a service method before persisting the raw event is rejected.

---

## INV-005: One Shared Storefront. Tenants Own Content, Not Code.

**Rule:** All tenants share a single Next.js storefront. Each academy customises: logo, theme, CMS pages, products, instructors, BBB rooms, custom domain. Each academy does **not** own: application code, GraphQL queries, business rule evaluation.

**Rejection criterion:** Any architecture that requires per-tenant code fork, per-tenant build pipeline, or per-tenant deployment of the Next.js storefront is rejected.

---

## INV-006: Storefronts Consume Domain APIs, Not Plugin Internals.

**Rule:** The storefront must query **domain-oriented GraphQL operations** that hide internal plugin structure. Plugin-internal entity names, field names, and relationship traversals are implementation details.

**Rejection criterion:** Any Shop API resolver that exposes a plugin-prefixed type (`Bbb*`, `Cms*`) as a top-level storefront query is rejected.

---

## INV-007: GraphQL Schema Changes Are Additive. Breaking Changes Are Prohibited.

**Rule:** Schema evolution must follow this order:
1. Add the new field/argument alongside the old one
2. Mark old field `@deprecated` with migration guidance
3. Keep old field working for at minimum one major release cycle
4. Remove only after all consumers have migrated

**Rejection criterion:** Any PR that removes or renames a GraphQL field or required argument without a prior deprecation cycle is rejected.

---

## INV-008: Business Logic Lives in Vendure. The Storefront Is a Renderer.

**Rule:** Access control, eligibility checks, pricing, capacity enforcement, trial rules, and fulfillment decisions must be evaluated by Vendure plugins — never by the Next.js storefront.

**Rejection criterion:** Any PR that adds business logic (if/else on access, pricing, or eligibility) to the Next.js storefront is rejected.

---

## INV-009: Marketplace Indices Are Read Projections.

**Rule:** The platform-level Elasticsearch indices (`saa9vi_marketplace_sessions`, `saa9vi_marketplace_instructors`) are derived read projections. Authoritative data always lives in channel-scoped PostgreSQL tables. No marketplace write operation may bypass channel context.

**Rejection criterion:** Any mutation that creates or modifies a channel-scoped entity without a `RequestContext.channelId` is rejected.

---

## INV-010: Ad Spend Truth Is the AdSpendLedger.

**Rule:** `MarketplaceAdCampaign.spentInPaise` is a convenience cache. Truth is `SUM(AdSpendLedger.amountInPaise) WHERE campaignId = X`. Extends INV-002 to the advertising domain.

**Rejection criterion:** Any service method that calls `.update()` on an `AdSpendLedger` row is rejected.

> **INV-011 is intentionally unassigned.** The current canonical sequence runs INV-010 → INV-012; nothing in `invariants.md` or the legacy ADR defines an INV-011. When adding a new invariant, use the next free number (**INV-020**) rather than claiming INV-011. The canonical sequence currently runs through **INV-019**.

---

## INV-012: Capacity Intelligence Is Advisory. Meetings Are Never Blocked for Capacity Reasons.

**Rule:** The `CapacityIntelligenceService` warns operators when forecast load approaches pool capacity. It does not block meeting provisioning. Capacity is a signal for operators, not a gate for students.

**Rejection criterion:** Any code path that throws an error or returns an access-denied response solely because pool capacity is high is rejected.

---

## INV-013: Customer Deletions Are Always Anonymizations. No Cascade Deletes.

**Rule:** Customer deletion must **anonymize** all personal data rather than hard-deleting rows. Financial and audit data must retain immutable foreign key references.

**Rejection criterion:** Any schema change that adds `onDelete: CASCADE` from `Customer` or `User` to financial/audit tables is rejected.

---

## DL-030: CommissionLedger $0-Row Pattern (Stream 2 Only)

**Rule:** `CommissionLedger` rows are written for every marketplace order regardless of the current `MARKETPLACE_COMMISSION_PERCENT` rate. When the rate is 0%, rows are written with `amountInPaise: 0`. This preserves complete `orderSource = 'marketplace'` GMV history.

This pattern does **not** apply to Stream 1 (`BbbUsageLedger`) or Stream 3 (`AdSpendLedger`).

---

## INV-014: BBB Infrastructure Capacity Is a Single Mutable Integer Per Organization (Current)

**Rule (current):** `BbbOrganization.maxParticipantsPerMeeting` is a single mutable integer set via admin dashboard form. `BbbRoom.maxParticipants` defaults from this value on room creation (`input.maxParticipants ?? org.maxParticipantsPerMeeting`). Any user with access to the org edit form can set this value directly.

**Rejection criterion:** `BbbRoom.maxParticipants` must never exceed `BbbOrganization.maxParticipantsPerMeeting` at provisioning time.

> **Transition note (2026-08, ADR-031 implementation):** once Portal Admin creates any `BbbPlatformCapacityPolicy` row, `maxParticipantsPerMeeting` becomes a write-through denormalized cache of the effective policy limit (`maxRoomCapacity`) — synced on organization creation and on room provisioning; manual form edits are then overridden by policy. The rejection criterion above is preserved by construction (the cache holds the ceiling). Pre-adoption (zero policy rows), the rule above applies unchanged. See `BbbPlatformCapacityPolicyService` and the roadmap Phase 2 entries.

---

## INV-016: Administrator Visibility Is Channel-Scoped

**Rule:** The `administrators` Admin API query must never leak administrators from other channels (including SuperAdmin/global administrators) to a tenant administrator. A tenant admin operating under channel X may only see administrators whose `Role.channels[]` includes channel X.

**Rationale:** Vendure's built-in `administrators` query is not channel-aware — it returns all administrators regardless of the active channel. If a tenant role is ever granted `ReadAdministrator`, the built-in query would expose global/SuperAdmin accounts to tenant admins. The TenantPlugin must override the `administrators` query to filter by the active channel's role membership.

**Rejection criterion:** Any PR that grants `ReadAdministrator` to a tenant role without also overriding the `administrators` query to be channel-scoped is rejected.

---

## INV-017: Subscription Renewals Use CAS Optimistic Locking.

**Rule:** `OrganizationSubscription` renewals must use a version-incrementing Compare-And-Swap (CAS) update to ensure idempotency across multiple workers. The worker must verify `affectedRows === 1` before publishing events or initiating billing.

**Rejection criterion:** Any renewal logic that updates `currentPeriodEnd` without checking a `version` column is rejected.

---

## INV-018: Billing Context Requires Explicit Channel Resolution.

**Rule:** Services operating on tenant subscriptions outside of a standard request-response cycle must resolve the `Channel` entity by ID and use its `token` or entity reference for `RequestContext` creation. Raw IDs must never be used for channel-based context resolution (BUG-021).

**Rejection criterion:** Any code that passes a raw database `channelId` to `RequestContextService.create({ channelOrToken })` is rejected.

---

## INV-019: Subscription Payment Attempts Are Independently Recorded Financial Facts.

**Status:** Live (registered 2026-08-30 with the Juspay recurring billing foundation; semantics decided in the Step 2 review as the "stateful attempt record" model).

**Rule:** Every Juspay charge attempt against an `OrganizationSubscription` is recorded as a `JuspayPaymentAttempt` row **before** the gateway call. The only permitted mutation of an attempt row is the single lifecycle transition `initiated → succeeded | failed`, performed exclusively by the tightly-scoped attempt-recording service (renewal worker or webhook processor). A retry is always a **new** row; terminal results are never overwritten, history is never rewritten, and no API surface may expose mutation of an existing attempt.

Related constraints:
- `OrganizationSubscription` period advancement must never be treated as equivalent to successful payment — the renewal flow is CLAIM CAS → attempt → charge → FINALIZE CAS (see `SubscriptionRenewalService` state model; a finalize conflict after a successful charge is an operator-visible reconciliation incident, never an automatic retry).
- `JuspayPaymentAttempt` carries a denormalized scalar `channelId` (ADR-003 scalar-only exception); all ledger queries must scope by it — a bare `repository.find()` is a BUG-031-class channel-isolation bug.
- Webhook-derived attempt results must reconcile the existing `initiated` attempt for that billing period, never create a parallel one.

**Rejection criterion:** Any code path that updates a `JuspayPaymentAttempt` row already in a terminal state (`succeeded`/`failed`), collapses retries into an existing row, advances the subscription period without a successful payment finalize, or queries the ledger without channel scoping is rejected.

---

## ADR-037: Separation of Subscription Discovery and Execution.

**Rule:** To ensure durability and horizontal scalability, subscription renewal is split into two phases:
1. **Discovery (ScheduledTask):** Identifies due subscriptions and enqueues BullMQ jobs.
2. **Execution (JobQueue):** Performs the actual renewal, billing, and event publication.

---

## INV-015: BBB Infrastructure Capacity Is Platform-Controlled.

**Status:** Live (ADR-031).

**Rule:** BBB infrastructure capacity limits (`BbbRoom.maxParticipants`, `BbbOrganization.maxParticipantsPerMeeting`) are governed by `BbbPlatformCapacityPolicy` controlled by Portal Admin. Tenant administrators control commercial capacity (`ProductVariant.stockLevel`) but cannot increase BBB resource limits beyond what the platform policy allows.

**Three distinct capacity layers (proposed):**

| Layer | What it controls | Who controls | Entity |
|---|---|---|---|
| Platform infrastructure | BBB server load, concurrent participants | Portal Admin | `BbbPlatformCapacityPolicy` |
| Academy commercial | How many customers can buy | Tenant Admin | `ProductVariant.stockLevel` |
| Session enrollment | How many students can attend a session | Tenant Admin (capped by policy) | `BbbScheduledSession.maxAttendees` |

**Rejection criterion (future):** Any code path that allows a tenant administrator to set `BbbRoom.maxParticipants` or `BbbOrganization.maxParticipantsPerMeeting` above the `BbbPlatformCapacityPolicy.maxRoomCapacity` limit is rejected.
