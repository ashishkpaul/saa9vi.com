# Security Catalog

> **Purpose:** Track security controls and hardening decisions. Each entry is a numbered `SEC-00x` item with a status. When a security fix is completed, mark it `✅ Fixed` and reference it in release-notes.md.

---

## SEC-001: Admin API Isolation — ✅ Fixed

Admin resolvers are registered only under `adminApiExtensions`; Shop resolvers only under `shopApiExtensions`. `@Allow` decorators gate admin operations behind permissions.

## SEC-002: Channel Isolation — ✅ Fixed

Tenant-scoped data must never leak across channels. Enforced at the service layer by `BbbChannelAccessService` (Phase A, ADR-032) and the channel-scoped `administrators` query override (Phase D, ADR-034 / INV-016). `findAll` filters by `ctx.channelId`; by-ID reads/mutations assert ownership. CMS entities (`Article`, `Page`, `Banner`) use `CmsChannelAssignmentPolicy` (ADR-036, BUG-031) instead of the generic `assignToCurrentChannel()` helper — SuperAdmin → default channel only; Tenant Admin → tenant channel only (never default).

## SEC-003: Rate Limiting on Public Mutations — ✅ Fixed

`rate-limiter.middleware.ts` applies `shopApiRateLimiter` (registerForTrial 10/min, bbbJoinMeeting 10/min, registerNewTenant 5/hour) and `bbbWebhookRateLimiter` (100 req/min per IP, allowlist via env).

## SEC-004: Channel Isolation (historical collision — see SEC-002) — ✅ Fixed (superseded)

This number was historically used for channel isolation and collided with the rate-limiting entry. The canonical channel-isolation control is **SEC-002**; the rate-limiting control is **SEC-003**. Retained only to document the numbering collision.

## SEC-005: Rate Limiting on Public Mutations (canonical) — ✅ Fixed

Canonical entry for rate limiting on public mutations. See SEC-003 for implementation. This is the correct number (SEC-004 was Channel Isolation).

## SEC-006: Custom Domain TLS / Routing — ⚠️ Partially implemented

Application-side custom-domain resolution is implemented: `DomainChannelResolverService` maps a configured custom domain to the tenant channel token via Redis.

Caddy is the selected TLS termination and custom-domain routing architecture (see ADR), but production Caddy routing/TLS deployment has not yet been verified — `roadmap.md` retains "Custom domain routing via Caddy" as open.

**Status:** application mapping implemented; production Caddy/TLS verification pending.

## SEC-007: Administrator Visibility (INV-016) — ✅ Fixed

The `administrators` Admin API query must never leak administrators from other channels to a tenant admin. `TenantAdminResolver.administrators` filters by `role.channels` join on `ctx.channelId`; SuperAdmin sees all. Enforced by INV-016 and the `administratorVisibility` invariant checker. See ADR-034.
