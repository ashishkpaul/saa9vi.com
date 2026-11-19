# ADR-056 — Course–Product Integration Contract

**Status:** PROPOSED — design contract for review; no schema, code or data change is authorised by this document
**Date:** 19 November 2026
**Baseline verified against:** `main` @ `c0c33c3ac7d01d1ab16269a3a044d4ccd0598372` (PR #25 merged; admission-first learner commerce contract is now the governing proposal)
**Amends (if accepted):** ADR-053 (adds a Product link to `LearningCourse`; D1 channel-scoping rule is unchanged)
**Refines:** ADR-055 D4 and D8; closes the design questions in worklist item MCR-0.2
**Depends on:** `docs/architecture/learner-commerce-domain-contract.md` (§8 access model), which this ADR follows where it conflicts with `docs/saa9vi-merged-course-admission-rfc.md`

---

## Context

**Revision note (v2):** Rebased from the original Claude-authored proposal onto `main` at `c0c33c3`. This revision incorporates the merged PR #25 admission-first learner commerce contract. It remains a proposal; no implementation is authorized.

ADR-053 made the course "the commercial unit tenants sell", but `LearningCourse` has no relationship to Vendure's catalogue. At the verified baseline:

- `LearningCourse` stores `channelId`, `slug`, `title`, `description`, `status`, `templateId`, `createdByUserId`. It has no product or variant reference.
- Vendure `Product` custom fields are only `bbbSessionId` and `instructorProfileId`, both written by `BbbScheduledSessionService` for marketplace indexing of BBB sessions.
- Commerce-to-learning delivery exists only for BBB: `bbbFulfillmentHandler` (`bbb-access-fulfillment`), `BbbProductAccess` (variant → room, `accessDays`) and `BbbScheduledSession.productVariantId`.
- `autoFulfillBbbOrder` fulfils only order lines whose variants map to `BbbProductAccess` or `BbbScheduledSession`. Course variants therefore receive no automatic fulfilment today.
- `bbbFulfillmentHandler` writes a `BbbCapacityGrant` for every line passed to it, before it checks any mapping. A course variant routed to it directly would receive an unrelated BBB capacity grant.
- `vendure-config.ts` defines no `ProductVariant` digital flag, no digital `ShippingMethod` flag, no custom `ShippingEligibilityChecker` and no `ShippingLineAssignmentStrategy`. Vendure's Digital Products guide uses all of these.
- `CourseEnrollment` status is `INVITED / ENROLLED / SUSPENDED / COMPLETED / WITHDRAWN` and carries no payment, source or validity fields.

Two existing documents disagree on where paid access lives. The merged Course Admission RFC puts `PENDING_PAYMENT`, a `PURCHASE` source and `validFrom/validUntil` on `CourseEnrollment`. The Learner Commerce Domain Contract (§8.1) forbids payment states on `CourseEnrollment` and proposes a separate `CourseAccessGrant`. This ADR adopts the contract.

Questions requiring a decision:

1. What is the relationship between Vendure `Product` and `LearningCourse`, and who owns which fields?
2. What does a `ProductVariant` represent, and how is it mapped to a delivery target?
3. How does a settled order become learning access without overwriting academic decisions?
4. Which Vendure digital-delivery mechanics must be added, and where?

---

## Decisions

### D1 — Product is the canonical catalogue identity; `LearningCourse` is the academic extension

For a catalogue course, Vendure `Product` owns catalogue presentation and `LearningCourse` owns academic operation.

| Vendure `Product` / `ProductVariant` owns | `LearningCourse` owns |
|---|---|
| Name, slug, description (translatable) | Academic lifecycle status |
| Assets, categories/facets | Course template and homepage tools (`CourseTool`) |
| Enabled state | Instructor / academic ownership |
| Variants: SKU, price, tax, stock | Enrollment, announcements, agenda, scheduled sessions |

- `LearningCourse.title`, `slug` and `description` become compatibility mirrors of the Product after cutover. They are not independently editable through any API, and the sync direction is Product → course only.
- Product enabled state, academic course publication status and marketplace listing eligibility (ADR-042) are separate. Disabling a Product stops new sales. It does not suspend, withdraw or delete any learner's academic record or an already-valid access grant.
- A productless `LearningCourse` may exist for internal/tenant-managed academic use. A course exposed in the public catalogue or marketplace must have a linked Product. A purchasable offer additionally requires a valid ProductVariant-to-target mapping (D4).
- `LearningCourse` is not replaced by `Product`. A Product has no tools, enrollment state, instructor assignment, participation or session association, and these must not be bolted onto it.

### D2 — The link is a unique, service-verified `LearningCourse.productId`

- Cardinality for MVP is Product 1 : 1 LearningCourse for catalogue courses. This is an Saa9vi constraint, not a Vendure restriction. Bundles and multi-course packs are deferred (ADR-055 D4, contract LC-02).
- The column is `LearningCourse.productId`, nullable and unique, not a `Product.customFields` string. A custom-field string has no referential integrity or uniqueness. The existing `bbbSessionId` fields exist for indexer reads and are not precedent for an ownership link.
- Use a real foreign key to Vendure `Product.id` with `ON DELETE RESTRICT`; verify the actual Product primary-key type before generating the migration. Vendure soft-deletes Products, so the constraint should rarely fire.
- The link is never browser-writable. The service must verify that the Product is assigned to the course's Channel (`course.channelId`) before writing it. A unique index and foreign key cannot establish same-Channel ownership.
- Productless internal courses are permitted. Public catalogue/marketplace publication requires a linked Product. Creating a public catalogue course creates/links its Product through Vendure services; do not require every internal LearningCourse to create a Product.
- ADR-053 D1's scalar channel-scoping rule remains unchanged: `LearningCourse.channelId` stays the tenant scope; the separate Product relationship is a real FK.

### D3 — A `ProductVariant` is a commercial offer, never an academic status

- No "Free Initial Admission" variant. Admission is trainer-controlled; a free variant would turn it into self-service checkout.
- The following create no Vendure Order: trainer-approved direct enrollment, trainer invitation/acceptance, complimentary or scholarship access. Initial zero-cost admission is an academic decision and may have a `TRAINER_APPROVED_ZERO_COST_ADMISSION` access-grant provenance as specified by the Learner Commerce contract; it is not a ProductVariant or checkout.
- Paid continuation offers for already-admitted learners, recurring plans and paid BBB sessions may use variants. A paid variant never creates the initial trainer admission.
- Product type, billing model and fulfilment model remain independent dimensions (ADR-055 D4). No new Product custom field is added for classification until an audited gap exists; classification is derived from the variant's fulfilment mapping (D4).

### D4 — `ProductFulfillmentMapping` is the single variant → target contract

Name and plugin ownership are provisional (OD-3). Proposed fields:

| Field | Purpose |
|---|---|
| `id` | Identifier |
| `channelId` | Tenant ownership |
| `productVariantId` | Vendure variant (unique) |
| `targetType` | `COURSE`, `BBB_ROOM`, `BBB_SESSION` |
| `targetId` | Target resource id |
| `fulfillmentPolicy` | Enumerated delivery/admission behaviour (GraphQL enum, not `String!`) |
| `accessDurationDays` | Optional bounded duration |

Rules:

- One variant maps to exactly one target for the initial implementation. A mapping may not be created if the variant, Product and target are not all in the same Channel.
- The existing mechanisms (`BbbProductAccess`, `BbbScheduledSession.productVariantId`, `Product.customFields.bbbSessionId`) are not deleted by this ADR. They coexist until migrated.
- During coexistence a variant must resolve to exactly one mapping source. A variant found in both the new mapping and a legacy BBB mapping is a configuration error: fulfilment refuses, logs and surfaces a reconciliation item. It never grants twice.
- Retirement of the legacy mappings is a later stage, gated on verifying that marketplace indexing and BBB join behaviour are unchanged.

### D5 — Course fulfilment is a separate path that converges, and does not decide, academic state

- Add a dedicated course fulfilment handler, or a dispatcher keyed by `targetType`. `bbbFulfillmentHandler` is not reused for course variants.
- The trigger is `PaymentSettled` only. `PaymentAuthorized` alone proves no collection and must not issue paid access. Vendure's example may fire earlier; Saa9vi deliberately does.
- The sequence follows the admission-first Learner Commerce contract:
  1. Record the durable commercial fact (the settled order line) and its immutable source reference.
  2. Run an idempotent convergence operation keyed by `orderLineId` (and target), not merely by order or fulfillment, so mixed carts and retries cannot suppress or duplicate line-level outcomes.
  3. Apply a paid-continuation grant only when the learner already has ACTIVE academy admission **and an explicitly trainer-approved `ENROLLED` academic enrollment for this specific course**. ACTIVE academy membership alone is not course-specific admission. The fulfillment path does not create an initial enrollment or make the trainer's decision.
  4. If the course-specific admission precondition is absent, preserve the payment fact, grant no course access, and create an operator-visible reconciliation outcome. The pre-checkout policy and refund/manual-resolution policy must be settled before paid course checkout is enabled.
  5. Keep initial zero-cost access distinct: it follows the trainer-approved admission path and its tenant-approved initial course/cohort policy; it is not created by a paid-order fulfillment event.
- Convergence never overwrites `SUSPENDED`, `WITHDRAWN` or `COMPLETED` enrollments, and never promotes `INVITED` or any other status to `ENROLLED`.
- Recurring plans: the subscription processor appends verified billing-period facts to the access grants. It does not create a Vendure Fulfillment per recurring charge unless a specific accounting need is accepted separately.
- `CourseAccessGrant` fields and the full access predicate are specified by the current Learner Commerce contract (§8.3–8.5) and belong to MCR-2.2. The contract distinguishes trainer-approved zero-cost admission from paid continuation and manual/offline collection provenance. This ADR requires the course fulfilment path to write the appropriate grant and never place payment state on `CourseEnrollment`.
- BBB join authorisation remains entitlement-only. Course-level access and BBB session access stay separate checks (contract §8.2).

### D6 — Adopt Vendure's digital shipping mechanics as part of the contract

Following the Digital Products guide, the implementation adds:

- `ProductVariant.isDigital` custom field.
- A digital-only flag on `ShippingMethod`.
- A digital `ShippingEligibilityChecker` and `ShippingLineAssignmentStrategy`, so digital lines attach to the digital shipping method and physical lines do not.
- An `OrderProcess` that triggers fulfilment on `PaymentSettled` only.
- Per-tenant provisioning of the digital `ShippingMethod` in every tenant Channel, as part of tenant provisioning (new requirement; the guide does not cover multi-tenant channels).
- Storefront checkout that reads eligible shipping methods and assigns the digital method.

Adding custom fields requires a CLI migration (`npx vendure migrate`). Physical fulfilment remains a separate workflow with its own acceptance criteria (ADR-055 D8).

### D7 — Migration and data rules

- Schema changes only via `npx vendure migrate`; inspect the generated file before running it. Never use `--from-empty` for an incremental change.
- Backfill existing `LearningCourse` rows (create Products, set `productId`) through approved Vendure Admin GraphQL operations. No direct SQL business-data changes.
- Existing `title`/`slug`/`description` are reconciled to the new Product once, before the mirror rule takes effect. Slug conflicts follow a documented rule decided in the ADR review (Product slugs are per-Channel and translatable; the existing unique `(channelId, slug)` index on `LearningCourse` is the other constraint).

---

## Alternatives rejected

| Alternative | Reason |
|---|---|
| Replace `LearningCourse` with `Product` | Product has no tools, enrollment, instructor, participation or session model. |
| Keep two unrelated catalogues | Duplicate catalogue fields, no canonical purchase target, divergent publication state. |
| `Product.customFields.learningCourseId` as the link | No referential integrity or uniqueness; weakens tenant verification. |
| A separate product mapping in each plugin | Duplicate, conflicting grants with unclear precedence (the risk the merged RFC already names in its product-to-room mapping paragraph). |
| "Free admission" ProductVariant | Converts trainer-controlled admission into self-service checkout; a variant is not an academic status. |
| Payment states on `CourseEnrollment` | Contradicts the Learner Commerce contract §8.1; payment failure must not rewrite academic history. |

---

## Consequences

- Every catalogue course has one Product, so storefront, marketplace listing, pricing and orders reuse Vendure's catalogue instead of a parallel one.
- Course creation becomes a two-record transactional operation; tenant provisioning gains a digital shipping method.
- Course variants get no automatic fulfilment until D5 and D6 are built; today only BBB variants do.
- The legacy BBB mapping mechanisms live alongside the new mapping for a transition period. The conflict rule in D4 is a hard requirement during it.
- A buyer without academy admission pays but receives no access until the reconciliation outcome is resolved. The approved policy for that case (refund versus manual admission) must be defined before storefront launch.
- This is a design record only. It is not implementation evidence.

---

## Open decisions

| ID | Question | Recommendation |
|---|---|---|
| ID | Decision | Proposed default for review | Remaining review |
|---|---|---|---|
| OD-1 | Productless courses | Permit productless internal/tenant-managed academic courses. Require Product linkage before public catalogue/marketplace exposure. Require a mapped ProductVariant before paid purchase. | Confirm scope and publish-gate location. |
| OD-2 | Product relationship | Nullable unique `LearningCourse.productId` real FK to `Product.id`, `ON DELETE RESTRICT`; retain service-level same-Channel validation. Verify actual id type before migration. | Confirm against Vendure entity metadata and migration behavior. |
| OD-3 | Mapping ownership | Platform-level commerce/fulfillment module behind a port; avoid plugin-to-plugin imports. | Confirm exact owning module and API boundary during implementation design. |
| OD-4 | Admission and paid checkout | Paid continuation is offered to an already admitted learner. Require ACTIVE academy membership and explicit `ENROLLED` status for the target course before checkout; settlement only extends paid continuation and never creates admission. If an invariant violation still settles, preserve payment, grant no access and reconcile under an approved refund/manual-resolution policy. | Confirm enforcement point and operator/refund policy before enabling paid course checkout. |
| OD-5 | Slug reconciliation | Product becomes canonical for public catalogue slug. Before backfill, detect per-Channel/language collisions; require an explicit reviewed resolution and preserve old course URLs through redirects/aliases where supported. Never silently overwrite or auto-rename without an audit record. | Specify redirect/alias mechanism and collision resolution UX before backfill. |

---

## Amendments requested to MCR-0.2

1. Record Product as canonical catalogue identity and `productId` as the link (D1–D2).
2. Add Product creation to the course creation workflow, and the publish gate.
3. Decide OD-1 and OD-2 before any entity change.
4. Specify `ProductFulfillmentMapping` and the coexistence/conflict rule with existing BBB mappings (D4).
5. Define `ProductVariant.isDigital`, the digital `ShippingMethod` flag and per-Channel provisioning (D6).
6. Specify the course fulfilment handler, the `PaymentSettled` trigger and the convergence sequence (D5).
7. Reconcile the Course Admission RFC with the Learner Commerce contract on `CourseEnrollment` states and `CourseAccessGrant` ownership, with the contract prevailing.
8. Backfill through Admin GraphQL only (D7).

---

## Acceptance tests required before implementation is accepted

- Two-tenant isolation: a settled order in tenant A can never create access for a course in tenant B.
- Same-Channel verification: linking a Product in another Channel to a course is rejected.
- Productless internal course: internal academic course remains usable without a Product; public catalogue/marketplace publication is rejected until linked.
- Admission boundary: learner interest, admin notification/contact, agreed joining time, and ACTIVE academy membership alone do not create course enrollment or course access; only explicit trainer disposition invokes invite/enroll.
- Paid continuation: settled purchase does not create initial academic admission; only an already trainer-approved `ENROLLED` course learner with the required ACTIVE academy membership can receive the paid continuation grant.
- Payment replay and per-order-line fulfilment idempotency: replays/retries create no duplicate grants; one failed/unmapped line does not suppress processing of other eligible lines in a mixed order.
- `PaymentAuthorized` without `PaymentSettled` issues no paid access.
- Mixed cart: digital course variant plus physical item routes to the correct shipping methods.
- Conflicting mapping: a variant mapped in both new and legacy BBB mechanisms is refused and logged.
- Convergence never changes `INVITED`, `SUSPENDED`, `WITHDRAWN` or `COMPLETED` enrollments.
- Existing BBB room/session purchase, entitlement creation and marketplace indexing behave as before.

---

## Review gates before acceptance

1. Review and confirm the proposed defaults in OD-1 to OD-5; none is ACCEPTED by this proposal alone.
2. Verify the current `main` Learner Commerce contract is authoritative for interest-led, trainer-controlled zero-cost admission and optional later collection. Reconcile any older Course Admission RFC language that implies payment-first enrollment.
3. Confirm the multi-tenant digital `ShippingMethod` provisioning design against the Vendure docs and test the shipping assignment behavior for mixed carts.
4. Confirm the actual Product primary-key type and same-Channel service validation before schema design.
5. Update status only after explicit architecture review.

## Related

- ADR-053 — LearningPlugin course domain
- ADR-055 — marketplace commerce and revenue model (D4, D8)
- ADR-042 — marketplace listing eligibility
- `docs/architecture/learner-commerce-domain-contract.md`
- `docs/saa9vi-merged-course-admission-rfc.md`
- `docs/implementation/marketplace-commerce-revenue-worklist.md` (MCR-0.2, MCR-0.3, MCR-2.2)
- Vendure Digital Products guide — https://docs.vendure.io/current/core/how-to/digital-products
