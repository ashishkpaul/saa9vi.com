As the lead architect for this project, would you agree with this story and the corresponding ADR?


> **✅ Resolution note (post-review sync):** All items in this assessment have since been addressed in `docs/architecture/platform-adr.md`:
>
> | Item | Status |
> |---|---|
> | 1. BBB migration framing ("interim, not incomplete") | ✅ Fixed — ADR-002 now states primary join path migrated; `BbbEnrollment` scoped to trial-conversion audit trail, Phase 1.5 cleanup pending. INV-003 updated to match. |
> | 2. PILOS config surface claim | ✅ Resolved by *building* the surface — `cameraRatio`, `micRatio`, `videoWeight`, `micWeight`, `listenerWeight` were added to `BigBlueButtonPluginOptions` and wired to `BBB_CAMERA_RATIO`/etc. env vars in `vendure-config.ts`, making the ADR's "operator-configurable" claim true. See `roadmap.md` Phase 1.5 completed list. |
> | 3. Grace-period race condition | ✅ Fixed — ADR-026 rationale explicitly documents the delayed-BullMQ-job window as an accepted business tolerance. |
> | 4. `simulateBbbWebhook` not implemented | ⚠️ Still open (distinct from BUG-020) — BUG-020 only fixed the *reference*: CausalMapper now returns `isPending: true` for the `BbbWebhookEvent` step so LoadOrchestrator skips it cleanly. The `simulateBbbWebhook` resolver itself still does not exist in `BbbAdminResolver` (confirmed by the pending-skip comment in `causal-mapper.ts`); both entries are simultaneously true — a naming/reference fix and the unimplemented mutation. |
> | 5. Commission attribution gap | ✅ Fixed — ADR-021 now carries an "Open Design Questions" block (storefront passes `referrerCode`/`utm_source`; Vendure classifies per INV-008). Cross-referenced from RFC-001 Appendix C-2, `domain-model.md` (DL-030), and `platform-story.md`. |
> | Structural: LoadSimulationPlugin on Shop API | ✅ Fixed — BUG-019: `runLoadTest` moved to Admin API with `@Allow(Permission.SuperAdmin)` (verified in `load-simulation.resolver.ts`; `plugin-map.md` lists `LoadSimulationAdminResolver` under Admin API SuperAdmin). |

> I've read both documents thoroughly and reviewed the source code. Here's my honest assessment:

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━


## Overall: Strong foundation, a few things worth questioning

The architecture is coherent, well-reasoned, and shows genuine thinking about multi-tenancy at scale. The invariants are load-bearing and correctly
identified. The story is accurate as a narrative. But there are places where I'd push back or flag concerns.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━


### Things I fully agree with

Channel = Tenant (INV-001). Using Vendure's existing channel system as the tenant boundary is the right call. Building a parallel tenantId system would create
exactly the dual-source-of-truth drift the ADR warns about. The DL-010/011/017 exceptions (scalar channelId without join table for high-frequency lookup
entities) are pragmatic and correctly reasoned.

Append-only ledger (INV-002). This is non-negotiable for billing. The extension of the principle to BbbCapacityAlertLog (CI-004) and ad spend in Phase 3 shows
the pattern is understood, not just copied.

Persist-before-process webhooks (INV-004). Critical for correctness. Correctly implemented. The code matches the invariant.

GrantReaderService seam (RFC-001 Q-009). The cleanest solution to the Phase 1 / Phase 2 grant union gap. Touching consumeGrant() to add a union query would
make it a Phase 2 concern leak into Phase 1 code. A new indirection layer is the right call.

Capacity intelligence is advisory, never blocking (INV-012 / DL-025). This is the most important design decision in ADR v1.6. A coaching platform that blocks
a live class because its infra is undersized has failed its users in an unrecoverable way. The 48-hour forecast window gives operators time to act. This is
correct.

Multivendor plugin rejection (DL-019). The reasoning is sound. Saa9vi is Shopify/Kajabi model, not Amazon/Etsy. Installing the plugin would introduce order-
splitting machinery for a problem that doesn't exist here.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━


### Things I'd push back on or flag

1. The BbbEnrollment → BbbEntitlement migration is described as "complete" in ADR v1.5/v1.6 but the story still references the old path.

