# Saa9vi Course, Tenant Membership & Admission RFC

**Status:** Design draft — merge/review before ADRs  
**Date:** 1 November 2026  
**Repositories inspected:** `ashishkpaul/saa9vi.com` (`main`), `ashishkpaul/edu-frontend` (`main`)  
**Backend dependency baseline:** Vendure 3.8.1 (`@vendure/core` and `@vendure/cli`)

## 1. Purpose

Consolidate the Chamilo-inspired user directory, course catalogue, learner enrollment, reusable direct enrollment links, tenant isolation, BBB access and seller-owned payment requirements into one coherent design. This RFC resolves overlapping entities and defines a phased implementation boundary. It is not an ADR and does not authorize schema or production changes.

The MVP delivers three user-facing capabilities:

1. A tenant-scoped user/learner directory for academy administrators and trainers.
2. A first-class course catalogue and course detail page, linked to existing BBB rooms and scheduled sessions.
3. A stable course enrollment URL with open, approval and invitation workflows.

Lessons, assignments, quizzes, certificates and detailed learning-progress tracking are explicitly outside this MVP. They require a separate product decision.

## 2. Business and architecture principles

1. **Channel = Tenant.** A Vendure Channel is the tenant boundary. Do not introduce a competing `tenantId`. Tenant-scoped entities follow the repository's ChannelAware/channel-assignment invariant and also carry a scalar `channelId` only where useful for indexed filtering or compound unique constraints.
2. **One global identity, tenant-specific membership.** Vendure `User` is the shared login identity; `Customer` is the channel-aware commerce/customer record. Neither is the academy's admission record.
3. **One invitation model.** Use one `AdmissionInvitation` for courses, BBB rooms and BBB sessions.
4. **One parent admission record for courses.** `CourseEnrollment` is the canonical course-level admission record. It is not a second BBB access engine.
5. **Every BBB join decision reads entitlements only.** A course enrollment issues `BbbEntitlement` rows for its linked BBB rooms/sessions. `bbbJoinRoom`, `bbbRoomStatus` and their session equivalents must not independently authorize from course enrollment, organization membership, legacy membership or `BbbEnrollment`. Staff/moderator membership is used by the admission service to issue a role-specific entitlement (for example `participantRole: MODERATOR`); it is not a bypass in the join resolver. Legacy `BbbEnrollment` is retired as an authorization source after migration.
6. **Admission is not payment.** A seller controls admission and independently controls whether/how a course fee is collected. A settled order may be one configured admission trigger, but an order is not mandatory for every admission.
7. **Saa9vi does not receive or hold seller course fees.** Offline/manual payment and seller-owned gateways must settle directly to the academy's own account.
8. **Visibility is not authorization or marketplace eligibility.** Public visibility, enrollment policy and Marketplace listing eligibility are separate axes.
9. **Application data changes go through GraphQL.** No manual PostgreSQL data writes. Schema changes use Vendure CLI migrations after reviewing generated files.
10. **Extend, do not rewrite, BBB.** The TypeScript BBB API adapter, checksum signing, meeting lifecycle, webhook pipeline, access policy, capacity and usage services already exist. Audit and extend them; do not port the PHP client.
11. **BBB checksum is per server.** Add `BbbServer.checksumAlgorithm: SHA1 | SHA256`; outbound API requests and webhook-hook registration use the selected server value. The current inbound webhook verifier can infer SHA-1 versus SHA-256 from digest length, so preserve that independent verification behavior and add server-specific contract tests.

## 3. Consolidated domain model

### 3.1 `LearningCourse`

A tenant-owned course is a parent catalogue/admission object. It is not a scheduled BBB session.

Proposed fields:

- `id`, `channelId`, `slug`, `title`, `summary`, `description`, optional cover asset.
- `status: DRAFT | PUBLISHED | ARCHIVED`.
- `visibility: PUBLIC | UNLISTED | HIDDEN`.
- `enrollmentPolicy: OPEN | APPROVAL_REQUIRED | INVITATION_ONLY | CLOSED`.
- `marketplaceListed: boolean` — independent of tenant catalogue visibility.
- owner/lead trainer reference and assignment metadata.
- timestamps and audit fields.

**Database invariant:** unique `(channelId, slug)`. Slug is normalized server-side and tenant-scoped. GraphQL exposes enums, not free-form `String` values, for these fields.

A trainer's ability to read or mutate a course is an object-level service rule: the trainer must be assigned to that course (unless the caller has an elevated tenant-administrator permission). Channel-level Vendure roles alone do not express course assignment.

### 3.2 `LearningCourseResource`

A lightweight link between a course and an existing BBB resource. It supports resource types `BBB_ROOM` and `BBB_SESSION`, plus ordering/primary flags as needed.

It does not store an independent access decision. Its purpose is to identify which BBB resources should receive entitlements when a course enrollment becomes active.

### 3.3 `CourseEnrollment` — canonical parent record

Proposed fields:

