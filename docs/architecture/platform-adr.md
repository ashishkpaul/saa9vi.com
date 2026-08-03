# Architecture Decision Record

> **Purpose:** Document enduring architectural decisions, their rationale, alternatives considered, and consequences. This document is **timeless** — it does not track implementation status, bugs, or roadmaps. Those belong in `docs/implementation/`.

---

## ADR-001: Channel = Tenant

**Status:** Active

**Decision:** The Vendure `Channel` is the sole tenant identity system. Every tenant-scoped entity is scoped to a Channel.

**Rationale:** Vendure's `RequestContext` carries the active `channelId`. `ListQueryBuilder` and `TransactionalConnection.findOneInChannel` automatically filter by this channel. A parallel identity system creates two sources of truth that drift in production under concurrent writes.

**Alternatives Rejected:**
- Separate `tenantId` column (dual source of truth)
- Separate database per tenant (operational overhead)

**Consequences:**
- All tenant-scoped entities must implement `ChannelAware`
- Exceptions documented for `InstructorProfile` (DL-010), `BbbEntitlement` (DL-011), `BbbOrganizationMembership` (DL-017)
- See INV-001 in `docs/architecture/invariants.md`

---

## ADR-002: BbbEnrollment Interim, Entitlement Target

**Status:** Active

**Decision:** `BbbEnrollment` is an interim access mechanism. `BbbEntitlement` is the target access primitive.

**Rationale:** Generalizing now prevents 5 separate access tables in 18 months.

**Alternatives Rejected:**
- Keep `BbbEnrollment` forever (accumulates tech debt per new product type)

**Consequences:**
- `BbbEntitlement` supports `bbb_session` and `bbb_room` types
- `BbbEnrollment` remains as legacy room-access path
- See INV-003 in `docs/architecture/invariants.md`

---

## ADR-003: `channels[]` ManyToMany + `channelId` Scalar

**Status:** Active

**Decision:** Entities carry both a `@ManyToMany(() => Channel) channels[]` join table and a scalar `channelId` column.

**Rationale:** `channels[]` enables framework tooling (`assignToCurrentChannel`, `findOneInChannel`). `channelId` scalar enables efficient direct joins without querying the join table.

**Alternatives Rejected:**
- `channelId` scalar only (loses framework channel-safety)
- `channels[]` only (loses query efficiency)

---

## ADR-004: Append-Only BbbUsageLedger

**Status:** Active

**Decision:** `BbbUsageLedger` rows are never updated, never deleted.

**Rationale:** Immutable billing facts; no retroactive mutation risk; enables audit.

**Alternatives Rejected:**
- Live calculation from `BbbMeeting.durationMinutes` (fragile, mutation risk)

**Consequences:**
- Extended to `AdSpendLedger`, `AdWalletLedger`, `BbbCapacityAlertLog`, `CommissionLedger`, `TenantRegistrationLog`
- See INV-002 in `docs/architecture/invariants.md`

---

## ADR-005: Webhook Persist-Before-Process

**Status:** Active

**Decision:** BBB webhooks are persisted to `BbbWebhookEvent` before any processing occurs. Processing happens asynchronously via BullMQ.

**Rationale:** Enables replay, audit, recovery; idempotency guaranteed by job deduplication.

**Alternatives Rejected:**
- Inline processing (no replay, silent loss on crash)

**Consequences:**
- See INV-004 in `docs/architecture/invariants.md`

---

## ADR-006: BbbScheduledSession as Commercial Product Entity

**Status:** Active

**Decision:** `BbbScheduledSession` is the commercial product entity, not `BbbRoom`.

**Rationale:** Trainers sell scheduled time slots, not abstract rooms. Marketplace requires browsable sessions with price and capacity.

**Alternatives Rejected:**
- `BbbRoom` as the product entity (too abstract, no time dimension)

---

## ADR-007: Postgres for Transactions, Elasticsearch for Search

**Status:** Active

**Decision:** PostgreSQL is the single source of truth for all transactional data. Elasticsearch is a derived read projection rebuilt on events.

**Rationale:** Single source of truth in PG; ES as a derived read projection rebuilt on event.

**Alternatives Rejected:**
- Dual-write to ES (synchronization failures)
- PG-only search (performance degrades at 10K+ instructors)

---

## ADR-008: Self-Hosted BBB

**Status:** Active

**Decision:** BigBlueButton is self-hosted.

**Rationale:** Data residency (India), cost control, integration depth.

**Alternatives Rejected:**
- Zoom/Meet (no API for room-level access control)
- BBB SaaS (loses per-meeting credential control)

---

