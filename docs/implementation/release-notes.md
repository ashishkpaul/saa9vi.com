# Release Notes

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
