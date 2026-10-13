/**
 * Recording provisioning policy (`recording-provisioning.policy.ts`).
 *
 * Infrastructure-free by design (no Postgres, Redis or BBB): the policy module
 * is pure, and this spec pins the exact semantics the provisioning worker
 * sends to BBB `/create`, so the worker and the tests cannot drift apart.
 *
 * Product rule under test: a recording-enabled room starts recording when the
 * first participant joins; a recording-disabled room never records.
 *
 * BBB 3.0 (docs.bigbluebutton.org/dev/api.html) defaults `autoStartRecording`
 * to `false`, so `record=true` on its own is NOT sufficient — which is exactly
 * what the worker hard-coded before this change
 * (`bbb-provisioning-worker.service.ts`).
 *
 * The infra-gated end-to-end proof that the REAL `/create` payload carries
 * these flags lives in
 * `src/plugins/bigbluebutton-plugin/e2e/bbb-provisioning-recording.e2e-spec.ts`.
 */

import { describe, expect, it } from 'vitest';
import { recordingProvisioningParams } from '../services/recording-provisioning.policy';

describe('recording-provisioning policy', () => {
  describe('recording-enabled room (the product default)', () => {
    it('sends record=true, autoStartRecording=true, allowStartStopRecording=true when no option is set', () => {
      expect(recordingProvisioningParams(undefined, true)).toEqual({
        record: true,
        autoStartRecording: true,
        allowStartStopRecording: true,
      });
    });

    it('sends the same triple for an options object that omits the key', () => {
      expect(recordingProvisioningParams({}, true)).toEqual({
        record: true,
        autoStartRecording: true,
        allowStartStopRecording: true,
      });
    });

    it('honours an explicit autoStartRecording: true', () => {
      expect(
        recordingProvisioningParams({ autoStartRecording: true }, true),
      ).toEqual({
        record: true,
        autoStartRecording: true,
        allowStartStopRecording: true,
      });
    });
  });

  describe('recording-disabled room', () => {
    it('never records, whatever the option says (the option can only narrow)', () => {
      expect(recordingProvisioningParams(undefined, false)).toEqual({
        record: false,
        autoStartRecording: false,
        allowStartStopRecording: true,
      });

      expect(
        recordingProvisioningParams({ autoStartRecording: true }, false),
      ).toEqual({
        record: false,
        autoStartRecording: false,
        allowStartStopRecording: true,
      });
    });
  });

  describe('autoStartRecording: false (opt-out)', () => {
    it('restores BBB manual-record behaviour: record=true but no auto start', () => {
      expect(
        recordingProvisioningParams({ autoStartRecording: false }, true),
      ).toEqual({
        record: true,
        autoStartRecording: false,
        allowStartStopRecording: true,
      });
    });

    it('keeps a disabled room disabled', () => {
      expect(
        recordingProvisioningParams({ autoStartRecording: false }, false),
      ).toEqual({
        record: false,
        autoStartRecording: false,
        allowStartStopRecording: true,
      });
    });
  });

  describe('allowStartStopRecording is a constant, not a preference', () => {
    it('is true for every combination of option and recordingEnabled', () => {
      const cases = [undefined, {}, { autoStartRecording: true }, {
        autoStartRecording: false,
      }];
      for (const options of cases) {
        for (const recordingEnabled of [true, false]) {
          expect(
            recordingProvisioningParams(options, recordingEnabled)
              .allowStartStopRecording,
          ).toBe(true);
        }
      }
    });
  });
});