- `id`, `channelId`, `courseId`, `customerId`, optional `tenantLearnerMembershipId`.
- `status: PENDING_APPROVAL | PENDING_PAYMENT | ACTIVE | SUSPENDED | REVOKED | COMPLETED`.
- `admissionType: REGULAR | SCHOLARSHIP | DEMO | COMPLIMENTARY | CORPORATE | OTHER`.
- `source: OPEN_REGISTRATION | INVITATION | ADMIN | PURCHASE | IMPORT` (server-derived).
- `reason` / operator note, `validFrom`, `validUntil`, `approvedByUserId`, audit timestamps.

The first implementation should enforce at most one current enrollment per `(channelId, courseId, customerId)` and preserve state changes in an audit log. If recurring cohorts/editions require multiple simultaneous enrollments later, model those as separate course editions or a cohort dimension rather than allowing ambiguous duplicates.

**Grant behavior:** when a course enrollment becomes `ACTIVE`, an admission service issues BBB entitlements for all linked resources. When resources are added to an already-active course, the service reconciles entitlements. When the course enrollment is suspended/revoked/expired, entitlements created by that enrollment are revoked. Provenance must be retained so revoking one source does not remove access granted independently by another source.

### 3.4 `BbbEntitlement` — only learner BBB access primitive

Keep `BbbEntitlement` as the only resource-level access decision for `bbb_room` and `bbb_session`; do not add a course entitlement type in this RFC. Add a role discriminator such as `participantRole: ATTENDEE | MODERATOR` if the join resolver needs to select the appropriate BBB password/permissions. Staff membership must be translated into a moderator entitlement before joining; it is not an independent join-time authorization source.

Add explicit provenance sufficient to map each grant back to its source, e.g. `sourceReferenceType` and `sourceReferenceId` (or an equivalent normalized relation). Add source values such as `course_enrollment` and `invitation`; retain `purchase`, `trial`, `trial_conversion`, `admin` and `import` only for their appropriate server-side workflows.

Rules:

- All BBB learner and moderator joins are authorized by a live, channel-matching `BbbEntitlement`; role membership is not checked as an alternate allow path at join time.
- Organization membership/role changes provision or revoke role-specific entitlements through a controlled service.
- `purchase` can only be written by verified order-fulfillment code after checking order channel, line/product mapping and target-resource channel.
- `trial` / `trial_conversion` can only be written by the trial workflow.
- `invitation` is written only by the unified admission acceptance service.
- `course_enrollment` is written only by the course admission service.
- A tenant Admin GraphQL mutation must not accept a client-supplied entitlement source.
- Revocation is provenance-aware and must not revoke another still-valid grant for the same customer/resource.

**BBB join:** any join (learner or moderator) is allowed only if a live `BbbEntitlement` exists for the current customer, resource and channel, with the required participant role. `CourseEnrollment` is never queried by the BBB join endpoint. `BbbOrganizationMembership`, legacy member rows and `BbbEnrollment` are not alternate authorization fallbacks after cutover. A staff membership lifecycle provisions the corresponding moderator entitlement before the user joins.

### 3.5 `AdmissionInvitation` — the only invitation entity

Do not create both `BbbAdmissionInvitation` and `CourseInvitation`.

One `AdmissionInvitation` supports:

- `targetType: COURSE | BBB_ROOM | BBB_SESSION`.
- `targetId`, `channelId`, and the target's organization/course ownership check.
- `mode: EMAIL_BOUND | OPEN_LINK`.
- `normalizedEmail` for email-bound invitations; null for open links.
- high-entropy opaque token whose **hash** is stored; never persist the plaintext token.
- `status: ACTIVE | REVOKED | EXPIRED | EXHAUSTED`.
- `expiresAt`, `maxUses`, `useCount`, optional validity window.
- `admissionType`, `reason`, creator and timestamps.

Acceptance is one service path: `AdmissionService.acceptInvitation(ctx, token)`.

- Email-bound is the default. The authenticated learner must have a verified email matching the invite.
- Open-link mode is a separate explicit choice, intended for WhatsApp/class-group sharing. It must require authentication, have a maximum-use count and expiry, and be rate-limited. It is not a private learner-specific invite.
- Use an `AdmissionInvitationUse`/acceptance audit record with uniqueness on `(invitationId, customerId)` so duplicate clicks are idempotent and acceptance history remains auditable.
- Consume uses atomically in a transaction; a token must not race past `maxUses`.
- Do not implement phone OTP as part of this scope.

On acceptance:

- Verify token, status, expiry, target ownership, verified email where required, current tenant and user identity.
- Ensure/assign the channel-aware Customer association only after the admission policy allows it.
- Create/activate `TenantLearnerMembership`.
- For a course target, create/activate `CourseEnrollment`, then issue resource entitlements.
- For a room/session target, issue the matching BBB entitlement directly (there is no course enrollment if the invite target is a standalone BBB resource).
- Derive all customer/channel/source fields on the server. Never accept a client-supplied `customerId`, `channelId` or entitlement `source` as authority.

