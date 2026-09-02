# Known Bugs

> **Purpose:** Track all confirmed bugs. Updated as bugs are found and fixed. When a bug is fixed, move it to release-notes.md.

---

## Active Bugs

| ID | Severity | File | Description | Status |
|---|---|---|---|---|
| _None_ | — | — | No active bugs. All confirmed bugs are fixed (see Fixed Bugs below). | — |

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
| BUG-031 | Critical | `src/plugins/cms/services/{page,banner,article}.service.ts` + `article.entity.ts` — CmsPlugin used Vendure's `assignToCurrentChannel()` which assigns an entity to the current channel AND the default channel, leaking tenant-created CMS content onto `__default_channel__` so it was visible to other tenants. Fixed by adding `CmsChannelAssignmentPolicy` (ADR-036): SuperAdmin → default channel only, Tenant Admin → tenant channel only (never default). Replaced `assignToCurrentChannel()` in `PageService`/`BannerService`/`ArticleService.create()`. Replaced non-working `ListQueryBuilder` channelId option in `findAll()` with explicit inner join on the `channels` relation. E2E: 44/44 pass, including new tests verifying tenant CMS isolation and platform CMS preservation. | ✅ Fixed |
| BUG-032 | Medium | `BbbSubscriptionListener` — not idempotent, writes multiple `BbbCapacityGrant` rows for the same billing period start. Fixed by adding existence check (`validFrom` + `sourceType: "subscription"`) before save. | ✅ Fixed |
| BUG-033 | High | e2e harness — admin login as a **tenant-channel** administrator fails in the isolated-e2e environment with `Cannot return null for non-nullable field CurrentUser.id` (the login mutation itself returns a null CurrentUser). Pre-existing: reproduced identically at commit `87ee596` via clean worktree. SuperAdmin logins (default channel) succeed; every tenant-channel login fails. Blocks 9 tenant-plugin e2e tests (INV-016 permission tests, CMS isolation, media ownership — all previously recorded as passing) **and** the marketplace Gate 1.5 suite (`marketplace.e2e-spec.ts`), which is committed and infrastructure-complete but cannot execute until this is fixed. Likely same root cause as the previously documented "Flow A e2e harness" blocker. Suspected area: channel-context session/user resolution on non-default channels during login (vendure upgrade or test-server auth-token/cookie handling). | ⚠️ Open — blocks marketplace Gate 1.5 execution |
| INV-008 | P1 | `src/lib/vendure/session-cta.ts` (deleted) + `learning-dashboard.service.ts` — `getSessionCta()` was a client-side entitlement isolation layer containing business logic (joinUrl precedence, trial eligibility, registration status) that violated the entitlement-only access invariant. Fixed by moving the CTA decision server-side: `LearningCourse` now carries server-driven `ctaAction`/`ctaLabel` computed in `LearningDashboardService.getDashboard()`. `course-card.tsx` renders these fields instead of re-deriving eligibility from the clock. `session-cta.ts` deleted. | ✅ Fixed |
