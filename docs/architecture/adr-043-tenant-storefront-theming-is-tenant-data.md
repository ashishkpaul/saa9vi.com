# ADR-043: Tenant Storefront Theming Is Tenant Data, Not Code

**Status:** Accepted  
**Date:** 2026-09-21  
**Related:** ADR-036 (CMS channel assignment policy), ADR-042 (marketplace listing entitlement), G1 hostname contract decision (2026-09-15), INV-001 (Channel = tenant identity), INV-006 (storefront contract independence)

---

## Context

Saa9vi is a multi-tenant platform. Each tenant academy has its own storefront (`{tenantSlug}.saa9vi.com` or `customDomain`). The shared marketplace (`marketplace.saa9vi.com`) is platform-owned.

As of 2026-09-21 — when this ADR was accepted — there was no tenant theming system: all tenant storefronts rendered with the default Saa9vi theme, and `SubscriptionPlan` carried `whitelabelEnabled` with no theming data structure or delivery mechanism behind it. **The L1 implementation has since shipped** (entity + immutable versioned lifecycle + entitlement gate + public `myTenantTheme`; commits `4d94844`, `4145e13`, `5e41d35`, `4f3a9cf`), which is what the ✅ tables below record. L2 (layout presets) and L3 (constrained custom CSS) remain unbuilt.

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

#### 2.1 L1 entitlement — subscription-state window

A plan flag alone is not an entitlement: it must be paired with a live commercial relationship. A tenant may use L1 theming only when **both** hold:

```
subscription.plan.whitelabelEnabled === true
AND subscription.status ∈ { trialing, active, past_due }
```

| Subscription state | `whitelabelEnabled` | L1 theming |
|---|---|---|
| `trialing` | `true` | ✅ |
| `active` | `true` | ✅ |
| `past_due` | `true` | ✅ — dunning must not strip branding from a tenant still being billed |
| `pending_provider_auth` | `true` | ❌ — authorization never completed |
| `cancelled` | `true` | ❌ — commercial relationship ended |
| any state | `false` | ❌ |
| no subscription row | — | ❌ |

The **local** subscription FSM is the only source of truth. Provider-side states (e.g. a Razorpay `halted`) do not introduce additional local eligibility states.

**Enforcement boundary.** `whitelabelEnabled` gates whether tenant branding is *usable*, not merely whether it can be edited:

| Operation | Gated |
|---|---|
| `createTenantTheme`, `updateTenantTheme` | ✅ |
| `publishTenantTheme` | ✅ |
| `rollbackTenantTheme` | ✅ — rollback *activates* a version, so it re-enables branding |
| `createDraftFromVersion` (internal seam) | ✅ — creates theming state |
| `myTenantTheme` (public Shop read) | ✅ — ineligible ⇒ `null` ⇒ platform default |
| `resetTenantTheme` | ❌ — only *removes* branding; the operational escape hatch |

Public API access and commercial entitlement are different questions: `myTenantTheme` remains `Permission.Public` because the storefront must resolve branding before customer authentication, while the *value* it returns is entitlement-conditional.

Entitlement is evaluated in exactly one place (`TenantCommercialEligibilityService`), which since ADR-042's implementation **delegates** the shared window evaluation to the platform `CommercialEntitlementService` (`src/platform/commercial/`) — one evaluator, the window supplied per entitlement. Marketplace listing eligibility (ADR-042, `marketplaceListingEnabled`) is a **separate** entitlement and is not part of this rule.

### 3. `TenantTheme` entity

`TenantTheme` stores one version of a tenant's theme. The fields are **flat columns**, not a JSON blob, so each field is independently nullable, typed and GraphQL-mappable:

```ts
TenantTheme {
  id
  channelId        // tenant scope — derived from ctx.channelId; immutable
  version: number  // monotonic per channel; allocated at draft creation
  status: 'draft' | 'active' | 'archived'
  primaryColor     // hex (#RGB | #RRGGBB | #RRGGBBAA), nullable
  secondaryColor
  accentColor
  backgroundColor
  textColor
  fontFamily       // key from the curated ALLOWED_FONTS set
  logoAssetId      // Vendure Asset owned by this channel
  displayName      // storefront header override
  createdAt
  updatedAt
}
```

`customCss` is **not** part of the entity in L1; it arrives with the L3 milestone alongside `SubscriptionPlan.customCssEnabled`.

**Lifecycle:**

```
draft --publish--> active --(publish the next version)--> archived
```

**Versioning — published versions are immutable.** `version` is a monotonic per-channel integer allocated when a **draft** is created (`MAX(version) + 1`, under a per-channel advisory lock so concurrent drafts cannot collide). It is **not** incremented on save.

- A version may only be edited while `status = 'draft'`.
- Changing the live theme requires a new draft: `active v3 → clone → draft v4 → publish v4`, which archives v3.
- Consequently every archived version still holds exactly the values that were live when it was active — which is what makes rollback deterministic.

**Validation** runs server-side on every write:

| Field group | Rule |
|---|---|
| Colours | Must be a hex colour, else rejected |
| `fontFamily` | Must be a key in the curated `ALLOWED_FONTS` set — no arbitrary fonts or font URLs |
| `logoAssetId` | Must resolve to an existing (non-soft-deleted) `Asset` whose `channels[]` contains the tenant's own channel |

Unknown input keys are rejected at the GraphQL layer by the typed `TenantThemeInput`.

### 4. Channel isolation — invariant

`TenantTheme.channelId` is derived from the authoritative request channel (`ctx.channelId`, INV-001 pattern) and is immutable thereafter. Theme reads and writes are always filtered by `channelId`. A tenant admin can only read and write their own channel's theme — the same access model as CMS content (ADR-036).