### 3.6 `TenantLearnerMembership` — tenant-specific learner relationship

Vendure `Customer` is shared across channels, so it cannot encode a tenant's learner status or private academy profile. Add an explicit entity unique on `(channelId, customerId)`.

Proposed fields:

- `channelId`, ChannelAware channel relation, `customerId`.
- `status: ACTIVE | SUSPENDED | LEFT`.
- `activatedAt`, `leftAt`, `suspendedAt`, `suspensionReason` (or link to audit log).
- `lastActivityAt` for activity in this tenant only.
- tenant-private fields only where necessary: `localStudentCode`, `preferredDisplayName`, `cohort/batch label`, `guardianName`, `guardianContact`, and limited academy-private notes.

Pending invitations are represented by `AdmissionInvitation`; the directory can display them in an `Invited` filter without creating a false active membership. Avoid storing a second copy of the global identity email/phone/address merely for convenience.

**Reuse existing suspension code:** `CustomerSuspensionPlugin` already supports both:

- platform-wide suspension in `Customer.customFields.status` (SuperAdmin only); and
- channel-level suspension in `CustomerChannelStatus`.

`TenantLearnerMembership.status` should become the canonical tenant membership/suspension state. Migrate existing `CustomerChannelStatus` records and adapt the suspension service to read/write the membership. Preserve `CustomerStatusChangeLog`. Do not maintain two independently writable tenant suspension tables. The platform-wide Customer status remains a separate platform control.

Important migration rule: do **not** backfill active memberships from `Customer.channels` alone. The current default assignment strategy can auto-assign a Customer to a channel without academy approval. Backfill only evidence of actual membership/admission; carry existing suspended channel rows into the new membership table.

### 3.7 Shared identity versus tenant-private profile data

Shared identity fields stay on Vendure `User` / `Customer`:

- login identifier and verified email;
- canonical contact phone, if used for authentication;
- global customer first/last name and global account identity.

Tenant-specific display/admission data belongs on `TenantLearnerMembership`:

- academy roll number/student code;
- learner's academy-specific preferred name;
- batch/cohort;
- guardian contacts where needed;
- academy-only notes and tenant-specific address/contact details where there is a demonstrated use case.

A tenant administrator must not silently overwrite global Customer details as a side effect of editing the academy's learner row. Prefer minimal collection and explicit purpose/retention rules.

Many learners may be minors. Design for guardian consent and data minimization; do not introduce child tracking, behavioural monitoring or targeted advertising. Have Indian privacy counsel confirm Saa9vi/tenant roles, lawful purposes, consent evidence, retention and applicable DPDP Rules/exemptions before collecting children's data.

### 3.8 Tenant directory and status presentation

The directory is a projection over `TenantLearnerMembership`, related Customer identity, `AdmissionInvitation`, CourseEnrollment counts and `User.lastLogin` where appropriate.

Filters: All, Learners, Trainers, Invited, Suspended, Left; search by name/email/student code; filter by course/batch/date. Actions are permission-checked and scoped to the current channel.

Vendure 3.8.1 already has `User.lastLogin`; Saa9vi does not set `disableLastLoginUpdate`, so the normal global login timestamp is updated. It is not academy-specific. Use `TenantLearnerMembership.lastActivityAt` only if tenant-specific activity is required, with a documented event definition (e.g. successful authenticated activity in this tenant), not every anonymous request.

## 4. Visibility, enrollment and marketplace are three separate axes

### 4.1 Course visibility

- `PUBLIC`: visible in the tenant's public course catalogue when published.
- `UNLISTED`: not listed in the tenant catalogue/search, but a direct course URL may display permitted course details.
- `HIDDEN`: not publicly discoverable and public details are not exposed; administrative visibility only.

### 4.2 Enrollment policy

- `OPEN`: verified registered users may enroll directly, subject to the course's payment/admission configuration.
- `APPROVAL_REQUIRED`: learner requests enrollment; tenant approves or rejects.
- `INVITATION_ONLY`: only an accepted valid AdmissionInvitation can enroll.
- `CLOSED`: no new admissions; existing enrollments remain unless explicitly revoked/suspended.

### 4.3 Marketplace listing

`marketplaceListed` is a separate course setting. Effective Marketplace discovery requires all of:

1. course `PUBLISHED`;
2. course visibility `PUBLIC`;
3. `marketplaceListed = true`;
4. channel currently eligible under ADR-042 `CommercialEntitlementService` / subscription policy.

Do not use a hostname, custom domain or subdomain as evidence of listing eligibility. Add a dedicated `MarketplaceCourseDocument` and course index; do not overload the existing session index. Existing session and instructor indexing remains separate. Instructor-index eligibility/pruning residuals from ADR-042 should be reviewed alongside the new course projection.

## 5. Domain routing decision

### Decision proposed

Provision a Saa9vi-hosted academy subdomain by default: `https://{tenantSlug}.saa9vi.com`. Custom domains are optional, not a prerequisite for a small institute to publish a course or share an enrollment link.