## ADR-009: Caddy for Reverse Proxy and Custom Domain TLS

**Status:** Active

**Decision:** Caddy handles TLS termination and custom domain routing.

**Rationale:** Automatic Let's Encrypt; Caddyfile is programmable via Admin API.

**Alternatives Rejected:**
- Nginx (manual cert management)
- Traefik (more complex for this use case)

---

## ADR-010: InstructorProfile Not ChannelAware (DL-010)

**Status:** Active

**Decision:** `InstructorProfile` uses scalar `channelId` without full `ChannelAware` implementation.

**Rationale:** 1:N channel-to-instructors; `assignToCurrentChannel` overhead per create not warranted; all queries are explicit and code-verified.

**Alternatives Rejected:**
- Full `ChannelAware` implementation (adds join table, no practical benefit)

---

## ADR-011: BbbEntitlement Not ChannelAware (DL-011)

**Status:** Active

**Decision:** `BbbEntitlement` uses scalar `channelId` without full `ChannelAware` implementation.

**Rationale:** Same pattern as DL-010: simple access checks rarely need the join table.

**Alternatives Rejected:**
- Full `ChannelAware` implementation (adds join table with no query-benefit at current access-check volume)

---

## ADR-012: BbbScheduledSession Uses (organizationId, slug) Not (channelId, slug)

**Status:** Active

**Decision:** Sessions use `(organizationId, slug)` composite unique index, not `(channelId, slug)`.

**Rationale:** Sessions are scoped to organizations. Org-to-channel is 1:1 making org-scoped slugs equivalent to channel-scoped slugs while matching domain semantics.

**Alternatives Rejected:**
- `(channelId, slug)` composite (requires joining org to resolve channel for every slug lookup)

---

## ADR-013: BbbWebhookEvent Uses simple-json Not jsonb

**Status:** Active

**Decision:** `BbbWebhookEvent.payload` uses `simple-json` column type, not `jsonb`.

**Rationale:** Keeps Postgres as the only DB dependency; avoids migration if switching DB provider; no query-time JSON-path queries needed.

**Alternatives Rejected:**
- `jsonb` (enables PG-specific JSON queries not needed for the replay/audit use case)

---

## ADR-014: BbbServerSelectionService Uses Opaque currentLoad

**Status:** Active

**Decision:** `BbbServerSelectionService` uses opaque `currentLoad` integer for server selection, not a hard-coded formula.

**Rationale:** Decouples selection algorithm from scoring formula; reconciliation service owns scoring logic and can evolve it without touching selection.

**Alternatives Rejected:**
- Hard-coded `activeMeetingCount × avgParticipants` formula inside selection service (couples two concerns)

---

## ADR-015: navMenuItem on Route Definitions, Never items Inside navSections

**Status:** Active

**Decision:** Dashboard nav links are registered via `navMenuItem` on route definitions. `navSections` only defines section containers.

**Rationale:** `DashboardNavSectionDefinition` type constraint enforced by TypeScript; confirmed by BBB and Tenant plugin code audit.

**Alternatives Rejected:**
- `items` array inside section (fails at compile time — TS-2353)

---

## ADR-016: Single Shared Next.js Storefront

**Status:** Active

**Decision:** A single shared Next.js storefront serves all tenants. Tenant identity is resolved from hostname.

**Rationale:** Eliminates per-tenant code deployments; backend plugin evolution is decoupled from storefront deployments; matches Shopify/Kajabi/Teachable operating model at scale.

**Alternatives Rejected:**
- Per-tenant Next.js fork (500 tenants = 500 deployment pipelines)
- iframe embedding (SEO dead, mobile broken)

---

## ADR-017: BbbOrganizationMembership Uses Scalar channelId (DL-017)

**Status:** Active

**Decision:** `BbbOrganizationMembership` uses scalar `channelId` without `ChannelAware`.

**Rationale:** Membership checks are high-frequency, low-data-volume queries. The join table overhead of full `ChannelAware` implementation adds no practical channel-safety benefit since all queries include explicit `organizationId` which already implies the channel via the 1:1 org-to-channel mapping.

**Alternatives Rejected:**
- Full `ChannelAware` implementation (adds join table, redundant with org-scoped filter)

---

## ADR-018: Internal Room Access via Membership Waterfall Gate

**Status:** Active

**Decision:** Internal room access is granted via an organizational membership check as a waterfall gate prior to entitlement check, not as a separate access-control system.

**Rationale:** Preserves INV-003 (one access-control system). Membership short-circuits the waterfall rather than replacing it. Commercial and internal access paths are additive, not competing.

