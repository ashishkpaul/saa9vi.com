# Known Bugs

> **Purpose:** Track all confirmed bugs. Updated as bugs are found and fixed. When a bug is fixed, move it to release-notes.md.

---

## Active Bugs

| ID | Severity | File | Description | Status |
|---|---|---|---|---|
| BUG-017 | Medium | ReviewsPlugin entities | `ProductReview`, `ReviewRequest`, `ReviewReport`, `ReviewReward`, `ReviewVote` do not implement `ChannelAware` — channel isolation relies solely on explicit `ctx.channelId` WHERE clauses in services; ORM provides no guard against missed query paths. Fixed by adding `ChannelAware` (channels[] + channelId) to all 5 entities. | ✅ Fixed |
| BUG-022 | P0 | `bbb-shop.resolver.ts` | `bbbRoomStatus`, `myBbbRooms`, and `myBbbEnrollments` read from `BbbEnrollment` only, while `BbbOrderFulfillmentListener` writes `BbbEntitlement` for room purchases. A paying customer's room never appears in their dashboard and `bbbRoomStatus` throws `ForbiddenError`, even though `bbbJoinRoom` would work. Fixed by also reading from `BbbEntitlement` in all three methods. | ✅ Fixed |
| BUG-023 | P1 | `marketplace-indexer.service.ts` | `academySlug` hardcoded to `''`, `channelToken` set to raw `channelId` instead of `Channel.token`, `customDomain` not indexed. Marketplace search results have no usable redirect URL. Fixed by resolving `Channel.token` and `BbbOrganization.slug` in both session and instructor indexing. | ✅ Fixed |
| BUG-024 | P2 | `TenantRegistrationService` | `ShippingMethod`/`StockLocation`/`PaymentMethod` not auto-provisioned for new channels. A freshly registered tenant has zero working payment methods and shipping configurations. Fixed by adding `autoProvisionChannelResources()` that assigns default channel's methods/locations to the new channel. | ✅ Fixed |
| BUG-025 | Medium | `tenant-admin.resolver.ts` | Vendure's built-in `roles` query is implicitly channel-scoped — it only returns roles whose `channels[]` includes the active channel. Tenant-created roles (scoped to only their tenant channel) are invisible to a SuperAdmin operating on the Default channel, breaking role-name resolution in the dashboard (a role shows as a bare numeric id). Fixed by overriding `roles` in `TenantAdminResolver` (SuperAdmin sees all, tenant admin channel-scoped). | ✅ Fixed |
| BUG-027 | P1 | `product-review-shop.resolver.ts` | `pendingReviewRequests` accesses `options.take`/`options.skip` on `undefined`. The schema declares `pendingReviewRequests(options: ProductReviewListOptions)` — `options` is optional — and the storefront `/account/reviews` page passes none. The GraphQL layer throws `TypeError: Cannot read properties of undefined (reading 'take')` at `query()` in `api.ts:136`, so `/account/reviews` crashes for any logged-in customer. Fixed by forwarding `options?.take`/`options?.skip`; the service already defaults take→10, skip→0. | ✅ Fixed |
| INV-008 | P1 | `src/lib/vendure/session-cta.ts` | `getSessionCta()` is a client-side entitlement isolation layer that should live server-side as `courseAccess(courseId)`. Currently contains business logic (joinUrl precedence, trial eligibility, registration status) that violates entitlement-only access invariant. Documented exception pending server-side `courseAccess` query. Once shipped, this file should be deleted and replaced with server-driven `ctaAction`/`ctaLabel` fields. | 🔲 Active |

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
| BUG-018 | Medium | `BbbShopResolver.joinRoom()` — moderator role-routing has no trigger path | ✅ Fixed |
| BUG-019 | High | `LoadSimulationPlugin` — `runLoadTest` exposed on public Shop API (DoS vector) | ✅ Fixed |
| BUG-020 | Medium | `CausalMapper` — references non-existent `simulateBbbWebhook` resolver | ✅ Fixed |
| BUG-021 | High | `TenantProfileService.create()` — `channelOrToken` passed as raw Channel entity instead of `channel.token` string | ✅ Fixed |