Use the existing immutable unique `TenantProfile.tenantSlug` as the default hostname label only after implementing actual hostname provisioning. Preserve it as the central marketplace slug too. Reserve platform labels such as `www`, `marketplace`, `admin`, `api`, `assets`, `mail`, and other infrastructure hosts.

Custom domains remain optional and must be verified before activation. The subdomain and custom domain resolve to the same channel/tenant.

### Required infrastructure and code changes

- Wildcard DNS `*.saa9vi.com` points to the storefront edge.
- Wildcard TLS certificate covers tenant subdomains; custom domains use a separate certificate/verification lifecycle.
- Extend hostname-to-channel resolution to support the Saa9vi subdomain namespace as well as verified custom domains.
- Maintain a server-side mapping to the channel token; never trust a client-provided channel header.
- Unmapped/unknown tenant hosts fail closed; do not fall back to the default channel.
- Keep `marketplace.saa9vi.com` and all platform hosts reserved and outside tenant resolution.
- Update tenant profile validation, tests and the current “no hosted subdomain” regression contract. The present code deliberately rejects `*.saa9vi.com` as custom domains and creates no subdomain mapping, so this is a real, explicit architecture change.

Do not generate permanent enrollment URLs until the wildcard DNS, certificate, edge routing, tenant mapping, canonical host and locale routing are deployed and tested.

Canonical course URL:

`https://{tenantSlug}.saa9vi.com/{locale}/courses/{courseSlug}`

Canonical enrollment URL:

`https://{tenantSlug}.saa9vi.com/{locale}/enroll/{courseSlug}`

A verified custom domain may serve the same paths later. Marketplace links deep-link to the academy course URL but do not enroll the learner or transfer checkout into the marketplace.

## 6. Payment design

### 6.1 Offline payments

Use Vendure's Admin API `addManualPaymentToOrder` only after the seller/academy has actually received and confirmed the funds (UPI, bank transfer or cash). It creates a manually processed payment against an eligible order; the seller/admin is recording a real-world settlement, not asking Saa9vi to collect money. Restrict this capability to tenant administrators/finance staff; do not expose it as a learner self-service “mark paid” action.

The existing `BbbOrderFulfillmentListener` subscribes to `OrderStateTransitionEvent` and provisions BBB entitlements when an order reaches `PaymentSettled`. The expected flow is that a manual payment which covers the order transitions it to `PaymentSettled`, invoking the listener. This must be proven with an Admin API integration test on the pinned 3.8.1 deployment before using it as a production admission path. The listener must also validate that order channel, product mapping and target course/resource channel agree.

The existing product-to-room mapping panel is retained as an optional purchase route. It should not be conflated with invitation-based admissions. As the course model lands, decide whether course product mappings create `CourseEnrollment` first and then issue BBB entitlements; avoid having two different product mappings that can grant the same admission with unclear precedence.

### 6.2 Razorpay seller accounts: prefer OAuth evaluation

Do not extend the current global environment-key handler to pretend one platform merchant account belongs to every tenant.

Preferred investigation: apply to Razorpay's Technology Partner / Platform Partner program and use Razorpay OAuth. Each tenant owner authorizes Saa9vi through Razorpay's authorization-code flow. Saa9vi stores the resulting access/refresh credential encrypted and scoped to the tenant, not the seller's raw API key secret. Support token revocation, scope changes, expiry and rotation.

OAuth availability and the exact payment creation/settlement flow require Razorpay partner approval and a proof-of-concept. Do not assume approval or production scopes are granted merely because documentation exists.

Razorpay Route is not the default fallback for this business model. Standard Route uses linked accounts/transfers; the separately documented Direct Settlement variant is on-demand and has narrow eligibility conditions. Confirm that any proposed flow settles directly to the seller and does not put Saa9vi in possession/control of seller funds.

### 6.3 Tenant payment account and webhook boundary

Proposed `TenantPaymentAccount`:

- `channelId`, provider, provider merchant/account identifier, connection status, granted scopes;
- encrypted OAuth access/refresh tokens (or encrypted API keys only if OAuth is unavailable and explicitly approved);
- token expiry/rotation metadata and credential version;
- encrypted tenant webhook secret and verification configuration.

The PaymentMethod handler receives no raw secret from GraphQL. It resolves the active tenant's connected account by `ctx.channelId` (and the channel-scoped order), then creates/verifies the payment against that merchant account.

Seller webhook endpoint should identify the integration from an opaque path identifier, e.g. `/payments/razorpay/integrations/{integrationId}/webhook`. It must:

1. load the integration and owning channel server-side;
2. verify the signature against that integration's secret and the raw request body;
3. persist the webhook event before enqueueing work;
4. store provider event ID, channel, merchant account ID, order reference and payload hash;
5. enforce unique/idempotent provider-event processing;
6. verify that the resolved order and payment belong to the same channel and merchant account before changing state.

Keep platform SaaS subscription billing and seller course checkout as separate payment lifecycles and credentials. Saa9vi's own subscription payments are not seller-course payments.

