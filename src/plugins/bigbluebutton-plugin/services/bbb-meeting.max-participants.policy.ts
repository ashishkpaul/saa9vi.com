import type { BbbOrganization } from "../entities/bbb-organization.entity";
import type { BbbRoom } from "../entities/bbb-room.entity";

/**
 * Resolve the per-meeting participant cap for a provisioning call.
 *
 * Phase 4 — honour the per-room participant limit (independent fix).
 *
 * Rules:
 *  - No `room` (null/undefined, i.e. room-less meeting) → the organization
 *    value is the only candidate, so it is returned unchanged.
 *  - `room` set → `room.maxParticipants` is preferred, but the result is
 *    **never** above `org.maxParticipantsPerMeeting`. This preserves INV-014:
 *    a room can never exceed the organization's ceiling. A missing/zero
 *    `room.maxParticipants` (legacy/unset rows) falls back to the org value.
 *
 * The operation is value-only — it never reads a repository or writes a row.
 */

export function getOrCreateMaxParticipants(
  room: BbbRoom | null | undefined,
  org: BbbOrganization,
): number {
  if (room == null) {
    return org.maxParticipantsPerMeeting;
  }
  const roomCap =
    room.maxParticipants && room.maxParticipants > 0
      ? room.maxParticipants
      : org.maxParticipantsPerMeeting;
  return Math.min(roomCap, org.maxParticipantsPerMeeting);
}
