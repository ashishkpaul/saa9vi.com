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
| BUG-033 | High | e2e harness — admin login as a **tenant-channel** administrator failed with `Cannot return null for non-nullable field CurrentUser.id` (the login mutation returned a null CurrentUser). **Root cause found & fixed:** NOT channel resolution (as originally suspected) — `registerNewTenant` creates admins with `user.verified=false`, and `@vendure/testing`'s `testConfig` defaults `authOptions.requireVerification=true`, so Vendure returns a `NotVerified`/null CurrentUser for tenant-channel logins. SuperAdmin logins succeed only because seed users are pre-verified. **Fix:** `requireVerification:false` added to the e2e harness config in the marketplace spec (already present) and the **tenant-plugin + customer-deletion specs** (this change). Verified: marketplace Gate 1.5 suite **7/7 pass**; tenant-plugin suite **45/45 pass** (the 9 previously-blocked INV-016/CMS-isolation tests now run, exposing one real INV-016 gap fixed in `TenantAdminResolver` — SuperAdmin account leaked into tenant admin lists because Vendure's SuperAdmin role carries ALL channels; excluded via `SUPER_ADMIN_ROLE_CODE`). | ✅ Fixed |
| BUG-034 | High | `src/plugins/marketplace/e2e/commission.e2e-spec.ts` line 118 — `SetAddress` mutation declared with non-existent input type `CreateAddressInput!` (the correct type is `AddressInput`). The typo was introduced during a refactor of the test fixture and caused every test exercising the `setOrderAddress` helper to fail at GraphQL validation time, blocking 6 commission E2E cases. **Root cause:** the original fixture used `AddressInput`, but a later edit renamed the import without updating the mutation document. **Fix:** corrected the mutation to `mutation SetAddress($input: AddressInput!)`. Verified: commission E2E **6/6 pass** (positive, $0-row, INV-008 forge, replay, no-ref, single-use ref). | ✅ Fixed |
| BUG-035 | High | `src/plugins/marketplace/e2e/commission.e2e-spec.ts` line 261 — the order-hydration query after `setOrderAddress` fetched the order without `relations: ['lines', 'surcharges']`, so `Order.lines` was empty. The INV-008 forged-reference test (`$0-row`) asserts that a forged `marketplaceRef` on an order with no matching resource lines is rejected; with an empty `lines` array the assertion `order.lines.some(l => l.productVariant.id === resourceVariantId)` always returned `false`, making the test pass for the wrong reason on a green-field DB but fail on any DB where real order lines existed from prior runs. **Root cause:** the hydration step was copied from a simpler fixture that didn't need line-level access and the relations array was never extended. **Fix:** added `relations: ['lines', 'surcharges']` to the order-hydration query. Verified: commission E2E **6/6 pass**, including the INV-008 forge case now correctly exercising the line-matching path. | ✅ Fixed |
| INV-008 | P1 | `src/lib/vendure/session-cta.ts` (deleted) + `learning-dashboard.service.ts` — `getSessionCta()` was a client-side entitlement isolation layer containing business logic (joinUrl precedence, trial eligibility, registration status) that violated the entitlement-only access invariant. Fixed by moving the CTA decision server-side: `LearningCourse` now carries server-driven `ctaAction`/`ctaLabel` computed in `LearningDashboardService.getDashboard()`. `course-card.tsx` renders these fields instead of re-deriving eligibility from the clock. `session-cta.ts` deleted. | ✅ Fixed |
