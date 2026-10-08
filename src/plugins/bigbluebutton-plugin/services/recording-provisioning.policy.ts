import type { BigBlueButtonPluginOptions } from "../types";

/**
 * The recording flags sent to BBB `/create` (Saa9vi invariant: a room with
 * recording enabled records itself; a room with recording disabled never does).
 *
 * Dependency-free by design — mirrors `grant-selection.policy.ts` /
 * `metered-billing.policy.ts`: every rule here is unit-testable without a
 * database, a RequestContext or a plugin instance, and exists in exactly ONE
 * place so the provisioning worker and the tests cannot drift.
 */
export interface RecordingProvisioningParams {
  /** `record` — enables recording for the meeting at all. */
  record: boolean;
  /** `autoStartRecording` — start recording on first participant join. */
  autoStartRecording: boolean;
  /** `allowStartStopRecording` — moderator may pause/restart. Always true. */
  allowStartStopRecording: boolean;
}

/**
 * Resolve the three recording flags for a `/create` call.
 *
 * `autoStartRecording = (options.autoStartRecording ?? true) && recordingEnabled`
 *
 * - BBB 3.0 defaults `autoStartRecording` to `false`, so `record=true` on its
 *   own does NOT start a recording — the product behaviour "trainer joins ⇒
 *   recording starts" needs this flag.
 * - The plugin option defaults to ON, so existing rooms behave as the product
 *   wants without configuration; `autoStartRecording: false` restores BBB's
 *   manual-record behaviour.
 * - `allowStartStopRecording` is deliberately NOT optional: auto-start must
 *   never trap a moderator in an unwanted recording.
 */
export function recordingProvisioningParams(
  options: Pick<BigBlueButtonPluginOptions, "autoStartRecording"> | undefined,
  recordingEnabled: boolean,
): RecordingProvisioningParams {
  const autoStartEnabled = options?.autoStartRecording ?? true;
  return {
    record: recordingEnabled,
    autoStartRecording: autoStartEnabled && recordingEnabled,
    allowStartStopRecording: true,
  };
}