## 7. Immediate security hotfixes (before course work)

### H1 — Remove client-controlled `purchase` entitlement creation

Current `createBbbEntitlement` accepts `source` from GraphQL (`purchase | trial | admin | import`). It checks the resource's channel and stamps `channelId` from context, but does not validate that `customerId` is an admitted learner in that channel. The tenant administrator role currently includes `BbbManageEntitlementsPermission`.

Hotfix:

- Remove caller-supplied `source` from the tenant-facing mutation contract.
- Restrict any tenant manual-grant mutation to an explicit `admin` grant with mandatory reason and an active tenant learner membership.
- Make `purchase`, `trial`, `trial_conversion`, `invitation` and `course_enrollment` service-derived flows only.
- Remove broad `BbbManageEntitlementsPermission` from the default tenant administrator role if the new admission permission replaces it.
- Require Customer existence and `TenantLearnerMembership` in the active channel; never rely on channel assignment alone.
- Restrict import/system overrides to narrowly scoped platform permissions and audit them.

### H2 — Close the customer/tenant gap in `createBbbEnrollment`

Current mutation verifies the room belongs to the active channel but does not verify the supplied customer belongs to that channel or has tenant learner membership. Its `reason` input is unused.

Hotfix:

- Validate target room channel and Customer existence.
- Require active tenant learner membership or route through an invitation/admission flow.
- Persist the reason and actor in an audit record.
- Deprecate direct `BbbEnrollment` creation after unified admission emits entitlements.
- Check the standard Admin API `customers` query with two-channel GraphQL tests; UI-level query filtering is not an authorization boundary.

### H3 — Harden the order-to-entitlement boundary

The current order listener uses productVariantId to find a session or room mapping and writes a purchase entitlement. Add explicit order channel == mapped resource channel validation, validate variant/channel mapping, and make replays idempotent. A payment-settled order from one tenant must never grant an entitlement in another tenant.

## 8. Identity and tenant-channel assignment

The current `src/vendure-config.ts` does not specify `authOptions.customerChannelAssignmentStrategy`, so Vendure 3.8.1's default auto-assignment strategy applies when an authenticated customer requests another channel. This behavior can create Customer channel association without academy admission.

Design:

- Introduce a controlled/invitation-aware assignment strategy, but do not mistake a strategy returning `false` for API denial: Vendure documents that it only prevents persisted channel assignment and still allows that request to proceed.
- `TenantLearnerMembership` is the authoritative admission record.
- Private course, enrollment, learner-directory and join operations must explicitly check active membership/entitlement in the service layer.
- The invitation acceptance service assigns the Customer to the channel only after successful validation.
- Preserve one global User login; each domain may establish its own API session in the first implementation. Do not place bearer/session tokens in enrollment URLs.
- A future cross-domain SSO layer should use a standard OIDC authorization-code flow, not query-string session tokens.

## 9. GraphQL contract principles

All status and policy values are GraphQL enums. Avoid `String!` for lifecycle or authorization fields.

Suggested enums:

```graphql
enum LearningCourseStatus { DRAFT PUBLISHED ARCHIVED }
enum CourseVisibility { PUBLIC UNLISTED HIDDEN }
enum CourseEnrollmentPolicy { OPEN APPROVAL_REQUIRED INVITATION_ONLY CLOSED }
enum CourseEnrollmentStatus { PENDING_APPROVAL PENDING_PAYMENT ACTIVE SUSPENDED REVOKED COMPLETED }
enum AdmissionTargetType { COURSE BBB_ROOM BBB_SESSION }
enum AdmissionInvitationMode { EMAIL_BOUND OPEN_LINK }
enum AdmissionInvitationStatus { ACTIVE REVOKED EXPIRED EXHAUSTED }
enum TenantLearnerStatus { ACTIVE SUSPENDED LEFT }
enum AdmissionType { REGULAR SCHOLARSHIP DEMO COMPLIMENTARY CORPORATE OTHER }
```

Admin API capabilities (illustrative contract, not existing operations):

- `learningCourses(options)` / `learningCourse(id)`;
- `createLearningCourse`, `updateLearningCourse`, `publishLearningCourse`;
- `courseEnrollments(courseId, options)`;
- `tenantLearners(options)`;
- `createAdmissionInvitation`, `revokeAdmissionInvitation`;
- `approveCourseEnrollment`, `suspendCourseEnrollment`, `revokeCourseEnrollment`.

Shop API capabilities:

- `publicLearningCourse(slug)`;
- `myLearningCourses`;
- `myAdmissionInvitations`;
- `requestCourseEnrollment(courseId)`;
- `acceptAdmissionInvitation(token)`.

All ID-based reads/writes must assert resource ownership by channel before returning or mutating data. Trainer assignment checks are service-layer object authorization, not just role checks.

## 10. Frontend scope

### Learner-facing

