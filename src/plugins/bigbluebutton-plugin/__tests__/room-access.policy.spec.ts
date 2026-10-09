/**
 * INV-027 (BUG-045) — room-access policy.
 *
 * Infrastructure-free by design (no Postgres, Redis or BBB): the policy module
 * is pure, and this spec pins the exact semantics shared by
 * `BbbShopResolver.bbbRoomStatus` (preview) and
 * `BbbMeetingService.joinRoom` (action) through `BbbRoomAccessService`, so the
 * two surfaces can never drift apart again.
 *
 * Regressions covered (both directions of BUG-045):
 *  - an admin-created `BbbEnrollment` makes a room visible to the preview but
 *    could never pass join's old entitlement-only Gate 3 — enrollment must
 *    authorize the shared decision (as VIEWER);
 *  - a FEAT-001 `BbbOrganizationMembership` passes join but was invisible to
 *    the preview — membership must authorize the shared decision (role-derived
 *    BBB role);
 *  - join previously ran its gates only AFTER `requestProvisioning`; the
 *    ordering itself is enforced by `RoomAccessChecker`
 *    (`src/platform/invariants/room-access.checker.ts`), which is structural.
 */

import { describe, expect, it } from 'vitest';
import {
  MEMBERSHIP_MODERATOR_ROLES,
  deriveClassAction,
  deriveRoomAccess,
  isEnrollmentValid,
  isEntitlementValid,
  isLegacyMemberModerator,
  isMembershipModerator,
} from '../services/room-access.policy';

const NOW = new Date('2026-09-30T12:00:00.000Z');
const past = new Date('2026-09-29T12:00:00.000Z');
const future = new Date('2026-10-01T12:00:00.000Z');

