# System Architecture & User Flows: Saa9vi Academy Platform

> **v4 — Updated:** Section 11 (Wallet & Capacity Intelligence) updated to reflect ADR v1.6 Capacity Intelligence System (§6A). CTA logic note in Section 3 corrected to reflect current code reality vs. ADR target. References updated to ADR v1.6 / RFC-001 v3.

---

## 1. Academy Setup

### A new Vendure Channel is created

* **Actor:** Platform admin
* **Description:** Platform admin creates a channel for "Mehta Coaching" on the Saa9vi backend. This Channel is the tenant — every entity the academy owns will be scoped to this channel ID from this moment forward.
* **System/Code Detail:** `TenantProfileService.create() → channelService.assignToCurrentChannel()`

### TenantProfile is initialised

* **Actor:** Platform admin
* **Description:** Name, logo, custom domain (`mehta.saa9vi.com`), and branding are saved. The `TenantProfile` carries a 1:1 FK to the channel ID — there is no separate tenant table.
* **System/Code Detail:** > `TenantProfile { channelId, name, logo, customDomain }`

### BbbOrganization is provisioned

* **Actor:** Platform admin
* **Description:** The BBB organization record is created and linked to the channel. It holds the `concurrentMeetingLimit` and `maxParticipantsPerMeeting` caps that govern every live class.
* **System/Code Detail:** `BbbOrganization` implements `ChannelAware` — channelId unique index enforces 1 org per channel.

### A capacity grant is issued

* **Actor:** Platform admin
* **Description:** Admin creates a `BbbCapacityGrant` of e.g., 3,000 minutes (50 hours). This is the billing unit — a prepaid block. The grant carries `validFrom` and `validUntil`. When provisioning starts, the earliest-expiring non-exhausted grant is consumed first.
* **System/Code Detail:** > `BbbCapacityGrant { grantedMinutes: 3000, consumedMinutes: 0, exhausted: false }`

---

## 2. Trainer Sets Up Content

### Instructor profiles are created

* **Actor:** Trainer
* **Description:** The trainer (or admin on behalf of the academy) creates `InstructorProfile` records — name, bio, photo, public slug. These are not `ChannelAware` entities; all queries carry an explicit `WHERE channelId = :channelId` guard instead.
* **System/Code Detail:** `InstructorProfileService` — explicit channelId filter on every query (DL-010).

### CMS pages and articles are authored

* **Actor:** Trainer
* **Description:** The trainer creates the academy home page, course detail pages, and blog articles through the Admin UI. Each entity is assigned to the current channel via `assignToCurrentChannel`. Slugs are unique per channel, not globally.
* **System/Code Detail:** `Article`, `Page`, `Banner` — all `ChannelAware` with composite (channelId, slug) unique index.

### Banners are scheduled

* **Actor:** Trainer
* **Description:** A "New batch starting Jan 10" banner is created with a `startsAt` and `endsAt` date, placement set to HERO, and `isActive = true`. The storefront queries `findActiveForPlacement()` which filters by channel, isActive, and the current timestamp — no precomputed flag yet.
* **System/Code Detail:** `BannerService.findActiveForPlacement()` — date filter at query time (CMS-002 pending).

### A BBB room is created

* **Actor:** Trainer
* **Description:** The trainer creates a standing room for their "Daily doubt clearing" slot. The room starts in Idle state. It has no meeting yet — meetings are provisioned on demand when the first person tries to join.
* **System/Code Detail:** > `BbbRoom { state: Idle, currentMeetingId: null, version: 1 }`

### A scheduled session is set up and priced

* **Actor:** Trainer
* **Description:** The trainer creates a `BbbScheduledSession` — "React Masterclass, Jan 15, 10am–12pm, ₹499". A Vendure `ProductVariant` is linked to this session. Students will purchase this variant to get a `bbb_session` entitlement.
* **System/Code Detail:** `BbbScheduledSession.productVariantId → ProductVariant` (the commercial bridge).

---

## 3. Student Discovers and Buys

### Student lands on mehta.saa9vi.com

* **Actor:** Student
* **Description:** Next.js middleware resolves the hostname to the channel token (looked up from Redis, populated from `TenantProfile.customDomain`). All subsequent GraphQL requests carry this channel token — the storefront is shared code, the channel token is what makes it belong to this academy.
* **System/Code Detail:** `hostname → channelToken` via Redis → `RequestContext.channelId` throughout.

### Storefront renders the academy homepage