- Tenant `/courses` catalogue with visibility rules.
- Tenant `/courses/[slug]` course overview, trainer and permitted linked sessions.
- Tenant `/enroll/[slug]` enrollment landing page.
- Existing `/account/learning` upgraded from one-card-per-session to one-card-per-course, with linked session schedule/status and server-authorized BBB CTA.
- Invitation acceptance page with explicit success/expired/revoked/exhausted states.

### Tenant administration

- `/admin/users`: searchable/paginated learners, trainers, invited, suspended, left; per-course membership counts and safe actions.
- `/admin/courses`: create/edit/publish, visibility, enrollment policy and marketplace-listing flag.
- `/admin/courses/[id]/learners`: enrollments, approvals, invite/revoke and audit trail.
- Retain the existing BBB product mapping workflow as the optional purchase path during transition.

### Marketplace

- Discover only courses meeting the independent Marketplace eligibility rule.
- Deep-link to the tenant's canonical course page. Marketplace browsing does not create an enrollment, and tenant checkout remains on the tenant storefront.

## 11. Sequenced implementation roadmap

### Phase 1 — Hotfixes and baseline audit

1. Fix H1: caller-controlled purchase entitlement/source.
2. Fix H2: customer tenant/admission check and unpersisted reason.
3. Fix H3: order/resource channel matching and idempotent fulfillment.
4. Verify the Admin API customer picker and cross-channel sign-in behavior with GraphQL tests.
5. Inspect existing migration history and current `npx vendure migrate --help` output in the checked-out 3.8.1 worktree.
6. Review current BBB checksum behavior. Add a per-server `checksumAlgorithm` setting for outbound API and hooks registration; backfill existing rows from the verified deployed server setting. Keep inbound webhook digest-length inference and test both SHA-1 and SHA-256. Do not hard-code one global value.

### Phase 2 — Domain routing decision and implementation

1. Approve wildcard subdomains as default; custom domains optional.
2. Provision wildcard DNS/TLS and reserved hostnames.
3. Resolve both platform subdomains and verified custom domains to channel tokens.
4. Fail closed on unknown hosts and reject spoofed channel headers.
5. Publish stable course/enrollment URLs only after end-to-end host tests.

### Phase 3 — Tenant membership and identity

1. Add `TenantLearnerMembership` and its GraphQL/service contract.
2. Merge channel-scoped suspension into the membership record; preserve platform-wide suspension and audit history.
3. Add the controlled customer-channel assignment strategy and explicit service-level admission checks.
4. Define tenant-private fields and data retention/minimization policy.
5. Add tenant-specific `lastActivityAt` only if the directory genuinely needs per-academy activity.

### Phase 4 — Course and unified admission foundation

1. Add `LearningCourse`, `LearningCourseResource`, `CourseEnrollment` and one `AdmissionInvitation` model.
2. Add enums, indexes, channel assertions and trainer-assignment service checks.
3. Implement one invitation acceptance service for COURSE / BBB_ROOM / BBB_SESSION.
4. Course enrollment issues BBB resource entitlements; BBB learner join reads entitlements only.
5. Backfill/retire `BbbEnrollment` as a learner access source after reconciliation.

### Phase 5 — Learner directory

1. Build the tenant-scoped user table and filters.
2. Project pending AdmissionInvitation records into the Invited view.
3. Join Customer global identity read-only with tenant-private membership profile.
4. Add safe actions, permission checks, reason capture and audit.

### Phase 6 — Direct enrollment links

1. Generate canonical course and enrollment paths on the default tenant subdomain.
2. Implement PUBLIC/UNLISTED/HIDDEN and OPEN/APPROVAL_REQUIRED/INVITATION_ONLY/CLOSED behavior.
3. Default invitation is email-bound; open-link invitation requires `maxUses` and expiry.
4. Test forwarding, reuse, revocation, expiry and rate limiting.

### Phase 7 — Seller payments

1. Keep offline payment confirmation on Vendure's Admin API manual payment path, after validating the actual `PaymentSettled` event and listener behavior.
2. Build Razorpay OAuth partner proof-of-concept and obtain Razorpay's written confirmation of seller-direct settlement and allowed scopes.
3. Implement encrypted `TenantPaymentAccount`, tenant account resolution, per-integration webhook verification and persist-first inbox.
4. Keep Saa9vi SaaS subscriptions separate.

### Phase 8 — Learner experience polish

1. Group existing sessions underneath courses in My Courses.
2. Keep server-driven session CTA and existing BBB authorization.
3. Add course resources/content only after a separate lessons/assignments/product decision.

## 12. Verification matrix

### GraphQL / API security tests required

