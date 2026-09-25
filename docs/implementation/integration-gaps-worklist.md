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

**Scope of this rule (clarified 2026-09-25).** It governs how *evidence is produced*, and it has three tiers:

| Tier | Permitted? | What it covers |
|---|---|---|
| Business/application runtime mutation | **GraphQL/API only** | Any state a real user, Admin or tenant could cause: tenants, orders, subscriptions, capacity policies, entitlements. Verify/smoke scripts (`scripts/verify/*.sh`, `scripts/smoke/*.sh`) and runtime assertions must drive these through Admin/Shop GraphQL with `curl`. |
| Isolated E2E fixture construction | **Sanctioned service layer, or a repository the suite owns** | Jest/Vitest specs that own a dedicated schema may build prerequisites the public GraphQL contract cannot construct — a `SubscriptionPlan` row, an `OrganizationSubscription` in a chosen status, a seeded `BbbPlatformCapacityPolicy` — via `connection.getRepository(...)`, and may publish the matching domain event on the real `EventBus`. This is the established, dominant pattern (21 of 23 e2e specs, e.g. `marketplace/e2e/*`, `subscription/__tests__/*`, `bigbluebutton-plugin/e2e/plan-derived-concurrency.e2e-spec.ts`). |
| Direct SQL mutation | **Forbidden everywhere** | `INSERT`/`UPDATE`/`DELETE` typed against application tables, in any script or test, for any reason. `SELECT` inspection stays permitted. |

The distinction that matters is *fixture* vs *business state*: a spec standing up its own isolated world is not "modifying business data", whereas a verifier mutating a running instance's data by SQL is. When in doubt, drive it through GraphQL or the service layer — never SQL.

**Corollary for evidence labelling:** a spec that builds its fixtures through the service layer and publishes the real event verifies the *consumer/convergence* path at runtime; it does not, by itself, verify the *public producer* path (e.g. Admin GraphQL mutation → service → event). Claim those separately.

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
   this is a deployment/configuration gap. B-6 default-channel-fallback hardening was closed
   separately on 2026-09-24 (unmapped public hostnames now fail closed at the proxy — see B-6).
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
| Unknown hostname SSR | ⚠️ default-channel fallback **at probe time**; no cross-tenant content observed in this probe — since closed for the Redis-healthy case by B-6 (2026-09-24: unmapped public hostname → `403` at the proxy) |

**B-3 SSR chain — VERIFIED 2026-09-16 (live, njs-free auth_request proxy).** The remaining
closure item did **not** require installing njs: the local nginx (1.22.1) ships
`--with-http_auth_request_module`, so the reference proxy contract was implemented without
it via `auth_request` + `auth_request_set` and adopted as
`nextjs-starter-vendure/deploy/nginx/saa9vi-storefront-authrequest.conf` (adds a
`?hostname=$host` auth subrequest to `/api/resolve-channel` and an **unconditional**
`proxy_set_header x-saa9vi-channel-token` overwrite). Non-root nginx instance on :8091,
underscores_in_headers on (so client-spoofed headers actually survive ingress and the
overwrite is provable), storefront :3001 + Vendure :3000 live.

Fixture (read-only SQL): `g3-alpha-course` exists **only** in channel 20 (tenant-a);
`g3-beta-course` **only** in channel 21 (tenant-b). Product-detail is a channel-scoped
server component (`getChannelTokenFromHeaders()` → `vendure-token` → `cacheTag(...-token)`).

| Probe (through :8091 proxy) | Result |
|---|---|
| tenant-a host → own `g3-alpha-course` | ✅ 200, full SSR product page (128 KB, slug ×13) |
| tenant-a host → `g3-beta-course` | ✅ "Page Not Found" rendered |
| tenant-b host → own `g3-beta-course` | ✅ 200, full SSR product page |
| tenant-b host → `g3-alpha-course` | ✅ "Page Not Found" rendered |
| tenant-a host + **spoofed** tenant-b token → own product | ✅ still renders tenant-a's page (13×, full) — spoof neutralized |
| tenant-a host + spoofed tenant-b token → tenant-b product | ✅ Not Found |
| Control: **direct** :3001 with spoofed token | ⚠️ tenant-b page **renders** (128 KB) — spoof risk is real at the app boundary; the proxy overwrite is what closes it |