**Alternatives Rejected:**
- Separate `InternalRoomAccess` entity (creates a second access-control system, violates INV-003)
- Adding `isInternal` flag to `BbbRoom` and bypassing all checks (no audit trail)

---

## ADR-019: Multivendor Plugin Rejected (DL-019)

**Status:** Active

**Decision:** The Vendure example `multivendor-plugin` is not installed.

**Rationale:** The plugin implements cross-vendor order splitting for the Amazon/Etsy model. Saa9vi uses the Shopify/Kajabi model — each academy is a completely isolated storefront; cross-academy carts do not exist.

**Alternatives Rejected:**
- Vendure multivendor-plugin (wrong data model)
- Separate marketplace microservice (operational overhead, dual source of truth)

---

## ADR-020: Platform-Level Elasticsearch Index (DL-020)

**Status:** Active

**Decision:** A single platform-level Elasticsearch index spans all channels for marketplace discovery.

**Rationale:** Marketplace discovery requires reading across tenant boundaries. A single platform index is a derived read projection — PG remains authoritative per-channel. INV-001 (Channel = Tenant for writes) is preserved.

**Alternatives Rejected:**
- Per-tenant index only (no cross-tenant discovery)
- PG-only search (performance degrades at 10K+ sessions)

---

## ADR-021: Three-Stream Revenue Model (DL-021)

**Status:** Active

**Decision:** Three-stream revenue model: subscription + commission + advertising.

**Rationale:** Streams are additive and reinforce each other. Subscription provides predictable base revenue. Commission aligns Saa9vi's growth with academy growth. Advertising creates a self-serve high-margin stream. Zero commission on direct traffic protects academy relationships.

**Alternatives Rejected:**
- Single-stream SaaS only (leaves growth revenue on table)
- Commission on all traffic (penalises academies for existing students, risks churn)

---

## ADR-022: Sponsored Listings Use Elasticsearch Function-Score Bid-Boost (DL-022)

**Status:** Active

**Decision:** Sponsored listings use Elasticsearch function-score bid-boost, not position injection.

**Rationale:** Bid-boost multiplier (`weight: 3.0` on `isSponsored: true`) integrates cleanly with existing `bayesianRating` function score. Organic ranking below sponsored results. Organic ordering is never manipulated.

**Alternatives Rejected:**
- Position injection (couples ranking and ad logic, fragile)
- Separate sponsored endpoint (bad UX, no interleaving)

---

## ADR-025: Proactive Capacity Intelligence Over Reactive Throttling (DL-025)

**Status:** Active

**Decision:** The platform implements 48-hour load forecasting with operator notification rather than capacity-based meeting blocking.

**Rationale:** The education context makes reactive throttling uniquely harmful. A live class with enrolled students cannot be cancelled at provisioning time. A 48-hour forecast with 15-minute alert cadence gives operators enough warning to add infrastructure before any student is affected.

**Alternatives Rejected:**
- Hard capacity ceiling blocking meetings (rejected — INV-012)
- Per-join capacity checks (too late — meeting already provisioned)
- Cloud auto-scaling (deferred to Phase 4 — current BBB servers are self-hosted)

---

## ADR-026: SubscriptionEntitlement as Pure Computed State (DL-026)

**Status:** Active

**Decision:** `SubscriptionEntitlement` is pure computed state from `SubscriptionEnrollment.status`, not a persisted entity.

**Rationale:** Access is computed at runtime. The transition `IN_GRACE → SUSPENDED` is driven by an async BullMQ cron job — a student technically past grace expiry retains access until the job processes. In a live education billing context, granting a few extra minutes during a queue delay is an acceptable business tolerance.

**Alternatives Rejected:**
- Persisting `SubscriptionEntitlement` explicitly (creates fragile sync between billing state and access state, introduces drift risk on job failure)

---

## ADR-027: Session Products Assigned to Tenant Channel Only (DL-027)

**Status:** Active

**Decision:** Session products are assigned to the tenant channel only — never to the default channel.

**Rationale:** Vendure assigns new products to both the default channel and the current channel by default. Allowing session products on the default channel would create an accidental cross-tenant product listing visible to all storefronts. The marketplace ES index is the correct and only cross-tenant discovery surface.

**Alternatives Rejected:**
- Allow default channel assignment (creates uncontrolled cross-tenant product leakage)
- Per-tenant index only for discovery (acceptable for Phase 1.5; not scalable for Phase 3 marketplace)

---

## ADR-028: TenantRegistrationLog Append-Only Pattern (DL-028)

**Status:** Active

**Decision:** `TenantRegistrationLog` uses append-only pattern — PENDING → COMPLETED/FAILED transition only, rows never updated after final status.

