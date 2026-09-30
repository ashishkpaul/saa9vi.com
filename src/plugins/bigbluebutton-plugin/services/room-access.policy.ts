/**
 * INV-027 (BUG-045) — the single home for room-access semantics.
 *
 * Before this module existed, `bbbRoomStatus` (preview) and `joinRoom` (action)
 * each hand-rolled their own source list and drifted apart in both directions:
 * an admin-created `BbbEnrollment` made a room look accessible but could never
 * pass join's Gate 3 (entitlement-only), while a FEAT-001
 * `BbbOrganizationMembership` passed join's Gate 1 but was invisible to the
 * preview (ForbiddenError). `joinRoom` also authorized only after
 * `requestProvisioning`, so a denied customer could still enqueue a meeting.
 *
 * Both surfaces now call `deriveRoomAccess()` through
 * `BbbRoomAccessService.evaluate()` — preview denial ⇔ join denial, and
 * authorization always precedes provisioning. Structural checker:
 * `RoomAccessChecker` under `npm run verify:invariants`.
 *
 * Deliberately dependency-light (mirrors `grant-selection.policy.ts`): pure
 * functions over structural inputs so the semantics are unit-testable without
 * a database. The only import is the legacy role list from `constants`.
 */
import { MODERATOR_ROLES } from "../constants";

/** Moderator-capable roles of the NEW membership entity (mirrors BbbMembershipService). */
export const MEMBERSHIP_MODERATOR_ROLES: readonly string[] = ["org_admin", "moderator"];

/** Where a room-access decision came from — first matching source wins. */
export type RoomAccessSource =
  | "membership"
  | "legacy_member"
  | "entitlement"
  | "enrollment";

/** Structural shapes of the four source rows (entity-agnostic on purpose). */
export interface RoomAccessInput {
  /** Active `BbbOrganizationMembership` row (null when absent). */
  membership?: { role: string } | null;
  /** Active `BbbOrganizationMember` row (null when absent). */
  legacyMember?: { role: string } | null;
  /** `BbbEntitlement { type: 'bbb_room' }` row for this room (null when absent). */
  entitlement?: { validFrom?: Date | null; validUntil?: Date | null } | null;
  /** Active `BbbEnrollment` row for this room (null when absent). */
  enrollment?: { validUntil?: Date | null; expiresAt?: Date | null } | null;
}

export interface RoomAccessDecision {
  allowed: boolean;
  /** Only staff sources (1-2) can be moderators; purchase/admin access is VIEWER. */
  isModerator: boolean;
  source: RoomAccessSource | null;
}

/**
 * Entitlement window: `validFrom <= now <= validUntil` (a null bound is open).
 * Includes `validFrom`, which the old preview omitted — the shared evaluation
 * uses the stricter, correct window for both surfaces.
 */
export function isEntitlementValid(
  entitlement: { validFrom?: Date | null; validUntil?: Date | null },
  now: Date,
): boolean {
  if (entitlement.validFrom && entitlement.validFrom > now) return false;
  if (entitlement.validUntil && entitlement.validUntil < now) return false;
  return true;
}

/**
 * Enrollment window — the semantics `bbbRoomStatus` applied: any provided
 * expiry bound in the past invalidates the row (`validUntil`, else `expiresAt`;
 * both are honoured when present). `active: true` is enforced by the query.
 */
export function isEnrollmentValid(
  enrollment: { validUntil?: Date | null; expiresAt?: Date | null },
  now: Date,
): boolean {
  if (enrollment.validUntil && enrollment.validUntil < now) return false;
  if (enrollment.expiresAt && enrollment.expiresAt < now) return false;
  return true;
}

/** New-membership role → moderator? (org_admin / moderator; staff → VIEWER). */
export function isMembershipModerator(role: string): boolean {
  return MEMBERSHIP_MODERATOR_ROLES.includes(role);
}

/** Legacy-member role → moderator? (all valid legacy roles are moderators). */
export function isLegacyMemberModerator(role: string): boolean {
  return (MODERATOR_ROLES as readonly string[]).includes(role);
}

/**
 * The one room-access decision (INV-027). First matching source wins and also
 * determines the BBB role — matching the old Gate 1 short-circuit, where a
 * staff membership never consulted the later sources.
 *
 * Order: 1 membership → 2 legacy member → 3 entitlement → 4 enrollment.
 */
export function deriveRoomAccess(
  input: RoomAccessInput,
  now: Date = new Date(),
): RoomAccessDecision {
  if (input.membership) {
    return {
      allowed: true,
      isModerator: isMembershipModerator(input.membership.role),
      source: "membership",
    };
  }
  if (input.legacyMember) {
    return {
      allowed: true,
      isModerator: isLegacyMemberModerator(input.legacyMember.role),
      source: "legacy_member",
    };
  }
  if (input.entitlement && isEntitlementValid(input.entitlement, now)) {
    return { allowed: true, isModerator: false, source: "entitlement" };
  }
  if (input.enrollment && isEnrollmentValid(input.enrollment, now)) {
    return { allowed: true, isModerator: false, source: "enrollment" };
  }
  return { allowed: false, isModerator: false, source: null };
}