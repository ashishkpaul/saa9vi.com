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

**Status:** IMPLEMENTED 2026-09-15 — **G2 acceptance PASSED at the Vendure layer** (live stack; see §G2 acceptance below). Build/migration/code-review verified; hostname→Channel resolution proven for four tenants. Next.js `resolve-channel` consumer and production Caddy/TLS remain unverified (out of B-2 scope).
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

### G2 acceptance — PASSED 2026-09-15 (Vendure layer, live stack)

Executed against the running server (`npm run start`, built `dist`) with Postgres + Redis:
four tenants registered via the supported `registerNewTenant` Shop-API mutation (two pairs sharing
a business name to exercise collision suffixing). All assertions are **read-only** afterwards — no
manual PostgreSQL or Redis writes.

| Assertion | Result |
|---|---|
| `TenantProfile.tenantSlug` derived | ✅ `g2-vertex-learning`, duplicate-name tenant → `g2-vertex-learning-2` |
| Redis mapping per hostname | ✅ `channel-token:{slug}.saa9vi.com` → that channel's token, all 4 distinct |
| Hostname → correct Channel (Vendure) | ✅ `Host:` per tenant returned its own token; `localhost` and an unknown hostname fall back to the default channel |
| `BbbOrganization.slug === tenantSlug` | ✅ all 4 orgs, async listener completed (polled) |
| BBB org per channel | ✅ one org per channel, distinct channelIds |

**Blocker found and fixed during G2:** `domainChannelMiddleware` wrote the resolved token to
`x-vendure-token`, but Vendure's `apiOptions.channelTokenKey` defaults to **`vendure-token`** — so
hostname-based channel resolution silently fell back to the default channel for every request.
Fixed in `domain-channel.middleware.ts` (header name corrected); re-verified on the production build.

Not covered by this run (explicitly out of B-2 scope): Next.js `/api/resolve-channel` (reads the
same Redis map; storefront not part of this stack), Caddy wildcard/on-demand TLS (G10), and the
7-day TTL re-affirmation strategy (separate operational decision).

### G3 pre-flight — storefront hostname chain verified 2026-09-16 (meeting.lan)

The Next.js link of the chain was exercised against the local `meeting.lan` stack
(nginx wildcard TLS → Next.js :3001 → `/api/resolve-channel` → Redis :6479) with **fresh tenants
created only through `registerNewTenant`** — no manual PostgreSQL or Redis writes.

| Assertion | Result |
|---|---|
| `TENANT_PLATFORM_DOMAIN` respected at registration | ✅ registering with `.env` = `meeting.lan` produced `channel-token:g3-tenant-a.meeting.lan` → `tok_g3-tenant-a_vufbkz`, `g3-tenant-b.meeting.lan` → `tok_g3-tenant-b_iw8l6l` |
| Existing G2 fixtures untouched | ✅ `*.saa9vi.com` keys and rows unchanged |
| Resolution through nginx HTTPS | ✅ `https://g3-tenant-{a,b}.meeting.lan/api/resolve-channel?hostname=…` returned each tenant's own token; unknown hostname → `null` |
| Not a default-channel echo | ✅ asking host A for hostname B returned **B**'s token |
| Header contract intact | ✅ `x-saa9vi-channel-token` always set (empty on no-match) — spoof-stripping preserved |
| Storefront consumes the header | ✅ code-verified precedence in `src/lib/vendure/api.ts`: explicit arg → `x-saa9vi-channel-token` (tenant) → `VENDURE_CHANNEL_TOKEN` env (dev fallback) |

**Environment-alignment defect found (documentation gap):** the storefront `.env` had
`REDIS_PORT=6379` while Redis is exposed on **6479** (backend `.env`), so `/api/resolve-channel`
returned `null` for *every* hostname — including mappings that demonstrably existed. The resolver
fails closed by design (`redis.on('error')` → null), which made the misconfiguration silent. Both
services must resolve the **same** Redis instance/port; this is now recorded here because it was not
stated anywhere in the repo.

**Test-methodology notes (for future runs):** `/api/resolve-channel` **requires** `?hostname=`
(the bare URL returns `null` by design), the storefront listens on **3001** (3000 is Vendure), and
`g3-tenant-*.meeting.lan` hostnames were exercised via `curl --resolve` rather than `/etc/hosts`
(entries would need sudo; the wildcard TLS vhost already accepts them).

