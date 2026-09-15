# Cline Implementation Tasks — Current Integration Gaps

> **Status:** Implementation worklist
> **Purpose:** Define only the remaining implementation work after the backend, BBB, Razorpay, marketplace, and storefront audits.
> **Rule:** Do not reimplement functionality already present in the repository. Every task begins with direct code inspection and evidence capture.
>
> **Supersedes** the earlier conversational "Implementation Action Plan" (Backend & GraphQL Schema Audit → BBB Service Porting → Razorpay Payment Handler Integration → Next.js Storefront GraphQL Synchronization), which described greenfield work the repository has since completed and which was never committed to any repository document.
>
> **BBB and Razorpay are existing implementation areas subject to regression verification. The remaining implementation focus is tenant reachability/isolation, marketplace-to-tenant storefront integration, marketplace attribution, SubscriptionProviderBinding lifecycle verification, and final documentation synchronization.**

## 0. Mandatory operating rules

Cline MUST follow these rules for every task:

### Repository evidence

Before changing code:

1. Check the current Git branch and working tree.
2. Fetch/inspect the current repository state.
3. Read the relevant implementation **and** its canonical documentation.
4. Do not treat conversation text, screenshots, proposed diffs, or previous audit claims as proof that code exists.
5. Classify findings as **Confirmed** (directly verified in the repository/runtime), **Unverified** (claimed but not present in current repository evidence), or **Proposed** (design recommendation only).

### Database/data mutations

**Never manually modify PostgreSQL business/test data.**

All test/application data mutations MUST use the Vendure Admin GraphQL API or Vendure Shop GraphQL API, using `curl` or another standard HTTP client.

Do **not** use `INSERT` / `UPDATE` / `DELETE` against application tables to create or modify fixtures. Read-only database inspection is permitted when necessary for verification.

### Schema changes

If a database schema change is actually required, use the Vendure CLI migration workflow (`npx vendure migrate`). Do not manually execute `ALTER TABLE`, create/drop application tables, or edit migration history.

### No speculative implementation

Do not implement a feature merely because an old roadmap or action plan mentions it. First prove that it is absent from the current codebase.

# Track B — Multi-Tenant Storefront Reachability & Isolation

## B-1 — Establish tenant hostname contract

**Priority:** P1
**Status:** Confirmed architectural gap; implementation required.

### Objective

A newly registered tenant must have a deterministic, reachable storefront hostname.

Trace:

```text
registerNewTenant() → Channel creation → TenantProfile creation → hostname assignment
→ domain/channel mapping → reverse proxy → Next.js → correct Vendure Channel
```

### Cline must first inspect

```text
src/plugins/tenant-plugin/ (tenant-registration.service.ts, tenant-profile.service.ts)
deploy/Caddyfile, deploy/nginx/
edu-frontend: src/lib/vendure/channel.ts, src/app/api/resolve-channel/
```

### Required decision

Determine and document the authoritative hostname contract. Preferred model to evaluate: `{academySlug}.saa9vi.com` for platform-managed subdomains, with `customDomain` reserved for explicitly configured domains. Do not create two independent hostname-resolution mechanisms unless the architecture requires it.

### Acceptance criteria

A tenant created through the supported GraphQL registration flow has a documented hostname contract and can be reached without manual DB or Redis modification.

## B-2 — Implement tenant hostname provisioning

**Status:** IMPLEMENTED 2026-09-15 (build-verified, runtime-unverified) — G2 acceptance test below not yet executed.
Audit fixes applied same day (B-2.1–B-2.4): (1) tenantSlug allocation is **platform-global** —
collision checks use `connection.rawConnection` (documented as the one sanctioned channel-bypassing
read) and save is **concurrency-safe** (unique-violation → next `-N` suffix → retry; explicit slugs
never auto-renamed); (2) failed Redis seed is recoverable via `ensureTenantHostnameMapping()`
invoked on every profile save; (3) `tenantSlug` mutation now **throws** (`IllegalOperationError`)
instead of being silently discarded; (4) G1 doc amended — TTL re-affirmation explicitly deferred
from B-2 as a separate operational decision.