**Conclusion:** `hostname → resolve-channel → x-saa9vi-channel-token injection →
channel-scoped SSR` is now runtime-proven in both directions, with no cross-tenant
exposure. SSR and cart/API boundaries are both verified; the two use the same
`/api/resolve-channel` resolution source. **Remaining deployment step (environment,
not code):** the deployed `/etc/nginx` vhost still (a) strips `X-SaaSvi-Channel-Token`
— a wrong, non-existent header name ("SaaSvi" vs "saa9vi"), making the strip
ineffective — and (b) never injects the token. Adopting the reference config (njs) or
the new auth_request config on the deployed vhost closes it; `/etc/nginx` is
root-owned and the local sudo requires a password, so that write remains an operator step.


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
**Status:** Contract runtime-verified 2026-09-16 (see B-3 SSR chain evidence above); **deployed-vhost gap remains open** (operator step).

Verify: `client → proxy → resolve-channel → x-saa9vi-channel-token → Next.js → Vendure`. The client must not be able to choose its own trusted channel header.

Runtime evidence (2026-09-16, live stack):

* With the auth_request proxy in front (see B-3 evidence), a client-spoofed
  `x-saa9vi-channel-token: tok_g3-tenant-b_...` sent to a tenant-a hostname is
  **overwritten** by the proxy's unconditional `proxy_set_header` — the spoofed
  value cannot select tenant-b's content (own page renders; cross-tenant page
  renders "Not Found").
* Control probe — the same spoofed request sent **directly to the storefront
  :3001** — renders tenant-b's product. This proves the trust boundary lives at
  the proxy, exactly as the `deploy/Caddyfile` security note states.
* **Deployed-vhost gap:** the live `/etc/nginx/sites-available/
  tenant-storefront.meeting.lan` (a) strips `X-SaaSvi-Channel-Token` — a wrong,
  non-existent header name ("SaaSvi" vs "saa9vi"), so the strip is a no-op — and
  (b) never injects the token. Until the vhost is replaced with the reference
  config (njs) or `deploy/nginx/saa9vi-storefront-authrequest.conf`,
  requests reaching the deployed storefront keep any client-supplied token.

### Acceptance criterion

Direct client attempts to inject `x-saa9vi-channel-token` cannot select another tenant.

## B-6 — Remove unsafe production default-channel fallback

**Priority:** P2 — **Depends on:** B-1/B-2
**Status:** CLOSED (fail-closed) 2026-09-24 for the unmapped-hostname and misconfigured-lookup cases — see evidence below. Two items remain outside this closure: the B-5 deployed-vhost gap (no effect in production until that vhost is replaced) and the deliberate Redis-*outage* fail-open (availability trade-off, retained).

### Pre-fix finding (historical — not current behaviour)

Before B-6, `(await getChannelTokenFromHeaders()) || getChannelToken()` let an **unmapped public hostname** fall through to the default channel: the resolution route collapsed "no mapping", "Redis down" and "private hostname" into `200` + empty header, and `api.ts` then fell back to the env-var token. The fix evaluated at the time was `missing channel → 404 / domain-not-configured / marketplace redirect`, while preserving convenient local development behavior.

The current production path no longer relies on that fallback for tenant identity — the reverse-proxy resolution edge denies unmapped public hostnames with `403` before Next.js renders (see **Resolution** below). `api.ts` keeps the env-var fallback for the remaining `''`/absent cases, which is now correct by construction.

### Resolution (2026-09-24, edu-frontend)

Implemented as an **HTTP-status distinction at the resolution edge** — not as a `null`-vs-`''` check in `api.ts` — because nginx does not forward an empty-valued `proxy_set_header`: `''` and "header absent" are indistinguishable by the time they reach the app, so a header-value check could never tell an unmapped hostname from a direct request.

`GET /api/resolve-channel` (`edu-frontend/src/app/api/resolve-channel/route.ts`) now separates the states that previously all collapsed into `200 + ''`:

| Condition | Response |
|---|---|
| Mapping found | `200` + token |
| localhost/private hostname, or no `hostname` param (dev) | `200` + `''` |
| Redis unreachable / timeout (infrastructure outage) | `200` + `''` — **fail-open retained** |
| Redis healthy, **no mapping** for a public hostname | `403` `hostname_not_mapped` |
| Resolution misconfigured (wrong password, revoked ACL, unknown error) | `500` `channel_resolution_misconfigured` |