* **Actor:** Student
* **Description:** Next.js calls `tenantProfile()` to get the name and logo, `cmsBanners(placement: HERO)` for the banner, `cmsPage(slug: "home")` for the body sections, and `instructorProfiles()` for the team row. All four queries are channel-scoped automatically.
* **System/Code Detail:** `TenantShopResolver` + `CmsShopResolver` — all `@Allow(Permission.Public)`.

### Student views the React Masterclass session page

* **Actor:** Student
* **Description:** The page shows the session date, time, price, capacity, and the instructor card. The CTA is determined by Vendure — has the student already purchased? Is there a trial available? The storefront renders whichever CTA Vendure returns.
* **System/Code Detail:** Shop API: `bbbScheduledSession(id)` — storefront is a renderer, not a decision-maker (INV-008).
* **Current code reality:** The unified `courseAccess(courseId)` resolver that returns `{ canJoin, joinUrl, ctaLabel, ctaAction }` is the ADR target (INV-008) but is not yet implemented. The current Shop API exposes `myScheduledSessions` and `bbbRoomStatus` as separate raw entity queries — the Next.js storefront currently stitches the CTA from these. This is the one area where the storefront is temporarily doing logic it should not. The `courseAccess` resolver is a Phase 1.5 deliverable (ADR §13 implementation checklist).

### Student adds session to cart and checks out

* **Actor:** Student
* **Description:** Standard Vendure checkout. `ProductVariant` ID is the link between cart and the BBB session. Payment is processed via Juspay. When the order reaches `PaymentSettled` state, the EventBus fires.
* **System/Code Detail:** `OrderStateTransitionEvent { toState: PaymentSettled }`

### BbbOrderFulfillmentListener creates an entitlement

* **Actor:** System
* **Description:** The listener catches `PaymentSettled`. It looks up whether the purchased `ProductVariant` maps to a `BbbScheduledSession`. It does — so it calls `entitlementService.create({ type: "bbb_session", resourceId: session.id, customerId, source: "purchase", validUntil: session.endTime })`.
* **System/Code Detail:** > `BbbEntitlement { type: bbb_session, source: purchase }` — idempotent `create()`

### ReviewRequestService schedules a review prompt

* **Actor:** System
* **Description:** On the same `PaymentSettled` event, `ReviewRequestListener` fires. It creates a `ReviewRequest` scheduled 5 days after delivery, expiring after 60 days. A unique `reviewToken` is generated for the email link.
* **System/Code Detail:** > `ReviewRequest { status: scheduled, scheduledAt: +5d, expiresAt: +60d, reviewToken: hex }`

---

## 4. Trial Class Path (Alternative)

### Student registers for a free trial session

* **Actor:** Student
* **Description:** A different student clicks "Join free trial" on the same session page. They are authenticated and call `registerForTrial()`. The system checks `session.isTrial = true`, verifies capacity against `maxAttendees`, and creates a `BbbTrialRegistration`.
* **System/Code Detail:** `TrialRegistrationService.register()` — capacity guard + `BbbTrialRegistration { status: REGISTERED }`

### Trial entitlement is created immediately

* **Actor:** System
* **Description:** `register()` also calls `entitlementService.create({ type: "bbb_session", source: "trial", validUntil: session.endTime })` — the same entitlement type as a purchase. `getJoinUrl()` cannot tell the difference at join time; access is access.
* **System/Code Detail:** `BbbEntitlement { source: trial }` — non-fatal if creation fails (registration still recorded).

---

## 5. Live Class Day

### Trainer activates the session

* **Actor:** Trainer
* **Description:** 10 minutes before class, the trainer clicks "Start session" in the Admin UI. This calls `activateSession()` on `BbbScheduledSession`, marking it `status: LIVE` and linking it to the standing room or creating a one-off meeting.
* **System/Code Detail:** `BbbScheduledSession.status = LIVE`, activeMeeting relation populated.

### Student clicks "Join class"

* **Actor:** Student
* **Description:** The storefront calls `joinRoom(roomId, participantName, customerId)`. The system first checks if the student is an org member (staff). If not, it checks for a valid `bbb_room` entitlement. If not, it checks for a valid `bbb_session` entitlement on the linked session. Access granted.
* **System/Code Detail:** `BbbMeetingService.joinRoom() → entitlementService.hasAccess(ctx, customerId, "bbb_room", roomId)`

### Room provisioning — the lock dance