Implemented per the G1 decision (`docs/implementation/g1-hostname-contract-decision.md`):
`TenantProfile.tenantSlug` (unique, immutable, derived from businessName) + migration
`1789484583008-add-tenant-slug.ts` (Vendure CLI-generated); hostname mapping seeded at registration
via the existing `DomainChannelResolverService.setMapping()` (`channel-token:{tenantSlug}.{TENANT_PLATFORM_DOMAIN}` → Channel.token, one writer, no new resolver); `TenantRegisteredEvent` consumed by
`BbbTenantProvisioningListener` to auto-provision `BbbOrganization.slug === tenantSlug` in a
channel-scoped ctx. Redis TTL (7-day expiry vs persistent Channel) deliberately unchanged —
separate operational decision required (see G1 doc §Impacts).
**Consistency model:** the registration mutation commits tenant identity (Seller/Channel/
TenantProfile); the Redis hostname mapping is written inline but is not atomic with it, and
`BbbOrganization` provisioning is **asynchronous and eventually consistent** via
`TenantRegisteredEvent` — the GraphQL registration response may arrive before the BBB listener
finishes. G2 acceptance must tolerate this ordering (poll/assert after a short delay), and
`registerNewTenant` intentionally carries no `@Transaction()` decorator, so slug-retry saves
autocommit (with SAVEPOINT fallback if a transactional caller is ever introduced).

**Priority:** P1 — **Depends on:** B-1

Implement the selected hostname contract using the existing domain/channel infrastructure where appropriate. Cline must verify whether `TenantProfile.customDomain`, `DomainChannelResolverService`, the Redis channel-token mapping, Caddy, and Next.js `resolve-channel` can safely support the selected contract.

### Important

Do **not** simply write another copy of the Channel token somewhere. The implementation must identify the authoritative source and ensure dependent mappings are derived/synchronized from it.

### Acceptance test

Create Tenant A and Tenant B **through GraphQL**. Verify `Tenant A → hostname A → Channel A` and `Tenant B → hostname B → Channel B`. No manual PostgreSQL or Redis changes.

## B-3 — Multi-tenant storefront isolation E2E

**Priority:** P0/P1 — **Depends on:** B-2

Create two real test tenants using GraphQL/API operations (Tenant A/B, each with Academy, Product, Session, CMS). Verify independently: A/B hostname → own CMS, products, sessions only; A/B cart, checkout, entitlement bound to own channel/tenant. Attempt deliberate cross-tenant access.

### Acceptance criterion

No cross-tenant data exposure and no channel substitution.

# Track A — Marketplace → Tenant Storefront

## A-1 — Verify marketplace deep-link implementation

**Priority:** P1
**Status:** Implemented 2026-09-15, **runtime-unverified** (no live ES/Vendure run yet).

Code evidence (storefront audit + follow-up change):

* Backend: `MarketplaceSessionDocument.productSlug` + additive ES mapping (`ensureProductSlugMapping()`), populated in `indexSession()`; `MarketplaceSearchResolver.withMarketplaceRef()` mints per-result `marketplaceRef`; schema exposes `productSlug` / `marketplaceRef` on `MarketplaceSession`.
* Storefront: `buildAcademyHref()` deep-links purchasable sessions to `https://{customDomain||academySlug}.saa9vi.com/product/{productSlug}?ref={marketplaceRef}`; non-purchasable results fall back to the academy root.

Do **not** assume this works end-to-end — requires A-2 and A-3 verification against a live stack.

### Required result

For a purchasable session: `Marketplace → Tenant hostname → /product/{productSlug}`.

### Acceptance criterion

A real marketplace result opens the correct tenant's product/session page directly.

## A-2 — Marketplace projection convergence

**Priority:** P1 — **Depends on:** A-1

`productSlug` was added to the Elasticsearch projection:

1. Verify the mapping (`ensureProductSlugMapping()` runs at boot via `ensureIndicesExist()`).
2. Verify new documents contain the field.
3. Existing documents are NOT updated by a mapping change — run the supported reindex mechanism (`marketplaceFullReindex` Admin query, or the incremental event-driven path) and verify.
4. Verify existing marketplace results carry `productSlug`.

### Acceptance criterion

Both newly indexed and previously existing eligible marketplace sessions have the required deep-link fields.

## A-3 — Marketplace attribution transport

**Priority:** P1
**Status:** Implemented 2026-09-15, **runtime-unverified**.

Trace the complete attribution contract:

```text
marketplace search (resolver mints HMAC ref, 30-min TTL)
→ signed marketplaceRef in result URL (?ref=)
→ tenant product page (ref read from searchParams)
→ addToCart server action
→ applyMarketplaceReference mutation (server-verified: HMAC + TTL + channel)
→ checkout → order placement listener re-verifies (3B.3)
→ server-side classification
```

The storefront MUST NOT submit `orderSource = marketplace`. The client transports the opaque reference only.

### Acceptance criterion

A valid marketplace reference reaches the backend attribution mechanism and results in server-side marketplace classification.

## A-4 — Attribution negative-path test

**Priority:** P1 — **Depends on:** A-3

Test at least: (1) valid reference; (2) invalid/tampered reference; (3) expired reference (30-min TTL); (4) reference belonging to another channel; (5) direct tenant purchase without a reference. Expected behavior must be documented and verified.

The test must prove that a failed attribution attempt does not allow the client to forge `orderSource = marketplace`.

### Acceptance criterion

Valid refs attribute correctly; invalid/expired/cross-channel refs cannot create marketplace attribution.

## A-5 — Marketplace → checkout → commission verification

**Priority:** P1 — **Depends on:** A-3 and A-4

Run the complete customer-facing flow: `Marketplace search → result → tenant product → add to cart → checkout → payment → order → marketplace attribution → commission`. Verify the final persisted business facts through supported application APIs/read models.

### Acceptance criterion

The order is attributed to the correct marketplace source and tenant, and the existing commission mechanism receives the correct attribution.

## B-4 / A-6 — Cache isolation regression

**Priority:** P0
**Status:** Previously audited as PASS (code-verified 2026-09-15: every `'use cache'` fetcher takes `channelToken` as a cache-key parameter and tags with channel-scoped `cacheTag`s); regression only unless code changes invalidate the evidence.

Inspect every tenant-dependent Next.js cache boundary (`'use cache'`, `fetch()`, `revalidate`, `cacheTag`, ISR, `generateStaticParams`, route handlers). Verify cache keys include tenant/channel identity where required.

### Acceptance criterion

A cached Tenant A response can never be served to Tenant B. Do not modify working cache architecture without a demonstrated defect.

## B-5 — Production proxy trust boundary

**Priority:** P1
**Status:** PASS subject to deployment verification (code-verified: Caddy `forward_auth` + `copy_headers` and nginx njs overwrite — not trust — the client header; `resolve-channel` always returns the header, `''` = no tenant).

Verify: `client → proxy → resolve-channel → x-saa9vi-channel-token → Next.js → Vendure`. The client must not be able to choose its own trusted channel header.

### Acceptance criterion

Direct client attempts to inject `x-saa9vi-channel-token` cannot select another tenant.

## B-6 — Remove unsafe production default-channel fallback

**Priority:** P2 — **Depends on:** B-1/B-2

Confirmed code pattern (audit B-6): `(await getChannelTokenFromHeaders()) || getChannelToken()` silently renders the default channel when the proxy header is missing.

Evaluate replacing this in production with `missing channel → 404 / domain-not-configured / marketplace redirect`, while preserving convenient local development behavior.

### Acceptance criterion

A production tenant request with no resolvable tenant identity cannot silently render the default tenant's storefront.

## B-7 — Channel-token rotation architecture

