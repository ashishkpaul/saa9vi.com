# PR 1 — BBB Retirement & PILOS Integration Dependency Audit

**Status:** PROPOSED (baseline only — no source deletion, no migration, no placeholder plugin)
**Branch basis:** `main` (HEAD `150fb95`), cross-checked against `origin/saa9vi_com` (`00afae14`) which holds ADR-057
**Related ADR:** `docs/adr/adr-057-pilos-keycloak-monthly-subscription-gating.md` — now present on `main` and indexed in `docs/adr/platform-adr.md` (§6 BB-006, Decision Log DL-032)
**Goal:** Establish a safe, complete inventory of every dependency on `BigBlueButtonPlugin` before any retirement work. **No plugin source, API, job, migration, or table is removed in PR 1.** PR 1 is documentation, audit, ADR alignment, and dependency inventory only.

---

## 1. Verification findings (assessment vs codebase)

| Assessment claim | Codebase reality | File / line | Status |
|---|---|---|---|
| `saa9vi_com` branch exists | Remote-tracking branch `origin/saa9vi_com` at `00afae14` | `git rev-parse --verify origin/saa9vi_com` | ✅ Confirmed |
| ADR-057 exists & is ACCEPTED | `docs/adr/adr-057-pilos-keycloak-monthly-subscription-gating.md` on `saa9vi_com` | `git show origin/saa9vi_com:docs/adr/adr-057-...` | ✅ Confirmed |
| ADR-057 now on `main` | Copied to `docs/adr/adr-057-pilos-keycloak-monthly-subscription-gating.md` on `main` | `diff` vs origin identical (modulo whitespace) | ✅ Done |
| ADR-057 indexed in platform-adr.md | §6 BB-006 subsection + Decision Log DL-032 | `docs/adr/platform-adr.md` lines ~699, ~1821 | ✅ Done |
| `TenantPlugin` retained | `src/plugins/tenant-plugin/tenant-plugin.plugin.ts` | — | ✅ Confirmed |
| `SubscriptionPlugin` retained | `src/plugins/subscription/subscription.plugin.ts` | — | ✅ Confirmed |
| `PaymentsPlugin` retained | `src/plugins/payments/payments.plugin.ts` | — | ✅ Confirmed |
| `LearningPlugin` retained | `src/plugins/learning-plugin/learning-plugin.plugin.ts` | — | ✅ Confirmed |
| `MarketplaceIndexerPlugin` retained | `src/plugins/marketplace/` | — | ✅ Confirmed |
| `BigBlueButtonPlugin` present (to retire) | `src/plugins/bigbluebutton-plugin/bigbluebutton.plugin.ts` | — | ✅ Confirmed |
| `PilosAccessSyncPlugin` exists | NOT FOUND anywhere in repo | `search_codebase("PilosAccessSync")` | ⬜ New plugin to create |
| `BbbOrganization.channelId` | `@Column() channelId: string;` | `src/plugins/bigbluebutton-plugin/entities/bbb-organization.entity.ts:23` | ✅ Confirmed |
| `BbbOrganizationMember.customerId` | `@Column() customerId: string;` | `src/plugins/bigbluebutton-plugin/entities/bbb-organization-member.entity.ts:38` | ✅ Confirmed |
| `BbbOrganizationMember.keycloakSub` | `@Column({ nullable: true }) keycloakSub: string;` | `src/plugins/bigbluebutton-plugin/entities/bbb-organization-member.entity.ts:60` | ✅ Confirmed |
| Subscription entities (6 listed) | All 6 present + `RenewalPaymentReconciliationRequired` | `src/plugins/subscription/entities/` | ✅ Confirmed |
| Razorpay provider/verifier/processor | All present | `src/plugins/subscription/providers/razorpay/` | ✅ Confirmed |
| `SubscriptionRenewalService` + dunning task | Present | `subscription-renewal.service.ts`, `subscription-dunning.task` | ✅ Confirmed |
| PILOS source integration in repo | None — only documentation references | `search_codebase("pilos", "PILOS")` | ✅ Confirmed (no code yet) |

---

## 2. Existing plugin inventory (main branch)

