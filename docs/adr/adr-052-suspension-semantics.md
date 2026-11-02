# ADR-052 — Academy Admission Suspension vs Customer Checkout Suspension

**Status:** DECISION REQUIRED  
**Date:** 1 November 2026

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

## Proposed default (pending confirmation)

- Academy suspension blocks new admission, new course enrollment, and new BBB joins.
- Academy suspension does **not** revoke existing BBB entitlements (they expire naturally).
- Academy suspension does **not** automatically block checkout (that is `CustomerChannelStatus`'s separate concern).
- Platform-wide suspension (`Customer.customFields.status = Suspended`) remains independent and SuperAdmin-only.

## Gate

Do not merge academy suspension into `CustomerChannelStatus` or vice versa without an explicit product decision on items 1–4 above. C-14 is documentation-only until the decision is made.