* **Actor:** System
* **Description:** `requestProvisioning()` acquires a distributed lock on the room ID. If the room is Idle, it transitions to Provisioning, sets `lastProvisionRequestedAt`, and returns `shouldEnqueue: true`. A BullMQ job is enqueued.
* **System/Code Detail:** `_doRequestProvisioning()` — `pessimistic_write` lock, debounce on non-Active rooms.

### BullMQ worker provisions the meeting on BBB

* **Actor:** System
* **Description:** `doProvisionMeeting()` selects the healthiest BBB server (lowest `currentLoad`). It resolves the earliest-expiring valid capacity grant and stores `grant.id` on the meeting — immutable billing linkage. It calls `bbbApiService.createMeeting()`, encrypts attendee and moderator passwords with AES-256-GCM, and transitions the meeting to Active.
* **System/Code Detail:** `BbbServer.currentLoad ASC → createMeeting API → encryptionService.encrypt() → meeting.state = Active`

### Student gets their join URL

* **Actor:** Student
* **Description:** The room is now Active. `getJoinUrl()` (or `joinRoom()`) resolves the encrypted password, calls `buildJoinUrl()` which constructs a signed BBB join URL — no network call to BBB, just HMAC-signed query params. The student's browser navigates to the URL.
* **System/Code Detail:** `bbbApiService.buildJoinUrl()` — signed URL, browser navigates directly to BBB HTML5 client.

### Runtime validation keeps the room honest

* **Actor:** System
* **Description:** Every join attempt on an Active room checks `lastRuntimeValidatedAt`. If the TTL has passed, it calls `isMeetingRunning()` on the BBB server. If BBB says the meeting is gone, the room is reset and reprovisioned — the student gets a new URL on next poll.
* **System/Code Detail:** `validateRuntimeMeeting()` — TTL cache guards `isMeetingRunning()` call frequency.

---

## 6. Session Ends — Billing & Records

### BBB fires a meeting-ended webhook

* **Actor:** System
* **Description:** BBB POSTs to `/bbb/webhook`. `BbbWebhookController` validates the HMAC signature, persists a `BbbWebhookEvent { status: PENDING }`, and enqueues the event ID to BullMQ. It returns `{ ok: true }` immediately — no processing in the HTTP handler.
* **System/Code Detail:** INV-004: persist-before-process — webhook never lost, always replayable.

### BullMQ processor handles the webhook

* **Actor:** System
* **Description:** `BbbWebhookProcessorService` loads the event by ID and calls `meetingService.handleWebhookEvent()`. The meeting-ended handler calls `completeMeetingLifecycle()` — transitions meeting to Completed, resets the room to Idle, and triggers billing.
* **System/Code Detail:** `BbbWebhookEvent.status: PENDING → PROCESSED` (or FAILED for retry).

### Billing ledger is written — immutably

* **Actor:** System
* **Description:** `consumeGrantHours()` calculates duration from `provisionedAt` to `completedAt`, rounds up to the nearest minute (min 1), and writes an append-only `BbbUsageLedger` row. It atomically increments `BbbCapacityGrant.consumedMinutes`. No row is ever updated.
* **System/Code Detail:** > `BbbUsageLedger { consumedMinutes, startedAt, completedAt }` — `grant.consumedMinutes += N` in same transaction (INV-002).

### Trial attendance is recorded from webhook payload

* **Actor:** System
* **Description:** `handleWebhookEvent()` also calls `updateTrialAttendanceForMeeting()`. It extracts attendee customer IDs from the BBB webhook payload, matches them against `BbbTrialRegistration` rows for the session, and marks each as ATTENDED or NO_SHOW.
* **System/Code Detail:** `BbbTrialRegistration { status: ATTENDED | NO_SHOW, attendedAt }` — `session.status = FINISHED`.

### Reconciliation runs every minute in the background

* **Actor:** System
* **Description:** `BbbReconciliationService` has three loops:
  1. `reconcileActiveMeetings` — checks BBB `getMeetingInfo` for every Active meeting; marks stale if BBB has no record.
  2. `reconcileProvisioning` — resets or fails meetings stuck in Provisioning past timeout.
  3. `reconcileRooms` — fixes room/meeting state drift.
* **System/Code Detail:** Scheduled task — grace period guards + billing ceiling (`maxMeetingDurationMs`) + `CapacityExhaustedEvent`.

---

## 7. Post-class — Reviews & Conversion

### Review request email fires 5 days later

