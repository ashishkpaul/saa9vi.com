# Saa9vi Clean Rebuild Blueprint
**Status:** PROPOSED — architecture and discovery baseline, not an implementation authorization  
**Reference repository:** https://github.com/ashishkpaul/saa9vi.com/tree/main  
**Reference baseline inspected:** `main` at `7b68eb83b4aef0b9b53c1afe4f53b97abd3e5552` (19 November 2026)  
**Strategy:** Start from a fresh Vendure installation. Treat the beta repository as a product/architecture reference and evidence archive, not as a code template to copy wholesale.

---

## 1. Decision

Build a separate clean implementation from a fresh, pinned Vendure installation, with a small number of bounded-context plugins and a deliberately constrained custom GraphQL surface.

Do not clean the beta repository in place, delete uncertain code, or make its current main branch the new implementation branch. Preserve it as a read-only beta reference until the replacement passes migration, integration, security, and operational acceptance.

Create a **new repository** for the clean implementation (preferred). Do not call a branch `develop` a fresh install: a branch from the current repository inherits all existing source, migrations, package dependencies and schema history.

The reference baseline is the main branch observed at the time of this review. Recheck it before creating the new repo.

## 2. Design rules

1. **Vendure first.** Use built-in Admin and Shop APIs, core entities, services, permissions, events, strategies and dashboard capabilities wherever they already satisfy the use case.
2. **Custom APIs only for Saa9vi concepts.** Do not wrap a Vendure operation in a new resolver just to give it a Saa9vi name. Add custom fields only when there is a durable domain concept or policy that core does not model.
3. **One owner per fact.** Product owns catalogue identity and translations; ProductVariant owns sellable offer/SKU/price/tax/stock; LearningCourse owns academic state; CourseEnrollment owns academic participation; CourseAccessGrant (proposed) owns bounded course access; BbbEntitlement owns room/session authorization.
4. **Tenant = Channel.** Derive channel from RequestContext. Never accept a browser-provided channelId as authority. Validate every cross-aggregate reference against the active Channel.
5. **Payment is not admission.** Initial admission is trainer-controlled and zero-cost by default. Interest, email, calls and agreed start time are not enrollment. Paid continuation is separate and cannot create initial admission.
6. **Payment facts are immutable.** Store durable settlement/order-line provenance. Webhook ingress persists before processing and is idempotent.
7. **Visibility is not authorization.** Hiding a course tool does not grant or revoke BBB or resource rights.
8. **No speculative endpoints.** Every custom query/mutation must have a defined actor, user story, permission, channel rule, transaction semantics, error model, and acceptance test.
9. **No duplicate catalogue, order, customer, payment or shipping models.** Extend Vendure, do not mirror it.
10. **No mutation outside domain services.** Admin/Shop GraphQL operations call services; workers call the same services. Business data changes through supported application paths, not manual SQL.

## 3. Responsibility split: Vendure core vs Saa9vi

### Use Vendure Admin API (do not recreate)
- Product and ProductVariant create/read/update/enable/disable
- Translations, assets, facets, collections and product options
- Channel assignments (with Saa9vi channel policy checks)
- Customer and Administrator management
- Orders, order lines, payments and order state
- PaymentMethods and PaymentHandlers
- ShippingMethods, shipping eligibility and order shipping lines
- Fulfillment primitives and stock operations
- Roles/permissions and channel scoping
- Promotions, tax, countries, zones and settings
- Asset management and Dashboard API client

### Use Vendure Shop API (do not recreate)
- Product/collection catalogue search and facets where the core search model fits
- Active customer and account authentication/profile operations
- Active order/cart creation and modification
- Add/remove order lines, quantity changes, coupon/promotion application
- Eligible shipping methods and shipping selection
- Available payment methods and payment initiation
- Order placement, order state and customer order history
- Address book and account flows