`403` rather than `404` because nginx `auth_request` forwards only `2xx`/`401`/`403`; any other status becomes an opaque `500`. All three reference proxy configs deny the request before Next.js renders: `resolve_channel.js` (njs) propagates the 403, `auth_request` passes it through, Caddy `forward_auth` denies on non-2xx.

Runtime evidence (2026-09-24, live local stack — route probed directly on `:3001`, Redis at `:6479`):

* mapped hostname → `200` + token (temporary key `channel-token:verify-academy.example.com`, removed after the probe)
* unmapped public hostname → `403` `{"error":"hostname_not_mapped"}`
* `localhost` and a missing `hostname` param → `200` + empty header / `null`
* wrong `REDIS_PASSWORD` → `500` `{"error":"channel_resolution_misconfigured"}`
* `REDIS_PORT` pointed at a closed port → `200` + `''` (fail-open preserved)
* `npx tsc --noEmit` → exit 0; `npx eslint` on both changed source files → exit 0

`api.ts` keeps the env-var fallback for `''`/absent headers; that is now correct by construction, since the only requests where the fallback would be wrong are denied at the edge. Deployment steps and the staging re-verification matrix are in `edu-frontend/deploy/VERIFY.md` §2–§4 (§6 probes the route directly).

### Acceptance criterion

A production tenant request with no resolvable tenant identity cannot silently render the default tenant's storefront.

→ **Satisfied** for "Redis answered: no mapping" (`403`) and "lookup misconfigured" (`500`). **Not** satisfied during a Redis *outage*, where the storefront deliberately serves the `VENDURE_CHANNEL_TOKEN` fallback (availability over strictness — documented in `deploy/VERIFY.md` §4). Closing the B-5 deployed-vhost gap is a prerequisite for either behaviour to apply in production.

### Ingress boundary — what B-6 does *not* cover (recorded 2026-09-24)

B-6 hardened the **storefront** ingress only. The backend's own `domainChannelMiddleware` (`src/plugins/tenant-plugin/config/domain-channel.middleware.ts`) is deliberately **non-blocking**: when `REDIS_HOST` is unset, Redis is unavailable, the hostname has no mapping, or the lookup errors, it calls `next()` with the request unmodified and Vendure proceeds with the default channel. That is not B-6 drift — it is a different ingress with a different job (a hostname-resolution quirk must not fail the entire Admin/Shop API).

| Ingress | Unknown / unresolvable hostname |
|---|---|
| Storefront (`edu-frontend`: `/api/resolve-channel` → reverse proxy → Next.js) | **fail closed** — `403` (B-6) |
| Backend (`domainChannelMiddleware` → Vendure API) | pass through; default channel (by design) |

Operationally: for the architecture `tenant host → proxy → Next.js → Vendure central API`, B-6 is the relevant protection. **If Vendure is ever exposed directly under tenant hostnames, the backend middleware needs its own fail-closed policy** — do not assume it inherits B-6.

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
* **C-1-B PASS:** `subscribeToPlan(channelId:16, planId:2)` → real Razorpay subscription `sub_Tcg6cxI0UPBuji` created; local subscription persisted as **`pending_provider_auth`** with `providerStatus='created'` + `providerShortUrl`; exactly **1** binding; scalar `channelId=16` AND `channels[]` join contains 16 (plus the platform default channel 1 — admin context; tenant-scoped read for another tenant matches nothing). _The `{16, 1}` join composition is the **pre-BUG-031-fix** behavior of `assignToCurrentChannel()`; the post-fix tenant-only assignment yields `{17}` — see the post-fix re-verification below._
* **C-1-C (local duplicate) PASS:** repeat `subscribeToPlan` rejected by the per-channel guard; still exactly 1 binding. The idempotency pre-lookup has since been **tightened in code** to the entity's composite uniqueness contract `(provider, providerSubscriptionId)` (previously `providerSubscriptionId` alone), removing the latent cross-provider conflation at the service level; the DB unique index was already composite. See post-fix re-verification below.
* **Third runtime defect found and fixed — Razorpay envelope unwrapping:** real Razorpay webhooks deliver `{ event, contains, payload: { subscription: { entity } } }`, but the worker and processor read `rawPayload.subscription...` one level too shallow — **every authentic webhook would have failed channel resolution** (probe events 11/14 terminal-`failed` before the fix). Fixed in both `resolveChannelFromBinding` and `normalizeEvent` (`rawPayload.payload ?? rawPayload`).
* **C-1-E PASS (full first-subscription lifecycle):** signed `subscription.authenticated` (event 15) → `processed` on attempt 1, channel 16 resolved **from the persisted binding**, binding `providerStatus='authenticated'`, still 1 binding. Then `subscription.activated` (event 18) → `processed`, binding `active=true`, and the ADR-039 transition **`pending_provider_auth → active`** fired on the local subscription (processor-side, logged).
* **Idempotency PASS:** duplicate delivery of the same `X-Razorpay-Event-Id` (controller: already-received, no re-enqueue); same `providerSubscriptionId` under a different event ID → processed, no duplicate binding (`total=1, dup=1`).
* **C-1-D PASS (structural + runtime):** binding `channels[]` = {16, 1}; tenant B's channel (17) has no join row — a channel-scoped read for 17 matches nothing. Cross-channel binding isolation holds at the read boundary. _(Binding 3's `{16, 1}` is pre-fix; post-fix binding 4 = `{17}` only.)_

