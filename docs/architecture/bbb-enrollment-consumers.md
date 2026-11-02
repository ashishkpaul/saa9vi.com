# BbbEnrollment Consumer Inventory (C-11)

**Date:** 1 November 2026  
**Status:** INVENTORY ONLY — no behavior changed.  
**Purpose:** Verified consumer map before any legacy enrollment access migration (C-18).

---

## Writers (verified from source)

| Location | Action | Condition |
|---|---|---|
| `bbb-admin.resolver.ts` — `createBbbEnrollment` | Upsert (re-activate or insert) | Academy staff + ACTIVE membership (H2 gate) |
| `bbb-deletion.service.ts` — `removeFromChannel` | Deactivates all for customer in channel | Customer deletion Flow A |
| `bbb-deletion.service.ts` — `fullDelete` | Deactivates all globally | Customer deletion Flow B |

**Does NOT write BbbEnrollment:** `order-fulfillment.listener.ts` — the room-product path creates `BbbEntitlement(type='bbb_room')`, not `BbbEnrollment`.

## Readers (active access paths)

| Location | Purpose |
|---|---|
| `room-access.service.ts` — `BbbRoomAccessService.evaluate()` | INV-027: source 4 (lowest priority) in `deriveRoomAccess()` |
| `room-access.policy.ts` — `deriveRoomAccess()` | Enrollment grants VIEWER if `active=true` and window valid |
| `bbb-admin.resolver.ts` — `bbbEnrollments` query | Admin listing |
| `bbb-shop.resolver.ts` | Shop-facing learner enrollment list |
| `bbb-channel-access.service.ts` | Channel ownership guard for enrollment mutations |
| `room-access.checker.ts` | Static source-shape invariant |
| `customer-deletion.e2e-spec.ts` | Tests deactivation on deletion |
| `bbb-channel-isolation.e2e-spec.ts` | Tests cross-channel boundary |
| `room-access.e2e-spec.ts` | Tests enrollment-based room access |

## Active access dependency

`BbbRoomAccessService.evaluate()` passes enrollment as source 4 to `deriveRoomAccess()`. Active `BbbEnrollment` rows still grant room access in production. They cannot be retired until:

1. All active rows with legitimate current access are converted to `BbbEntitlement(type='bbb_room')`.
2. `BbbRoomAccessService.evaluate()` removes source 4.
3. Room-access e2e passes with enrollment source removed.

## Conversion mapping (for C-18)

| BbbEnrollment | BbbEntitlement |
|---|---|
| `customerId` | `customerId` |
| `roomId` | `resourceId` |
| `active = true` | row is live |
| `expiresAt` | `validUntil` |
| `source = 'admin'` | `source = 'admin'` |
| `channelId` (via org) | `channelId` |

Conversion must be an idempotent Admin API operation using `BbbEntitlementService.create()`, not migration SQL.

## Gate for C-18

Do not start C-18 until this document is reviewed, every active row has a verified mapping, and room-access e2e passes with enrollment source removed in isolation.