* **Actor:** System
* **Description:** `ReviewRequestService` finds scheduled `ReviewRequest` rows where `scheduledAt <= now` and `status = scheduled`. It calls `reviewEmailService` to send the email with the unique token link. Status transitions to sent.
* **System/Code Detail:** `ReviewRequest.status: scheduled → sent` — reviewToken in email link.

### Student submits a review via email link

* **Actor:** Student
* **Description:** Student clicks the link, lands on `/review/submit?token=...` The token is validated by `validateToken()`. The student fills in a 1–5 star rating and review body. `createReview()` checks they are authenticated, verifies purchase eligibility (orderLines in eligible states), and saves the review as `state: new`.
* **System/Code Detail:** `ProductReviewService.createReview() → eligibility check → ReviewCreatedEvent fired`.

### Anti-fraud analysis runs immediately on creation

* **Actor:** System
* **Description:** `ReviewEventListener` catches `ReviewCreatedEvent` and runs `reviewAntiFraudService.analyzeReview()`. Five checks: review velocity (5+ in 7 days = +25 risk), duplicate content (>80% similarity = +30), new account (<7 days old = +20), suspicious rating pattern (+15), and unverified purchase (+10). Score ≥ 50 auto-flags the review.
* **System/Code Detail:** `riskScore >= 50 → productReviewService.flagReview() → state: flagged`.

### Trainer moderates the review queue

* **Actor:** Platform admin
* **Description:** In the Reviews dashboard, the trainer sees reviews in `state: new` and `state: flagged`. They approve clean reviews — `recalculate()` fires, updating the product's cached `reviewRating` and `reviewCount` custom fields. Rejected reviews trigger a recalculation only if they were previously approved.
* **System/Code Detail:** `approveReview() → recalculateProductRating() → Product.customFields.reviewRating` updated.

### Approved review appears on the session page

* **Actor:** Student
* **Description:** The storefront queries `productReviews(productId)` filtering `state = approved`. The product card shows the cached star rating from `customFields.reviewRating` — a single float kept fresh by the aggregation service on every approve/reject/hide.
* **System/Code Detail:** > `Product.customFields { reviewRating: 4.6, reviewCount: 23 }` — denormalised cache, always authoritative from rows.

---

## 8. Trial Conversion Path

### Admin converts a trial attendee to full access

* **Actor:** Platform admin
* **Description:** In the Trial Registrations dashboard, the admin selects a student with status ATTENDED. They click "Convert to enrolled" and pick a room and optional access duration. `convertToEnrollment()` verifies `status = ATTENDED`, then calls `entitlementService.create({ type: "bbb_room", source: "trial_conversion", validUntil: expiresAt })`.
* **System/Code Detail:** > `BbbEntitlement { type: bbb_room, source: trial_conversion }` — channel from `session.channelId`.

### Student can now join the standing room indefinitely

* **Actor:** Student
* **Description:** On their next visit, `joinRoom()` finds a valid `bbb_room` entitlement for the room. Access is granted. The old `BbbEnrollment` table is untouched — it exists only as an audit trail. The entitlement is the sole gate.
* **System/Code Detail:** `entitlementService.hasAccess(ctx, customerId, "bbb_room", roomId) → true`

Here is what the full story covers, from the code up:

---

## How the platform actually works

The story has six chapters, each showing what fires in the background when a person takes an action.

**Chapter 1 — Academy setup.** Everything starts with a Vendure `Channel`. That channel IS the tenant. `TenantProfileService.create()` stamps the branding, `BbbOrganization` is created with the channel's `channelId` as a unique index, and a `BbbCapacityGrant` is issued with a fixed minute budget. From this moment, every query in the system automatically filters by `ctx.channelId` — no explicit tenant-ID logic anywhere.

**Chapter 2 — Content.** The trainer authors CMS pages, banners, and instructor profiles through the Admin UI. `assignToCurrentChannel()` is called on every creation. Slugs are unique per channel, not globally — two academies can both have a `/about` page. The BBB room and scheduled session are also created here. The session's `productVariantId` field is the commercial bridge — it's how checkout eventually connects to live class access.

**Chapter 3 — Discovery and purchase.** A student lands on `mehta.saa9vi.com`. Next.js middleware resolves the hostname to a channel token from Redis. Every GraphQL call from that point on carries that channel, and Vendure filters all results to that academy invisibly. When the student buys the React Masterclass, the order reaches `PaymentSettled`. `BbbOrderFulfillmentListener` catches the `OrderStateTransitionEvent`, looks up the `BbbScheduledSession` by `productVariantId`, and calls `entitlementService.create({ type: "bbb_session", source: "purchase" })`. In the same event, `ReviewRequestListener` creates a `ReviewRequest` scheduled to email the student in 5 days with a unique token link.

