# Plugin Code Review and Documentation Reconciliation

**Review date:** 16 November 2026  
**Repository:** `ashishkpaul/saa9vi.com`  
**Branch / baseline:** `saa9vi_com` at `3c245952d57b9ddeb27b9cbd6ee01de5bae0ba71`  
**Review type:** source, plugin registration, entities, GraphQL SDL/resolvers and documentation review

## Scope and method

The current Git tree was checked against the supplied commit. The review covered the Vendure plugin registration in `src/vendure-config.ts`, the plugin entry points and entity registrations under `src/plugins/`, the relevant Admin/Shop GraphQL schemas and resolvers, the new LearningPlugin platform ports, and the ADR/architecture/implementation Markdown files. This is a source-level review; it does not claim that the application was built, migrations were run, or the providers were exercised at runtime.

The eleven custom plugin areas registered by the current Vendure configuration are:

| Plugin area | Main responsibility |
|---|---|
| `tenant-plugin` | Tenant registration/profile, instructors, media, themes and learner admission |
| `bigbluebutton-plugin` | BBB rooms, meetings, scheduled sessions, grants/entitlements, metering, billing and webhooks |
| `cms` | Tenant articles, pages, banners and navigation menus |
| `reviews` | Product reviews, moderation, reports, voting, rewards and reputation aggregation |
| `marketplace` | Cross-channel Elasticsearch projections, attribution, commission and advertising |
| `customer-suspension` | Platform/channel customer suspension and checkout enforcement |
| `subscription` | Tenant SaaS subscription plans, recurring Razorpay billing, webhook processing, renewal/dunning and self-service |
| `payments` | One-time platform Razorpay checkout (Flow A) plus partial per-tenant Razorpay checkout setup (Flow B) |
| `learning-plugin` | Courses, course tools, enrollments, course-session links and announcements |
| `load-simulation-plugin` | Admin-triggered load/causality simulation |
| `platform-dashboard` | Vendure dashboard/login branding extension |

The repository also registers the external `@vendure-community/stripe-plugin`; it is not one of the eleven custom plugin areas.

## Findings requiring attention

| Priority | Area | Finding | Documentation / engineering consequence |
|---|---|---|---|
| **P1** | Flow B payment settlement | `TenantRazorpayService.verifyAndSettle()` exists, but the current `PaymentsPlugin` registers only the platform `razorpayPaymentHandler`. No tenant-specific Vendure `PaymentMethodHandler` is registered, and no current resolver calls `verifyAndSettle()`. | Flow B currently creates a tenant Razorpay order but is not end-to-end wired to settle a Vendure order. Do not mark Flow B complete or production-ready. Implement and test a tenant-specific handler before enabling collection. |
| **P1 / security review** | Flow B order ownership | `createTenantRazorpayCheckoutOrder(orderId)` requires an authenticated caller and channel-scopes the order, but the service does not visibly compare the order's customer user with `ctx.activeUserId`. The resolver has `@Allow(Permission.Owner)`; its resource-binding effect for this custom resolver should be proven. | Add a cross-customer same-channel regression test and an explicit owner check unless the Vendure permission contract demonstrably provides it. |
| **P2** | Flow B webhook verification | `verifyTenantPaymentWebhook` only checks that the encrypted webhook secret exists and can be decrypted, then returns `webhookVerified: true`. | This is not a live webhook verification. Rename/rework the mutation or clearly label it as a secret-presence check. |
| **P2** | Flow B webhooks | The current PaymentsPlugin webhook controller/inbox/queue is for platform Flow A. There is no tenant-specific webhook endpoint or per-tenant webhook reconciliation worker. | Design channel resolution, signature verification, durable inbox/idempotency and reconciliation before webhook recovery is claimed. |
| **P2** | Learning API scope | The Admin API supports course CRUD, enrollment state operations, announcements, tool updates and BBB session links. The Shop API only exposes `myCoursePages`, `myCoursePage` and `coursePageAnnouncements`. | No Shop enrollment/invitation acceptance mutation is present. Course templates have entities and snapshotting but no template CRUD GraphQL surface. |
| **P2** | Learning state | The entity/FSM includes `INVITED`, but current Admin `enrollLearner` writes `ENROLLED` directly and no invitation-create/accept operation is exposed. | Keep the invitation state documented as a model state, not a delivered invitation workflow. |
| **P2** | Subscription docs | The old plugin map/domain-model text says no tenant self-service plan change/cancellation exists. The current `SubscriptionShopResolver` exposes `requestMySubscriptionPlanChange` and `cancelMySubscription`, alongside `availableSubscriptionPlans`, `mySubscription` and `myLiveUsage`. | Replace the September capability-gap text with the current ADR-046 Shop API, while keeping live-provider verification separate. |
| **P2** | Tenant admission docs | `TenantPlugin` now registers `TenantLearnerMembership` and `TenantLearnerMembershipLog`, backed by `TenantLearnerMembershipService` and the `LearnerAdmissionPort`. | Add membership/admission entities and service to the plugin map/domain model. |

