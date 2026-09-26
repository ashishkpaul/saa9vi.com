# ADR-046: Tenant Self-Serve Plan Change and Cancellation (Shop API)

- **Status:** Accepted
- **Date:** 2026-09-26
- **Deciders:** Platform architecture
- **Supersedes:** — (extends ADR-044; resolves the deferral in UI-1)
- **Related:** ADR-038, ADR-039, ADR-044, UI-1 (`integration-gaps-worklist.md`), plan §3.5/§3.9

## Context

ADR-044 added `changeOrganizationSubscriptionPlan` / `cancelOrganizationSubscription` to the
**Admin** API, both `@Allow(Permission.SuperAdmin)`. UI-1's actor-model decision (option (b):
"Portal Admin subscribes tenants via the Admin API") deliberately deferred any Shop-API
mutation pending a new ADR — slice 8/9 shipped **read-only** tenant dashboard access for
exactly this reason: *"Do not expose the existing Admin `subscribeToPlan(channelId, planId)`
through the Shop API"*.

Track 3 of the roadmap now asks for genuine tenant self-serve upgrade/cancel in
`edu-frontend`. That requires a Shop-API surface, which does not exist today. This ADR is
that surface's design — the prerequisite this roadmap item has been blocked on since slice 9.

The trust boundary is materially different from the read contract this extends. A read
returning `mySubscription`/`myLiveUsage` cannot cost anyone money if the ownership check is
wrong. A mutation that changes plan calls `RecurringBillingProvider` and can create a real
provider subscription, or cancel one, on the strength of whoever satisfies
business-account ownership. Every decision below follows from that difference.

## Decision

