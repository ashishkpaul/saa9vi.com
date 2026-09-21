# ADR-043: Tenant Storefront Theming Is Tenant Data, Not Code

**Status:** Accepted  
**Date:** 2026-09-21  
**Related:** ADR-036 (CMS channel assignment policy), ADR-042 (marketplace listing entitlement), G1 hostname contract decision (2026-09-15), INV-001 (Channel = tenant identity), INV-006 (storefront contract independence)

---

## Context

Saa9vi is a multi-tenant platform. Each tenant academy has its own storefront (`{tenantSlug}.saa9vi.com` or `customDomain`). The shared marketplace (`marketplace.saa9vi.com`) is platform-owned.

As of 2026-09-21 there is no tenant theming system. All tenant storefronts render with the default Saa9vi theme. The `SubscriptionPlan` entity already carries `whitelabelEnabled` but no theming data structure or delivery mechanism exists.

This ADR defines the architectural model for tenant storefront theming.

### The core risk

Tenant theming, if implemented incorrectly, can:
- Allow tenant CSS/code to affect other tenants' storefronts
- Allow tenant content to appear in the admin portal
- Allow tenant styles to alter marketplace presentation
- Allow arbitrary code execution via CSS (`expression()`, external fonts with tracking, `url()` to exfil)

The key architectural constraint is therefore: **tenant theme data must never become platform code**.

---

## Decision

### 1. Tenant theming is tenant data, not tenant code

Tenant theme configuration is stored as structured data (`TenantTheme` entity), versioned, and rendered by the shared Next.js storefront at request time. No tenant-supplied JavaScript is accepted. No tenant theme affects the admin portal, the marketplace surface, or any other tenant's storefront.

```
Tenant A theme data
        ↓
Validated theme schema
        ↓
Tenant A storefront only
```

```
Marketplace     → Saa9vi platform theme (never tenant theme)
Admin portal    → Saa9vi platform theme (never tenant theme)
Tenant A        → Tenant A theme
Tenant B        → Tenant B theme (isolated from A)
```

### 2. Three capability levels, gated by plan

| Level | Capability | Plan gate |
|---|---|---|
| **L1 — Controlled theme** | Colour palette, logo, font family from a curated set | `whitelabelEnabled = true` |
| **L2 — Layout presets** | Page layout variants (hero style, session card layout, etc.) from a fixed preset library | `whitelabelEnabled = true` + future plan flag |
| **L3 — Constrained custom CSS** | Tenant-supplied CSS, constrained to a tenant-scoped stylesheet boundary | Explicit `customCssEnabled` plan flag (separate from `whitelabelEnabled`) |

L1 ships first (T1). L2 and L3 are subsequent milestones (T2+). This ADR governs all three levels.

### 3. `TenantTheme` entity

A new `TenantTheme` entity stores the tenant's active theme configuration:

```ts
TenantTheme {
  id
  channelId          // tenant scope — enforced at all access points
  version: number    // incremented on every update; enables deterministic rollback
  status: 'active' | 'draft' | 'archived'
  config: ThemeConfig  // validated JSON (colour palette, logo asset IDs, font choices)
  customCss?: string   // L3 only — null until customCssEnabled
  createdAt
  updatedAt
}
```

**Versioning:** `version` is a monotonic integer. The previous active theme version is retained as `archived` to support instant rollback (set previous `archived` version back to `active`). Only one `active` version per channel at any time.

**`config` schema is validated server-side** on every write. Unknown keys are rejected. Logo/image references must resolve to assets in the tenant's own asset namespace.

### 4. Channel isolation — invariant

`TenantTheme.channelId` is set at creation from the authoritative `BbbOrganization.channelId` / `ctx.channelId` (INV-001 pattern). Theme reads are always filtered by `channelId`. A tenant admin can only read and write their own channel's theme — the same access model as CMS content (ADR-036).

Themes are never cross-channel-assignable. There is no `channels[]` join table — `channelId` is the sole scope identifier, consistent with the scalar-channel exception pattern.

### 5. L3 custom CSS — security boundary

When `customCssEnabled` is active, the tenant may supply a custom CSS string. The security model is:

**The CSS is scoped, not merely sanitized.**

Implementation requirements:
- Custom CSS is injected inside a tenant-scoped wrapper selector (e.g. `[data-channel="tok_abc"]`) so it cannot affect elements outside the tenant's DOM scope
- External resource loading via `url()` to non-allowlisted origins is blocked by the storefront's Content Security Policy (CSP)
- Prohibited constructs (e.g. `expression()`, `@import` of arbitrary URLs, vendor prefixes that escape scoping) are rejected at save time, not merely at render time
- The CSS is stored as-is and rendered server-side; no client-side `<style>` injection from untrusted sources
- Custom CSS is **never applied to**: admin portal pages, marketplace pages, or other tenants' storefront pages