Retained plugins — no duplication, extend in place:

| Plugin | Path | Role in target architecture |
|---|---|---|
| `tenant-plugin` | `src/plugins/tenant-plugin/` | Tenant identity (Channel = tenant), seller/channel relationships |
| `subscription` | `src/plugins/subscription/` | Commercial subscription state, Razorpay recurring billing, renewal/dunning |
| `payments` | `src/plugins/payments/` | Platform Razorpay one-time payments (Flow A), separate from subscription |
| `learning-plugin` | `src/plugins/learning-plugin/` | Course domain, learner entitlements (retains BBB product/session linkage) |
| `marketplace` | `src/plugins/marketplace/` | Marketplace indexer, revenue, commission |
| `bigbluebutton-plugin` | `src/plugins/bigbluebutton-plugin/` | **RETIRE** — meeting ops move to PILOS |

New plugin:

| Plugin | Path | Role |
|---|---|---|
| `pilos-access-sync-plugin` | `src/plugins/pilos-access-sync-plugin/` (NEW) | Keycloak user provisioning, subject mapping, tenant membership sync, PILOS entitlement sync, durable outbox + retry, reconciliation |

**No placeholder plugin is registered in PR 1.** The BBB registration in `vendure-config.ts` remains until PR 7, when the replacement integration is validated.


---

## 3. BigBlueButtonPlugin — full entity inventory (21 entities + 2 shared)

From `bigbluebutton.plugin.ts` `@VendurePlugin entities`:

1. `BbbServer`
2. `BbbOrganization` — owns `channelId` (tenant mapping) → **migrate to TenantPlugin/Channel reference**
3. `BbbMeeting`
4. `BbbCapacityGrant`
5. `BbbUsageLedger` — **historical, retain per ADR-057 D8**
6. `BbbMeetingSample`
7. `BbbMeteredUsage` — **historical, retain per ADR-057 D8**
8. `BbbOrganizationMember` — owns `customerId` + `keycloakSub` → **migrate to Keycloak/TenantPlugin/PILOS**
9. `BbbScheduledSession`
10. `BbbRoom`
11. `BbbEnrollment` — legacy
12. `BbbProductAccess`
13. `BbbTrialRegistration`
14. `BbbInstructorAssignment`
15. `BbbWebhookEvent`
16. `SessionAttendance`
17. `BbbEntitlement`
18. `BbbOrganizationMembership` — internal staff
19. `BbbCapacityAlertLog`
20. `BbbPlatformCapacityPolicy`
21. `BbbSessionTemplate`
22. `CustomerDeletionLog` (shared — customer-deletion platform)
23. `EventLog` (shared — tracing platform)

BBB services (sample): `BbbOrganizationService`, `BbbMeetingService`, `BbbRoomService`, `BbbScheduledSessionService`, `BbbEntitlementService`, `BbbBillingService`, `BbbMeteringService`, `BbbWebhookProcessorService`, `BbbReconciliationService`, `BbbHooksService`, `GrantReaderService`, `CapacityIntelligenceService`, `BbbRoomAccessService` (INV-027 shared evaluator), `BbbProvisioningWorkerService`, etc.

BBB jobs: `bbbReconciliationTask`, `bbbCapacityAlertTask`, `bbbMeteringTask`, `bbbMeteringPruneTask`, `bbbDailyAllowanceTask`, `bbbServerHealthTask`, `bbbServerLoadTask`, `bbbHooksReconciliationTask`, `bbbWebhookRetentionTask`.

BBB controllers/resolvers: `BbbWebhookController`, `BbbAdminResolver`, `BbbShopResolver`.

BBB dashboard routes: billing, dashboard, enrollments, meetings, members, organizations, people, plans, rooms, servers, sessions (+ shared lib).


---

## 4. External dependency audit — direct imports vs. indirect dependencies

### 4.1 Direct TypeScript imports (inventoried)

These are the only production source files that directly import from `bigbluebutton-plugin`:

| # | File | Reference | Action needed |
|---|---|---|---|
| 1 | `src/vendure-config.ts:25,338` | `import { BigBlueButtonPlugin }` + `.init({...})` in plugins array | Replace registration in PR 7; no placeholder in PR 1 |
| 2 | `src/plugins/reviews/generated-shop-types.ts:1` | `export * from "../bigbluebutton-plugin/generated-shop-types"` | Re-export point; verify reviews does not consume BBB types beyond re-export |
| 3 | `src/plugins/reviews/generated-admin-types.ts:1` | `export * from "../bigbluebutton-plugin/generated-admin-types"` | Same as #2 |
| 4 | `src/plugins/subscription/services/subscription-shop.service.ts:155-158` | `hasMetadata(BbbOrganization)` check; degrades to zeroed live allowance when BBB not registered | Update to degrade gracefully after BBB removal; do not couple subscription shop API to BBB entity |
| 5 | `src/plugins/subscription/__tests__/subscription-shop.e2e-spec.ts:71,208` | `import { BigBlueButtonPlugin }` + plugins array | Test config updated when BBB removed |
| 6 | `src/plugins/subscription/__tests__/adr-046-self-serve.e2e-spec.ts:17,170` | `import { BigBlueButtonPlugin }` + plugins array | Same as #5 |
| 7 | `src/plugins/bigbluebutton-plugin/e2e/*` | Own e2e suites (TenantPlugin + BigBlueButtonPlugin) | Retire with plugin in PR 7 |

**Revised statement:** No additional direct production TypeScript imports of `bigbluebutton-plugin` were identified by the audit searches. Data-contract, schema, migration and operational dependencies are inventoried separately below. This does **not** imply the plugin is completely isolated.

### 4.2 Indirect / data-contract dependencies (dedicated table)

| Dependency type | What needs checking | Current state | PR 1 action |
|---|---|---|---|
| **Product custom fields** | `bbbSessionId` and `instructorProfileId` on `Product` | Defined in `vendure-config.ts` customFields `Product`; written by `BbbScheduledSessionService` for marketplace indexing of BBB sessions | Inventory only; consumers (LearningPlugin, MarketplaceIndexerPlugin) reviewed in PR 2–6; fields retained or migrated as part of BBB retirement |
| **Learning domain** | Product/session linkage and enrollment consumers | `LearningPlugin` retains BBB product/session linkage per architecture; `CourseScheduledSession` may query `BbbScheduledSession`; `CourseEnrollment` ties to tenant channel | Dedicated dependency table in PR 2; no BBB entity duplication |
| **Marketplace** | Indexing and use of BBB-related product/session metadata | `MarketplaceIndexerPlugin` indexes `saa9vi_marketplace_sessions` (public `BbbScheduledSession` listings) and `saa9vi_marketplace_instructors`; `MarketplaceCheckoutService` resolves BBB session → owning Channel | Inventory only; marketplace entitlement boundary clarified in section 8 below |
| **GraphQL** | Generated types, SDL, storefront operations, API snapshots | `src/gql/graphql-env.d.ts` (674 KB, generated, contains BBB types); BBB plugin ships `generated-admin-types.ts`/`generated-shop-types.ts`; reviews plugin re-exports BBB generated types | Regeneration required after BBB admin/shop schema removal (PR 7) |
| **Database** | All migrations, entity relations, indexes, historical table references | `src/migrations/1793082717736-fresh.ts` (initial schema incl. `bbb_*` tables); `1793265688264-add-bbb-server-load-fields.ts`; `1793511014520-add-reason-enrolled-to-bbb-enrollment.ts` | Historical BBB tables/rows retained per ADR-057 D8; PR 8 inspects every generated migration diff before any table retirement |
| **Platform services** | Shared evaluators, event logging, customer-deletion services | `CustomerDeletionLog` and `EventLog` registered through BBB plugin; `CustomerDeletionModule` shared; `BbbRoomAccessService` is INV-027 shared evaluator | Ownership of shared entities established before BBB removal (see section 7) |
| **Operations** | Environment variables, deployment files, scripts, monitoring | `BBB_*` env vars in `.env.example`; `vendure-config.ts` BBB plugin options; `docker-compose.yml`; scripts referencing BBB | Inventory only; env vars and config cleaned up in PR 7–8 |


---