**Not yet demonstrated:** tenant-specific *page data* on a server-rendered surface — `/en/search`
SSR bytes were identical between the base host and a tenant host, which is expected because
`search-results.tsx` is client-rendered, so that probe was inconclusive rather than negative.
A server-rendered channel-scoped probe belongs to G3 proper.

### G3 application-level isolation — PASSED 2026-09-16 (live stack, sequential probes)

Continued from the pre-flight with the same G3 tenants. Stock fixture was set via the **Admin API
`updateProductVariant` mutation only** (live-schema introspection confirmed `stockOnHand: Int` on
`UpdateProductVariantInput` before any mutation; PostgreSQL touched read-only).

**Probe-error corrections found along the way (recorded so they are not rediscovered):**

1. Vendure's default channel-token header is **`vendure-token`**, not `x-vendure-token`. The first
   visibility probes used the wrong header name and silently fell back to the default channel,
   which made it look like both tenants saw both products. With the correct header, isolation held.
2. The reverse proxy must inject `x-saa9vi-channel-token` for SSR pages to be channel-scoped.
   When the tenant header is absent/unresolved, `src/proxy.ts` has no tenant identity and the
   downstream storefront falls back to the **default-channel token**, so the tenant's own product
   renders "Not Found". The reference `deploy/nginx/saa9vi-storefront.conf` implements tenant-header
   injection via an nginx njs subrequest to `/api/resolve-channel`; the local nginx site (a) lacked
   `libnginx-mod-http-js` and (b) did not inject the tenant header, so SSR pages under tenant
   hostnames rendered the default/fallback path. **No cross-tenant data exposure was observed** —
   this is a deployment/configuration gap, and B-6 default-channel-fallback hardening remains open.
3. Vendure refuses `removeProductsFromChannel` for the default channel, so the default channel
   cannot be used as a tenant-isolated fixture channel. Tenant isolation relies on correct
   per-request channel tokens; the default channel is not an isolation boundary.

| Test | Result |
|---|---|
| G3-A visibility: A token → search | ✅ Alpha visible, Beta **absent** |
| G3-A visibility: B token → search | ✅ Beta visible, Alpha **absent** |
| G3-B cart: A hostname/token adds Alpha | ✅ order created; read-only DB verification confirmed `order.channelId` = A (20) |
| G3-C cart: B hostname/token adds Beta | ✅ distinct cart/order; read-only DB verification confirmed `order.channelId` = B (21) |
| G3-D cross-tenant: A adds Beta | ✅ rejected — Beta is not visible in A's channel (visibility failure, not stock failure) |
| G3-D cross-tenant: B adds Alpha | ✅ rejected likewise |
| Unknown hostname SSR | ⚠️ default-channel fallback; no cross-tenant content observed in this probe; B-6 remains open |

**Remaining for full B-3 closure (deployment, not application code):** install
`libnginx-mod-http-js` and adopt `deploy/nginx/saa9vi-storefront.conf` (njs `resolve_channel.js`
subrequest injecting `x-saa9vi-channel-token`) on the local nginx vhost, then re-run the SSR
product-detail probe to prove channel-scoped page rendering through the full chain.
Cart/API-level isolation is already proven above; SSR hostname-to-channel
propagation remains to be verified (the two boundaries test different paths,
neither universally subsumes the other).


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

**Priority:** P1 — **Status:** CLOSED 2026-09-16 — all sub-gates (C-1-A/B/C/C-idempotency/D/E) runtime-verified; see evidence below.

Trace the real recurring-payment lifecycle:

```text
checkout → Razorpay subscription/payment → provider response/webhook
→ SubscriptionProviderBinding creation → OrganizationSubscription → channel
```

Determine whether the binding is created automatically, by webhook processing, by checkout, or is currently missing. Do not add a second binding mechanism until the existing lifecycle is understood.

### C-1-A runtime evidence (2026-09-16) — first-subscription lifecycle FAILS CLOSED

Executed against the live stack (GraphQL/HTTP only; SQL inspection read-only):

