# Known Vendure Built-in Resolver Overrides

**Last reviewed:** 1 November 2026 (Vendure 3.8.1)  
**File:** `src/plugins/tenant-plugin/api/tenant-admin.resolver.ts`

This document lists every Vendure built-in GraphQL field that Saa9vi overrides
in `TenantAdminResolver`. All overrides must be reviewed when upgrading Vendure
to confirm that upstream resolver/schema changes do not regress the Saa9vi
behavior.

---

## 1. `administrators` (list query)

**Vendure built-in:** Returns all administrators visible to the caller using
`AdministratorService.findAll()`, which since Vendure 3.7.3 applies
`restrictToVisibleAdministrators` — hiding any administrator whose role the
caller could not be granted.

**Saa9vi override reason (INV-016, BUG-025):**  
The 3.7.3 core filter drops tenant-admin rows from the result for a
channel-scoped caller before the INV-016 channel filter can see them. The
override splits the concerns: the administrator *row* follows channel scoping;
role *details* stay hidden via the core `User.roles` @ResolveField filter
(anti-enumeration).

**Saa9vi behavior:**
- SuperAdmin: delegates to `AdministratorService.findAll()` (full list, all
  channels, Dashboard filter/sort/pagination intact).
- Tenant admin: builds the same `ListQueryBuilder` query directly, then adds:
  - channel filter (`Role.channels` must include `ctx.channelId`)
  - SuperAdmin role exclusion (`role.code != '__superadmin_role__'`)

**Regression tests:** `src/plugins/tenant-plugin/e2e/tenant-plugin.e2e-spec.ts`
— INV-016 cross-channel / same-channel administrator visibility cases.

---

## 2. `administrator(id)` (singular query)

**Vendure built-in:** Implicitly channel-scoped; a SuperAdmin on the Default
channel gets "not found" for a tenant admin even though the list works.

**Saa9vi override reason (BUG-026):**  
Same channel-scoping gap as the list. Without this override, SuperAdmin cannot
resolve a tenant admin by ID when operating on the Default channel, breaking
Dashboard role-name resolution.

**Saa9vi behavior:**
- SuperAdmin: direct repository lookup by `id` (no channel filter).
- Tenant admin: same channel filter + SuperAdmin role exclusion as the list.

---

## 3. `roles` (list query)

**Vendure built-in:** Implicitly channel-scoped — only returns roles whose
`channels[]` includes the active channel. A SuperAdmin on the Default channel
cannot see tenant-scoped roles, so role names appear as bare numeric IDs in the
Dashboard.

**Saa9vi override reason (BUG-025):**  
SuperAdmin needs cross-channel role visibility. Tenant admins must still be
channel-scoped.

**Saa9vi behavior:**
- SuperAdmin: delegates to `RoleService.findAll()` — returns all roles with
  Dashboard filter/sort/pagination. SuperAdmin role itself is included.
- Tenant admin: same `RoleService.findAll()` result, then filters out
  `__superadmin_role__` before returning.

---

## 4. `role(id)` (singular query)

**Vendure built-in:** Implicitly channel-scoped; same gap as the list.

**Saa9vi override reason (BUG-026):**  
SuperAdmin cannot resolve a tenant-scoped role by ID when on the Default
channel.

**Saa9vi behavior:**
- SuperAdmin: direct repository lookup (no channel filter).
- Tenant admin: channel filter + SuperAdmin role exclusion.

---

## Upgrade checklist

When upgrading Vendure, inspect the upstream diff for these resolver methods
before merging:

- `AdministratorResolver.administrators()`
- `AdministratorResolver.administrator()`
- `RoleResolver.roles()`
- `RoleResolver.role()`

Check for:
- New permission guards added to the built-in
- Changed relations loaded (add them to the override's `relations` set)
- Changed filter/sort/pagination semantics
- New fields added to the return types
- Schema changes to `Administrator` or `Role` types

If a built-in change requires updating the override, update this document with
the Vendure version, the change, and the updated behavior.