## 5. Migrations touching BBB tables

Confirmed BBB-related migrations exist under `src/migrations/`:
- `1793265688264-add-bbb-server-load-fields.ts`
- `1793511014520-add-reason-enrolled-to-bbb-enrollment.ts`

The large `1793082717736-fresh.ts` (226 KB) is the initial/full schema and includes `bbb_organization`, `bbb_organization_member`, etc. Per ADR-057 D8 and this audit, **historical BBB tables/rows must not be dropped** in this transition.

**Historical retention rule (PR 1 decision):**
> Historical BBB tables and records must remain accessible for the agreed retention period. Removing an entity from Vendure plugin registration must not result in a migration that drops those tables. Any archival or schema retirement must be explicit and reviewed independently.

PR 8 should inspect every generated migration diff. Do not assume a generated migration automatically preserves historical tables.


---

## 6. GraphQL codegen

- `src/gql/graphql-env.d.ts` (674 KB) — generated, contains BBB types (`BbbOrganization`, `BbbOrganizationMember`, etc.)
- `codegen.ts` at repo root
- BBB plugin ships `generated-admin-types.ts` and `generated-shop-types.ts`
- Reviews plugin re-exports BBB generated types

Regeneration required after BBB admin/shop schema removal (PR 7).


---

## 7. Shared entity ownership + target ownership map (amendments C and D)

### 7.1 Shared entities — ownership established before BBB retirement

`CustomerDeletionLog` and `EventLog` are currently registered through `BigBlueButtonPlugin`'s `@VendurePlugin entities` array, but they are **platform-owned** entities, not BBB-owned:

| Entity | Current registration | Owner after BBB removal | PR 1 action |
|---|---|---|---|
| `CustomerDeletionLog` | BBB plugin entities list | Platform customer-deletion module (shared) | Verify registration persists through `CustomerDeletionModule` |
| `EventLog` | BBB plugin entities list | Platform tracing module (shared) | Verify registration persists through `PlatformTracingModule` |

These entities must not disappear merely because their current registration happens through the BBB plugin. Their ownership is confirmed in `vendure-config.ts` (`subscribers` array references `AdSpendLedgerImmutableSubscriber`, etc.) and in the platform module structure. PR 7 must re-register them if they are only reached through BBB plugin imports.

### 7.2 Target ownership map (from assessment + ADR-057 D1/D2)

| Current BBB responsibility | Target owner | Notes |
|---|---|---|
| BBB server management | PILOS | PILOS operates BBB infra |
| BBB API, meeting creation/joining | PILOS | — |
| BBB rooms/sessions | PILOS | — |
| BBB webhooks/reconciliation | PILOS | — |
| BBB attendance/recording lifecycle | PILOS | — |
| Attendee-hour/grant-minute billing | Retired | Fixed monthly subscription; no usage-based billing |
| `BbbOrganization.channelId` tenant mapping | TenantPlugin + Vendure Channel | Channel ID = stable tenant ref to PILOS |
| `BbbOrganizationMember.customerId` + `keycloakSub` | TenantPlugin / Keycloak / PILOS | Keycloak authenticates; Vendure owns commercial state |
| BBB enrollment/course access | LearningPlugin + commerce entitlement | As applicable |
| BBB product/session linkage | LearningPlugin + PILOS integration | Review consumers |
| BBB usage ledger | Historical records retained | No new meeting-based invoices |

### 7.3 No duplicate tenant identity (amendment C)

PR 2 must **not** introduce a second independent `Tenant` entity that duplicates the Channel identity. Ownership is:

| Data | Owner |
|---|---|
| Tenant identity | Vendure Channel |
| Seller relationship | Vendure Seller |
| Owner/moderator account | Vendure Administrator |
| Tenant-specific profile and settings | Existing TenantPlugin |
| Administrator-to-tenant membership | TenantPlugin, with channel-scoped relationship |
| Keycloak identity mapping | TenantPlugin or clearly owned identity component |
| Cross-system provisioning and synchronization | PilosAccessSyncPlugin |

For Keycloak identity, store the validated **issuer and subject pair (`iss` + `sub`)**, not just an email or an unqualified subject. If the person-one-tenant rule is retained, enforce it with a database uniqueness constraint.