describe('INV-027 room-access policy', () => {
  describe('source order (first match wins, as the old Gate 1 short-circuit)', () => {
    it('authorizes FEAT-001 staff by membership alone, deriving the BBB role', () => {
      // The BUG-045 "display ✗ / join ✓" direction: preview must now agree.
      expect(deriveRoomAccess({ membership: { role: 'org_admin' } }, NOW)).toEqual({
        allowed: true,
        isModerator: true,
        source: 'membership',
      });
      expect(deriveRoomAccess({ membership: { role: 'moderator' } }, NOW)).toEqual({
        allowed: true,
        isModerator: true,
        source: 'membership',
      });
      // 'staff' membership is access but never a moderator (old Gate 1 VIEWER).
      expect(deriveRoomAccess({ membership: { role: 'staff' } }, NOW)).toEqual({
        allowed: true,
        isModerator: false,
        source: 'membership',
      });
    });

    it('lets a membership short-circuit later sources (expired entitlement is irrelevant)', () => {
      const decision = deriveRoomAccess(
        {
          membership: { role: 'moderator' },
          entitlement: { validFrom: null, validUntil: past },
          enrollment: { validUntil: past, expiresAt: past },
        },
        NOW,
      );
      expect(decision.allowed).toBe(true);
      expect(decision.source).toBe('membership');
      expect(decision.isModerator).toBe(true);
    });

    it('authorizes legacy staff by BbbOrganizationMember, moderator for all valid legacy roles', () => {
      expect(deriveRoomAccess({ legacyMember: { role: 'org-admin' } }, NOW)).toEqual({
        allowed: true,
        isModerator: true,
        source: 'legacy_member',
      });
      expect(deriveRoomAccess({ legacyMember: { role: 'trainer' } }, NOW)).toEqual({
        allowed: true,
        isModerator: true,
        source: 'legacy_member',
      });
      // A legacy member outranks a stored entitlement (source order 2 < 3).
      expect(
        deriveRoomAccess(
          { legacyMember: { role: 'org-admin' }, entitlement: { validFrom: null, validUntil: future } },
          NOW,
        ).source,
      ).toBe('legacy_member');
    });

    it('authorizes a purchase by valid entitlement, as VIEWER', () => {
      expect(
        deriveRoomAccess(
          { entitlement: { validFrom: past, validUntil: future } },
          NOW,
        ),
      ).toEqual({ allowed: true, isModerator: false, source: 'entitlement' });
    });

    it('authorizes an admin-created enrollment as VIEWER (the BUG-045 "display ✓ / join ✗" direction)', () => {
      // The old joinRoom had no path that honored BbbEnrollment at all.
      expect(
        deriveRoomAccess(
          { enrollment: { validUntil: future, expiresAt: null } },
          NOW,
        ),
      ).toEqual({ allowed: true, isModerator: false, source: 'enrollment' });
      // Enrollment is last: an entitlement outranks it.
      expect(
        deriveRoomAccess(
          {
            entitlement: { validFrom: past, validUntil: future },
            enrollment: { validUntil: future, expiresAt: null },
          },
          NOW,
        ).source,
      ).toBe('entitlement');
    });

    it('denies when no source is present or every source is out of window', () => {
      expect(deriveRoomAccess({}, NOW)).toEqual({
        allowed: false,
        isModerator: false,
        source: null,
      });
      expect(
        deriveRoomAccess(
          {
            entitlement: { validFrom: null, validUntil: past },
            enrollment: { validUntil: past, expiresAt: null },
          },
          NOW,
        ),
      ).toEqual({ allowed: false, isModerator: false, source: null });
    });
  });

  describe('entitlement window (validFrom <= now <= validUntil)', () => {
    it('rejects an entitlement that has not started yet', () => {
      // The old preview omitted the validFrom check — the shared decision is
      // deliberately the stricter, correct window for both surfaces.
      expect(isEntitlementValid({ validFrom: future, validUntil: null }, NOW)).toBe(false);
      expect(isEntitlementValid({ validFrom: NOW, validUntil: null }, NOW)).toBe(true);
    });

    it('rejects an expired entitlement and honors open bounds', () => {
      expect(isEntitlementValid({ validFrom: past, validUntil: past }, NOW)).toBe(false);
      expect(isEntitlementValid({ validFrom: null, validUntil: future }, NOW)).toBe(true);
      expect(isEntitlementValid({ validFrom: null, validUntil: null }, NOW)).toBe(true);
    });
  });

  describe('enrollment window (any provided bound in the past invalidates)', () => {
    it('rejects validUntil in the past (purchase-window expiry)', () => {
      expect(isEnrollmentValid({ validUntil: past, expiresAt: null }, NOW)).toBe(false);
      expect(isEnrollmentValid({ validUntil: future, expiresAt: null }, NOW)).toBe(true);
    });

    it('rejects expiresAt in the past (trial/accessDays expiry)', () => {
      expect(isEnrollmentValid({ validUntil: null, expiresAt: past }, NOW)).toBe(false);
      expect(isEnrollmentValid({ validUntil: null, expiresAt: future }, NOW)).toBe(true);
    });

    it('rejects when EITHER bound is in the past (pins bbbRoomStatus semantics)', () => {
      // A validUntil in the future does not resurrect a stale expiresAt.
      expect(isEnrollmentValid({ validUntil: future, expiresAt: past }, NOW)).toBe(false);
      expect(isEnrollmentValid({ validUntil: past, expiresAt: future }, NOW)).toBe(false);
      expect(isEnrollmentValid({ validUntil: future, expiresAt: future }, NOW)).toBe(true);
      expect(isEnrollmentValid({ validUntil: null, expiresAt: null }, NOW)).toBe(true);
    });
  });

  describe('role vocabularies (two entity generations, both pinned here)', () => {
    it('pins the new membership moderator roles', () => {
      expect([...MEMBERSHIP_MODERATOR_ROLES]).toEqual(['org_admin', 'moderator']);
      expect(isMembershipModerator('org_admin')).toBe(true);
      expect(isMembershipModerator('moderator')).toBe(true);
      expect(isMembershipModerator('staff')).toBe(false);
    });

    it('pins the legacy member roles via constants.MODERATOR_ROLES', () => {
      expect(isLegacyMemberModerator('org-admin')).toBe(true);
      expect(isLegacyMemberModerator('trainer')).toBe(true);
      expect(isLegacyMemberModerator('student')).toBe(false);
    });
  });

  // ─── classAction — the server-driven storefront action (INV-008) ─────────
  // A boolean cannot answer all four questions the room card asks, so the
  // contract is a four-valued action derived from the SAME access decision
  // plus the room state. The storefront only renders it.

  describe('deriveClassAction (START | JOIN | WAIT | NONE)', () => {
    it('lets a moderator START an idle or provisioning room', () => {
      expect(
        deriveClassAction({ allowed: true, isModerator: true, roomState: 'Idle' }),
      ).toBe('START');
      expect(
        deriveClassAction({
          allowed: true,
          isModerator: true,
          roomState: 'Provisioning',
        }),
      ).toBe('START');
    });

    it('makes a learner WAIT on a room nobody has started yet', () => {
      expect(
        deriveClassAction({ allowed: true, isModerator: false, roomState: 'Idle' }),
      ).toBe('WAIT');
      expect(
        deriveClassAction({
          allowed: true,
          isModerator: false,
          roomState: 'Provisioning',
        }),
      ).toBe('WAIT');
    });

    it('lets EVERY authorized viewer JOIN a live room — learners included', () => {
      expect(
        deriveClassAction({ allowed: true, isModerator: false, roomState: 'Active' }),
      ).toBe('JOIN');
      expect(
        deriveClassAction({ allowed: true, isModerator: true, roomState: 'Active' }),
      ).toBe('JOIN');
    });

    it('offers no action on a Failed room — it needs an admin reset', () => {
      expect(
        deriveClassAction({ allowed: true, isModerator: true, roomState: 'Failed' }),
      ).toBe('NONE');
      expect(
        deriveClassAction({
          allowed: true,
          isModerator: false,
          roomState: 'Failed',
        }),
      ).toBe('NONE');
    });

    it('returns NONE when access was denied (the preview throws first, but the answer is total)', () => {
      expect(
        deriveClassAction({ allowed: false, isModerator: false, roomState: 'Idle' }),
      ).toBe('NONE');
      expect(
        deriveClassAction({ allowed: false, isModerator: true, roomState: 'Active' }),
      ).toBe('NONE');
    });
  });
});