**Residual (documented, non-blocking):** `OrganizationSubscription.providerStatus` retains the creation-time value (`created`) while the binding mirrors later webhook statuses — mirroring the subscription field on lifecycle events is a cosmetic follow-up; the authoritative state (`binding.active`, `subscription.status`) is correct. Late-orphan-provider-subscription behavior (ADR-039 residual risk) remains covered by the C-1-C/D scope recorded above.
### C-1 post-fix re-verification (2026-09-16) — tenant-only assignment + narrow transaction

Re-executed against the **rebuilt and restarted** server after two corrections landed in the same reconciliation pass:

1. **ADR-036 tenant-only channel assignment** — `channels = [channel]` replacing `assignToCurrentChannel()`, which additionally joined the platform default channel onto tenant-scoped rows (**BUG-031**).
2. **Narrow explicit transaction** — `rawConnection.transaction()` covering `OrganizationSubscription` + `SubscriptionProviderBinding` atomically, with the external Razorpay call **outside** it (ADR-039 external-side-effect model).

Evidence (Admin GraphQL mutations + signed HTTP webhooks only; SQL inspection read-only):

* **C-1-B PASS (post-fix):** `subscribeToPlan(channelId:"17", planId:"2")` → real Razorpay subscription `sub_Tci4adZ7onzZlF`; local subscription id **3** persisted `pending_provider_auth` with `providerStatus='created'` and `providerShortUrl=https://rzp.io/rzp/28GUpUxd`; binding id **4** `channelId=17`, `active=false`, `subscriptionId=3`.
* **Join-table persistence PASS (the C-1-B question answered):** subscription 3 join rows = **`{17}`** (tenant only — **no platform-default-channel leak**); binding 4 join rows = **`{17}`**. The `rawConnection.transaction` + `em.save()` path therefore persists `channels = [channel]` correctly for **both** rows, and the BUG-031 fix is confirmed at runtime (not merely in code).
* **C-1-C (local duplicate) PASS (post-fix):** repeat `subscribeToPlan(channelId:"17", …)` → `Channel 17 already has an active or trialing subscription`; counts unchanged (**2** subscriptions / **2** bindings / **2** distinct provider subscription IDs) — **no orphan provider subscription**, proving the guard executes *before* the external provider call.
* **C-1-D PASS (post-fix):** binding 4 `channels[] = {17}`; binding 3 (created pre-fix) = `{1,16}`. A channel-scoped read for another tenant matches nothing; cross-channel binding isolation holds at the read boundary.
* **Dashboard read-regression check PASS:** `organizationSubscriptions` in the **channel-1 admin ctx** still returns both subscriptions (ids 2 and 3). `findAllSubscriptions` uses `ListQueryBuilder` with `ctx` only and does **not** channel-filter unless `channelId` is passed explicitly, so tenant-only assignment does not hide rows from the Portal Admin Dashboard (UI-1, `91ca476`).

