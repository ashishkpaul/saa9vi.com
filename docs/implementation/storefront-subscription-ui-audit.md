# Storefront Subscription UI Audit (2026-09-16, post-ADR-039)

> **STATUS: HISTORICAL — decision made.** The actor-model decision was recorded in the canonical worklist (`UI-1`, commit `7d80854`): **option (b) — Portal Admin subscribes tenants via the Admin API** for the current phase. Dashboard subscription visibility subsequently shipped in `91ca476`. Storefront subscription mutations remain deferred; Shop-API self-service requires a new ADR. This document is retained as the discovery evidence behind that decision.
>
> **Update (2026-09-22):** the *read* half of this surface is now specified for implementation as the Shop read-only commercial API in `saa9vi-comprehensive-integration-and-commercial-plan.md` §3.5 (`mySubscription`, `myLiveUsage`, `availableSubscriptionPlans`), whose rules restate this document's findings: tenant resolved from `RequestContext` only, no `channelId` argument, and no mutation. Finding 1 (zero subscription surface in the storefront) and finding 4 (never assume return-from-Razorpay means active) remain the governing constraints for that work; finding 5 (R3 `PaymentMethodHandler` is a separate integration) is unchanged.

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