**Rationale:** Registration is a critical platform operation. Append-only logging provides an immutable audit trail for every tenant creation attempt, enabling retrospective analysis of registration failures and abuse patterns.

**Alternatives Rejected:**
- Mutable `TenantRegistrationLog` (loses audit trail on failure)
- No log at all (no observability into registration failures)

---

## ADR-029: TenantProfileService.create() Resolves Channel to token String (DL-029)

**Status:** Active

**Decision:** `TenantProfileService.create()` resolves `Channel` entity to `channel.token` string before passing to `RequestContextService.create()`.

**Rationale:** `RequestContextService.create()` expects a `channelToken: string` parameter. Passing a raw `Channel` entity object causes `TypeError: channelOrToken.startsWith is not a function`.

**Alternatives Rejected:**
- Passing `Channel` entity directly (crashes with TypeError)
- Refactoring `RequestContextService.create()` to accept both types (adds complexity to a Vendure core method)

---

## ADR-030: CommissionLedger $0-Row Pattern (DL-030)

**Status:** Active

**Decision:** `CommissionLedger` always writes a row per marketplace order, even at 0% rate ($0 rows). The env var is named `MARKETPLACE_COMMISSION_PERCENT` (not `PLATFORM_FEE_PERCENT`).

**Rationale:** Three-stream revenue model has three separate control mechanisms. Stream 2 (marketplace commission) is the only one where "the event happened but the rate is zero" is a recurring state worth recording. Writing $0 rows preserves complete `orderSource = 'marketplace'` GMV history so future rate changes have full historical data. The env var name must be unambiguous about which stream it controls.

**Alternatives Rejected:**
- `PLATFORM_FEE_PERCENT` (ambiguous — reads like it controls all three streams)
- Not writing $0 rows (loses GMV history when rate is turned up later)
- Applying $0-row pattern to Stream 1 or 3 (incorrect — absence of rows in those streams correctly means no usage/no ad spend)

---

## ADR-031: Platform-Owned BBB Capacity Policy

**Status:** Proposed

**Decision:** BBB infrastructure capacity limits are controlled by Portal Admin through a platform-level `BbbPlatformCapacityPolicy`. Tenant administrators can manage courses and commercial enrollment but cannot increase BBB resource limits beyond what the policy allows.

**Rationale:** BBB servers are Saa9vi-owned infrastructure. Allowing tenant-controlled capacity creates unpredictable resource consumption that impacts other tenants and infrastructure costs. Three distinct capacity layers must be separated:

1. **Platform infrastructure capacity** — controlled by Portal Admin via `BbbPlatformCapacityPolicy`
2. **Academy commercial capacity** — tenant controls `ProductVariant.stockLevel` (how many can buy)
3. **Individual class/room capacity** — governed by platform policy, tenant can set within limits

**Capacity Model:**

```
ProductVariant.stockLevel
  → "How many customers can buy?" (tenant-controlled)

BbbScheduledSession.maxAttendees
  → "How many students can attend this session?" (tenant-controlled, capped by policy)

BbbRoom.maxParticipants
  → "What is the BBB infrastructure limit?" (governed by platform policy)

BbbPlatformCapacityPolicy
  → "What is the platform-wide default and maximum?" (Portal Admin controlled)
```

**Plan-Based Capacity (Recommended):** Capacity limits are tied to subscription plans:

| Plan | Default Room Capacity | Max Room Capacity | Max Concurrent Participants |
|---|---|---|---|
| Starter | 50 | 100 | 500 |
| Growth | 200 | 500 | 2000 |
| Enterprise | 500 | 1000 | 5000 |

**Entity Design:**

```typescript
@Entity('bbb_platform_capacity_policy')
export class BbbPlatformCapacityPolicy extends VendureEntity {
  @Column({ default: 100 })
  defaultRoomCapacity: number;       // applied when tenant creates a room

  @Column({ default: 500 })
  maxRoomCapacity: number;           // tenant cannot exceed this

  @Column({ default: 1000 })
  maxConcurrentParticipants: number; // across all rooms for this tenant

  @Column({ nullable: true })
  subscriptionPlanId: string | null; // FK to SubscriptionPlan (Phase 2)
}
```

**Consequences:**
- `BbbOrganization.maxParticipantsPerMeeting` becomes a denormalized cache of the policy limit
- `BbbRoom.maxParticipants` is set from policy default on room creation, tenant can increase up to `maxRoomCapacity`
- `BbbScheduledSession.maxAttendees` is a separate commercial field — tenant controls it for selling, but actual BBB room capacity is the runtime ceiling
- Portal Admin dashboard needs a capacity policy management UI