1. Signed `subscription.activated` webhook (`sub_C1PROBE001`, `notes.channelId` present in payload) delivered via HTTP to `POST /payments/razorpay/webhook` with a valid HMAC signature and unique `X-Razorpay-Event-Id` (bad-signature control correctly rejected 401; missing event-ID header correctly rejected 401).
2. `ProviderWebhookEvent` persisted first (INV-004): `pending`, raw payload + hash stored. Webhook returns **HTTP 201** (controller has no explicit `@HttpCode`).
3. Worker: `resolveChannelFromBinding()` consults **only** the DB binding lookup — it ignores `notes.channelId` in the payload. With no pre-existing binding it returns `null`.
4. Worker fails closed (INV-018): `Could not resolve channel for webhook event 11; refusing to process with generic context` — 3 attempts (BullMQ exponential backoff), then terminal `failed` + `failedAt`.
5. `subscription_provider_binding` remained **0 rows**. `RazorpayWebhookProcessor` (and its lazy `createProviderBinding()` path) was **never reached**.

**Conclusion (runtime-proven):** the processor's lazy-binding branch is unreachable for the first subscription — the worker's binding-lookup precedes processor invocation, so a brand-new subscription's first webhook can never establish its own binding. The queue worker fails closed *before* the lazy path can run. Fix must occur in the worker's channel-resolution step (e.g., consult authenticated payload `notes.channelId` to seed the binding pre-processor), not in the processor.

**Amended 2026-09-16 (Layer 2) — the conclusion above is superseded by a deeper finding:** there is no production path that creates a Razorpay subscription at all. `RazorpaySubscriptionProvider.createSubscription()` has zero production call sites (only the M1.3 verification script); `subscribeToPlan()` creates a local `OrganizationSubscription` with `status: 'active'` and **no provider interaction**; `SubscriptionPlan` has no `providerPlanId` mapping. Consequently no legitimate runtime path ever produces the `providerSubscriptionId` required for first-binding creation — the fix is **not** a worker-side `notes.channelId` fallback (rejected: moves tenant identity across the webhook trust boundary, contradicting INV-018). The provider-wired subscription-creation design is decided in **ADR-039** (`docs/architecture/adr-039-provider-wired-subscription-lifecycle.md`, Proposed) with an implementation plan at `docs/implementation/adr-039-implementation-plan.md`. C-1-B/C/D are **blocked** pending ADR-039 approval and implementation, which supply the legitimate creation path they must verify.

Minor observations: (a) `attemptCount` accumulates across duplicate-delivery jobs sharing one `providerEventId` (observed 4 for 3 attempts) — accounting quirk, FSM unaffected; (b) duplicate-delivery recovery path (`UNIQUE(provider, providerEventId)` → re-enqueue pending event) verified working at runtime.

### C-1 infrastructural finding — job-queue worker was never started (fixed 2026-09-16)

The API entrypoint (`src/index.ts`) called only `bootstrap(config)`. In Vendure 3, `bootstrap()` does **not** start job-queue consumption; that requires a worker process or an explicit `JobQueueService.start()`. Consequence: all BullMQ jobs (provider webhooks, marketplace indexing, subscription renewals, BBB webhooks) were stranded in the shared `bull:vendure-job-queue` wait list — 25+ jobs since 2026-09-15 evening, while the API server otherwise served normally. Fixed by explicitly calling `JobQueueService.start()` in `src/index.ts` after bootstrap (merged-worker mode); verified by live backlog drain and worker failure logs. Any runtime verification that depends on async jobs must re-check this behavior after server restarts.

### Acceptance criterion

A real Razorpay subscription creates exactly one valid `SubscriptionProviderBinding` with the correct provider, provider subscription ID, and Saa9vi subscription/channel association.

Remaining C-1 sub-gates: C-1-B (`channels[]` join + scalar `channelId` persistence after `bindingRepo.save()`), C-1-C (idempotency: same provider+ID repeat vs `providerSubscriptionId`-only pre-lookup vs `(provider, providerSubscriptionId)` unique index), C-1-D (cross-channel binding visibility isolation).

### C-1-B/C/C-idempotency/D/E runtime evidence (2026-09-16) — ALL PASSED, C-1 CLOSED

Executed via Admin GraphQL + signed HTTP webhooks only; SQL inspection read-only. Razorpay test account (`plan_TaMGQbDDQn7Tir`, from the M1.3 acceptance).