**Conclusion:** C-1 remains CLOSED. The post-fix re-verification additionally confirms the BUG-031 tenant-only assignment and the ADR-039 transaction boundary behave correctly at runtime, and **supersedes the pre-fix `{16, 1}` join evidence** recorded above (subscription 2 / binding 3 were created before the fix and retain their historical join rows).

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

## D-5 — Dunning recovery after Razorpay `halted`

**Gap (identified in the post-refactor audit, 2026-09-19):** the
`subscription.pending`/`subscription.halted` → `past_due` bridge makes
failed subscriptions discoverable by the dunning task, but once Razorpay
reaches `halted` (retries exhausted) Razorpay performs **no automatic
charge** of outstanding invoices — recovery requires a customer
payment-method change or an explicit/manual charge of the unpaid invoice
(Razorpay docs). The current `RecurringBillingProvider`
(`createSubscription` / `getSubscription` / `cancelSubscription` /
`pauseSubscription` / `resumeSubscription`) has **no operation that
triggers recovery of an outstanding halted invoice**, and the dunning task
explicitly documents that it is orchestration, not a recovery trigger.

Consequence: a `halted`-origin subscription enters `past_due`, dunning
retries record ledger intent, no provider webhook arrives, and after
`DUNNING_MAX_RETRIES` the subscription is auto-cancelled. Payment is never
actually recovered.

> **Correction (2026-09-21, commit `5856f71`) — the "no operation" claim above is wrong.**
> A recovery path *does* exist in code: the existing successful-charge finalization path
> (`finalizeAfterPayment()`) can transition a Saa9vi `past_due`/halted subscription to `active`
> when a later provider charge finalizes a newer billing cycle — there is **no `halted`
> exclusion in the cycle-monotonic CAS; only `cancelled` is excluded**. The same correction was
> applied to `production-readiness.md` §7 and `what-next.md` (R2-G row).
>
> What actually remains open is therefore **runtime evidence**, not missing capability: the full
> sequence halted → provider charge → `subscription.charged`/`activated` webhooks → `active` has
> not been observed live. The resolution options below are consequently *optional* — option 1
> (`recoverSubscription`/manual-charge on the provider) may still be wanted for operator-driven
> recovery, but the acceptance criterion is now satisfiable by exercising the existing charge path.

### Resolution options (choose one before R2-G can be considered closed)

1. **Provider-driven recovery** — add a `recoverSubscription`/manual-charge
   operation to `RecurringBillingProvider` where the Razorpay contract
   supports it (e.g. charging an outstanding invoice), invoked by the
   dunning task.
2. **Customer-facing recovery path** — expose a payment-method-update /
   retry-payment link in the dunning flow (Shop API + storefront) so the
   customer completes a new authorization; the resulting webhook carries
   the recovery.

### Acceptance criterion

A `halted` Razorpay subscription whose customer completes recovery
produces a provider webhook that reconciles a billing attempt and
finalizes the Saa9vi period — end-to-end, post-refactor.


# Track E — Documentation Consistency

After implementation and E2E verification, perform a **bidirectional documentation audit**. For every relevant claim (`Documentation → code`, `Code → documentation`), classify as `CONFIRMED`, `DRIFT`, `UNIMPLEMENTED`, `IMPLEMENTED BUT UNDOCUMENTED`, or `PROPOSED`.

At minimum inspect `docs/architecture/`, `docs/implementation/`, `docs/what-next.md`, `docs/implementation/roadmap.md`, `docs/implementation/known-bugs.md`, and the corresponding storefront documentation.

### Acceptance criterion

No documentation says a feature is `complete`, `accepted`, `implemented`, or `verified` unless repository/runtime evidence supports that claim. Likewise, significant implemented architecture must have a canonical documentation reference.

# Track F — Free Basic plan + storefront commercial integration

## FREE-1 — Provider-free Free Basic plan (programme)

