import type { BbbRemoteMeeting } from "./bbb-api.service";

/**
 * BBB server load policy — Phase 1 of the measured-load plan.
 *
 * Pure, dependency-free load calculation for a single BBB server. No I/O,
 * no database, no side effects — the same style as `grant-selection.policy.ts`.
 *
 * `load` is the scheduler's input to server selection: it reflects how many
 * attendee-equivalent units are currently consuming this server, favouring
 * under-utilised nodes. `liveMeetings` and `liveParticipants` are the raw
 * census figures surfaced on the Servers dashboard.
 *
 * Moderators are NOT added on top of `participantCount`. Load uses
 * `participantCount` alone; moderator/trainer headcount is a billing
 * concern (learner-minutes), not a server-load concern.
 */

export interface ServerLoadOpts {
  /** Current time in ms since epoch. */
  nowMs: number;
  /** Minimum attendees assumed for a brand-new meeting still in its join buffer. */
  minUserCount: number;
  /** Meetings younger than this many ms count as "new" and use `minUserCount` if their actual count is lower. */
  joinBufferMs: number;
}

export interface ServerLoadResult {
  load: number;
  liveMeetings: number;
  liveParticipants: number;
}

/**
 * Compute load, live meeting count, and live participant count for a server.
 *
 * Rules:
 *  - Breakout rooms and forcibly-ended meetings are skipped for `load`.
 *  - A meeting younger than `joinBufferMs` uses `max(participantCount, minUserCount)`.
 *  - `liveParticipants` is the plain participant sum across non-breakout,
 *    non-forcibly-ended meetings (no buffer applied).
 *  - `liveMeetings` counts non-breakout meetings (forcibly-ended still count
 *    as live meetings for the census, since BBB still knows about them).
 *  - `load` is rounded up (`Math.ceil`).
 */
export function computeServerLoad(
  meetings: ReadonlyArray<
    Pick<
      BbbRemoteMeeting,
      "participantCount" | "createTime" | "isBreakout" | "hasBeenForciblyEnded"
    >
  >,
  opts: ServerLoadOpts,
): ServerLoadResult {
  const { nowMs, minUserCount, joinBufferMs } = opts;

  let load = 0;
  let liveMeetings = 0;
  let liveParticipants = 0;

  for (const m of meetings) {
    if (m.isBreakout) continue;

    liveMeetings += 1;
    liveParticipants += m.participantCount;

    if (m.hasBeenForciblyEnded) continue;

    const ageMs = nowMs - m.createTime;
    const effectiveCount =
      ageMs < joinBufferMs
        ? Math.max(m.participantCount, minUserCount)
        : m.participantCount;

    load += effectiveCount;
  }

  return {
    load: Math.ceil(load),
    liveMeetings,
    liveParticipants,
  };
}

/** Re-export the meeting shape so callers can type their inputs without importing the API service. */
export type LoadMeetingInput = Pick<
  BbbRemoteMeeting,
  "participantCount" | "createTime" | "isBreakout" | "hasBeenForciblyEnded"
>;