The ADR says room-access migration is complete — joinRoom() now uses BbbEntitlementService.hasAccess(). But the story (Section 5, "Student clicks Join class")
still says: "checks for a valid bbb_room entitlement. If not, it checks for a valid bbb_session entitlement" — which is correct — but earlier in the same
section it says the auth waterfall checks org membership first, then falls through to bbb_room entitlement. The code confirms this. The story is consistent
with the code, but the ADR §14 Phase 1.5 "room-access migration complete" claim needs to be held against the fact that BbbEnrollment rows are still being
created by convertTrialToEnrollment. That's not a completed migration — it's a frozen interim state. The ADR should say "migrated for the primary join path;
BbbEnrollment retained for trial conversion audit trail pending Phase 1.5 cleanup."

2. The PILOS formula parameters are presented as configurable but there's no configuration surface.

ADR §6A says cameraRatio, micRatio, videoWeight, etc. are "operator-configurable via BigBlueButtonPlugin.init() options." But BigBlueButtonPluginOptions in
types.ts doesn't have these fields. The ADR specifies defaults but the configuration path is fictional right now. Either add them to
BigBlueButtonPluginOptions when implementing Task 8, or remove the "configurable" claim from the ADR. Undocumented magic defaults are worse than hardcoded
ones.

3. SubscriptionEntitlement as pure computed state (RFC-001 §2.2) creates a subtle race condition.

The RFC defines subscription entitlement as a runtime computation against SubscriptionEnrollment.status and currentPeriodEnd. This means access is computed
from a mutable row. Under the dunning FSM, status transitions from IN_GRACE → SUSPENDED are time-driven — the grace-expired BullMQ job updates the enrollment
row. If that job is delayed (BullMQ backed up, Redis reachable but slow), a student whose grace period has technically expired will still see
hasAccess() = true until the job runs. For a billing platform, this is probably acceptable — the ADR's answer in Q-003 (allow session to complete if in-
session during suspension) implies this tolerance is deliberate. But it should be explicitly documented as a known acceptable gap, not left implicit.

4. The simulateBbbWebhook mutation in CausalMapper is registered in the schema spec but doesn't exist in the actual admin API.

The what-next.md (previous iteration) correctly flagged this, and the current CausalMapper references SIMULATE_BBB_WEBHOOK_MUTATION. But searching the admin
schema shows this resolver isn't implemented. The LoadSimulationPlugin will fire this mutation against a live endpoint and get a
Field 'simulateBbbWebhook' doesn't exist error. Until the resolver exists, the BbbWebhookEvent lifecycle step should be marked isPending: true in CausalMapper
, the same way Phase 2 events are. Otherwise every load test run will silently fail on this step.

5. The three-stream revenue model in ADR-014 has a commission attribution gap.

Stream 2 (marketplace commission) relies on Order.customFields.orderSource = 'marketplace' being set at checkout. The ADR says this is "set at checkout from
session referrer." But who sets it, and how? The storefront captures a referrer — which means the storefront is making a business decision about whether an
order is marketplace-sourced. This violates INV-008 (business logic in Vendure). The correct design is: the storefront passes a referrerCode or utm_source
parameter to the checkout mutation, and Vendure-side logic classifies it. The current spec leaves this gap unaddressed — it's a Phase 3 concern, but it should
be flagged before Phase 3 design begins, not discovered mid-implementation.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━


### One structural question

Why is LoadSimulationPlugin a Shop API extension?

runLoadTest is a superadmin-only operation. It fires real mutations against the Shop API as part of its work, but the entry point — the mutation that triggers
a load test — should be an Admin API extension, not a Shop API extension. A production shop API exposing runLoadTest is a DoS vector. I'd move the resolver
to adminApiExtensions with @Allow(Permission.SuperAdmin) before this goes anywhere near a non-dev environment.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━


### Summary verdict

Agree with the core architecture. The invariants are correct and the story accurately reflects the code. The four specific concerns (trial conversion interim
state labeling, fictional PILOS config surface, grace period race condition documentation, simulateBbbWebhook not implemented) are all fixable without
architectural change. The commission attribution gap and the LoadSimulationPlugin API surface are the two that need design decisions before Phase 3 and
production deployment respectively.

 ▸ Credits: 0.42 • Time: 47s
