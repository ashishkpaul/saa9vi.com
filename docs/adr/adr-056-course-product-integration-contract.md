# ADR-056 — Course–Product Integration Contract

**Status:** PROPOSED — design contract for review; no schema, code or data change is authorised by this document
**Date:** 19 November 2026
**Baseline verified against:** `main` @ `5bf62f9`
**Amends (if accepted):** ADR-053 (adds a Product link to `LearningCourse`; D1 channel-scoping rule is unchanged)
**Refines:** ADR-055 D4 and D8; closes the design questions in worklist item MCR-0.2
**Depends on:** `docs/architecture/learner-commerce-domain-contract.md` (§8 access model), which this ADR follows where it conflicts with `docs/saa9vi-merged-course-admission-rfc.md`

---

## Context

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
- Product enabled state, course publication status and marketplace listing eligibility (ADR-042) are separate. Disabling a Product stops new sales. It does not suspend, withdraw or delete any learner's academic record or an already-valid access grant.
- `LearningCourse` is not replaced by `Product`. A Product has no tools, enrollment state, instructor assignment, participation or session association, and these must not be bolted onto it.

### D2 — The link is a unique, service-verified `LearningCourse.productId`

- Cardinality for MVP is Product 1 : 1 LearningCourse for catalogue courses. This is an Saa9vi constraint, not a Vendure restriction. Bundles and multi-course packs are deferred (ADR-055 D4, contract LC-02).
- The column is `LearningCourse.productId`, unique, not a `Product.customFields` string. A custom-field string has no referential integrity and no uniqueness. The existing `bbbSessionId` fields exist for indexer reads and are not precedent for an ownership link.
- The link is never browser-writable. The service must verify that the Product is assigned to the course's Channel (`course.channelId`) before writing it. A unique index cannot establish this.
- Course creation creates the Product (disabled) and the course in one transaction through Vendure services. A catalogue course cannot be published without a linked Product (publish gate).
- The column is nullable at the database level, for backfill and for explicitly internal-only courses. Whether productless internal courses are permitted at all is open decision OD-1.
- Whether the link is a real foreign key or a scalar column following ADR-053 D1 is open decision OD-2. Recommendation: a real foreign key with `ON DELETE RESTRICT`. Vendure soft-deletes Products, so the constraint will rarely fire. ADR-053 D1's scalar rule concerned channel scoping, which this ADR keeps unchanged via the explicit service-level channel check.

### D3 — A `ProductVariant` is a commercial offer, never an academic status

- No "Free Initial Admission" variant. Admission is trainer-controlled; a free variant would turn it into self-service checkout.
- The following create no Vendure Order: trainer direct enrollment, trainer invitation, complimentary or scholarship access. They create an auditable free/manual source on the access side, per contract §8.2–8.4.
- Paid fixed-term offers, recurring plans and paid BBB sessions are variants.
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
- The trigger is `PaymentSettled` only. `PaymentAuthorized` alone proves no collection and must not issue paid access. Vendure's example may fire earlier; Saa9vi deliberately does not.
- The sequence follows contract §8.4:
  1. Record the durable commercial fact (the settled order line).
  2. Run an idempotent convergence operation, keyed by `orderLineId`, mirroring `BbbCapacityGrant` idempotency.
  3. If the customer has ACTIVE academy admission, create or activate the permitted `CourseEnrollment` through the Learning domain service, then create the time-bounded `CourseAccessGrant`.
  4. If admission is absent, preserve the payment fact, grant no learning access, and create an operator-visible pending/reconciliation outcome handled under the approved refund or manual-admission policy.
- Convergence never overwrites `SUSPENDED`, `WITHDRAWN` or `COMPLETED` enrollments, and never promotes them to `ENROLLED`.
- Recurring plans: the subscription processor appends verified billing-period facts to the access grants. It does not create a Vendure Fulfillment per recurring charge unless a specific accounting need is accepted separately.
- `CourseAccessGrant` fields and the full access predicate are specified by the contract (§8.2–8.3) and belong to MCR-2.2. This ADR requires only that the course fulfilment path write that entity and no payment state onto `CourseEnrollment`.
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
| OD-1 | May a `LearningCourse` exist without a Product, or is the link mandatory? | Mandatory to publish; nullable in the database for backfill. Permit internal-only productless courses only if there is a real use for them. |
| OD-2 | Real foreign key or scalar `productId`? | Real foreign key, `ON DELETE RESTRICT`, plus the service-level channel check. |
| OD-3 | Which plugin or platform module owns `ProductFulfillmentMapping` and the dispatcher? | A platform module behind a port, following the `LearnerAdmissionPort` pattern (ADR-053 D2), to avoid plugin-to-plugin coupling. |
| OD-4 | Policy when a purchaser lacks ACTIVE admission: refund, manual admission, or block at cart time? | Contract §8.4 behaviour (preserve payment, no access, reconcile); decide the operator policy. |
| OD-5 | Slug conflict rule when reconciling existing course slugs with Product slugs. | Decide before backfill. |

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
- Payment replay and fulfilment idempotency: replays and retries create no duplicate grants or enrollments.
- `PaymentAuthorized` without `PaymentSettled` issues no paid access.
- Mixed cart: digital course variant plus physical item routes to the correct shipping methods.
- Conflicting mapping: a variant mapped in both new and legacy BBB mechanisms is refused and logged.
- Convergence never changes `SUSPENDED`, `WITHDRAWN` or `COMPLETED` enrollments.
- Existing BBB room/session purchase, entitlement creation and marketplace indexing behave as before.

---

## Review gates before acceptance

1. Resolve OD-1 to OD-5.
2. Reconcile the merged Course Admission RFC with the Learner Commerce contract (MCR-2.2 owns `CourseAccessGrant` detail).
3. Confirm the multi-tenant digital `ShippingMethod` provisioning design against the Vendure docs.
4. Update status after technical review.

## Related

- ADR-053 — LearningPlugin course domain
- ADR-055 — marketplace commerce and revenue model (D4, D8)
- ADR-042 — marketplace listing eligibility
- `docs/architecture/learner-commerce-domain-contract.md`
- `docs/saa9vi-merged-course-admission-rfc.md`
- `docs/implementation/marketplace-commerce-revenue-worklist.md` (MCR-0.2, MCR-0.3, MCR-2.2)
- Vendure Digital Products guide — https://docs.vendure.io/current/core/how-to/digital-products