The integration plugin coordinates provisioning; it does **not** become a second tenant or membership authority.


---

## 8. Subscription and marketplace entitlement boundary (amendment E)

The existing `OrganizationSubscription` (SubscriptionPlugin) represents **the tenant's subscription to Saa9vi** — one row per tenant (Channel = Tenant, INV-001), unique per Channel for non-cancelled rows. Key observations from the codebase:

- `OrganizationSubscription` is tied to `SubscriptionPlan` (platform-global catalogue of SaaS tiers).
- `SubscriptionBillingAttempt` is tied to `OrganizationSubscription`; it is **not** a generic learner billing ledger.
- `RazorpaySubscriptionProvider` obtains platform credentials from `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET`.
- `OrganizationSubscription.marketplaceGraceUntil` (ADR-042 §3) — set to `now() + MARKETPLACE_GRACE_PERIOD` when the subscription transitions to `past_due`; while set and in the future, a `past_due` subscription still satisfies INV-024 (marketplace listing entitlement during dunning grace).

**Boundary decision (PR 1, to be validated in PR 3):**

The existing `OrganizationSubscription` represents the **fixed monthly PILOS access subscription** (Flow A: tenant administrator → Saa9vi, platform credentials). It also carries `marketplaceGraceUntil`, which means it **touches** marketplace eligibility but does not **define** it. Marketplace listing eligibility is a separate entitlement concern (ADR-042).

**Do not accidentally change marketplace eligibility when changing PILOS access.** PILOS access and marketplace listing should not become indistinguishable merely because they share a billing record. Entitlements should be represented explicitly:
- PILOS access entitlement → synced to PILOS via `PilosAccessSyncPlugin` (tenant-level projection)
- Marketplace listing eligibility → evaluated separately (existing `marketplaceGraceUntil` + INV-024)

The single authoritative subscription lifecycle (`OrganizationSubscription`) is retained, but entitlements are explicitly distinguished rather than conflated.


---

## 9. Subscription & access flow (unchanged, retained)

1. Saa9vi provisions Seller + Channel for tenant
2. Tenant owner/moderators get Vendure Administrator accounts
3. Owner subscribes via platform Razorpay (SubscriptionPlugin)
4. Razorpay webhooks persisted + reconciled (SubscriptionPlugin)
5. Vendure determines effective subscription state
6. Outbox event → PILOS entitlement sync (PilosAccessSyncPlugin)
7. Keycloak users + tenant membership synchronized (PilosAccessSyncPlugin)
8. PILOS grants access only when valid tenant member + active entitlement (backend enforcement)
9. Expiry/suspension → PILOS blocks new protected operations; owner can still log in to Vendure and renew

Billing model: fixed monthly subscription. Meeting duration/attendance/attendee-hours do **not** influence price.

### PILOS entitlement contract (proposed — not yet implemented)

```json
{
  "tenant_ref": "vendure-channel-id",
  "status": "ACTIVE",
  "plan": "STARTER",
  "version": 12,
  "valid_until": "2026-12-27T00:00:00Z"
}
```

- Single tenant-level entitlement for all moderators
- PILOS checks both tenant entitlement AND individual membership
- Backend enforcement required — Keycloak role/login alone is insufficient

### Corrected implementation sequence (9 PRs)

| PR | Scope | Main result | Depends on |
|---|---|---|---|
| **PR 1** | **Architecture & dependency audit** | This document: dependency inventory, ownership map, migration plan, worklist | — |
| PR 2 | Tenant model | Tenant + moderator identity ownership into TenantPlugin; Channel as tenant key | PR 1 |
| PR 3 | Subscription adaptation | Adapt SubscriptionPlugin for fixed monthly PILOS access plan | PR 1 |
| PR 4 | Keycloak integration | Provision users, link identities, synchronize membership | PR 2 |
| PR 5 | PILOS entitlement API | Tenant-level entitlement projection + server-side enforcement (PILOS side) | PR 3 |
| PR 6 | Access synchronization | Transactional outbox, retry, reconciliation, dashboard status (PilosAccessSyncPlugin) | PR 4, PR 5 |
| PR 7 | BBB plugin retirement | Remove plugin registration, source, APIs, jobs, obsolete dependencies | PR 6 |
| PR 8 | Database migration & cleanup | Preserve historical records; safely retire obsolete schema via Vendure CLI migration | PR 7 |
| PR 9 | E2E & launch verification | Provision → subscribe → login → meeting → expiry → renewal | PR 8 |

