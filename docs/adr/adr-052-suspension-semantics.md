# ADR-052 — Academy Admission Suspension vs Customer Checkout Suspension

**Status:** ACCEPTED  (**Option B**)  
**Date:** 7 November 2026
**Decided:** Block `TenantLearnerMembership.status = NOT ACTIVE` (SUSPENDED, REVOKED, LEFT or PENDING) from BBB join paths. Only `ACTIVE` passes. No membership row (null) does NOT block.

---

## Current semantics (verified from source)

### `CustomerChannelStatus` (CustomerSuspensionPlugin)

- **Entity:** `customer_channel_status` — unique on `(customerId, channelId)`.
- **Values:** `Active` | `Suspended`.
- **Effect:** Read by the `CustomerSuspension` order process at `onTransitionStart`. Blocks NEW checkouts at `ArrangingPayment` when status is `Suspended`.
- **Scope:** Per-channel (academy). Independent of platform-wide suspension (stored in `Customer.customFields.status`).
- **Existing entitlements:** Continue until natural expiry. Suspension does NOT revoke BBB access.
- **Log:** `CustomerStatusChangeLog` records status changes with reason and actor.

### `TenantLearnerMembership.status` (TenantPlugin)

- **Entity:** `tenant_learner_membership` — unique on `(customerId, channelId)`.
- **Values:** `PENDING` | `ACTIVE` | `SUSPENDED` | `REVOKED` | `LEFT`.
- **Effect:** `SUSPENDED` is an academy admission status. Checked by BBB H1/H2 resolvers via `LearnerAdmissionPort.isActiveMember()` — only `ACTIVE` passes.
- **Scope:** Per-channel (academy).
- **Log:** `TenantLearnerMembershipLog` (C-02) records all transitions with reason and actor.

---

## Key distinction

| Concern | `CustomerChannelStatus` | `TenantLearnerMembership.status` |
|---|---|---|
| Blocks new checkout? | Yes (order process) | No (not wired to order process) |
| Blocks BBB access? | No (existing entitlements continue) | Yes (H1/H2 check `ACTIVE` only) |
| Blocks course enrollment? | No | Yes (if C-25 checks admission) |
| Blocks new academy admission? | No | Yes (`SUSPENDED` is a non-ACTIVE state) |
| Platform-wide equivalent? | `Customer.customFields.status` | No (membership is per-tenant only) |

These are **not interchangeable**. A customer can be `Suspended` for checkout but still have `ACTIVE` academy admission (and thus still join BBB sessions). Conversely, a `SUSPENDED` membership blocks BBB access but does not prevent checkout of non-course products.

---

## Decision required

Define whether an academy admission suspension (`TenantLearnerMembership.status = SUSPENDED`) should additionally:

1. **Block new course enrollment?** — Currently: yes, because C-25 will check `isActiveMember()`. Confirm this is intended.
2. **Block new BBB joins?** — Currently: yes, because H1/H2 check `isActiveMember()`. Confirm.
3. **Revoke existing BBB entitlements?** — Currently: no. Existing `BbbEntitlement` rows remain live until expiry. Should academy suspension also revoke or expire live entitlements?
4. **Block new checkout?** — Currently: no. Should academy suspension also set `CustomerChannelStatus = Suspended` to block checkout?

## Decision (accepted)

Academy suspension blocks new BBB joins at join time (not only at grant time):

1. **Block new BBB joins?** — Yes. `BbbRoomAccessService.isLearnerBlocked()` blocks any non-null status that is not `ACTIVE` (SUSPENDED, REVOKED, LEFT or PENDING). Checked for learner-facing access sources (entitlement, enrollment, session entitlement). Staff sources (membership, legacyMember) are NOT blocked.
2. **Revoke existing BBB entitlements?** — No. Existing `BbbEntitlement` rows remain live until natural expiry; suspension does NOT revoke them.
3. **Block new checkout?** — No. Academy suspension does not set `CustomerChannelStatus = Suspended`; those are separate concerns.
4. **PENDING membership** — Blocked until activated via `activateTenantLearner`. Readmitted learners (REVOKED → PENDING) stay blocked until activation.

## Gate

Do not merge academy suspension into `CustomerChannelStatus` or vice versa without an explicit product decision.