### Saa9vi custom API only where domain-specific
- Tenant academy profile / public academy identity (only fields not covered by Channel/Seller)
- Trainer/instructor profile and trainer-to-academy/course assignment if not represented by core Administrator/Customer roles
- Academy learner membership and its audited lifecycle
- LearningCourse academic workspace, CourseTool configuration, CourseEnrollment FSM
- Course interest/enquiry and trainer disposition
- Secure invitation acceptance where the core account flow does not represent course-specific invitation semantics
- CourseAccessGrant and effective access status (once the contract is accepted)
- ProductVariant-to-fulfillment target mapping (COURSE / BBB_ROOM / BBB_SESSION)
- Course fulfilment reconciliation/read models
- BBB domain: rooms, scheduled sessions, meetings, entitlements, metering and provider callbacks
- Marketplace cross-channel discovery projection and sponsored-placement attribution, not a duplicate product/order catalogue
- SaaS tenant subscription and Saa9vi platform billing, separate from tenant-to-learner commerce

## 4. Proposed bounded-context plugin map

Start with a minimal deployable set. Split further only when ownership, scaling, or release independence justifies it.

### Platform wiring (not a business plugin)
Owns Vendure configuration, authentication, channel resolution, custom permission registration, cross-plugin ports, global event policy, migration bootstrapping, encryption, queue and observability configuration.

### TenantAcademyPlugin
Owns TenantProfile, TrainerProfile (or InstructorProfile), TenantLearnerMembership and append-only membership transition log. Avoid a broad "TenantPlugin" with CMS, theme, media, registration, roles, payment and commerce mixed together.

### LearningPlugin
Owns LearningCourse, CourseTool, CourseEnrollment, course announcements, course/session association and course-specific invitation/interest workflows. Product link is a nullable unique FK from LearningCourse to Vendure Product; same-channel validation through service.

### LearningCommercePlugin (or platform commerce module)
Owns CourseAccessGrant, ProductFulfillmentMapping, course settlement convergence, immutable course commerce provenance and reconciliation. Exposes ports for LearningPlugin and BBB plugin; avoid direct plugin-to-plugin entity imports.

### BigBlueButtonPlugin
Owns BBB provider integration, room/session/meeting lifecycle, BBB entitlements, attendance, capacity/metering and webhook inbox. Reuse Vendure order/variant primitives; preserve BBB-specific legacy mappings during controlled migration only where required.

### MarketplacePlugin
Owns platform-level search projections, cross-channel discovery, sponsored placements/ad events and attribution. Does not own duplicate Products, ProductVariants, Customers, Carts, Orders or Payments.

### PlatformBillingPlugin (only if distinct from tenant learner commerce)
Owns tenant-to-Saa9vi plans, Saa9vi service fees, BBB tenant billing and platform entitlements. Must remain distinct from Flow B tenant-to-learner payments.

### Content/CMS (optional, late)
Add only after deciding whether Vendure Collections, Assets and existing content capabilities cover the storefront requirements. Do not start with a bespoke CMS plugin.

## 5. GraphQL surface budget and endpoint policy

For every operation classify it as:
- **CORE**: Vendure already supplies it; use core operation.
- **CUSTOM DOMAIN**: unique Saa9vi aggregate lifecycle.
- **READ MODEL**: optimized projection only; must not mutate state.
- **INTERNAL**: service/event/worker only; never expose as GraphQL unless a real actor needs it.

Avoid:
- Renaming core operations (`saa9viCreateProduct`, `tenantAddToCart`, etc.).
- Generic "do everything" resolver or arbitrary JSON action endpoint.
- Separate endpoints for simple fields already exposed by Vendure.
- Browser mutation of channelId, payee, order owner, mapping target ownership or entitlement truth.
- Shop mutations that bypass core order/payment lifecycle.
- Admin endpoints exposing worker retry internals or raw webhook actions without operator controls.

Every custom API gets a short API decision record with: actor, purpose, permission, channel source, input/output, idempotency, transaction boundary, error semantics, audit event, and tests.

## 6. Proposed small Admin API (custom only)

