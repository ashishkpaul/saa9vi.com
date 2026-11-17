# Retired Seller-Subdomain Provisioning — Historical Evidence

> **Archive only.** This section preserves the former 2026-09-15 B-2 generated seller-subdomain implementation and verification record. The `{tenantSlug}.saa9vi.com` hostname contract was retired on 28 October 2026. These steps and their acceptance criteria must not be reactivated.

> Current tenant storefront contract: central `/sellers/{tenantSlug}` route or a seller-owned verified custom domain. See [G1 hostname decision](../g1-hostname-contract-decision.md) and [current integration worklist](../integration-gaps-worklist.md#b-1--define-tenant-storefront-reachability-contract).

---

## B-2 — Implement tenant hostname provisioning

**Status:** IMPLEMENTED 2026-09-15 — **G2 acceptance PASSED at the Vendure layer** (live stack; see §G2 acceptance below). Build/migration/code-review verified; hostname→Channel resolution proven for four tenants. Next.js `resolve-channel` consumer and production Caddy/TLS remain unverified (out of B-2 scope).
Audit fixes applied same day (B-2.1–B-2.4): (1) tenantSlug allocation is **platform-global** —
collision checks use `connection.rawConnection` (documented as the one sanctioned channel-bypassing
read) and save is **concurrency-safe** (unique-violation → next `-N` suffix → retry; explicit slugs
never auto-renamed); (2) **the `ensureTenantHostnameMapping()` re-affirmation path was removed**
with the platform-subdomain retirement (2026-10-28) — no hostname mapping is written at
registration or on profile save; (3) `tenantSlug` mutation now **throws** (`IllegalOperationError`)
instead of being silently discarded; (4) G1 doc amended — TTL re-affirmation explicitly deferred
from B-2 as a separate operational decision.

Implemented per the G1 decision (`docs/implementation/g1-hostname-contract-decision.md`):
`TenantProfile.tenantSlug` (unique, immutable, derived from businessName) + migration
`1789484583008-add-tenant-slug.ts` (Vendure CLI-generated); **the `{tenantSlug}.saa9vi.com`
platform-subdomain hostname mapping has been retired** (2026-10-28). `tenantSlug` is retained
as an internal identity slug (central marketplace routes, `BbbOrganization.slug` sync,
marketplace `academySlug` derivation) but is **not** a hostname. `TenantRegisteredEvent`
is still consumed by `BbbTenantProvisioningListener` to auto-provision
`BbbOrganization.slug === tenantSlug` in a channel-scoped ctx. Redis TTL (7-day expiry vs
persistent Channel) deliberately unchanged — separate operational decision required
(see G1 doc §Impacts).
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
| Platform-subdomain hostname mapping retired at registration | ✅ `registerNewTenant` with `.env` = `meeting.lan` writes **no** `channel-token:*.meeting.lan` key; only `customDomain` mappings are written |
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