| Test | Expected result |
|---|---|
| Tenant admin calls entitlement mutation with `source: purchase` | Rejected: no public source input / source is server-derived |
| Tenant admin targets a Customer from another tenant | Rejected, no entitlement or enrollment row created |
| Tenant admin manually admits an active member in its own tenant | Allowed with reason and audit |
| Tenant A uses `customers` query while searching for Tenant B-only learner | Tenant B customer not returned unless membership/channel policy permits it |
| Existing user signs in against second tenant domain | Authentication may succeed, but no learner admission or private course access without TenantLearnerMembership |
| Customer auto-assigned to a channel by Vendure | Does not create `TenantLearnerMembership` or any course/BBB access |
| Channel suspension | Blocks tenant actions; other tenant memberships remain active |
| Platform suspension | Blocks platform-wide per existing policy |
| Existing course enrollment creates linked BBB entitlements | Each entitlement target belongs to the same channel |
| Revoke course enrollment with another independent grant still active | Only this enrollment's provenance grants revoked; independent entitlement remains effective |
| BBB room/session learner join without entitlement | Denied even if legacy BbbEnrollment exists after cutover |
| Staff/moderator join | Only explicit active organization staff role path grants moderator access |
| Open-link invitation races at maxUses | At most maxUses acceptances succeed |
| Email-bound invitation accepted by mismatched verified email | Rejected |
| Reused/expired/revoked invitation | Rejected or idempotent only for the same already-accepted learner |
| Order settled in tenant A maps to resource in tenant B | Rejected and logged; no foreign entitlement |
| Manual payment covers tenant order | Order reaches PaymentSettled, listener provisions only the intended tenant access; event replay is idempotent |
| Course marketplace indexing | Only published + public + listed + ADR-042-eligible channel courses are indexed |
| Hidden/unlisted course | Not exposed in marketplace search/index |
| Unknown hostname / spoofed channel header | Fail closed; no default-channel fallback |
| Tenant subdomain and verified custom domain | Resolve to the same intended channel; no cross-tenant leakage |

### CLI and migration checks

The backend's package manifest pins `@vendure/cli` 3.8.1 and Vendure core 3.8.1. Current Vendure documentation describes `npx vendure migrate` interactive mode and non-interactive flags `-g/--generate <name>`, `-r/--run`, `--revert`, `-o/--output-dir`, and `--from-empty`. The exact installed CLI output has **not** been executed in this review; run `npx vendure migrate --help` in the actual worktree before choosing a command.

Generate an incremental migration against the checked-out project's configured schema, inspect the file, back up production, and run through the Vendure CLI. Do not use `--from-empty` as a routine incremental migration and do not repeat the earlier baseline-snapshot mistake where an initial migration tried to recreate tables already present in migration history.

## 13. Current code audit — evidence and limits

Static inspection of current `main` establishes:

| Claim | Static result |
|---|---|
| `createBbbEntitlement` accepts caller `source` and lacks customer membership validation | Confirmed in `bbb-admin.resolver.ts` |
| Tenant admin permission includes `BbbManageEntitlementsPermission` | Confirmed in `tenant-plugin/constants.ts` |
| `createBbbEnrollment` validates room access but not supplied customer membership; `reason` unused | Confirmed in `bbb-admin.resolver.ts` |
| Enrollment Dashboard customer picker uses built-in `customers` query, email filter, `take: 10` | Confirmed in `EnrollmentsList.tsx`; live channel-scope behavior not GraphQL-tested |
| Customer suspension supports both platform-wide and channel-scoped status | Confirmed in `customer-suspension.service.ts` and `CustomerChannelStatus` entity |
| Learning dashboard is built from `bbb_session` entitlement rows and `BbbScheduledSession` | Confirmed in `learning-dashboard.service.ts` |
| Tenant registration assigns default-channel Razorpay PaymentMethod records to new channels | Confirmed in `tenant-registration.service.ts` |
| Razorpay handler secrets are environment-only and global; handler has `args: {}` | Confirmed in `razorpay-payment-handler.ts` |
| Seller payment webhook currently uses one global webhook secret and endpoint | Confirmed in `razorpay-payments-webhook.controller.ts` |
| Tenant profile does not provision Saa9vi-hosted subdomains; tests explicitly reject them as custom domains | Confirmed in `tenant-profile.service.ts` and `tenant-profile-service-no-hosted-subdomain.spec.ts` |
| Vendure `User.lastLogin` exists and update is not disabled in Saa9vi config | Confirmed by Vendure 3.8 docs/source and Saa9vi `authOptions` |
| Customer channel auto-assignment strategy is not configured in Saa9vi | Confirmed in `src/vendure-config.ts`; Vendure default strategy applies |
| BBB checksum configuration is currently plugin-wide, not per server | Confirmed: `BbbApiService` reads plugin option; `BbbServer` has no checksum field |

**Not performed:** no live GraphQL test, no login on two tenant domains, no live customer-picker query, no live offline-payment transition, no Razorpay OAuth partner onboarding, no database migration, and no production mutation. Those remain explicit release gates.

## 14. Decisions to approve before ADRs