**Chapter 4 — The live class.** When the student clicks "Join class", `joinRoom()` runs a three-path auth check: org membership (moderator/trainer), then `bbb_room` entitlement, then `bbb_session` entitlement via the session linked to the active meeting. If granted, `requestProvisioning()` acquires a distributed lock, transitions the room from Idle to Provisioning, and enqueues a BullMQ job. The worker selects the BBB server with the lowest `currentLoad`, resolves the earliest-expiring capacity grant, calls the BBB `createMeeting` API, encrypts both passwords with AES-256-GCM, and writes the `grantId` to the meeting — immutably. The student gets a HMAC-signed join URL built client-side from the decrypted password; no second BBB call needed.

**Chapter 5 — Session end and billing.** BBB fires a `meeting-ended` webhook. The controller validates the HMAC, persists a `BbbWebhookEvent { status: PENDING }`, enqueues the ID, and returns immediately. The BullMQ worker loads the event and calls `completeMeetingLifecycle()`. Duration is calculated from `provisionedAt` to `completedAt`, rounded up to the nearest minute. A `BbbUsageLedger` row is inserted (never updated, never deleted — INV-002) and `consumedMinutes` on the grant is atomically incremented. In the same handler, trial attendee status is updated from the webhook's attendee list — ATTENDED or NO_SHOW, per registration. Separately, `BbbReconciliationService` runs on a schedule to catch anything the webhook missed: stale Active meetings, stuck Provisioning rooms, capacity ceiling breaches.

**Chapter 6 — Reviews and conversion.** Five days after purchase, the review email fires. The student clicks the token link, submits a review, and `ReviewCreatedEvent` fires. `ReviewAntiFraudService` immediately runs five checks — velocity, duplicate content similarity (Levenshtein), account age, rating pattern, unverified purchase — producing a risk score. Score ≥ 50 auto-flags the review for the trainer. When the trainer approves it, `reviewAggregationService.recalculateForProduct()` recomputes the channel's average rating and updates `Product.customFields.reviewRating` — the single float the storefront renders on the session card. For trial students who attended the session, the admin converts them to full room access with one click: `convertToEnrollment()` creates a `bbb_room` entitlement. The student can now join the standing room on any future date.

The thing to notice across all of this: the storefront makes zero decisions. It asks Vendure what the CTA should be, which banners are active, whether a student has access. Logic changes — a new entitlement type, a new trial rule, a new billing tier — happen in one place in the backend and take effect for all 500 academies on the next deployment.

---

## 9. Archetype B: Internal Staff Meeting

*This flow shows what happens when a staff member (not a student) joins an internal BBB room that has no product listing and bypasses the commerce loop entirely.*

### Staff member authenticates via the Shop API

* **Actor:** Staff Member
* **Description:** The staff member navigates to the academy's Next.js storefront and logs into the internal team portal. The Admin API is not exposed publicly. Authentication happens via the public Shop API — the Next.js storefront decodes the session token, detects the `OrgAdmin` or `Moderator` role from the staff member's `BbbOrganizationMembership`, and renders the internal dashboard instead of the student view.
* **System/Code Detail:** Shop API auth + `BbbOrganizationMembership.role` check (FEAT-001 — pending implementation, see §8A).

### Staff selects an internal room with no product listing

* **Actor:** Staff Member
* **Description:** The staff member selects "Engineering Weekly Sync" — a `BbbRoom` with `productVariantId = null`. This room does not exist in the Vendure product catalogue. It cannot be added to a cart. The storefront fires `joinRoom(roomId)`.
* **System/Code Detail:** `BbbRoom.productVariantId = null` — commerce bypass is structurally enforced. No code change required (✅ already works).

### Auth waterfall short-circuits on org membership

* **Actor:** System
* **Description:** `joinRoom()` resolver runs the waterfall. Gate 1: is this `customerId` an active member of the `BbbOrganization` owning this room? `BbbMembershipService.findActiveMembership()` returns a match with `role: 'moderator'`. Access granted. The entitlement check (Gate 2) is never reached.
* **System/Code Detail:** FEAT-001 required. Without `BbbOrganizationMembership`, the waterfall falls through to Gate 2 and denies the staff member. See §8A OP-001.

### Lock dance and provisioning — identical to commercial flow