1. **Two new Shop mutations**, resolving the channel from `ctx.channelId` only — no
   `channelId` argument, same rule as `mySubscription`/`myLiveUsage` (UI-1 rule: *"replicating
   the Admin mutation's signature into the Shop API is explicitly forbidden"*). They return a
   **dedicated result type**, not the Admin API's `OrganizationSubscription` — that type is
   defined only in `subscription-admin.schema.ts` and does not exist in the Shop schema, and
   even if it did, it carries provider internals the Shop surface must not expose (decision 2):

   ```graphql
   type MySubscriptionChangeResult {
     subscription: MySubscription!
     """
     Present only when this call requires customer authorization (Razorpay e-mandate/UPI
     Autopay). Null when no action is needed. A one-time value returned by the mutation —
     never persisted onto MySubscription, never present on a later `mySubscription` read.
     """
     authorizationUrl: String
   }

   requestMySubscriptionPlanChange(planId: ID!): MySubscriptionChangeResult!
   cancelMySubscription(atPeriodEnd: Boolean = true): MySubscriptionChangeResult!
   ```

   Both `@Allow(Permission.Authenticated)` at the resolver. Both **delegate to the existing
   `SubscriptionService.changeOrganizationSubscriptionPlan` /
   `cancelOrganizationSubscription`** rather than duplicating their FSM logic; the Shop
   resolver is authorization + channel resolution + cooldown check + result-shaping only,
   never a second implementation of ADR-044's transaction.

2. **The provider-internals boundary from slice 8 is preserved, not reopened.**
   `subscription-shop.schema.ts`'s own module comment states `providerShortUrl` (along with
   `providerPlanId`, `providerStatus`, `billingCustomerId`) is *"NEVER exposed here."* This ADR
   does not amend that rule for `MySubscription` — the redirect URL a provider-wired upgrade
   needs is returned **only** on `MySubscriptionChangeResult`, at the moment the mutation
   produces it, and is never added to the persistent read model.

   **Transient-origin invariant:** `authorizationUrl` on `MySubscriptionChangeResult` must be
   sourced strictly from the transient operation result of the provider call made during this
   invocation. Persisted `subscription.providerShortUrl` is **never** used as a fallback or
   source for this field. Specifically:
   - Provider-wired change (Free → Paid, or Paid → Paid to a different provider plan):
     provider creates new subscription and returns `short_url` → `authorizationUrl` is that
     exact transient URL. If the provider indicates authorization is required but returns no
     URL, the mutation fails closed rather than returning `authorizationUrl: null`.
   - Same-plan short-circuit: no provider call is made → `authorizationUrl: null`.
   - Provider-free change (Paid → Free, or Free → Free): no provider call is made →
     `authorizationUrl: null`.

   This eliminates the staleness hazard where `providerShortUrl` (which is not cleared on
   activation) could otherwise leak into a self-serve response. The subscription stays in its
   pre-change status (per ADR-039's FSM) until the provider webhook confirms; **the frontend
   must not treat a mutation response without a completed redirect as "upgraded"** — render
   the returned `subscription.status`, not client-side optimism.

3. **Rate limit self-serve plan changes per channel via an atomic cooldown.**
   Nothing today limits how often `changeOrganizationSubscriptionPlan` can be called; a
   SuperAdmin-only mutation had an implicit rate limit (a human operator). A tenant-facing
   mutation does not.

   `pg_advisory_xact_lock` is a mutual-exclusion primitive bound to a database transaction,
   not an expiring cooldown; furthermore, ADR-039/044 deliberately places provider HTTP calls
   outside database transactions so external latency does not tie up Postgres connections.
   Therefore:
   - Enforce a 5-minute per-channel cooldown using an atomic expiring key in Redis
     (`SET key NX EX 300`, keyed by `channelId`).
   - The cooldown check executes before calling the billing provider. Requests rejected by the
     cooldown fail closed and never invoke the provider.
   - Consistent with platform security rules for billing-critical operations, Redis failure
     must fail closed (reject mutation) rather than silently bypassing rate limiting.
   - Postgres transaction locks remain available inside the narrow local transaction where
     needed, but do not serve as the inter-request cooldown.

4. **Cancellation stays symmetric with the Admin mutation's semantics** —
   `atPeriodEnd: true` remains the tenant-facing default (matches the Admin default and avoids
   a tenant accidentally losing access mid-period), `atPeriodEnd: false` is exposed but the
   frontend should treat it as a destructive confirmation action (immediate loss of
   subscription-backed commercial entitlements), not a casual toggle.

5. **No new downgrade guard beyond ADR-044's existing one.** The `trialing` +
   lower-priced-plan rejection (ADR-044 decision 5) already fires inside
   `SubscriptionService`; the Shop wrapper inherits it for free by delegating rather than
   reimplementing. This ADR does not add a "confirm downgrade" UX requirement at the API
   layer — that is a frontend concern, not a contract concern.

6. **Audit trail and actor provenance:**
   `TenantBusinessAccountService.assertBusinessAccount(ctx)` allows platform SuperAdmin
   access by design (since SuperAdmin is assigned to all tenant channels for read support).
   For these self-serve mutations, actor provenance must be truthful:
   - Introduce a dedicated guard `assertTenantSelfServeBusinessAccount(ctx)` (or inspect the
     resolved role) to identify the caller:
     - Tenant channel administrator → audit log records `actor: 'tenant-self-serve'`.
     - Platform SuperAdmin calling the Shop mutation → audit log records
       `actor: 'platform-superadmin'`.
     - Learner / customer or unauthorized administrator → refused (`ForbiddenError`).
   - Logging explicit caller provenance prevents audit drift and cleanly separates tenant-driven
     lifecycle changes from operational overrides.

## Consequences

- Resolves UI-1's deferral: Track 3 Option A becomes buildable once this ADR is accepted and
  implemented, in that order — same discipline as R3 (contract before code).
- Portal Admin's existing Admin-API mutations (Track 3 Option B) are **unaffected** — this ADR
  adds a parallel, tenant-scoped entry point; it does not change or remove the SuperAdmin
  path, which remains the correct mechanism for support-initiated plan changes (e.g. a tenant
  who can't complete authorization themselves).
- New required evidence, mirroring R3/R4's evidence-first pattern:
  (a) ownership-boundary proof — a Customer-role session and a different-channel Administrator
      must both be refused; caller provenance is accurately logged,
  (b) idempotency and cooldown proof — requests within 5 minutes are rejected by the cooldown
      without duplicate provider calls,
  (c) redirect-flow proof — a provider-wired upgrade's `authorizationUrl` is returned on
      `MySubscriptionChangeResult` transiently and the subscription's status does not change
      until a webhook confirms it,
  (d) boundary-regression proof — a `mySubscription` read, taken immediately after a
      provider-wired change, must never carry `providerShortUrl`/`authorizationUrl` or any other
      provider-internal field,
  (e) transient-origin proof — same-plan short-circuit returns `authorizationUrl: null` even if
      the underlying row retained a legacy `providerShortUrl`.
- `schema-shop.graphql` gains two mutations; codegen regenerates; `edu-frontend`'s generated
  types pick them up per the existing "backend contract → codegen → UI" discipline (UI-1 rule
  2, unchanged by this ADR).

## Alternatives considered

- **Use PostgreSQL advisory locks for the 5-minute cooldown:** rejected — advisory xact locks
  release on transaction commit and cannot span 5 minutes without holding a DB connection open
  across provider HTTP requests, violating ADR-039/044's external-call boundary.
- **Widen the existing Admin mutations' `@Allow` to include the tenant's own Administrator
  role:** rejected — `Permission.Administrator` is not channel-scoped the way this needs;
  widening the Admin API mutation risks a tenant Administrator being able to call it for a
  channel they don't own via the Admin API's existing multi-channel session model, which the
  Shop API's `ctx.channelId`-only resolution specifically prevents. A new Shop mutation is the
  narrower, already-precedented boundary.
- **Let the frontend call `subscribeToPlan`/`changeOrganizationSubscriptionPlan` directly with
  a client-supplied `channelId`:** rejected outright by UI-1's existing rule; would let one
  tenant's authenticated session name another tenant's channel.
- **Skip the rate limit, rely on ADR-044's same-plan short-circuit alone:** rejected — the
  short-circuit only prevents a *duplicate-plan* retry from creating a second provider
  subscription; it does nothing to stop a tenant rapidly alternating between two different
  plans, each of which is a real provider call.