**Alternatives Rejected:**
- Tenant-controlled BBB capacity (resource abuse risk, unpredictable infrastructure costs)
- Fixed hardcoded capacity in code (not adaptable to different plan tiers)
- BBB server as only capacity authority (too late — impacts user experience at join time)

---

## ADR-032: Channel-Ownership Guard for BBB Resources

**Status:** Active

**Decision:** All BBB service-layer reads and mutations that resolve a tenant-scoped resource (organization, room, meeting, scheduled session, entitlement, member, membership, capacity grant, enrollment, product access, trial registration) must pass through `BbbChannelAccessService` before returning or mutating. The guard asserts the resource's owning organization belongs to the active `ctx.channelId`. SuperAdmin bypasses all checks.

**Rationale:** The BBB services previously resolved resources by ID without verifying channel ownership, so a tenant admin could read or mutate another tenant's BBB resources if they knew the ID. Centralizing the check in a single injectable service (rather than scattering `if (org.channelId !== ctx.channelId)` across every method) keeps the invariant enforceable and testable.

**Consequences:**
- `BbbChannelAccessService` is registered in the BBB plugin providers and injected into `BbbOrganizationService`, `BbbRoomService`, `BbbMeetingService`, `BbbScheduledSessionService`, and `BbbEntitlementService`
- `findAll` methods filter by `ctx.channelId`; `findById`/`update`/`delete`/`create` assert ownership
- Worker/webhook callbacks (e.g. `onMeetingActive`) bypass the guard — they run under internal context, not tenant-admin context
- See INV-001 and the Phase A isolation e2e suite

**Alternatives Rejected:**
- Relying on Vendure's `ListQueryBuilder` channel filtering alone (does not cover scalar-`channelId` entities like `BbbEntitlement`, and does not guard by-ID mutations)
- Scattering inline channel checks per method (duplication, drift risk)

---

## ADR-033: Granular BBB Permissions

**Status:** Active

**Decision:** The single coarse-grained `BBBAdmin` permission is supplemented by seven granular permissions: `BBBPlatformInfrastructure`, `BBBManageOrganizations`, `BBBManageRooms`, `BBBManageSessions`, `BBBManageMeetings`, `BBBManageEntitlements`, `BBBManageMembers`. Every BBB admin resolver method and dashboard route is decorated with both `BBBAdmin` and the matching granular permission, so `BBBAdmin` remains fully backward compatible while finer-grained roles are possible.

**Rationale:** A single `BBBAdmin` permission forces every tenant admin to have full BBB access or none. Granular permissions let the platform grant scoped access (e.g. a tenant admin who manages rooms but not platform servers) and align with the Phase C expansion of `TENANT_ADMIN_ROLE_PERMISSIONS`.

**Consequences:**
- `BBB_GRANULAR_PERMISSIONS` registered in `config.authOptions.customPermissions`
- Resolver `@Allow` decorators include both `BbbAdminPermission.Permission` and the granular permission
- Dashboard `requiresPermission` arrays include both `BBBAdmin` and the granular permission
- `TENANT_ADMIN_ROLE_PERMISSIONS` grants the granular permissions (not `BBBAdmin`) to new tenant admins
- See INV-001 and Phase B

**Alternatives Rejected:**
- Replacing `BBBAdmin` entirely (breaks existing roles that hold `BBBAdmin`)
- Keeping only `BBBAdmin` (no scoped access possible)

---

## ADR-034: Channel-Scoped Administrator Visibility

**Status:** Active

**Decision:** The TenantPlugin overrides the built-in `administrators` Admin API query so that a tenant administrator only sees administrators whose `Role.channels[]` includes the active channel. SuperAdmin bypasses the filter and sees all administrators.

**Rationale:** Vendure's built-in `administrators` query is not channel-aware — it returns all administrators regardless of the active channel. If a tenant role is ever granted `ReadAdministrator`, the built-in query would expose global/SuperAdmin accounts to tenant admins. Overriding the query closes this latent leak.

**Consequences:**
- `TenantAdminResolver.administrators` filters by `role.channels` join on `ctx.channelId`
- SuperAdmin path returns all administrators
- Enforced by INV-016 and the `administratorVisibility` invariant checker
- Regression tests cover tenant A, tenant B, and SuperAdmin visibility

**Alternatives Rejected:**
- Relying on the built-in query (leaks global admins if `ReadAdministrator` is granted)
- Removing `ReadAdministrator` from tenant roles entirely (over-restrictive; the override is the correct fix)
