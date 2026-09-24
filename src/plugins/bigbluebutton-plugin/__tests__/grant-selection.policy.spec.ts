/**
 * BUG-036 — grant-selection policy.
 *
 * Infrastructure-free by design (no Postgres, Redis or BBB): the policy module
 * is pure, and this spec pins the exact semantics that
 * `BbbProvisioningWorkerService.doProvisionMeeting()` and
 * `GrantReaderService` now share, so the two can never drift apart again.
 *
 * Regression covered: the auto-created `internal_overhead` grant carries
 * `grantedMinutes: -1` as a sentinel with `isUnbounded: true`
 * (`BbbOrganizationService.create()`). Before BUG-036 the provisioning gate
 * never read `isUnbounded`, computed `-1 - consumed <= 0`, and refused every
 * tenant with the misleading "No minutes remaining on plan".
 *
 * The infra-gated end-to-end proof (real Postgres, real provisioning worker)
 * lives in
 * `src/plugins/bigbluebutton-plugin/e2e/bbb-meeting-concurrency.e2e-spec.ts`.
 */

import { describe, expect, it } from 'vitest';
import {
  PROVISIONING_ALLOWANCE_EXHAUSTED_ERROR,
  PROVISIONING_NO_GRANT_ERROR,
  TENANT_SELECTABLE_SOURCE_TYPES,
  grantUnavailableReason,
  hasProvisionableMinutes,
  isTenantSelectableSourceType,
  remainingMinutesForGrant,
} from '../services/grant-selection.policy';

/** Mirrors the overhead grant written by BbbOrganizationService.create(). */
const overheadGrant = (consumedMinutes = 0) => ({
  grantedMinutes: -1,
  consumedMinutes,
  isUnbounded: true,
});

describe('BUG-036 grant-selection policy', () => {
  describe('source-type selection', () => {
    it('treats order and subscription capacity as tenant-selectable', () => {
      expect(isTenantSelectableSourceType('order')).toBe(true);
      expect(isTenantSelectableSourceType('subscription')).toBe(true);
    });

    it('never lets internal_overhead capacity serve a tenant session', () => {
      expect(isTenantSelectableSourceType('internal_overhead')).toBe(false);
      expect(TENANT_SELECTABLE_SOURCE_TYPES).not.toContain('internal_overhead');
      expect([...TENANT_SELECTABLE_SOURCE_TYPES]).toEqual([
        'order',
        'subscription',
      ]);
    });
  });

  describe('remaining minutes', () => {
    it('computes granted - consumed for bounded grants', () => {
      expect(
        remainingMinutesForGrant({
          grantedMinutes: 600,
          consumedMinutes: 0,
          isUnbounded: false,
        }),
      ).toBe(600);
      expect(
        remainingMinutesForGrant({
          grantedMinutes: 600,
          consumedMinutes: 250,
          isUnbounded: false,
        }),
      ).toBe(350);
    });

    it('returns Infinity for unbounded grants (grantedMinutes is a sentinel)', () => {
      expect(remainingMinutesForGrant(overheadGrant())).toBe(Infinity);
      // Consuming beyond the sentinel must not turn Infinity into a negative.
      expect(remainingMinutesForGrant(overheadGrant(5000))).toBe(Infinity);
    });

    it('derives provisionability with Infinity semantics (the BUG-036 regression)', () => {
      // Auto-created overhead grant, never consumed.
      expect(hasProvisionableMinutes(overheadGrant())).toBe(true);
      // Same shape after heavy consumption: still provisionable.
      expect(hasProvisionableMinutes(overheadGrant(100000))).toBe(true);
      // A future non-overhead unbounded grant (e.g. an enterprise tier).
      expect(
        hasProvisionableMinutes({
          grantedMinutes: -1,
          consumedMinutes: 42,
          isUnbounded: true,
        }),
      ).toBe(true);
    });

    it('refuses provisioning at zero or negative remaining minutes', () => {
      expect(
        hasProvisionableMinutes({
          grantedMinutes: 600,
          consumedMinutes: 600,
          isUnbounded: false,
        }),
      ).toBe(false);
      expect(
        hasProvisionableMinutes({
          grantedMinutes: 600,
          consumedMinutes: 700,
          isUnbounded: false,
        }),
      ).toBe(false);
      expect(
        hasProvisionableMinutes({
          grantedMinutes: 0,
          consumedMinutes: 0,
          isUnbounded: false,
        }),
      ).toBe(false);
      // The sentinel is only meaningful together with isUnbounded: if a grant
      // ever carries -1 without the flag, it must fail closed, not pass.
      expect(
        hasProvisionableMinutes({
          grantedMinutes: -1,
          consumedMinutes: 0,
          isUnbounded: false,
        }),
      ).toBe(false);
    });
  });

  describe('failure reasons', () => {
    it('distinguishes an exhausted allowance from a missing one', () => {
      expect(grantUnavailableReason(true)).toBe(
        PROVISIONING_ALLOWANCE_EXHAUSTED_ERROR,
      );
      expect(grantUnavailableReason(false)).toBe(PROVISIONING_NO_GRANT_ERROR);
      expect(PROVISIONING_ALLOWANCE_EXHAUSTED_ERROR).not.toBe(
        PROVISIONING_NO_GRANT_ERROR,
      );
      expect(PROVISIONING_ALLOWANCE_EXHAUSTED_ERROR).toMatch(/exhausted/);
    });

    it('keeps the pre-existing no-grant message verbatim (runbooks reference it)', () => {
      expect(grantUnavailableReason(false)).toBe(
        'No active capacity grant found for this organization. Please purchase or renew a plan.',
      );
    });
  });
});
