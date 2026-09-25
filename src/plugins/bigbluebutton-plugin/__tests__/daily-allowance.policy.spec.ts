/**
 * Slice 6 — daily live-allowance policy (ADR-045 / INV-026).
 *
 * Infrastructure-free by design (no Postgres, Redis or BBB): the policy module
 * is pure, and this spec pins the properties the whole slice rests on —
 *
 *   1. DISCRIMINATOR: `providerPlanId IS NULL` is the only "daily-only" test
 *      (ADR-039/ADR-044), never `status` or `providerStatus`.
 *   2. WINDOW DISJOINTNESS: consecutive server-day windows must not overlap.
 *      Both bounds are tested inclusively at read and provisioning time, so an
 *      `end` equal to the next `start` would make two grants in-window at that
 *      instant and `myLiveUsage` would report 120 minutes for a 60-minute day.
 *   3. COVERAGE: every instant of a day falls inside that day's window — the
 *      bridge that lets the same row satisfy the read model and the gate.
 *   4. KEY STABILITY: the idempotency key of plan §3.3 — the same key the
 *      renewal writer uses — is (organization, validFrom, sourceType) and does
 *      not vary with the Date object's representation.
 *   5. FROZEN VALUE: 60/day (§3.6, D-1 frozen 2026-09-22).
 *
 * The infra-gated end-to-end proof (real Postgres, real provisioning worker,
 * real FSM) lives in `../e2e/daily-allowance.e2e-spec.ts`.
 */

import { describe, expect, it } from 'vitest';
import {
  DAILY_ALLOWANCE_MINUTES,
  DAILY_ALLOWANCE_SOURCE_TYPE,
  dailyAllowanceIdempotencyKey,
  dailyAllowanceWindowFor,
  isDailyOnlyPlan,
  isWithinAllowanceWindow,
  startOfServerDay,
} from '../services/daily-allowance.policy';
import { TENANT_SELECTABLE_SOURCE_TYPES } from '../services/grant-selection.policy';

describe('Slice 6 daily-allowance policy', () => {
  describe('daily-only discriminator (ADR-039 / ADR-044)', () => {
    it('treats a provider-free plan as daily-only', () => {
      expect(isDailyOnlyPlan({ providerPlanId: null })).toBe(true);
      expect(isDailyOnlyPlan({ providerPlanId: undefined })).toBe(true);
    });

    it('treats a provider-backed plan as NOT daily-only (period pool instead)', () => {
      expect(isDailyOnlyPlan({ providerPlanId: 'plan_ABC123' })).toBe(false);
    });

    it('is false for a missing plan rather than guessing a default', () => {
      expect(isDailyOnlyPlan(null)).toBe(false);
      expect(isDailyOnlyPlan(undefined)).toBe(false);
    });
  });

  describe('server-clock day window (D-7)', () => {
    it('starts at local midnight with no sub-day residue', () => {
      const start = startOfServerDay(new Date(2026, 8, 25, 13, 47, 12, 913));
      expect(start.getHours()).toBe(0);
      expect(start.getMinutes()).toBe(0);
      expect(start.getSeconds()).toBe(0);
      expect(start.getMilliseconds()).toBe(0);
      expect(start.getDate()).toBe(25);
    });

    it('uses the Saa9vi server clock, not a caller-supplied offset', () => {
      // Two instants a day apart in time-of-day share one window: the boundary
      // is the platform's, never a tenant's (ADR-042's clock rule, reused by D-7).
      const a = dailyAllowanceWindowFor(new Date(2026, 8, 25, 0, 0, 0, 0));
      const b = dailyAllowanceWindowFor(new Date(2026, 8, 25, 23, 59, 59, 999));
      expect(a.start.getTime()).toBe(b.start.getTime());
      expect(a.end.getTime()).toBe(b.end.getTime());
    });

    it('keeps consecutive days strictly disjoint (inclusive bounds)', () => {
      const today = dailyAllowanceWindowFor(new Date(2026, 8, 25, 9, 0, 0, 0));
      const tomorrow = dailyAllowanceWindowFor(new Date(2026, 8, 26, 9, 0, 0, 0));

      // The shared instant — tomorrow's midnight — belongs to tomorrow only.
      const boundary = new Date(tomorrow.start.getTime());
      expect(isWithinAllowanceWindow(today, boundary)).toBe(false);
      expect(isWithinAllowanceWindow(tomorrow, boundary)).toBe(true);
      expect(today.end.getTime()).toBeLessThan(tomorrow.start.getTime());
    });

    it('covers every instant of its own day (read model and gate agree)', () => {
      // The same predicate the provisioning gate and myLiveUsage apply:
      // validFrom <= now AND validUntil >= now.
      const day = new Date(2026, 8, 25, 0, 0, 0, 0);
      const window = dailyAllowanceWindowFor(day);
      for (const offsetMs of [0, 1, 3_600_000, 43_200_000, 86_399_999]) {
        expect(
          isWithinAllowanceWindow(window, new Date(day.getTime() + offsetMs)),
        ).toBe(true);
      }
    });

    it('excludes the millisecond before the day starts', () => {
      const window = dailyAllowanceWindowFor(new Date(2026, 8, 25, 12, 0, 0, 0));
      expect(
        isWithinAllowanceWindow(window, new Date(window.start.getTime() - 1)),
      ).toBe(false);
    });
  });

  describe('idempotency key (plan §3.3)', () => {
    it('is stable for the same organization and day, regardless of time-of-day', () => {
      const morning = dailyAllowanceWindowFor(new Date(2026, 8, 25, 6, 30, 0));
      const evening = dailyAllowanceWindowFor(new Date(2026, 8, 25, 21, 15, 0));
      expect(dailyAllowanceIdempotencyKey('org-1', morning)).toBe(
        dailyAllowanceIdempotencyKey('org-1', evening),
      );
    });

    it('separates organizations and days', () => {
      const day = dailyAllowanceWindowFor(new Date(2026, 8, 25, 12, 0, 0));
      const nextDay = dailyAllowanceWindowFor(new Date(2026, 8, 26, 12, 0, 0));
      expect(dailyAllowanceIdempotencyKey('org-1', day)).not.toBe(
        dailyAllowanceIdempotencyKey('org-2', day),
      );
      expect(dailyAllowanceIdempotencyKey('org-1', day)).not.toBe(
        dailyAllowanceIdempotencyKey('org-1', nextDay),
      );
    });

    it('names the subscription source type (the renewal writer\'s key shape)', () => {
      const window = dailyAllowanceWindowFor(new Date(2026, 8, 25, 12, 0, 0));
      expect(dailyAllowanceIdempotencyKey('org-1', window)).toContain(
        DAILY_ALLOWANCE_SOURCE_TYPE,
      );
    });
  });

  describe('frozen values and seam alignment', () => {
    it('freezes the Free Basic daily runway at 60 minutes (§3.6 / D-1)', () => {
      expect(DAILY_ALLOWANCE_MINUTES).toBe(60);
    });

    it('writes daily grants on the subscription discriminator (F-6: no second entity)', () => {
      expect(DAILY_ALLOWANCE_SOURCE_TYPE).toBe('subscription');
    });

    it('a daily grant is tenant-selectable, so the existing gate serves it unchanged', () => {
      // INV-026: slice 6 adds a grant *window*, never a grant *kind*. If this
      // ever fails, daily allowances would be invisible to doProvisionMeeting()
      // and myLiveUsage() and the slice would be silently broken.
      expect([...TENANT_SELECTABLE_SOURCE_TYPES]).toContain(
        DAILY_ALLOWANCE_SOURCE_TYPE,
      );
    });
  });
});