Exact field names are provisional and must be reconciled with Vendure's version-specific SDL at bootstrap time. Reuse core Vendure types rather than creating shadow Product/Customer/Order types.

### Tenant academy
- `academyProfile` / `updateAcademyProfile` (only non-core academy identity fields)
- `academyLearners(options)` (membership listing; include safe Customer summary through an explicit resolver)
- `admitAcademyLearner`, `activateAcademyLearner`, `suspendAcademyLearner`, `revokeAcademyLearner`, `readmitAcademyLearner`
- `academyLearnerMembershipHistory(customerId)`

### Learning
- `learningCourses(options)`, `learningCourse(id)`
- `createLearningCourse`, `updateLearningCourse`, `publishLearningCourse`, `closeLearningCourse`, `archiveLearningCourse`
- `linkProductToLearningCourse` (or integrated create flow; never a generic Product CRUD wrapper)
- `courseEnrollments(courseId, options)`, `enrollLearner`, `suspendCourseLearner`, `completeCourseLearner`, `withdrawCourseLearner`
- `courseTools(courseId)`, `courseToolDefinitions`, `updateCourseTool`
- `courseAnnouncements(courseId)`, `createCourseAnnouncement`, `updateCourseAnnouncement`, `publishCourseAnnouncement`
- `courseScheduledSessions(courseId)`, `addCourseSession`, `removeCourseSession`

Do not expose template CRUD until a concrete staff workflow needs it. Template snapshotting can remain service-only in MVP.

### Learning commerce
- `courseFulfillmentMappings(courseId)`
- `createCourseFulfillmentMapping`, `updateCourseFulfillmentMapping`, `disableCourseFulfillmentMapping`
- `courseAccessGrants(courseId, customerId)`
- `courseFulfillmentReconciliation(options)`, `resolveCourseFulfillmentReconciliation` (constrained, audited actions only)

### BBB and marketplace
Admin APIs should focus on provider/domain operations and operational dashboards, not mirror all underlying tables. Reuse Vendure's built-in Order, Product, ProductVariant, Payment, Fulfillment, Customer and Asset operations.

## 7. Proposed small Shop API (custom only)

Use Vendure core Shop APIs for catalogue, identity, cart, checkout, shipping, payment initiation and order history.

Custom Saa9vi Shop surface:
- `publicAcademy(slug)` / `publicAcademies(options)` if the marketplace needs an academy read model not represented by core channels/sellers.
- `publicCourseDetails(slug)` as a read projection joining an eligible Product with LearningCourse academic presentation.
- `submitCourseInterest(input)` if prospects need an enquiry action distinct from cart/checkout.
- `myCourseInvitations` / `acceptCourseInvitation(token)` only when secure course invitation acceptance is approved.
- `myCoursePages`, `myCoursePage(slug)`, `coursePageAnnouncements(courseId)` for active admitted/enrolled learners.
- `myCourseAccess(courseId)` as a read-only access decision/projection; authorization is always enforced by server services on each protected tool/action.
- No custom Shop mutation to create an Order or initiate a provider payment for ordinary course purchase if Vendure's Shop API already handles it.

Anonymous interest versus authenticated interest remains a policy decision. Do not implement both variants before deciding anti-abuse, identity matching and consent rules.

## 8. Vendure core workflow and extension strategy

Prefer:
- Vendure entities/services for Product, ProductVariant, Customer, Order, Payment, Fulfillment and Channel.
- Custom fields only for small stable scalar metadata (e.g. `ProductVariant.isDigital`) with migrations and clear public/read/write policy.
- Vendure custom entities for domain aggregates with lifecycle/audit.
- Permissions and `@Allow` on every custom Admin/Shop resolver.
- RequestContext for tenant Channel and transaction context.
- EventBus for domain integration, but event handlers must be idempotent.
- JobQueue for asynchronous provider calls, email and reconciliation.
- Strategies/checkers for shipping and product availability policy.
- Vendure OrderProcess / payment settlement lifecycle for digital fulfillment; course access only after verified PaymentSettled.
- Admin dashboard extensions only for Saa9vi workflows not covered by core screens.