* **Setup:** plan `c1-probe-growth` (id 2) created via `createSubscriptionPlan` with `providerPlanId=plan_TaMGQbDDQn7Tir` (GraphQL field exposed by Step 1).
* **C-1-B PASS:** `subscribeToPlan(channelId:16, planId:2)` → real Razorpay subscription `sub_Tcg6cxI0UPBuji` created; local subscription persisted as **`pending_provider_auth`** with `providerStatus='created'` + `providerShortUrl`; exactly **1** binding; scalar `channelId=16` AND `channels[]` join contains 16 (plus the platform default channel 1 — admin context; tenant-scoped read for another tenant matches nothing).
* **C-1-C (local duplicate) PASS:** repeat `subscribeToPlan` rejected by the per-channel guard; still exactly 1 binding. The `providerSubscriptionId`-only pre-lookup vs composite unique index question is now moot at runtime for the single-provider regime (Juspay dormant); the composite-tightening remains available if a second provider is ever reintroduced.
* **Third runtime defect found and fixed — Razorpay envelope unwrapping:** real Razorpay webhooks deliver `{ event, contains, payload: { subscription: { entity } } }`, but the worker and processor read `rawPayload.subscription...` one level too shallow — **every authentic webhook would have failed channel resolution** (probe events 11/14 terminal-`failed` before the fix). Fixed in both `resolveChannelFromBinding` and `normalizeEvent` (`rawPayload.payload ?? rawPayload`).
* **C-1-E PASS (full first-subscription lifecycle):** signed `subscription.authenticated` (event 15) → `processed` on attempt 1, channel 16 resolved **from the persisted binding**, binding `providerStatus='authenticated'`, still 1 binding. Then `subscription.activated` (event 18) → `processed`, binding `active=true`, and the ADR-039 transition **`pending_provider_auth → active`** fired on the local subscription (processor-side, logged).
* **Idempotency PASS:** duplicate delivery of the same `X-Razorpay-Event-Id` (controller: already-received, no re-enqueue); same `providerSubscriptionId` under a different event ID → processed, no duplicate binding (`total=1, dup=1`).
* **C-1-D PASS (structural + runtime):** binding `channels[]` = {16, 1}; tenant B's channel (17) has no join row — a channel-scoped read for 17 matches nothing. Cross-channel binding isolation holds at the read boundary.

**Residual (documented, non-blocking):** `OrganizationSubscription.providerStatus` retains the creation-time value (`created`) while the binding mirrors later webhook statuses — mirroring the subscription field on lifecycle events is a cosmetic follow-up; the authoritative state (`binding.active`, `subscription.status`) is correct. Late-orphan-provider-subscription behavior (ADR-039 residual risk) remains covered by the C-1-C/D scope recorded above.

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

## UI-1 — Subscription UI (post-ADR-039): ACTOR MODEL DECIDED

**Priority:** P2 — **Status:** Decision recorded 2026-09-16; UI implementation gated on it. Audit evidence: `docs/implementation/storefront-subscription-ui-audit.md`.

### Decision (product decision, not a permanent architecture constraint)

**Current phase: option (b) — Portal Admin subscribes tenants via the Admin API.**

The tenant owner does not subscribe from the storefront in this phase. The flow is:

```text
Portal Admin → Admin API subscribeToPlan(channelId, planId)
  → Razorpay subscription created → providerShortUrl returned
  → tenant owner authorizes at the Razorpay short_url
  → Razorpay webhook → binding → pending_provider_auth → active
```

No subscription UI is implemented in the storefront this phase; the storefront may READ the tenant's own subscription state (status, providerStatus, providerShortUrl) but performs no subscription mutations.

### Explicitly deferred (requires a NEW ADR before implementation)

Option (c) — self-service tenant-owner subscription via an authenticated **Shop API** mutation. This changes the actor authorization boundary (channel/tenant identity must derive from the authenticated RequestContext, never a client-supplied channelId). Do not expose the existing Admin `subscribeToPlan(channelId, planId)` through the Shop API. Option (a) Dashboard-only remains technically available at any time without new backend surface.

### Implementation rules when UI work starts

1. **Trust boundary:** returning from the Razorpay authorization page does NOT mean active. The frontend re-queries Saa9vi subscription state; only the webhook-driven `pending_provider_auth → active` transition is authoritative.
2. **codegen sequencing:** actor decision → backend contract final → `npm run codegen` (gql.tada) → queries/types → UI. Never UI-first.
3. **State machine to mirror:** `pending_provider_auth` → "Complete Payment Authorization" CTA linking the tenant's own `providerShortUrl`; `active` → active plan; `past_due` → payment attention; `cancelled` → cancelled.
4. **Scope separation:** normal-checkout `PaymentMethodHandler` (one-time commerce) is a separate integration per ADR-038 and must not be combined with the subscription UX.
