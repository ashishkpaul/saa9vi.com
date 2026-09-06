import { Injectable, Logger } from "@nestjs/common";
import { RequestContext, TransactionalConnection } from "@vendure/core";

import { BbbEntitlement } from "../entities/bbb-entitlement.entity";
import { BbbScheduledSession } from "../entities/bbb-scheduled-session.entity";
import { BbbOrganization } from "../entities/bbb-organization.entity";
import { SessionAttendance } from "../entities/session-attendance.entity";

const loggerCtx = "SessionAttendanceService";

/**
 * 3D.3b — attendance aggregation service.
 *
 * Layer contract (docs/implementation/phase3-attendance.md §2):
 *   BbbWebhookEvent (immutable raw evidence)
 *        ↓
 *   SessionAttendance (derived, recomputable fact)
 *
 * v1 aggregation source: the MEETING_ENDED webhook payload's final
 * attendee snapshot (extracted attendee customer ids). Granular
 * join/leave cycles are a future extension (cyclesCount retained).
 *
 * Invariants:
 * - channelId is ALWAYS derived server-side from the linked
 *   BbbScheduledSession.channelId — never from client input.
 * - Idempotent: each row records lastProcessedWebhookEventId; reprocessing
 *   the same webhook event never double-counts.
 * - Registered population = BbbEntitlement(type=bbb_session,
 *   resourceId=session.id) — access truth stays in Entitlement.
 * - Late/updated events RECOMPUTE the derived fact (not append-only).
 */
@Injectable()
export class SessionAttendanceService {
  constructor(private connection: TransactionalConnection) {}

  /**
   * Derive attendance facts for a session from a MEETING_ENDED webhook.
   *
   * @param webhookEventId raw BbbWebhookEvent id — idempotency watermark
   * @param eventTime webhook receipt time — used as lastEventAt
   */
  async recordMeetingEndedAttendance(
    ctx: RequestContext,
    session: BbbScheduledSession,
    attendeeCustomerIds: Set<string>,
    webhookEventId: string | null,
    eventTime: Date,
  ): Promise<{ created: number; updated: number; noShows: number }> {
    const sessionKey = String(session.id);
    // BbScheduledSession has no channelId — derive from the linked organization.
    const channelId = await this.resolveSessionChannelId(ctx, session);

    // Registered population = active bbb_session entitlements.
    const entitlements = await this.connection
      .getRepository(ctx, BbbEntitlement)
      .find({ where: { type: "bbb_session", resourceId: sessionKey } });

    const registeredCustomerIds = entitlements
      .filter(
        (e) =>
          e.validFrom === null ||
          e.validFrom === undefined ||
          e.validFrom.getTime() <= eventTime.getTime(),
      )
      .filter(
        (e) =>
          e.validUntil === null ||
          e.validUntil === undefined ||
          e.validUntil.getTime() >= eventTime.getTime(),
      )
      .map((e) => String(e.customerId));

    const repo = this.connection.getRepository(ctx, SessionAttendance);
    const existing = await repo.find({
      where: { scheduledSessionId: sessionKey },
    });
    const existingByCustomer = new Map(
      existing.map((row) => [String(row.customerId), row]),
    );

    let created = 0;
    let updated = 0;
    let noShows = 0;

    // Population = registered ∪ observed attendees (observed non-registered
    // customers still get an attendance row: evidence exists).
    const population = new Set<string>([
      ...registeredCustomerIds,
      ...attendeeCustomerIds,
    ]);

    for (const customerId of population) {
      const attended = attendeeCustomerIds.has(customerId);
      const current = existingByCustomer.get(customerId);

      if (current && current.lastProcessedWebhookEventId === webhookEventId) {
        // Same raw event already folded into this row — skip.
        continue;
      }

      const row =
        current ??
        repo.create({
          channelId: channelId ?? "",
          scheduledSessionId: sessionKey,
          customerId,
          meetingId: null,
        });

      if (attended) {
        row.attendanceStatus = current?.attendanceStatus === "PRESENT"
          ? "PRESENT"
          : "PRESENT";
        row.cyclesCount = Math.max(1, current?.cyclesCount ?? 0);
        row.joinedAt = current?.joinedAt ?? eventTime;
      } else if (!current) {
        row.attendanceStatus = "NO_SHOW";
        row.cyclesCount = 0;
        noShows++;
      }
      // Registered with a prior PRESENT row: keep existing attendance
      // (late ended event must not demote an observed attendee).

      row.channelId = channelId ?? row.channelId;
      row.meetingId = row.meetingId ?? null;
      row.source = current?.source === "MANUAL_CORRECTION"
        ? "MANUAL_CORRECTION"
        : "WEBHOOK";
      row.lastEventAt = eventTime;
      row.lastProcessedWebhookEventId = webhookEventId;

      await repo.save(row);
      if (current) updated++;
      else created++;
    }

    Logger.log(
      `Attendance recorded for session ${sessionKey}: created=${created} updated=${updated} noShows=${noShows} attendees=${attendeeCustomerIds.size} registered=${registeredCustomerIds.length}`,
      loggerCtx,
    );
    return { created, updated, noShows };
  }

  /**
   * Resolve the channelId for a session via its linked organization.
   * BbScheduledSession has no channelId field — the organization is the
   * source of the tenant scope (Channel=Tenant invariant).
   */
  private async resolveSessionChannelId(
    ctx: RequestContext,
    session: BbbScheduledSession,
  ): Promise<string> {
    if (session.organization?.channelId) {
      return String(session.organization.channelId);
    }
    const org = await this.connection
      .getRepository(ctx, BbbOrganization)
      .findOne({ where: { id: String(session.organizationId) } });
    return org ? String(org.channelId) : "";
  }
}
