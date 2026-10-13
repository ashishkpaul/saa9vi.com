# ADR-049: Durable Hostname→Channel Mapping for Legacy Tenants (No Manual Redis/DB Writes)

**Status:** Proposed (2026-10-12, rev.2 — corrects the rev.1 TTL/backfill errors
found in review against `tenant-profile.service.ts` / `domain-channel-resolver.service.ts`)

**Implementation status (2026-10-13 review):** PARTIAL — one item from §7
shipped on this branch, remainder proposed:
- SHIPPED: `bbbProductVariantSearch` channel scoping
  (`bbb-admin.resolver.ts` via `BbbChannelAccessService.isPlatformCaller`) +
  `bbb-permission-tiers.e2e-spec.ts` + `tenant-role-bbb-boundary.spec.ts` +
  `test:e2e:bbb-tiers` npm script.
- PROPOSED (not yet implemented): §§2–4 (`assignInitialTenantSlug`,
  reconciliation job, platform-default host record). The hand-set Redis key
  remains the documented interim until those land.

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
- `update()` re-affirms ONLY `{tenantSlug}.{domain}` (`ensureTenantHostnameMapping`,
  `tenant-profile.service.ts:288-293,305-320`). `customDomain` keys are written
  ONLY on value change (`:268-280`). "Ordinary save renews everything" is false.
- `update()` CANNOT backfill an empty slug: `input.tenantSlug !== profile.tenantSlug`
  (empty) always throws `IllegalOperationError` (`:257-262`), and the ensure-method
  early-returns without a slug (`:307-309`).
- `setMapping` TTL is `EX 86400*7` (`domain-channel-resolver.service.ts:75-80`).

**Decision:**

1. **One writer preserved.** The Redis `channel-token:` map keeps exactly one
   writer: `DomainChannelResolverService` (G1 decision). No script, seed, or
   operator may `SET`/`DEL` mapping keys directly (no `redis-cli` writes, no
   `psql` UPDATE/INSERT on mapping state). Enforced by a CI grep ban on
   `redis-cli *SET channel-token` and direct `UPDATE tenant_profile … customDomain|tenantSlug`
   in scripts.
2. **New `assignInitialTenantSlug(ctx, channelId, requestedSlug?)` method on
   `TenantProfileService`.** Set-if-empty ONLY (throws if a slug already exists —
   immutability intact once set); reuses the existing `slugify` + uniqueness/suffix
   path and adds a reserved-word guard; then calls `ensureTenantHostnameMapping()`.
   No schema change → no migration (Vendure CLI rule respected). Legacy profiles
   (channels 14, 15) are repaired through this method, never through `update()`.
3. **Reconciliation job (decided here, not deferred).** Startup + interval well
   under 7 days (e.g. every 6h): for every profile, re-write the slug hostname
   AND the `customDomain` key via `setMapping` only. Either extend
   `ensureTenantHostnameMapping` to also re-write `customDomain`, or have the job
   call both paths — but "ordinary save re-affirms" is NOT the renewal story.
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