**Priority:** Architectural hardening — **Status:** Document now; implementation deferred unless required.

Document the current dependency between `Channel.token`, the Redis hostname mapping, template resolution, and configuration/fixtures. Do not build ad-hoc token rotation. If rotation becomes required, implement it as one coordinated service operation with explicit synchronization and invalidation semantics.

### Acceptance criterion

The architecture documentation clearly identifies the rotation dependency and prevents future implementations from treating `Channel.token` as an isolated mutable value.

# Track C — SubscriptionProviderBinding

## C-1 — Verify binding creation lifecycle

**Priority:** P1 — **Status:** Open.

Trace the real recurring-payment lifecycle:

```text
checkout → Razorpay subscription/payment → provider response/webhook
→ SubscriptionProviderBinding creation → OrganizationSubscription → channel
```

Determine whether the binding is created automatically, by webhook processing, by checkout, or is currently missing. Do not add a second binding mechanism until the existing lifecycle is understood.

### Acceptance criterion

A real Razorpay subscription creates exactly one valid `SubscriptionProviderBinding` with the correct provider, provider subscription ID, and Saa9vi subscription/channel association.

# Track D — Existing BBB/Razorpay — Verification Only

These are **not implementation tasks** unless direct inspection proves the current repository has regressed.

## D-1 — BBB API

Do not rebuild `create`, `join`, `getMeetingInfo`, `end`, `checksum`. The existing BBB implementation must first be inspected and tested. Use the official BBB API as the protocol reference.

## D-2 — BBB webhook pipeline

Verify the existing `HTTP webhook → persist webhook event → BullMQ → processor → meeting lifecycle`. Do not introduce the previously discussed/unverified "Option A" recovery architecture (closed 2026-09-15: no authoritative decision exists in the repository; current PROCESSED/FAILED + rethrow behavior matches `runtime-flow.md`).

## D-3 — Razorpay webhook

Verify the existing `raw body → signature verification → event ID → ProviderWebhookEvent → BullMQ → channel resolution → processing`. Do not rebuild the webhook controller or payment handler merely because the old implementation plan says to.

## D-4 — Razorpay provider

Verify the existing payment/subscription implementation against the current provider contract (ADR-038, accepted 2026-09-12). Do not create a second payment integration path.

# Track E — Documentation Consistency

After implementation and E2E verification, perform a **bidirectional documentation audit**. For every relevant claim (`Documentation → code`, `Code → documentation`), classify as `CONFIRMED`, `DRIFT`, `UNIMPLEMENTED`, `IMPLEMENTED BUT UNDOCUMENTED`, or `PROPOSED`.

At minimum inspect `docs/architecture/`, `docs/implementation/`, `docs/what-next.md`, `docs/implementation/roadmap.md`, `docs/implementation/known-bugs.md`, and the corresponding storefront documentation.

### Acceptance criterion

No documentation says a feature is `complete`, `accepted`, `implemented`, or `verified` unless repository/runtime evidence supports that claim. Likewise, significant implemented architecture must have a canonical documentation reference.

# Final Cline Execution Gate

Cline must work in this order:

```text
G0  Repository baseline
G1  Track B.1 hostname contract
G2  Tenant hostname provisioning
G3  Tenant A/B isolation E2E
G4  Verify marketplace deep-link implementation
G5  Marketplace ES projection convergence
G6  marketplaceRef attribution E2E
G7  SubscriptionProviderBinding lifecycle
G8  Full regression
G9  Bidirectional documentation audit
G10 Production hardening
```

### Stop conditions

Cline MUST stop and report rather than improvise when:

* the repository differs from the expected baseline;
* a claimed feature cannot be found;
* a required GraphQL mutation does not exist;
* a schema change appears necessary;
* the hostname contract is ambiguous;
* an existing invariant would need to be weakened;
* a test requires manual database mutation;
* an architectural decision is missing.

**Do not silently convert an unverified claim into an implementation requirement.**