## 9. Data ownership and invariants

- Vendure Channel is the tenant boundary. Tenant is not an arbitrary client-side tenantId.
- Vendure Product is canonical public catalogue identity; ProductVariant is the purchasable offer.
- LearningCourse is academic workspace and may be productless for internal-only use.
- A public catalogue course needs a linked Product. A paid purchasable offer needs a valid same-channel ProductVariant mapping.
- Product.name/slug/description/translations are canonical. LearningCourse legacy display fields are mirrors during any transitional period; after clean-build design, decide whether to remove duplicate fields entirely rather than copy the beta duplication.
- One Product maps to one catalogue LearningCourse for MVP. Multi-course bundles deferred.
- ProductVariant maps to exactly one target for MVP.
- Initial academic admission is trainer-controlled and zero-cost by default; no free-admission ProductVariant or checkout.
- Paid continuation is not initial admission. Do not let settlement create an initial CourseEnrollment.
- ACTIVE academy membership is necessary but insufficient: the learner must have explicit trainer-approved ENROLLED status for the specific course before paid continuation.
- CourseAccessGrant is separate from CourseEnrollment; BBB Entitlement remains separate again.
- Course page visibility, course enrollment, course access grant and BBB session entitlement are distinct gates.
- Payment/webhook facts are immutable, idempotent and tenant-scoped.
- Mixed carts must not allow one failed/unmapped order line to suppress eligible fulfillment for other lines.
- Keep legacy BBB mapping readers during migration; reject ambiguous dual mappings and retire only after compatibility tests.

## 10. Clean repository structure (proposed)

```text
src/
  platform/
    config/
    auth/
    tenancy/
    permissions/
    ports/
    events/
    observability/
  plugins/
    tenant-academy/
    learning/
    learning-commerce/
    bigbluebutton/
    marketplace/
    platform-billing/
  migrations/
  index.ts
  index-worker.ts
test/
  architecture/
  e2e/
  fixtures/
docs/
  product/
  architecture/
  adr/
  api/
```

Do not copy old folders wholesale. Every file brought across requires a destination, owning context, dependency direction, current runtime use, replacement plan and tests. Anything with no active runtime path or owner is excluded until justified.

## 11. Refactor and migration approach

### Stage 0 — Freeze and baseline
- Tag the beta repository/commit as the reference baseline.
- Save current GraphQL SDL for Admin and Shop APIs from the live beta server.
- Inventory package dependencies, plugins registered, entity metadata, migrations, custom fields, resolver fields, permission grants, dashboard routes, workers, scheduled tasks, event subscribers and HTTP controllers.
- Classify each item KEEP / REBUILD / REPLACE WITH CORE / RETIRE / INVESTIGATE.
- No deletions from beta.

### Stage 1 — Fresh Vendure skeleton
- Create a new repository from `@vendure/create` with the exact target Vendure version pinned.
- Keep Admin API and Shop API at Vendure defaults initially.
- Confirm fresh build, server, worker, migrations and Dashboard compile before custom plugins.
- Export and commit the unmodified generated Admin and Shop GraphQL SDL as baseline artifacts.

### Stage 2 — Core API contract
- Build a matrix mapping each business user journey to Vendure core operations and only necessary custom operations.
- Use custom types only for Saa9vi aggregates; reuse core Product, ProductVariant, Customer, Order, Payment, Fulfillment, Asset, Channel types.
- Keep schema additions actor-driven. Review API surface against user stories, not table inventory.

### Stage 3 — Plugin slices
- Platform tenancy and permission foundations.
- Academy membership.
- Learning academic model and course page.
- Course interest/invitation workflow.
- Learning commerce mapping and access grants.
- BBB domain integration.
- Marketplace discovery and advertising.
- Platform billing and CMS only after revenue/operational priority is confirmed.

