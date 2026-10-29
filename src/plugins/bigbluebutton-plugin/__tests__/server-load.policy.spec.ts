/**
 * Phase 1 — pure load policy unit tests.
 *
 * Covers `computeServerLoad` from `services/server-load.policy.ts`. Dependency-free:
 * constructs `Pick<BbbRemoteMeeting, ...>` inputs directly, no BBB API, no database.
 */
import { describe, expect, it } from "vitest";
import { computeServerLoad } from "../services/server-load.policy";

const NOW_MS = 1_700_000_000_000;
const JOIN_BUFFER_MS = 15 * 60 * 1000; // 15 minutes
const MIN_USER_COUNT = 15;

function meeting(over: {
  participantCount: number;
  createTime?: number;
  isBreakout?: boolean;
  hasBeenForciblyEnded?: boolean;
}) {
  return {
    participantCount: over.participantCount,
    createTime: over.createTime ?? NOW_MS - 2 * JOIN_BUFFER_MS, // established by default
    isBreakout: over.isBreakout ?? false,
    hasBeenForciblyEnded: over.hasBeenForciblyEnded ?? false,
  };
}

describe("computeServerLoad", () => {
  it("empty list → zeros", () => {
    const result = computeServerLoad([], {
      nowMs: NOW_MS,
      minUserCount: MIN_USER_COUNT,
      joinBufferMs: JOIN_BUFFER_MS,
    });
    expect(result).toEqual({ load: 0, liveMeetings: 0, liveParticipants: 0 });
  });

  it("single established meeting uses its real participantCount", () => {
    const result = computeServerLoad(
      [meeting({ participantCount: 10 })],
      { nowMs: NOW_MS, minUserCount: MIN_USER_COUNT, joinBufferMs: JOIN_BUFFER_MS },
    );
    expect(result).toEqual({ load: 10, liveMeetings: 1, liveParticipants: 10 });
  });

  it("new meeting under buffer uses minUserCount", () => {
    const result = computeServerLoad(
      [meeting({ participantCount: 3, createTime: NOW_MS - 1000 })],
      { nowMs: NOW_MS, minUserCount: MIN_USER_COUNT, joinBufferMs: JOIN_BUFFER_MS },
    );
    expect(result.load).toBe(15); // max(3, 15)
    expect(result.liveMeetings).toBe(1);
    expect(result.liveParticipants).toBe(3); // real count, no buffer
  });

  it("new meeting above minUserCount uses its real count", () => {
    const result = computeServerLoad(
      [meeting({ participantCount: 20, createTime: NOW_MS - 1000 })],
      { nowMs: NOW_MS, minUserCount: MIN_USER_COUNT, joinBufferMs: JOIN_BUFFER_MS },
    );
    expect(result.load).toBe(20); // max(20, 15)
    expect(result.liveParticipants).toBe(20);
  });

  it("breakout room excluded from load, liveMeetings, and liveParticipants", () => {
    const result = computeServerLoad(
      [meeting({ participantCount: 30, isBreakout: true })],
      { nowMs: NOW_MS, minUserCount: MIN_USER_COUNT, joinBufferMs: JOIN_BUFFER_MS },
    );
    expect(result).toEqual({ load: 0, liveMeetings: 0, liveParticipants: 0 });
  });

  it("forcibly-ended meeting excluded from load but still counted in census", () => {
    const result = computeServerLoad(
      [meeting({ participantCount: 10, hasBeenForciblyEnded: true })],
      { nowMs: NOW_MS, minUserCount: MIN_USER_COUNT, joinBufferMs: JOIN_BUFFER_MS },
    );
    expect(result.load).toBe(0);
    expect(result.liveMeetings).toBe(1);
    expect(result.liveParticipants).toBe(10);
  });

  it("boundary at exactly joinBufferMs is not buffered (uses real count)", () => {
    const result = computeServerLoad(
      [
        meeting({
          participantCount: 8,
          createTime: NOW_MS - JOIN_BUFFER_MS, // exactly at the boundary
        }),
      ],
      { nowMs: NOW_MS, minUserCount: MIN_USER_COUNT, joinBufferMs: JOIN_BUFFER_MS },
    );
    expect(result.load).toBe(8); // age == buffer → not < buffer → real count
    expect(result.liveParticipants).toBe(8);
  });

  it("moderators are NOT added on top of participantCount (pinned)", () => {
    const result = computeServerLoad(
      [meeting({ participantCount: 10 })],
      { nowMs: NOW_MS, minUserCount: MIN_USER_COUNT, joinBufferMs: JOIN_BUFFER_MS },
    );
    // Load uses participantCount alone (10), never participantCount + moderatorCount.
    expect(result.load).toBe(10);
    expect(result.load).not.toBe(15); // 10 + 5 moderators would be wrong
  });

  it("multiple meetings sum load correctly", () => {
    const result = computeServerLoad(
      [
        meeting({ participantCount: 10 }),
        meeting({ participantCount: 20 }),
        meeting({ participantCount: 5, isBreakout: true }),
      ],
      { nowMs: NOW_MS, minUserCount: MIN_USER_COUNT, joinBufferMs: JOIN_BUFFER_MS },
    );
    expect(result.load).toBe(30);
    expect(result.liveMeetings).toBe(2);
    expect(result.liveParticipants).toBe(30);
  });

  it("load is rounded up (Math.ceil)", () => {
    const result = computeServerLoad(
      [
        meeting({ participantCount: 10 }),
        meeting({ participantCount: 7 }),
      ],
      { nowMs: NOW_MS, minUserCount: MIN_USER_COUNT, joinBufferMs: JOIN_BUFFER_MS },
    );
    expect(result.load).toBe(17);
  });
});