1. Approve Option A: `CourseEnrollment` is the parent course admission; it emits resource-level `BbbEntitlement` grants. BBB learner joins read entitlements only.
2. Approve one `AdmissionInvitation` with `targetType` course/room/session.
3. Approve `TenantLearnerMembership` as the canonical tenant learner relationship and tenant-scoped status/profile; migrate `CustomerChannelStatus` into it, retain the platform-wide Customer suspension axis.
4. Approve Saa9vi wildcard subdomains as default, with custom domains optional.
5. Approve email-bound invitations as default and capped open-link invitations as optional; defer phone OTP.
6. Approve manual-payment recording through the Vendure Admin API only after seller receipt; validate the `PaymentSettled` listener path.
7. Approve Razorpay OAuth investigation before any design that stores seller API key/secret pairs. No Route-based settlement assumption without direct-settlement eligibility confirmation.
8. Keep lessons/assignments/progress out of MVP.

## 15. Primary code and documentation references

### Saa9vi backend

- [BBB Admin resolver](https://github.com/ashishkpaul/saa9vi.com/blob/main/src/plugins/bigbluebutton-plugin/api/bbb-admin.resolver.ts)
- [BBB entitlement entity](https://github.com/ashishkpaul/saa9vi.com/blob/main/src/plugins/bigbluebutton-plugin/entities/bbb-entitlement.entity.ts)
- [BBB entitlement service](https://github.com/ashishkpaul/saa9vi.com/blob/main/src/plugins/bigbluebutton-plugin/services/bbb-entitlement.service.ts)
- [BBB room access service](https://github.com/ashishkpaul/saa9vi.com/blob/main/src/plugins/bigbluebutton-plugin/services/room-access.service.ts)
- [BBB order fulfillment listener](https://github.com/ashishkpaul/saa9vi.com/blob/main/src/plugins/bigbluebutton-plugin/listeners/order-fulfillment.listener.ts)
- [Learning dashboard service](https://github.com/ashishkpaul/saa9vi.com/blob/main/src/plugins/bigbluebutton-plugin/services/learning-dashboard.service.ts)
- [Tenant permissions](https://github.com/ashishkpaul/saa9vi.com/blob/main/src/plugins/tenant-plugin/constants.ts)
- [Tenant profile service](https://github.com/ashishkpaul/saa9vi.com/blob/main/src/plugins/tenant-plugin/services/tenant-profile.service.ts)
- [Customer suspension service](https://github.com/ashishkpaul/saa9vi.com/blob/main/src/plugins/customer-suspension/services/customer-suspension.service.ts)
- [Tenant Razorpay provisioning](https://github.com/ashishkpaul/saa9vi.com/blob/main/src/plugins/tenant-plugin/services/tenant-registration.service.ts)
- [Razorpay PaymentMethod handler](https://github.com/ashishkpaul/saa9vi.com/blob/main/src/plugins/payments/config/razorpay-payment-handler.ts)
- [Razorpay webhook controller](https://github.com/ashishkpaul/saa9vi.com/blob/main/src/plugins/payments/api/razorpay-payments-webhook.controller.ts)
- [Vendure config](https://github.com/ashishkpaul/saa9vi.com/blob/main/src/vendure-config.ts)

### Saa9vi frontend

- [BBB enrollment management screen](https://github.com/ashishkpaul/saa9vi.com/blob/main/src/plugins/bigbluebutton-plugin/dashboard/routes/enrollments/EnrollmentsList.tsx)
- [Learning dashboard page](https://github.com/ashishkpaul/edu-frontend/blob/main/src/app/%5Blocale%5D/account/learning/page.tsx)
- [Course card](https://github.com/ashishkpaul/edu-frontend/blob/main/src/app/%5Blocale%5D/account/learning/course-card.tsx)
- [Marketplace page](https://github.com/ashishkpaul/edu-frontend/blob/main/src/app/%5Blocale%5D/marketplace/page.tsx)
- [Vendure GraphQL API client](https://github.com/ashishkpaul/edu-frontend/blob/main/src/lib/vendure/api.ts)

### External specifications

- [Vendure User management](https://docs.vendure.io/current/framework/core-concepts/user-management)
- [Vendure CustomerChannelAssignmentStrategy](https://docs.vendure.io/current/framework/reference/typescript-api/auth/customer-channel-assignment-strategy)
- [Vendure OrderService](https://docs.vendure.io/current/framework/reference/typescript-api/services/order-service)
- [Vendure Admin API mutations](https://docs.vendure.io/current/framework/reference/graphql-api/admin/mutations)
- [Vendure CLI migrate command](https://docs.vendure.io/current/framework/developer-guide/cli)
- [Vendure migrations guide](https://docs.vendure.io/current/framework/developer-guide/migrations)
- [Razorpay OAuth — Technology Partners](https://razorpay.com/docs/partners/technology-partners/onboard-businesses/integrate-oauth/)
- [Razorpay Direct Settlements on Route](https://tfs.np.razorpay.in/docs/payments/settlements/direct/route)
- [Digital Personal Data Protection Act, Section 9](https://indiacode.ecourtsindia.com/digital-personal-data-protection-act-2023/section/9/)
- [Government of India: DPDP Rules 2025 notified](https://www.pib.gov.in/PressReleasePage.aspx?PRID=2190014&lang=2&reg=3)
