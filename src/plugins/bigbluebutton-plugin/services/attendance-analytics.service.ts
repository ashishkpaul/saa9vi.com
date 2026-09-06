import { Injectable, Logger } from "@nestjs/common";
import { RequestContext, TransactionalConnection } from "@vendure/core";
import { Between } from "typeorm";
import { SessionAttendance } from "../entities/session-attendance.entity";

const loggerCtx = "AttendanceAnalyticsService";

/**
 * Per-session attendance summary metrics.
 *
 * v1 note: `totalDurationSeconds` is authoritative for duration (owned by
 * SessionAttendanceService). Snapshot aggregation (3D.3b) records 0 duration;
 * `averageDurationSeconds` will populate once granular join/leave events land.
 * `completionRate` currently equals attendanceRate (any join = completed);
 * a future threshold (e.g., attended >50% of session) will diverge these.
 */
export interface SessionAttendanceSummary {
  sessionId: string;
  registered: number;
  attended: number;
  noShow: number;
  attendanceRate: number;
  averageDurationSeconds: number;
  completionRate: number;
}

/**
 * Channel-wide attendance summary across a time window.
 *
 * Time window is filtered on `lastEventAt` (the MEETING_ENDED webhook time),
 * i.e., sessions that *finalized* in [from, to].
 */
export interface ChannelAttendanceSummary {
  from: Date;
  to: Date;
  totalSessions: number;
  totalRegistered: number;
  totalAttended: number;
  totalNoShow: number;
  attendanceRate: number;
  averageDurationSeconds: number;
  completionRate: number;
}


/**
 * 3D.3c — attendance analytics service.
 *
 * Read-only query layer over the `SessionAttendance` derived fact.
 * PostgreSQL is the authority; this service computes aggregates in-process
 * (acceptable at current scale; SQL-level aggregation is a Phase 4
 * optimization if session counts grow large).
 *
 * Security contract (enforced by API layer, 3D.3d):
 *   - Tenant Admin → own channel only
 *   - Shop student → own rows only (self-view)
 *   - SuperAdmin → platform-wide
 * Every query here is scoped to ctx.channelId.
 */
@Injectable()
export class AttendanceAnalyticsService {
  constructor(private connection: TransactionalConnection) {}

  /**
   * Per-student attendance facts for a session.
   * Scoped to the caller's channel.
   */
  async getSessionAttendance(
    ctx: RequestContext,
    sessionId: string,
  ): Promise<SessionAttendance[]> {
    return this.connection
      .getRepository(ctx, SessionAttendance)
      .find({
        where: {
          scheduledSessionId: sessionId,
          channelId: String(ctx.channelId),
        },
        order: { createdAt: "ASC" },
      });
  }

  /**
   * Aggregate metrics for a single session.
   */
  async getSessionAttendanceSummary(
    ctx: RequestContext,
    sessionId: string,
  ): Promise<SessionAttendanceSummary> {
    const rows = await this.getSessionAttendance(ctx, sessionId);
    return this.summarizeRows(rows, sessionId);
  }

  /**
   * Student's own attendance history (channel-scoped self-view).
   */
  async getCustomerAttendance(
    ctx: RequestContext,
    customerId: string,
  ): Promise<SessionAttendance[]> {
    return this.connection
      .getRepository(ctx, SessionAttendance)
      .find({
        where: {
          customerId,
          channelId: String(ctx.channelId),
        },
        order: { lastEventAt: "DESC" },
      });
  }

  /**
   * Channel-wide attendance summary for an operational reporting window.
   *
   * @param from inclusive start (filters on lastEventAt)
   * @param to   inclusive end
   */
  async getChannelAttendanceSummary(
    ctx: RequestContext,
    from: Date,
    to: Date,
  ): Promise<ChannelAttendanceSummary> {
    const rows = await this.connection
      .getRepository(ctx, SessionAttendance)
      .find({
        where: {
          channelId: String(ctx.channelId),
          lastEventAt: Between(from, to),
        },
      });

    const totalSessions = new Set(rows.map((r) => r.scheduledSessionId)).size;
    const summary = this.summarizeRowsWithMeta(rows, from, to, totalSessions);

    Logger.log(
      `Channel attendance summary (${from.toISOString()} → ${to.toISOString()}): sessions=${summary.totalSessions} registered=${summary.totalRegistered} attended=${summary.totalAttended} noShow=${summary.totalNoShow} rate=${(summary.attendanceRate * 100).toFixed(1)}%`,
      loggerCtx,
    );

    return summary;
  }

  private summarizeRows(
    rows: SessionAttendance[],
    sessionId: string,
  ): SessionAttendanceSummary {
    const registered = rows.length;
    const attended = rows.filter(
      (r) =>
        r.attendanceStatus === "PRESENT" || r.attendanceStatus === "PARTIAL",
    ).length;
    const noShow = rows.filter(
      (r) => r.attendanceStatus === "NO_SHOW",
    ).length;

    const metrics = this.computeMetrics(rows, registered, attended, noShow);

    return {
      sessionId,
      registered,
      attended,
      noShow,
      ...metrics,
    };
  }

  private summarizeRowsWithMeta(
    rows: SessionAttendance[],
    from: Date,
    to: Date,
    totalSessions: number,
  ): ChannelAttendanceSummary {
    const totalRegistered = rows.length;
    const totalAttended = rows.filter(
      (r) =>
        r.attendanceStatus === "PRESENT" || r.attendanceStatus === "PARTIAL",
    ).length;
    const totalNoShow = rows.filter(
      (r) => r.attendanceStatus === "NO_SHOW",
    ).length;

    const metrics = this.computeMetrics(rows, totalRegistered, totalAttended, totalNoShow);

    return {
      from,
      to,
      totalSessions,
      totalRegistered,
      totalAttended,
      totalNoShow,
      ...metrics,
    };
  }

  private computeMetrics(
    rows: SessionAttendance[],
    registered: number,
    attended: number,
    noShow: number,
  ): {
    attendanceRate: number;
    averageDurationSeconds: number;
    completionRate: number;
  } {
    const attendanceRate = registered > 0 ? attended / registered : 0;

    const attendedDurations = rows
      .filter((r) => r.attendanceStatus !== "NO_SHOW")
      .map((r) => r.totalDurationSeconds);
    const averageDurationSeconds =
      attendedDurations.length > 0
        ? attendedDurations.reduce((a, b) => a + b, 0) /
          attendedDurations.length
        : 0;

    // v1: completion == attendance (any join = completed).
    const completionRate = attendanceRate;

    return { attendanceRate, averageDurationSeconds, completionRate };
  }
}
