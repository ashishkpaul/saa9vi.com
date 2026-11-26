# ADR-057 — Keycloak SSO and Vendure-Owned Monthly Subscription Gate for PILOS

**Status:** ACCEPTED  
**Date:** 26 November 2026  
**Deciders:** Saa9vi platform architecture  
**Supersedes:** ADR-047's grant / attendee-hour billing model as the current commercial billing basis. Historical records are retained; this ADR does not authorise destructive cleanup.  
**Related:** ADR-001, ADR-039, ADR-041, ADR-047, ADR-051, INV-001, INV-004, INV-032

## Context

Saa9vi is a multi-tenant education commerce platform. A Vendure Channel represents one tenant (INV-001). Tenant owners pay Saa9vi a fixed monthly subscription for the platform services that include access to the shared PILOS / BigBlueButton service.

A tenant owner must be able to authenticate to Vendure and renew the subscription even when that subscription has expired or been suspended. When the tenant subscription is active, the tenant's authorised moderators must be able to authenticate through Keycloak and use the single hosted PILOS instance to operate rooms and meetings.

PILOS already has an OIDC integration path in its upstream Laravel application. Vendure also has a Keycloak Admin authentication integration path. The architecture must use those existing integration points rather than create another identity authority or a parallel meeting operations application.

The former BBB grant-minute and attendee-hour billing model in ADR-047 conflicts with the agreed fixed monthly subscription model. PILOS meeting and attendance records remain valuable operational and audit records, but they are not the basis for calculating the tenant's monthly Saa9vi subscription fee.

## Decisions

### D1 — System-of-record boundaries

| Concern | Authority | Responsibility |
|---|---|---|
| Tenant identity and scope | Vendure | The Channel is the tenant identity; no parallel Vendure tenantId is introduced |
| Seller subscription and Saa9vi billing | Vendure | Plan, monthly subscription period, payment state, renewal, suspension and expiry |
| User authentication | Keycloak | OIDC identity for seller and moderator sign-in |
| Tenant membership and operational roles | Vendure / PILOS | Vendure owns seller/channel relationships; PILOS enforces its local moderator membership and operational permissions |
| Rooms, meetings, attendance, recordings and BBB lifecycle | PILOS | Operational system of record for live meeting services |
| Live video service | BigBlueButton | Meeting media and conferencing service |

PILOS consumes the effective tenant subscription entitlement from Vendure. PILOS does not become the commercial subscription authority, and Vendure does not become a second source of truth for PILOS meeting operations.

### D2 — Vendure Channel is the tenant key across the integration

The existing invariant remains binding: one Vendure Channel represents one tenant. The integration uses the Channel ID as the stable external tenant reference when mapping the tenant into PILOS.

The PILOS-side tenant/organisation mapping must resolve to exactly one Vendure Channel. If the existing PILOS data model cannot store that external reference, add only the minimal mapping required on the PILOS side. Do not introduce a second tenant identity or a tenantId column into Vendure entities.

Every moderator must have an explicit membership in the relevant PILOS tenant/organisation. A successful Keycloak login alone does not grant access to every tenant.

### D3 — Keycloak is the shared identity provider, not the subscription authority

1. Keycloak is the OIDC identity provider for PILOS and Vendure Admin SSO.
2. PILOS should use its native upstream Laravel OIDC integration and mapping configuration. A separate Next.js authentication broker or a second user/password system is not introduced as another authority.
3. Vendure uses its Keycloak Admin authentication strategy alongside the configured Vendure Admin authentication path. Subscription state must not be checked by the authentication strategy.
4. Cross-system identity is linked by the validated OIDC issuer and subject pair (iss + sub). Email is profile data, not a reliable identity key and not sufficient by itself for automatic account linking.
5. Keycloak authenticates the person. Vendure channel assignment and PILOS tenant membership/roles continue to determine what that person may do. Token role claims must not override tenant ownership or PILOS membership checks.

### D4 — Vendure owns the fixed monthly tenant subscription

The tenant's Saa9vi service subscription in Vendure is the sole commercial record for PILOS / BBB service access.

- The charge is the agreed fixed monthly subscription amount for the tenant's selected plan.
- The monthly subscription period and its effective status are determined by Vendure's subscription lifecycle and payment records.
- Plan differences may control included capabilities or operational limits. Those are plan entitlements, not attendee-minute or per-meeting prices.
- No invoice or renewal amount is calculated from meeting count, meeting duration, participant count, attendee seconds, attendee minutes, or moderator count.
- Learner-to-tenant product/course payments and the zero-commission marketplace model remain separate from this tenant-to-Saa9vi subscription.

### D5 — PILOS receives a tenant-level entitlement projection

Vendure publishes the effective subscription state for the tenant, not a separate copy of the subscription for every moderator.

The integration contract must carry at least:
- the external tenant reference (the Vendure Channel ID);
- effective access state;
- plan code;
- monotonically increasing version;
- effective period start and validUntil.

The existing user-level PILOS entitlement update contract is not, by itself, the correct tenant subscription boundary. It must be extended or replaced with a tenant-scoped entitlement projection. Do not fan out one tenant subscription into independent moderator subscriptions; that creates inconsistent state when moderators are added, removed, or assigned to more than one tenant.