**CSS sanitization alone is not the security boundary.** Scoping + CSP + prohibited-construct rejection together form the boundary. If any of the three cannot be guaranteed, L3 is not enabled for that tenant regardless of the plan flag.

### 6. Marketplace surface is Saa9vi platform theme

The marketplace (`marketplace.saa9vi.com`) always renders with the Saa9vi platform theme. When a marketplace search result card displays a tenant's session, it uses the platform card template. Tenant theme assets (logo, colours) are **not** applied to marketplace result cards.

This is a hard architectural boundary:

```
marketplace.saa9vi.com
        → Saa9vi platform theme
        → tenant logo may appear in result cards as content (avatar/logo image)
        → but tenant colour palette / custom CSS does NOT apply to marketplace pages
```

### 7. Feature flags are independent

The capability flags on `SubscriptionPlan` remain separate and independently billable:

| Flag | Controls |
|---|---|
| `customDomainEnabled` | Custom domain hostname (existing) |
| `whitelabelEnabled` | L1/L2 theming (existing flag, now wired to TenantTheme) |
| `marketplaceListingEnabled` | Marketplace listing (ADR-042) |
| `customCssEnabled` | L3 custom CSS (new) |

`whitelabelEnabled = true` does not imply `customCssEnabled = true`. A plan can offer branded storefronts without arbitrary CSS.

### 8. Default theme and reset

Each channel's default state is `TenantTheme` absent (no row) → storefront renders the Saa9vi default theme. Resetting a tenant's theme to the platform default is equivalent to deleting or archiving their `TenantTheme` row; the storefront falls back to the platform default without error.

---

## Consequences

### Required code changes

| Component | Change |
|---|---|
| `TenantTheme` entity | New entity + migration |
| `SubscriptionPlan` entity | Add `customCssEnabled: boolean` (default `false`) |
| Theme service | `TenantThemeService` — CRUD, version management, rollback |
| Admin GraphQL | `createTenantTheme`, `updateTenantTheme`, `rollbackTenantTheme`, `deleteTenantTheme`, `tenantTheme(channelId)` |
| Shop GraphQL | `myTenantTheme` (read-only, for the tenant admin dashboard UI) |
| Storefront | Theme resolution at request time by `channelId`; no server-side injection for admin/marketplace routes |
| CSS validation | Prohibited-construct rejection at save time (L3) |
| CSP | Content Security Policy updated to block external `url()` in tenant CSS scope |
| Migrations | `npx vendure migrate -g add-tenant-theme` + `npx vendure migrate -g add-custom-css-enabled-to-plan` |

### What is explicitly excluded

| Excluded | Reason |
|---|---|
| Admin portal theming | Platform-owned surface; no tenant data applied |
| Marketplace theming | Platform-owned surface (see §6) |
| Cross-tenant theme sharing | Violates channel isolation (INV-001) |
| Arbitrary JavaScript | Tenant code is never accepted |
| Client-side `<style>` injection | Server-side rendering of scoped CSS only |
| CSS applied to other tenants | Scoping guarantee |

### Invariant additions (to `invariants.md`)

> **INV-025 — Tenant theme applies only to the tenant's own storefront**
>
> A `TenantTheme` row is scoped to exactly one `channelId`. Tenant theme configuration
> (colours, logo, fonts, custom CSS) MUST NOT be applied to: the Saa9vi admin portal,
> the marketplace surface, or any other tenant's storefront pages.
> Custom CSS, when enabled, MUST be constrained to a tenant-scoped stylesheet boundary
> and MUST NOT load arbitrary external resources or inject executable code.

---

## Sequencing

T1 (L1 controlled theme) is safe to build before the marketplace entitlement gates (ADR-042 / M0) because tenant presentation is independent of marketplace eligibility. T2 (L3 custom CSS) should remain after T1 in the implementation roadmap — it has the highest security surface area and should only be introduced after L1 is proven stable.

## Migration note

Two schema migrations required, both via Vendure CLI:

1. `npx vendure migrate -g add-tenant-theme` — creates `tenant_theme` table
2. `npx vendure migrate -g add-custom-css-enabled-to-plan` — adds `customCssEnabled BOOLEAN NOT NULL DEFAULT false` to `subscription_plan`