* **Actor:** System
* **Description:** `BbbRoomLockService` acquires a Redis distributed lock on the `roomId`. The room transitions from Idle to Provisioning. A BullMQ worker selects the BBB server with the lowest `currentLoad` and calls `createMeeting`.
* **System/Code Detail:** Identical to §5 commercial flow. No changes needed (✅).

### Staff joins as moderator

* **Actor:** System
* **Description:** Because `membership.role = 'moderator'`, `buildJoinUrl()` uses the decrypted moderator password (AES-256-GCM). The staff member's browser receives a HMAC-signed URL granting full moderator controls — screen sharing, recording, whiteboard.
* **System/Code Detail:** FEAT-001 required for role-routing. `buildJoinUrl()` itself already supports moderator path (✅). See §8A OP-002 and BUG-018.

### Internal consumption written to overhead grant

* **Actor:** System
* **Description:** The BBB `meeting-ended` webhook follows the same persist-first pipeline (INV-004). Duration is calculated and written to `BbbUsageLedger` — append-only, always. Because there is no student `OrderLine`, the ledger row debits against the academy's `internal_overhead` `BbbCapacityGrant` (`sourceType: 'internal_overhead'`). No billing alert is triggered.
* **System/Code Detail:** FEAT-002 required. Without the `internal_overhead` grant, there is nothing to debit against. See §8A OP-005.

---

## 10. Phase 3 Preview: Student Discovers Academy via Marketplace

*This flow shows how a student who has never heard of Mehta Coaching finds and purchases a session through Saa9vi's marketplace — and how that discovery generates platform commission.*

### Student searches on marketplace.saa9vi.com

* **Actor:** Student (new, no academy in mind)
* **Description:** A student searches "JEE Mathematics coaching Delhi" on the Saa9vi marketplace. The `MarketplaceSearchResolver` queries the platform-level `saa9vi_marketplace_sessions` Elasticsearch index — a cross-channel read projection that surfaces public sessions from all academies. Results are ranked by `bayesianRating` (from `ReviewsPlugin` aggregates). Sponsored sessions appear above organic results via bid-boost multiplier.
* **System/Code Detail:** `MarketplaceSearchResolver` (no channel token) → `saa9vi_marketplace_sessions` ES index. Index kept fresh by `MarketplaceIndexerPlugin` subscribing to Vendure's `ProductVariantEvent` — reads `Product.customFields.bbbSessionId` to join `BbbScheduledSession` data. Session products are channel-scoped to the tenant channel only (DL-027 — not the default channel). Sponsored listings: `isSponsored: true → weight: 3.0` function-score boost (INV-009).

### Student views Mehta Coaching's marketplace listing

* **Actor:** Student
* **Description:** The student clicks Mehta Coaching's result. A marketplace academy page aggregates `TenantProfile` (name, logo, city), public `BbbScheduledSession` listings with prices, `InstructorProfile` cards, and the academy's cached `reviewRating` (4.7 stars, 143 reviews from `ReviewsPlugin`). The "Sponsored" badge is visible if `MarketplaceAdCampaign` is active for this listing.
* **System/Code Detail:** `MarketplaceAcademyPage` query — reads across `TenantPlugin`, `BigBlueButtonPlugin`, `ReviewsPlugin`. All read from PG; ES provides the discovery path only.

### Student registers for a free trial from the marketplace

* **Actor:** Student
* **Description:** The student clicks "Try a free class" from the marketplace listing. They're redirected to `mehta.saa9vi.com` — the academy's own storefront, now with the channel token set. They call `registerForTrialSession()`. The same `AC-003` trial flow fires: `BbbTrialRegistration` created, `BbbEntitlement { source: 'trial' }` created.
* **System/Code Detail:** `TrialRegistrationService.register()` — identical to Phase 1. The marketplace is a discovery layer only; the transaction happens on the academy's channel.

### Student purchases the full course — commission attributed

* **Actor:** Student
* **Description:** After the trial, the student buys the React Masterclass. At checkout, the storefront passes `utm_source=marketplace` as a raw parameter to the order mutation; Vendure-side `OrderProcess` logic stamps `Order.customFields.orderSource = 'marketplace'` (INV-008 — storefront never makes this business decision). `BbbOrderFulfillmentListener` creates the `BbbEntitlement` as normal. Separately, `CommissionLedger` records a platform fee (e.g., 10% of ₹499 = ₹49.90) against this order.
* **System/Code Detail:** Storefront passes `referrerCode` or `utm_source` → Vendure `OrderProcess` classifies and stamps `orderSource`. `CommissionLedger` (append-only, Phase 3). Zero changes to Phase 1 fulfillment path.