### Stage 4 — Acceptance, compatibility and rollout
- E2E tenant/channel isolation tests across both APIs.
- GraphQL contract tests against generated schemas.
- Idempotency/replay tests for payment and webhooks.
- Mixed-cart fulfilment tests.
- Test core Dashboard functionality before adding custom Dashboard pages.
- Migrate business records from beta through supported Admin/Shop APIs or explicitly designed import jobs; never direct SQL edits of domain data.
- Keep the beta system running until feature parity and operational cutover criteria pass.

## 12. Initial API classification rules

| Capability | Vendure core | Saa9vi custom |
|---|---|---|
| Products, variants, translations, assets, collections, pricing | Admin CRUD and Shop catalogue | Course→Product link, public course projection |
| Customer authentication/profile | Shop auth/account APIs | Academy membership and trainer/course relationship |
| Carts, orders, promotions | Shop order APIs | Signed marketplace attribution only if required |
| Payment methods and payment initiation | Vendure PaymentMethod + handler | Tenant credential policy/provider webhook ownership as needed |
| Fulfillment and shipping | Core primitives + extension hooks | Digital-course handler, BBB handler, target mapping and reconciliation |
| Academy learner membership | — | Membership lifecycle and audit |
| Courses, tools, announcements | — | Academic course domain |
| Interest and invitation | — | Course-specific workflow |
| BBB rooms/sessions/meetings | — | Provider integration and session entitlements |
| Cross-tenant search and sponsored placements | Core Product data reused as source | Marketplace read projection and ad ledger |

## 13. Open decisions before implementation

1. Fresh repository name and ownership: separate repo preferred; no fresh-install semantics inside a branch of beta.
2. Exact Vendure version and Node/package-manager baseline: pin after checking current compatible release and project deployment constraints.
3. Tenant identity representation: Channel remains authoritative; decide whether Seller is needed or TenantProfile alone is sufficient.
4. Product and LearningCourse title/slug/description duplication: clean build should ideally avoid duplicate canonical fields; define internal-course title/slug strategy.
5. Interest identity: anonymous prospect vs authenticated customer; consent, anti-spam and identity merge policy.
6. Whether instructors are Vendure Administrators, Customers or a separate InstructorProfile linked to identity; decide permissions and access separately.
7. Which existing Beta capabilities are actually required for V1 versus deferred (CMS, reviews, theme editor, ads, advanced BBB analytics, load simulation).
8. Product channel assignment policy and the exact safe sequence with Default Channel under Vendure's ProductService.
9. Customer/account channel assignment and academy membership lifecycle, preserving the current business distinction.
10. Whether tenant storefront Next.js is developed in same repo or a separate storefront repo.

## 14. Definition of done for the clean foundation

- Fresh generated Vendure Admin/Shop APIs work without Saa9vi GraphQL extensions.
- Core Product, ProductVariant, Customer, Order, Payment, Shipping and Fulfillment flows work in default Dashboard and Shop API.
- Every custom plugin has a one-page responsibility contract and no overlapping entity ownership.
- Every custom resolver is tied to a concrete user workflow, explicit permission, RequestContext channel scope and acceptance tests.
- No orphan plugin, unused resolver, unused entity, duplicated core field or undocumented worker remains.
- Generated GraphQL SDL and codegen artifacts are reproducible in CI.
- Beta reference remains intact and available for verification.

## 15. Reference materials

- Beta repository: https://github.com/ashishkpaul/saa9vi.com/tree/main
- ADR-053 Learning domain: docs/adr/adr-053-learning-plugin-course-domain.md
- ADR-055 Marketplace commerce / revenue: docs/adr/adr-055-marketplace-commerce-and-revenue-model.md
- ADR-056 Course/Product: docs/adr/adr-056-course-product-integration-contract.md
- Learner Commerce Domain Contract: docs/architecture/learner-commerce-domain-contract.md
- Invariants: docs/architecture/invariants.md
- Plugin map: docs/architecture/plugin-map.md
- Learning domain as-built API: docs/architecture/learning-domain.md