## LearningPlugin — verified as-built contract

### Entities

- `LearningCourse`: scalar `channelId`; unique `(channelId, slug)`; lifecycle status `DRAFT | PUBLISHED | CLOSED | ARCHIVED`.
- `CourseTemplate`: nullable scalar `channelId` (`NULL` represents a platform-default template). The implementation has a non-unique index on `(channelId, name)`; there is no database uniqueness guarantee for a single platform-default template.
- `CourseTemplateTool`: scalar `templateId`, `toolKey`, order, visibility and JSONB settings.
- `CourseTool`: scalar `courseId`, `toolKey`, order, visibility and JSONB settings; unique `(courseId, toolKey)`. Tenant access is derived through the parent course.
- `CourseEnrollment`: scalar `courseId`, `customerId`, `channelId`, `courseRole` and status. Unique `(courseId, customerId)`.
- `CourseScheduledSession`: scalar `courseId`, `sessionId` and `channelId`.
- `CourseAnnouncement`: scalar `courseId`, `channelId`, title/body/status and publication metadata.

These entities use scalar identifier columns; the current definitions do not declare TypeORM relation decorators for the course/template/session references.

### GraphQL contract

**Admin queries:** `learningCourses`, `learningCourse`, `courseEnrollments`, `courseAnnouncements`, `courseTools`, `courseScheduledSessions`, `courseToolDefinitions`.

**Admin mutations:** `createLearningCourse`, `updateLearningCourse`, `publishLearningCourse`, `closeLearningCourse`, `archiveLearningCourse`, `enrollLearner`, `suspendLearner`, `completeLearner`, `withdrawLearner`, `createCourseAnnouncement`, `publishCourseAnnouncement`, `updateCourseAnnouncement`, `updateCourseTool`, `addCourseSession`, `removeCourseSession`.

**Shop queries:** `myCoursePages`, `myCoursePage(slug)`, `coursePageAnnouncements(courseId)`. They require authentication, current-channel enrollment in `ENROLLED` state, a published course, and active academy admission. Hidden tools are filtered from the learner-facing response. No Shop enrollment mutation is exposed.

### Cross-plugin boundaries and registered tools

- `CourseEnrollmentService` consumes `LearnerAdmissionPort` through `LEARNER_ADMISSION_PORT`; the check requires an active `TenantLearnerMembership`.
- LearningPlugin and BigBlueButtonPlugin import `CourseToolRegistryModule`; contributors register definitions during Nest module initialization.
- LearningPlugin contributes `description`, `users`, `agenda`, and `announcements`. BigBlueButtonPlugin contributes `videoconference` (not `bbb_session`).
- Tool visibility is presentation only. BBB meeting access still uses the independent BBB authorization path (INV-027).
- Customer deletion hooks are registered for channel-scoped and full-delete handling.

### Implemented enrollment FSM

```text
INVITED  -> ENROLLED | WITHDRAWN
ENROLLED -> SUSPENDED | COMPLETED | WITHDRAWN
SUSPENDED -> ENROLLED | COMPLETED | WITHDRAWN
COMPLETED -> (terminal)
WITHDRAWN -> (terminal)
```