---

## How the platform actually works — Updated Summary (v2)

The story now has eight chapters (plus two preview flows), each showing what fires in the background when a person takes an action.

**Chapters 1–6** remain unchanged from v1 — Academy setup, Content creation, Student discovery and purchase, Live class day, Session billing, Reviews and conversion.

**Chapter 7 — Trial conversion.** Unchanged from v1.

**Chapter 8 — Archetype B (Internal Staff Meeting).** The auth waterfall has a new Gate 1: org membership check via `BbbOrganizationMembership`. Staff members short-circuit the entitlement check and receive the moderator join URL. Internal consumption is recorded against an `internal_overhead` capacity grant. The commerce loop is bypassed entirely. Two features are required before this flow is operational: FEAT-001 (`BbbOrganizationMembership`) and FEAT-002 (overhead grant path).

**Chapter 9 — Phase 3 Marketplace.** Students who don't know any academy can discover Mehta Coaching via the Saa9vi marketplace search — a platform-level Elasticsearch index that spans all channels, ranked by Bayesian review score. Sponsored academies appear at the top via bid-boost. The transaction itself still happens on `mehta.saa9vi.com` (the academy's channel). The platform captures `orderSource = 'marketplace'` and records a commission. Mehta Coaching pays for promoted visibility from a prepaid `AdWallet`, topped up via Juspay.

The thing to notice across all of this: **the storefront makes zero decisions** (INV-008), **all billing facts are immutable ledger rows** (INV-002, INV-010), and **the marketplace is a read projection** — it never bypasses channel isolation for writes (INV-009). Logic changes in any one layer take effect for all academies on the next deployment, without touching the others.
---

## 11. The Infrastructure That Makes It All Sustainable

*This section shows what happens in the background that academy owners never see — the wallet, the server pool, and the intelligence system that keeps the platform running as it grows.*

### A new academy arrives

When Mehta Coaching signs up, three things happen automatically before the founder even logs in:

- A `BbbWallet` is created with 10,000 attendee-minutes of free credit — roughly 10 hours of class time with a typical cohort of 17 students
- A `BbbCapacityGrant` is issued against that credit, making those minutes immediately available for provisioning
- The academy is assigned to the `shared` server pool — the pool of BBB servers where all starter academies run

The founder sees none of this. They see "You have 10 hours of free class time. Get started."

**System/Code Detail:** `BbbOrganizationService.create()` → `WalletService.createWithWelcomeCredit(org, 10_000)` → `BbbWalletLedger { type: 'welcome_credit', direction: 'credit', minutes: 10_000 }` → `WalletService.issueGrant()` → `BbbCapacityGrant { sourceType: 'wallet', grantedAttendeeMinutes: 10_000 }`. No admin action required.

### A class runs — billing in attendee-minutes

Mehta runs a 60-minute JEE session with 42 students. When the meeting ends, the BBB server fires a `meeting-ended` webhook. The persist-first pipeline (INV-004) saves the event to `BbbWebhookEvent`, enqueues it to BullMQ, and returns `ok: true` immediately.

The BullMQ processor calculates:

```
attendeeMinutes = peakParticipantCount × durationMinutes
               = 42 × 60
               = 2,520 attendee-minutes
```

This is debited from the capacity grant. The `BbbUsageLedger` row is appended — never updated. The wallet cache is decremented. The billing truth is always the ledger, never the cache (INV-011).

**Why attendee-minutes?** A solo instructor testing an empty room for 5 minutes costs 5 units. That same room with 42 students for 60 minutes costs 2,520 units — 504× more. That ratio reflects the actual infrastructure load: more streams, more CPU, more bandwidth. Host-minutes (the old model) would charge both the same rate per minute.

### The wallet runs low

After a few weeks of classes, Mehta's wallet approaches zero. The `WalletLowBalanceEvent` fires. An email goes out: "Your class credits are running low. Top up to keep teaching without interruption."

The founder clicks the email, chooses the ₹899 package (6,000 attendee-minutes — 50 students × 2 hours), and pays via Juspay. The payment settles, `WalletService.credit()` runs, a new `BbbCapacityGrant` is issued, the `BbbWalletLedger` records both the credit and the grant issuance. The academy never stops running.

**System/Code Detail:** Top-up flows through the existing `JuspayPlugin`. `PaymentSettledEvent` → `WalletTopUpListener` → `WalletService.credit(walletId, 6_000, 'topup', { orderId })` → `BbbWalletLedger { type: 'topup', direction: 'credit' }` → `WalletService.issueGrant()` → `BbbCapacityGrant { sourceType: 'wallet' }`. No new payment integration.

