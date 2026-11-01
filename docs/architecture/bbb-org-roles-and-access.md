# BBB Organizational Roles and INV-027 Access Evaluator (C-12)

**Date:** 1 November 2026  
**Status:** PRESERVED — no entity retired, no table dropped.

---

## Entity responsibilities

| Entity | Purpose | Owner plugin | Retire? |
|---|---|---|---|
| `BbbOrganizationMember` | Organization trainer/org-admin role; referenced by `BbbScheduledSession.trainer` | BigBlueButtonPlugin | **No** — separate trainer/admin identity |
| `BbbOrganizationMembership` | Internal-staff access path (org_admin, moderator) | BigBlueButtonPlugin | **No** — separate internal-staff model |
| `BbbEntitlement` | Grant record for room/session access (ADR-targeted primitive) | BigBlueButtonPlugin | **No** — the access grant record |
| `BbbEnrollment` | Legacy direct room access (pre-entitlement) | BigBlueButtonPlugin | **Deferred** — see C-11/C-18, only after conversion |
| `BbbRoomAccessService` | Single INV-027 evaluator for room status/preview and join | BigBlueButtonPlugin | **Never** — do not add a second evaluator |

## Decision rules

1. **Student enrollment** is not equivalent to `BbbOrganizationMember` or `BbbOrganizationMembership`. The former grants room access via `BbbEntitlement` or legacy `BbbEnrollment`; the latter two are staff roles.
2. **Course `TRAINER` role** (future LearningPlugin) does not automatically imply BBB moderator. An explicit mapping to an active `BbbOrganizationMember` trainer/admin identity is required before returning a moderator join URL (D8).
3. **`BbbRoomAccessService`** remains the single authorization evaluator. `deriveRoomAccess()` in `room-access.policy.ts` is the pure policy function. Both the preview (`bbbRoomStatus`) and the action (`joinRoom`) delegate here.
4. Do not add a direct course-role-to-BBB-moderator shortcut.

## Access source priority (INV-027)

`deriveRoomAccess()` checks sources in order:

1. `BbbOrganizationMembership` (staff — moderator-capable)
2. `BbbOrganizationMember` (legacy staff — moderator-capable)
3. `BbbEntitlement` (purchase/admin grant — VIEWER)
4. `BbbEnrollment` (legacy direct access — VIEWER)

Sources 1–2 grant moderator when the role matches `MODERATOR_ROLES` / `MEMBERSHIP_MODERATOR_ROLES`. Sources 3–4 always grant VIEWER.