Re-enrollment from `COMPLETED` or `WITHDRAWN` is rejected. Current Shop SDL does not expose invitation acceptance.

## PaymentsPlugin — verified as-built contract

### Flow A — platform one-time payment

- `razorpayPaymentHandler` uses platform `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` and is reserved for platform-service charges.
- `RazorpayShopResolver.createRazorpayCheckoutOrder` requires an authenticated order owner, checks the current channel and requires `paymentPurpose === 'platform-service'`.
- The one-time webhook route is `POST /payments/razorpay/checkout-webhook`; it verifies the signature against raw body bytes, persists a `PaymentWebhookEvent`, then enqueues reconciliation (INV-004).
- Recurring subscription billing is a separate bounded context in SubscriptionPlugin, with its own `POST /payments/razorpay/webhook` endpoint.

### Flow B — per-tenant account and checkout-order creation

- `TenantPaymentAccount` is unique per `(channelId, provider)`; public `keyId` is stored in plaintext and Key Secret/webhook secret ciphertext is AES-256-GCM.
- `TENANT_PAYMENT_ENCRYPTION_KEY` is 64-character hex (32 bytes), mandatory when `APP_ENV !== 'dev'`; `TENANT_PAYMENT_ENCRYPTION_KEY_PREVIOUS` supports fallback decryption during rotation.
- Admin operations are guarded by `ManageTenantPaymentAccount`; new tenant-admin roles get the permission through `TENANT_ADMIN_ROLE_PERMISSIONS`.
- `verifyTenantPaymentAccount` uses `GET /payments?count=1` and activates the account after successful API access.
- `createTenantRazorpayCheckoutOrder(orderId)` checks active + enabled account status, channel membership, order state and positive amount; it returns a Razorpay order handle and the public Key ID.
- There is no registered Flow B `PaymentMethodHandler`; `verifyAndSettle()` is currently unwired. No Flow B webhook endpoint/worker exists. `verifyTenantPaymentWebhook` is only a secret-presence/decryption check.
- `VENDURE_ENCRYPTION_KEY` is a separate Vendure system encryption secret used by `DefaultEncryptionStrategy` for Stripe's `encryptSecrets: true`.

## Other plugin areas

- **CMS:** `Article`, `Banner`, `Page`, `NavigationMenu`; Admin/Shop GraphQL; a scheduled banner activator.
- **Reviews:** review/request/report/reward/vote entities; Admin/Shop GraphQL, upload controller, target/eligibility/aggregation registries and product strategy implementation; customer-deletion hooks.
- **Marketplace:** platform-level Elasticsearch session/instructor projections; campaign/ad-spend/wallet/wallet-ledger/commission-ledger entities; Shop search/commission and Admin advertising/reconciliation surfaces; scheduled Bayesian baseline refresh.
- **CustomerSuspension:** channel status and status-change log; Admin GraphQL and an order-process guard that blocks suspended customers' checkout.
- **Subscription:** Razorpay-only recurring provider in current configuration; plan/subscription/provider-binding/attempt/webhook/reconciliation entities; Admin API plus Shop catalogue/read/self-service plan-change/cancellation; webhook, renewal and dunning workers/tasks.
- **LoadSimulation:** Admin API simulation using configured Shop/Admin API URLs and tokens; no Shop resolver.
- **PlatformDashboard:** dashboard/login branding UI extension; no entity or API surface.

## Documentation changes made with this review

- Corrected the LearningPlugin API/registry description and added actual Learning entities/flows.
- Corrected the ADR-054 credential probe, secret verification semantics and Flow B settlement status.
- Added the current SubscriptionPlugin Shop API and corrected obsolete subscription capability-gap text.
- Added tenant learner-admission entities to the plugin/domain map.
- Recorded the Flow B settlement, webhook, and potential order-owner issues as explicit follow-ups.

## Verification limits

- No build, unit/e2e suite, migration, database mutation, live Razorpay request, or BBB runtime request was performed as part of this documentation review.
- Plugin registration and source code reviewed at the baseline commit above; provider credentials, deployed environment values, role-repair execution, database migration application and live checkout/webhook behavior remain separate evidence items.
