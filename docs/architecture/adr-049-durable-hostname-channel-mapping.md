# ADR-049: Durable Hostname→Channel Mapping for Legacy Tenants (No Manual Redis/DB Writes)

**Status:** Superseded (2026-10-28) — the `{tenantSlug}.saa9vi.com` platform-subdomain
hostname feature is retired. This ADR's proposed items (§§2–4: `assignInitialTenantSlug`,
reconciliation job, platform-default host record) related to durable slug hostnames are
**moot**: no slug hostname mapping is created or re-affirmed. `tenantSlug` is retained as an
internal identity slug only.

**Implementation status (2026-10-28 review):** NOT IMPLEMENTED — superseded by the
platform-subdomain retirement. `ensureTenantHostnameMapping()` was removed from
`TenantProfileService`; no slug hostname mapping is created at registration or on profile
update.

> The hand-set Redis key `channel-token:storefront.saa9vi.com → tok_apex-academy_p0p0ik`
> (TTL `-1`) referenced below is a **platform-owned** mapping, not a seller subdomain. It is
> out of scope for the seller-subdomain retirement and must be evaluated separately before
> any cleanup.

**Context:** Incident 2026-10-12 — `storefront.saa9vi.com/en/account/rooms` showed
"This classroom cannot be opened right now" for the Apex instructor. Root cause
(channel mismatch) proven at the API level: the shared storefront fell back to
`.env.local` channel-15 token while room 3's org sits on channel 14, so
`assertRoomAccess` threw `FORBIDDEN` on every `bbbRoomStatus` while the
unscoped `myBbbRooms` list still rendered. Emergency fix was a hand-set Redis
key `channel-token:storefront.saa9vi.com → tok_apex-academy_p0p0ik` (TTL `-1`).
That key bypasses the single sanctioned writer
(`DomainChannelResolverService.setMapping`, 7-day TTL) and dies on Redis
flush/wipe — the storefront then silently falls back to channel 15 again.
Additionally, both Apex `TenantProfile` rows (channels 14, 15) pre-date the
G1/B-2 slug contract: `tenantSlug` and `customDomain` are both empty, so no
code-owned mapping exists for either.

**Corrections to rev.1 (verified in code):**
- `ensureTenantHostnameMapping()` was **removed** from `TenantProfileService` with the
  platform-subdomain retirement (2026-10-28). No slug hostname mapping is re-affirmed on
  profile `update()`. `customDomain` keys are still written ONLY on value change.
  "Ordinary save renews everything" is false.
- `update()` CANNOT backfill an empty slug: `input.tenantSlug !== profile.tenantSlug`
  (empty) always throws `IllegalOperationError`. Slug immutability is preserved
  (tenantSlug is an internal identity slug, not a hostname).
- `setMapping` TTL is `EX 86400*7` (`domain-channel-resolver.service.ts:75-80`).

**Decision:**

1. **One writer preserved.** The Redis `channel-token:` map keeps exactly one
   writer: `DomainChannelResolverService` (G1 decision). No script, seed, or
   operator may `SET`/`DEL` mapping keys directly (no `redis-cli` writes, no
   `psql` UPDATE/INSERT on mapping state). Enforced by a CI grep ban on
   `redis-cli *SET channel-token` and direct `UPDATE tenant_profile … customDomain|tenantSlug`
   in scripts.
2. **`assignInitialTenantSlug` proposed item — MOOT.** The `assignInitialTenantSlug`
   method that called `ensureTenantHostnameMapping()` is no longer relevant: no slug
   hostname mapping is created. `tenantSlug` is still allocated at registration
   (slugified `businessName`, uniqueness retry) as an internal identity slug.
3. **Reconciliation job — MOOT.** The startup/interval job that re-wrote the slug hostname
   via `ensureTenantHostnameMapping()` is superseded by the platform-subdomain retirement.
   No slug hostname mapping is created or re-affirmed.
   Alternative accepted: persistent (no-TTL) DB-backed keys, since the DB is the
   source of truth; if TTL is kept, the job interval stays well under it.
4. **Shared-storefront host is an explicit platform default, not tenant data.**
   `storefront.saa9vi.com` does not match `{tenantSlug}.saa9vi.com`. Binding the
   platform's own host to one tenant's `customDomain` couples platform routing to
   that tenant's lifecycle (delete/suspend/domain-change kills the platform host).
   Decision: model it as an explicit platform-default mapping record owned by the
   same single writer (rebuilt by the job in §3 from config, not from a tenant row),
   OR record the accepted coupling in this ADR. Recommended: platform default.
   `customDomain` uniqueness is DB-enforced (`unique: true`); a second-tenant claim
   fails closed. Note: `customDomainEnabled` (plan-tier flag,
   `subscription-plan.entity.ts:48-50`) is NOT enforced in the profile `update()`
   path — the backfill is unblocked, but gating it is a separate gap.
5. **Fail-closed posture kept.** Unmapped public hostnames stay `403` at the
   proxy (B-6). The `.env.local`/env channel token remains the documented
   fallback **only** for localhost/private hostnames and Redis-outage
   fail-open — never a silent production tenant selector.
6. **Verification (post-deploy):** Host-header curl returns the owning channel's
   token; an automated check asserts all expected keys exist after the job runs
   AND after a Redis flush. The `bbbProductVariantSearch` channel-scoping patch
   and the two permission-tier spec files ship on this ADR's implementation track.
7. **Deferred (separate ADRs):** scoping `myBbbRooms` to the active channel
   (Channel=Tenant contract change); server-side `ForbiddenError` logging
   with tenant-existence-safe UI copy.

**Consequences:** The hand-set key is the documented interim until §§2–4 land.
The 7-day TTL is now load-bearing for the platform host — the §3 job is
P0, not follow-up.