**PR boundary rule:** PR 1 is documentation, audit, ADR alignment, and dependency inventory only. No BBB source, registration, migration, or table is deleted in PR 1. BBB removal occurs only in PR 7, after replacement functionality is validated (PR 6).


---

## 10. PR 1 acceptance checklist

**PR 1 review progress — 0/9**

| # | Checklist item | Status |
|---|---|---|
| 1 | ADR-057 is present and indexed on main | ✅ Done |
| 2 | Direct imports and indirect data/schema dependencies are distinguished | ✅ Done (§4) |
| 3 | Product custom fields and LearningPlugin/MarketplaceIndexer consumers are inventoried | ✅ Done (§4.2) |
| 4 | Shared `CustomerDeletionLog` and `EventLog` ownership is established | ✅ Done (§7.1) |
| 5 | Every BBB-related migration and persisted table is inventoried | ✅ Done (§5) |
| 6 | Channel = tenant remains the only tenant identity | ✅ Done (§7.3) |
| 7 | Subscription and marketplace entitlement boundaries are documented | ✅ Done (§8) |
| 8 | No BBB source, registration, migration or table is deleted in PR 1 | ✅ By design |
| 9 | PR 2 has a clear entity and ownership design with no duplicate tenant model | ⬜ Ready (see below) |

### PR 2 scope definition (narrowly scoped)

Once PR 1 is accepted, PR 2 should be narrowly scoped to **tenant and moderator identity ownership**, not the complete Keycloak/PILOS integration. Its expected result:

1. One Channel represents one tenant.
2. One Seller is associated with that Channel.
3. The owner and moderators have individual Vendure Administrator accounts.
4. TenantPlugin owns the tenant-scoped membership relationship.
5. Membership records link the Vendure Administrator to the tenant and support validated Keycloak identity mapping.
6. Owner/moderator permissions are channel-scoped.
7. Adding and removing moderators does not require direct, unrestricted Administrator creation permissions.
8. Isolation and uniqueness tests prove a person cannot accidentally be assigned to multiple tenants under the one-person-one-tenant policy.

Keycloak provisioning and PILOS synchronization should remain in the later PRs (PR 4 and PR 6).

### Immediate next steps (PR 1 execution)

1. **Review this audit** with stakeholders; confirm the ownership map and external-consumer list.
2. **Create PR 1 branch** from `main` (do not checkout `saa9vi_com` — it is a reference branch only).
3. **ADR-057 and platform-adr.md indexing** are already complete on `main` as part of this PR 1 change set.
4. **Do not** delete `BigBlueButtonPlugin` source, migrations, or tables in PR 1.
5. Once PR 1 is approved, proceed to PR 2 (Tenant model).

---

## Appendix: commands used for verification

```bash
git fetch origin
git rev-parse --verify origin/saa9vi_com        # 00afae148de12734512e145853662047a7132589
git show origin/saa9vi_com:docs/adr/adr-057-pilos-keycloak-monthly-subscription-gating.md
diff <(git show origin/saa9vi_com:docs/adr/adr-057-...) docs/adr/adr-057-...   # verify main copy
ls src/plugins/                                       # all 6 plugins present
cat src/plugins/bigbluebutton-plugin/entities/bbb-organization.entity.ts       # channelId:23
cat src/plugins/bigbluebutton-plugin/entities/bbb-organization-member.entity.ts # customerId:38, keycloakSub:60
ls src/plugins/subscription/entities/                  # 6 entities confirmed
ls src/plugins/subscription/providers/razorpay/        # provider, verifier, processor confirmed
search_codebase("PilosAccessSync")                      # not found
search_codebase("bigbluebutton-plugin")                 # external consumers listed above
```