Themes are never cross-channel-assignable. There is no `channels[]` join table — `channelId` is the sole scope identifier, consistent with the scalar-channel exception pattern.

**At most one `active` version per channel is enforced by PostgreSQL**, not merely by service convention. Zero active rows (after `resetTenantTheme`) is the platform-default state — the partial index prevents *two or more* active rows; it does not require one:

```sql
UNIQUE ("channelId") WHERE "status" = 'active'
```

A losing concurrent publisher therefore fails closed (23505) instead of leaving two active themes. A separate `UNIQUE (channelId, version)` prevents duplicate versions.

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

Each channel's default state is `TenantTheme` absent (no active row) → storefront renders the Saa9vi default theme. Resetting is done via the `resetTenantTheme` Admin mutation, which archives the active version inside a transaction; there is **no** `deleteTenantTheme` mutation (history is preserved for audit). The storefront falls back to the platform default without error. `resetTenantTheme` is deliberately **ungated** by the entitlement: it only removes tenant branding and can never create theming state.

---

## Implementation status (2026-09-21)

This ADR is **Accepted** as an architectural decision; the capability matrix below records what is implemented vs. pending, so the ADR is not mistaken for a completed feature.

| Capability | ADR | Current code |
|---|---|---|
| `TenantTheme` entity (flat fields) | Required | ✅ |
| Channel isolation (`ctx.channelId`) | Required | ✅ |
| L1 colours, curated fonts, logo | Required | ✅ |
| Logo channel-ownership validation | Required | ✅ |
| Immutable published versions | Required | ✅ |
| One active per channel (DB partial unique index) | Required | ✅ |
| Draft cloning from published version | Required | ✅ |
| Admin CRUD + publish/rollback/reset | Required | ✅ |
| L1 entitlement (`whitelabelEnabled` + state window) | Required | ✅ |
| Public Shop `myTenantTheme`, entitlement-conditional | Required | ✅ |
| Storefront theme rendering (`edu-frontend`) | Required for delivery | ✅ Implemented 2026-09-24 (`edu-frontend` `7561643` L1 consumption + `b262ba3` billing/sign-in bridge + `2bba7e2` contract doc); positive themed-tenant runtime render not evidenced — no dev channel has an active theme row (backend fixture gap), `null` ⇒ platform default verified |
| L2 layout presets | Future | ❌ |
| `customCssEnabled` plan flag | Future | ❌ |
| L3 custom CSS + CSP changes | Future | ❌ |

---

## Consequences

### Required code changes

| Component | Change |
|---|---|
| `TenantTheme` entity | New entity + migration |
| `SubscriptionPlan` entity | Add `customCssEnabled: boolean` (default `false`) |
| Theme service | `TenantThemeService` — CRUD, version management, rollback |
| Admin GraphQL | `tenantTheme(id)`, `tenantThemes`, `createTenantTheme`, `updateTenantTheme`, `publishTenantTheme`, `rollbackTenantTheme`, `resetTenantTheme` — channel derived from `ctx.channelId`, never a caller-supplied `channelId` argument |
| Shop GraphQL | `myTenantTheme` — `Permission.Public`, consumed by the tenant **storefront** (branding must resolve before customer authentication); entitlement-conditional: ineligible ⇒ `null` ⇒ platform default |
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

> **INV-025 — Tenant theme is channel-isolated, immutable once published, and commercially gated**
>
> 1. `TenantTheme.channelId` is derived from the authoritative request channel
>    (`ctx.channelId`) and is immutable. All reads and writes are channel-scoped;
>    tenant A can never read or write tenant B's theme.
> 2. At most one `active` theme exists per channel — enforced by a PostgreSQL
>    partial unique index, not merely by service convention.
> 3. Published versions (`active`/`archived`) are immutable; edits happen only on
>    `draft` rows. Live changes require a new draft version.
> 4. Tenant theme configuration MUST NOT be applied to: the Saa9vi admin portal,
>    the marketplace surface, or any other tenant's storefront pages.
> 5. A non-null `logoAssetId` MUST resolve to an Asset belonging to the same channel.
> 6. L1 theme use (create/update/publish/rollback/draft-clone and the storefront
>    read) requires the commercial entitlement: subscription exists,
>    `plan.whitelabelEnabled === true`, and subscription status ∈
>    {`trialing`, `active`, `past_due`}. Ineligible storefront reads resolve to
>    the platform default (`myTenantTheme` returns `null`).
> 7. `resetTenantTheme` (removing branding) is always permitted.
> 8. Custom CSS, when enabled (L3), MUST be constrained to a tenant-scoped
>    stylesheet boundary and MUST NOT load arbitrary external resources or inject
>    executable code.

---

## Sequencing

T1 (L1 controlled theme) is safe to build before the marketplace entitlement gates (ADR-042, implemented as plan slice 7) because tenant presentation is independent of marketplace eligibility. T2 (L3 custom CSS) should remain after T1 in the implementation roadmap — it has the highest security surface area and should only be introduced after L1 is proven stable.

## Migration note

1. `npx vendure migrate -g add-tenant-theme` — creates `tenant_theme` table (**done**)
2. `npx vendure migrate -g tenant-theme-one-active-per-channel` — partial unique index enforcing one active theme per channel (**done**)
3. `npx vendure migrate -g add-custom-css-enabled-to-plan` — adds `customCssEnabled BOOLEAN NOT NULL DEFAULT false` to `subscription_plan` (future, L3)