A moderator may use PILOS only when both conditions hold:
1. the user has an active membership and the required PILOS operational role for that tenant; and
2. the tenant entitlement is active and the current time is before validUntil.

PILOS must enforce this condition on protected server-side operations, including room and meeting administration, meeting start/join and other tenant operations. A frontend or middleware-only check is insufficient. Missing, unknown, expired, or suspended tenant entitlement fails closed.

### D6 — Subscription changes are synchronised reliably

Vendure remains the authority for activation, renewal, plan change, suspension, cancellation and expiry.

- Subscription changes are persisted in Vendure before an integration event is delivered.
- Delivery to PILOS is authenticated, idempotent and versioned. PILOS rejects stale versions and treats duplicate delivery of the same version/state as a no-op.
- The integration retries failed delivery and provides reconciliation so that PILOS converges to Vendure's current effective state.
- validUntil is enforced in PILOS even if an expiry notification is delayed. An ACTIVE snapshot must never grant indefinite access.
- An immediate suspension or cancellation is propagated promptly; an already-issued PILOS session must not bypass a changed tenant entitlement.

The integration follows the persist-before-process discipline in INV-004. Keycloak does not store or calculate the subscription state.

### D7 — Expiry blocks PILOS operations, not Vendure renewal

When the tenant's effective subscription is no longer active, PILOS denies application access to that tenant's operational area and denies its meeting operations for all of that tenant's moderators.

The tenant owner must still be able to authenticate to Vendure Admin, open the subscription/billing area, view the current state, and renew or resolve payment. Subscription expiry must not disable the owner's Vendure identity, remove the owner from the Channel, or block the renewal mutations and payment flow.

After Vendure confirms renewal, the new versioned entitlement is synchronised to PILOS and access is restored according to the tenant's active membership and PILOS roles.

### D8 — PILOS owns meeting history; meeting usage is not a billing meter

PILOS is the operational record for rooms, meetings, attendance, recordings and meeting lifecycle. Those records support operations, customer support, audit and usage reporting.

Vendure may consume read-only usage summaries from PILOS for reporting where useful, but such data must not change the fixed monthly subscription amount. There is no new attendee-hour, attendee-minute, per-meeting or grant-minute charge.

Existing BbbUsageLedger, BbbMeteredUsage and related historical data must not be deleted as part of this decision. They may be retained for historical reconciliation and migration evidence. They are not inputs to new tenant subscription invoices. Any retirement of legacy billing code or data requires a separate implementation and migration plan.

## Alternatives considered

| Alternative | Decision |
|---|---|
| Continue pre-purchased grant-minute or postpaid attendee-hour billing | Rejected; conflicts with the fixed monthly subscription decision |
| Store subscription state independently on every moderator | Rejected; creates duplicated state and inconsistent access when membership changes |
| Make Keycloak the subscription authority | Rejected; Keycloak is the identity provider, while Vendure owns commercial lifecycle |
| Build a separate Next.js OIDC broker for PILOS | Rejected; use PILOS's native OIDC integration unless a future, separately justified frontend requirement emerges |
| Deploy one PILOS instance per tenant | Rejected; use one hosted multi-tenant PILOS instance |
| Make Vendure the source of truth for PILOS rooms and meetings | Rejected; PILOS owns meeting operations and history |

## Consequences

**Positive**
- One authoritative monthly subscription and payment lifecycle exists in Vendure.
- Seller renewal remains possible even when PILOS service access is suspended.
- Keycloak provides shared authentication without replacing Vendure or PILOS authorisation.
- One tenant subscription controls all authorised moderators in that tenant.
- PILOS meeting history is retained without turning attendance data into a variable invoice.

**Trade-offs and risks**
- Subscription state must be synchronised reliably between Vendure and PILOS.
- PILOS needs a tenant-scoped entitlement check and a reliable mapping from its local tenant/organisation to a Vendure Channel.
- OIDC account linking and moderator membership changes require explicit lifecycle handling.
- Existing grant/metered billing code and records need a controlled retirement or compatibility plan; this ADR does not perform that migration.

## Implementation acceptance criteria

1. An active Vendure subscription permits every active, authorised moderator of the mapped tenant to access that tenant's PILOS operations.
2. An expired, suspended or missing entitlement blocks PILOS operations for all moderators of that tenant, including requests made with an already-established session.
3. The tenant owner can still log in to Vendure Admin and renew while PILOS access is blocked.
4. A moderator cannot gain tenant access by changing an email address, client-supplied tenant ID or Keycloak role claim.
5. Duplicate and out-of-order entitlement messages cannot reactivate an older subscription state; reconciliation restores the latest Vendure state.
6. No meeting, attendance or usage record changes the monthly subscription invoice amount.
7. PILOS remains the source of truth for meeting and attendance history.

## Scope exclusions

This ADR does not redesign learner course subscriptions, learner entitlements, marketplace checkout, tenant-client payment collection, or the zero-commission policy. It does not authorise destructive migration of existing Vendure BBB data or PILOS records.
