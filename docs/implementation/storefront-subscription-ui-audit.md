# Storefront Subscription UI Audit (2026-09-16, post-ADR-039)

> Scratch audit record - to be folded into the canonical worklist when the actor-model decision is made.

Audited `nextjs-starter-vendure` against the post-ADR-039 schema. Findings:

1. **Zero subscription surface exists in the storefront.** No reference to `subscribeToPlan`, `OrganizationSubscription`, `SubscriptionPlan`, `providerShortUrl`, or any subscription state anywhere in `src/`. The `account/` area has orders/learning/profile/settings - no billing or subscription page. The `register-academy/` tenant-onboarding flow has **no plan-selection or payment-authorization step**.
2. **Actor-model gap (the decisive design decision for the UI layer):** `subscribeToPlan` and `createSubscriptionPlan` live in the **Admin API** and are `@Allow(Permission.SuperAdmin)`-gated. The Shop API exposes no subscription mutations at all. A customer-facing "choose plan -> authorize" UX therefore cannot be driven from the storefront as-is. Options:
   - (a) tenant owner uses the Vendure Dashboard - needs providerStatus/short_url visibility there, no storefront work;
   - (b) Portal Admin subscribes on behalf of tenants - admin-side UX only;
   - (c) add an authenticated Shop-API subscription mutation for the tenant-owner role - new backend surface, ADR-worthy; must preserve the trust boundary: the storefront may only read `providerShortUrl` for the tenant's own subscription and must **re-query Saa9vi state after authorization, never set `active` locally**.
3. gql.tada codegen (`npm run codegen`) must be re-run against the updated backend schema before any UI work; the new fields are absent from `src/graphql-env.d.ts`.
4. UI state machine to mirror (ADR-039): `pending_provider_auth` -> "Complete Payment Authorization" CTA linking the tenant's own `providerShortUrl`; `active` -> active plan; `past_due` -> payment attention; `cancelled` -> cancelled. **Never assume return-from-Razorpay means active** - the webhook transition is authoritative.
5. Normal-checkout `PaymentMethodHandler` (one-time commerce) remains a separate integration per ADR-038 - do not conflate with the subscription UX.

**Sequencing decision required (actor model a/b/c) before any storefront implementation.**