### What the platform operator sees

While Mehta is teaching, the platform operator (Saa9vi admin) has a dashboard showing the live health of every server pool. Right now, at 6:00 PM IST, 23 academies are running simultaneous sessions across the shared pool. The dashboard shows:

```
Shared Pool — 3 servers
Server A:  ████████░░  78% load  (14 meetings, 312 participants, 89 cameras)
Server B:  ██████░░░░  61% load  (11 meetings, 247 participants, 71 cameras)
Server C:  ████░░░░░░  43% load  ( 9 meetings, 198 participants, 54 cameras)
Pool avg:  ██████░░░░  61%  ← amber threshold at 65%
```

The forecast panel shows that tomorrow at 10:00 AM, 31 academies have scheduled sessions simultaneously — a projected 89% pool load. The recommendation card reads:

> **Add 1 server before tomorrow 09:30 AM**
> Peak load of 847 virtual units will reach 89% of current capacity.
> Add 1 standard server (capacity: 200) to maintain 70% headroom.
> Urgency: **Soon**

The operator spins up a server, adds it to the pool. The next forecast recalculates: projected load drops to 71%. The recommendation clears.

**System/Code Detail:** `CapacityAlertJob` (CI-005, ADR §6A) runs every 15 minutes. `CapacityIntelligenceService.buildForecast(48h)` queries `BbbScheduledSession` across all orgs, builds 30-minute load windows using the PILOS virtual load formula (videos×3 + mics×2 + listeners×1, with configurable `cameraRatio: 0.40`, `micRatio: 0.70` defaults). `CapacityRecommendation` target utilisation is 70% of pool capacity: `serversNeeded = Math.ceil((peakLoad / 0.70 - currentCapacity) / BbbServer.capacity)`. `BbbCapacityAlertLog` row appended on every check — append-only, never updated (INV-002 extended). If urgency = 'immediate', `CapacityAlertEvent` published → email to platform admin. Virtual load denominator is `SUM(BbbServer.capacity)` across the pool — `BbbServer.capacity` is the new operator-configured hardware ceiling (CI-001, separate from `maxLoad` admission threshold).

### Why the platform never blocks a class

The system warns. It recommends. It alerts. It never blocks.

If the operator ignores three days of "soon" warnings and the pool reaches 95% load during peak hours, BBB sessions degrade — some participants get choppy video. That is bad. But it is recoverable: the operator adds a server, load redistributes within minutes.

If instead the platform blocked Mehta's 6:00 PM class because the pool was at 85%, 42 students lose their session. Mehta refunds the class, loses trust, and considers leaving the platform. That is not recoverable.

**INV-012 (ADR v1.6):** Meetings are never blocked for capacity reasons. The intelligence system informs; operators act. See ADR §6A and DL-025 for full rationale.

---

## How the platform actually works — Updated Summary (v3)

The story now has eleven chapters, each showing what fires when a person takes an action.

**Chapters 1–8** unchanged from v2 — Academy setup, content, commerce loop, live class, billing, reviews, trial conversion, internal staff meetings.

**Chapter 9 — Phase 3 Marketplace.** Unchanged from v2.

**Chapter 10 — Phase 3 Marketplace (student side).** Unchanged from v2.

**Chapter 11 — Wallet & Capacity Intelligence.** The three systems that make the platform self-sustaining at scale:

- **Wallet:** Every academy gets 10,000 attendee-minutes free. Top-ups flow through Juspay. `BbbCapacityGrant` is auto-issued by `WalletService` — never manually created. Subscription renewals credit the wallet. The academy sees a balance; the platform manages grants invisibly.
- **Attendee-minutes billing:** `participants × duration`, computed once at `meeting-ended` time. Proportional to real infrastructure cost. Intuitive to educators who think in "students × hours."
- **Capacity intelligence:** 48-hour forecast from scheduled session data. PILOS virtual load formula (videos×3 + mics×2 + listeners×1). Plain-English recommendation. 15-minute alert job. The platform warns — the operator acts. No class is ever blocked.

The thing to notice across all eleven chapters: **the academy owner's experience is simple** (wallet, balance, top up) while **the platform's infrastructure is sophisticated** (ledgers, grants, pool routing, forecasting). The architecture is designed so the complexity is invisible to the people using it and auditable for the people running it.