**Priority:** P0 — **Status:** IN PROGRESS — plan §4 **slices 1–10 all done** (slice 6 daily live allowance closed 2026-09-25, commit `07aa9d6`); BUG-036/035/037/038/**039** closed, plan-derived `concurrentMeetingLimit` sync delivered; next slice 11 (R3 one-time payment handler) — the independent launch gate. **Canonical plan:** `docs/implementation/saa9vi-comprehensive-integration-and-commercial-plan.md` (v3, evidence-verified at `4f3a9cf`; header/§3.5/§3.8 reconciled through `ec866fe` to the post-slice-9 state (`fbcdce9`, frontend `2bba7e2`) on 2026-09-24; §3.10/§4 row 10 and reviewer row 0.17 reconciled 2026-09-25 to the R4 runtime evidence at `4870251`; its §6 preflight was executed and recorded in §6.1; baseline relabelled to the slice-6 source commit `07aa9d6` when slice 6 closed).

**Product decision:** every tenant lands on a permanent **Free Basic** plan at registration — no card, no trial clock, no "no subscription" state. Paid plans add capacity (concurrent live rooms, daily live minutes, participants, staff, students) and entitlements (hosted academy / custom domain, white-label theming, marketplace listing per ADR-042).

### Blocking prerequisite (verified 2026-09-22 — do not skip)

`SubscriptionService.subscribeToPlan()` throws for any channel whose subscription row is in a state other than `cancelled`, and the subscription Admin API exposes **only** `createSubscriptionPlan`, `updateSubscriptionPlan`, `subscribeToPlan` — no cancel, no change-plan, no pause/resume. Therefore auto-provisioning a subscription at registration **blocks the paid-upgrade path for that channel**. A plan-change/cancel capability and its ADR (**ADR-044**) must ship before — or together with — free-plan provisioning. Provider-side `cancelSubscription`/`pauseSubscription`/`resumeSubscription` already exist on `RecurringBillingProvider` with **zero call sites**, so this is wiring plus a local, transactional, FSM-aware operation — not new provider integration.

### Slices (detail and gates in the plan §4)

1. Commercial matrix freeze (product decision; the in-code 600 min / 100 students / 5 concurrent meetings are seed defaults, not decisions). — ✅ **DONE 2026-09-22** (slice 1).
2. Documentation drift sweep (this commit's sibling edits: ADR-039 amendment, ADR-042 M0 reference, ADR-043 opening, RFC-001 §4, D-5 correction, domain-model grant source types / FSM slot wording). — ✅ **DONE 2026-09-22** (slice 2).
3. ADR-044 + plan-change/cancel capability. — ✅ **DONE 2026-09-23** (commit `66e6cd4`): `changeOrganizationSubscriptionPlan`, `cancelOrganizationSubscription`, provider-wired + provider-free branches, and the renewal-sweep `cancelAtPeriodEnd` completion branch. Runtime acceptance script committed but **not yet executed** (needs a dev DB + Razorpay test key).
4. Provider-free Free Basic activation at registration (idempotent; no provider call; no fake binding). — ✅ **DONE + RUNTIME-VERIFIED 2026-09-23** (commit `d45b0a5`): `FreePlanProvisioningService` + `FreePlanProvisioningListener` (subscription plugin), triggered by `TenantRegisteredEvent`; option `freePlanSlug` (default `free-basic`, env `FREE_PLAN_SLUG`); status `active`, period fields **NULL** (F-7), no provider call and no binding; ADR-039 + entity docstrings amended. Deliberately excluded: capacity grants (org overhead grant already exists; the free allowance is the daily grant in slice 6) and `concurrentMeetingLimit` sync (slice 5). Runtime evidence: `scripts/verify/free-basic-activation.sh` → **19 passed / 0 failed / 3 skipped** (exit 0) on 2026-09-23; **re-run 2026-09-25 after Slice 5 added step 6b → 24 passed / 0 failed / 3 skipped**. The same run exposed and fixed two defects in BOTH verify scripts (corrupt `vars="${5:-{}}"` payloads; bearer-token login instead of the session cookie) — `adr-044-acceptance.sh` had been unrunnable for that reason. The Free tier's `BbbPlatformCapacityPolicy` row (5/5/5) remains an Admin/ops call — the script performs it idempotently.
5. Grant-selection correctness (`internal_overhead` vs exhaustion; plan-derived `concurrentMeetingLimit`). — ✅ **DONE 2026-09-25** (BUG-036 `d711940`, BUG-035 `ab274bf`, BUG-037 `30d245a` closed — plan §4 row 5; **plan-derived `concurrentMeetingLimit` sync delivered**: `BbbPlatformCapacityPolicy.maxConcurrentMeetings` + CLI migration `1790319702564`, `EffectiveCapacityPolicy.maxConcurrentMeetings` + `isPlanDerived()`, `syncConcurrentMeetingLimit()` invoked from org create/update + a `SubscriptionPlanChangedEvent` consumer + startup reconciliation (convergence, not listener ordering), Admin field with `>= 1` validation, new `plan-derived-concurrency.e2e-spec.ts` **5/5** — which surfaced and fixed **BUG-039**). **Residual:** one *runtime* session attempt asserting `assertCanCreateMeeting` throws at the limit (provisioning-side concurrency is covered by the 4/4 suite).
6. Daily live allowance layer (scheduled daily grants, `sourceType: 'subscription'`; `BbbUsageLedger` semantics unchanged).
7. ADR-042 implementation (two CLI migrations, grace transitions, shared eligibility policy, indexer gate, INV-024 checker). — ✅ **DONE 2026-09-23**: `1790172415061-add-marketplace-listing-enabled-to-plan` + `1790172546153-add-marketplace-grace-until-to-subscription` (both `npx vendure migrate -g`, applied); grace transitions in `SubscriptionRenewalService` (set on entry to `past_due`, cleared on recovery/cancellation); shared policy `src/platform/commercial/commercial-entitlement.service.ts` (window per entitlement — `TenantCommercialEligibilityService` now delegates); `indexSession()` gate; Admin schema fields; `AdrChecker.marketplaceEntitlementInvariants()`. Evidence: `verify:invariants` green, 25/25 infra-free gate spec, 73/73 tenant e2e; indexer e2e matrix committed (needs `MARKETPLACE_E2E=true` to run).
8. Shop read-only commercial API (`mySubscription`, `myLiveUsage`, `availableSubscriptionPlans`). — **owns the "no subscription / missing Free Basic row" detection surface** deferred from slice 4. — ✅ **DONE 2026-09-24** (`ec866fe`; 12/12 `subscription-shop.e2e-spec.ts` — plan §4 row 8).
9. `edu-frontend` theme consumption + plan/usage dashboard. — ✅ **DONE 2026-09-24** (`edu-frontend` `7561643` + `b262ba3` + `2bba7e2`, pushed; final-tree gates exit 0 + browser sign-in/billing E2E — plan §3.8/§4 row 9).
10. R4 runtime evidence (R4 is already implemented — verification only).
11. R3 one-time payment handler — **separate launch gate**, blocked by nothing here.

**Scope exclusions:** no `marketplacePromotionEnabled` (promotion is a separate subsystem); no tenant-facing upgrade mutation (UI-1 defers it pending an ADR); no external headless CMS as a core dependency.

### Open API-completeness gap (not a slice) — Tier-1 channel capacity override has no write surface

Found 2026-09-25 (second reconciliation pass, review of `6e4467a`). `BbbPlatformCapacityPolicyService.getEffectivePolicy()` resolves **Tier 1 = channel override** (`repo.findOne({ where: { channelId } })` — `bbb-platform-capacity-policy.service.ts:120-126`), and ADR-031 documents the 4-tier cascade as live. But the Admin GraphQL surface exposes only:

- `upsertPlatformCapacityPolicy(input: PlatformCapacityPolicyInput!)` — the input carries `subscriptionPlanId` and **no `channelId`** (`bbb-admin.schema.ts:675-687`), and the resolver looks the row up by `{ subscriptionPlanId: input.subscriptionPlanId ?? null }` alone (`bbb-admin.resolver.ts:1108+`).
- `deletePlatformCapacityPolicy(id: ID!)` — needs an id nobody can obtain.

So a channel-scoped row **cannot be created or updated through the API**, and application-table SQL writes are forbidden. Tier 1 is therefore *resolve-only*: reachable in code, unreachable in practice.

**Impact on shipped scope: none.** Free Basic resolves at **Tier 2** (plan-matched), which is exactly what Slice 5 implements and what `scripts/verify/free-basic-activation.sh` asserts. This is an API-completeness gap, not a correctness bug. Closing it needs either a `channelId` field on `PlatformCapacityPolicyInput` (SDL + codegen change, plus a redefined upsert key so a channel row cannot collide with the plan row) or an explicit decision to drop Tier 1 from the cascade.

---

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
