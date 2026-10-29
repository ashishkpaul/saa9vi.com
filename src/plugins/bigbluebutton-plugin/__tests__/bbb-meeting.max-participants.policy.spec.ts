/**
 * Phase 4 — unit tests for `getOrCreateMaxParticipants`.
 *
 * Pure helper: resolves `meeting.organization.maxParticipantsPerMeeting`
 * and `meeting.room.maxParticipants` into the per-meeting participant cap.
 */
import { describe, expect, it } from "vitest";
import { getOrCreateMaxParticipants } from "../services/bbb-meeting.max-participants.policy";
import type { BbbOrganization } from "../entities/bbb-organization.entity";
import type { BbbRoom } from "../entities/bbb-room.entity";

const makeOrg = (over: Partial<Record<string, unknown>> = {}): BbbOrganization => ({
  id: "o1",
  name: "test-org",
  maxParticipantsPerMeeting: 30,
  ...over,
} as unknown as BbbOrganization);

const makeRoom = (over: Partial<Record<string, unknown>> = {}): BbbRoom => ({
  id: "r1",
  organizationId: "o1",
  name: "main room",
  maxParticipants: undefined,
  ...over,
} as unknown as BbbRoom);

describe("getOrCreateMaxParticipants", () => {
  it("room-less meeting returns the org value", () => {
    const org = makeOrg();
    const room: null = null;
    expect(getOrCreateMaxParticipants(room, org)).toBe(30);
  });

  it("room lower than org → room value", () => {
    const org = makeOrg();
    const room = makeRoom({ maxParticipants: 20 });
    expect(getOrCreateMaxParticipants(room, org)).toBe(20);
  });

  it("room higher than org (legacy data) → org value", () => {
    const org = makeOrg();
    const room = makeRoom({ maxParticipants: 50 });
    // INV-014: room can never exceed org ceiling
    expect(getOrCreateMaxParticipants(room, org)).toBe(30);
  });

  it("room with explicit 0 maxParticipants → org value", () => {
    const org = makeOrg();
    const room = makeRoom({ maxParticipants: 0 });
    // 0 is "not set" — treat as unset
    expect(getOrCreateMaxParticipants(room, org)).toBe(30);
  });

  it("room maxParticipants equal to org → org value", () => {
    const org = makeOrg();
    const room = makeRoom({ maxParticipants: 30 });
    expect(getOrCreateMaxParticipants(room, org)).toBe(30);
  });
});
