import { Injectable } from "@nestjs/common";
import { RequestContext, TransactionalConnection } from "@vendure/core";
import { BbbServer } from "../entities/bbb-server.entity";
import { BbbMeeting } from "../entities/bbb-meeting.entity";
import { BbbScheduledSession } from "../entities/bbb-scheduled-session.entity";
import { BbbUsageLedger } from "../entities/bbb-usage-ledger.entity";

/**
 * Aggregates server pool health, forecasts future load from scheduled sessions,
 * and provides capacity recommendations to operators.
 *
 * This service is read-only — it never modifies meetings, servers, or capacity.
 * It is purely advisory (INV-012).
 *
 * See ADR v1.7 §6A CI-002.
 */
@Injectable()
export class CapacityIntelligenceService {
  // PILOS load estimation parameters (hardcoded per ADR §6A CI-002)
  private readonly cameraRatio = 0.40;
  private readonly micRatio = 0.70;
  private readonly videoWeight = 3;
  private readonly micWeight = 2;
  private readonly listenerWeight = 1;
  private readonly targetUtilization = 0.70;
  private readonly standardServerCapacity = 200;

  constructor(private readonly connection: TransactionalConnection) {}

  /**
   * Computes live pool health from current server loads and active meetings.
   */
  async getLivePoolHealth(ctx: RequestContext): Promise<{
    servers: Array<{
      serverId: string;
      serverName: string;
      status: "active" | "disabled" | "unreachable";
      currentLoad: number;
      loadPercent: number;
      activeMeetings: number;
      activeParticipants: number;
      isOverloaded: boolean;
    }>;
    totalServers: number;
    activeServers: number;
    totalVirtualLoad: number;
    totalCapacity: number;
    poolLoadPercent: number;
    activeAttendees: number;
    activeMeetings: number;
    safeHeadroom: number;
  }> {
    const servers = await this.connection
      .getRepository(ctx, BbbServer)
      .find();

    const serverHealthPromises = servers.map(async (server) => {
      const activeMeetings = await this.connection
        .getRepository(ctx, BbbMeeting)
        .createQueryBuilder("meeting")
        .where("meeting.serverId = :serverId", { serverId: String(server.id) })
        .andWhere("meeting.state = :state", { state: "Active" })
        .getCount();

      // BbbMeeting entity does not have attendeeCount — participant tracking
      // is done via BbbUsageLedger. We use 0 as a placeholder; the live
      // participant count can be added when BBB webhook provides it.
      const activeParticipants = 0;

      const loadPercent =
        server.capacity > 0 ? (server.currentLoad / server.capacity) * 100 : 0;

      const status: "active" | "disabled" | "unreachable" = server.enabled
        ? server.healthy
          ? "active"
          : "unreachable"
        : "disabled";

      return {
        serverId: String(server.id),
        serverName: server.name,
        status,
        currentLoad: server.currentLoad,
        loadPercent: Math.round(loadPercent * 100) / 100,
        activeMeetings,
        activeParticipants,
        isOverloaded: loadPercent > 85,
      };
    });

    const serverHealth = await Promise.all(serverHealthPromises);

    const totalServers = servers.length;
    const activeServers = servers.filter((s) => s.enabled && s.healthy).length;
    const totalVirtualLoad = servers.reduce((sum, s) => sum + s.currentLoad, 0);
    const totalCapacity = servers.reduce((sum, s) => sum + s.capacity, 0);
    const poolLoadPercent =
      totalCapacity > 0 ? (totalVirtualLoad / totalCapacity) * 100 : 0;
    const activeAttendees = serverHealth.reduce(
      (sum, s) => sum + s.activeParticipants,
      0
    );
    const activeMeetingsCount = serverHealth.reduce(
      (sum, s) => sum + s.activeMeetings,
      0
    );
    const safeHeadroom = Math.max(0, totalCapacity * 0.8 - totalVirtualLoad);

    return {
      servers: serverHealth,
      totalServers,
      activeServers,
      totalVirtualLoad,
      totalCapacity,
      poolLoadPercent: Math.round(poolLoadPercent * 100) / 100,
      activeAttendees,
      activeMeetings: activeMeetingsCount,
      safeHeadroom: Math.round(safeHeadroom * 100) / 100,
    };
  }

  /**
   * Generates a 48-hour load forecast in 30-minute windows using PILOS formula.
   */
  async get48HourLoadForecast(ctx: RequestContext): Promise<
    Array<{
      windowStart: Date;
      windowEnd: Date;
      expectedSessions: number;
      expectedAttendees: number;
      expectedVirtualLoad: number;
      projectedLoadPercent: number;
      riskLevel: "safe" | "warning" | "critical";
    }>
  > {
    const sessions = await this.connection
      .getRepository(ctx, BbbScheduledSession)
      .createQueryBuilder("session")
      .where("session.startTime >= :now", { now: new Date() })
      .andWhere("session.startTime <= :end", {
        end: new Date(Date.now() + 48 * 60 * 60 * 1000),
      })
      .getMany();

    const windows: Array<{
      windowStart: Date;
      windowEnd: Date;
      sessions: any[];
    }> = [];
    const forecastEnd = new Date(Date.now() + 48 * 60 * 60 * 1000);

    for (
      let windowStart = new Date();
      windowStart < forecastEnd;
      windowStart = new Date(windowStart.getTime() + 30 * 60 * 1000)
    ) {
      const windowEnd = new Date(windowStart.getTime() + 30 * 60 * 1000);
      const sessionsInWindow = sessions.filter((session: any) => {
        const sessionStart = new Date(session.startTime);
        const sessionEnd = new Date(session.endTime);
        return sessionStart < windowEnd && sessionEnd > windowStart;
      });

      windows.push({
        windowStart: new Date(windowStart),
        windowEnd,
        sessions: sessionsInWindow,
      });
    }

    const servers = await this.connection
      .getRepository(ctx, BbbServer)
      .find();
    const totalCapacity = servers.reduce((sum, s) => sum + s.capacity, 0);

    return windows.map((window) => {
      const expectedSessions = window.sessions.length;
      const expectedAttendees = window.sessions.reduce(
        (sum, session: any) => sum + (session.maxAttendees || 0),
        0
      );

      const videos = Math.floor(
        expectedAttendees * this.cameraRatio * this.micRatio
      );
      const mics = Math.floor(
        expectedAttendees * this.micRatio * (1 - this.cameraRatio)
      );
      const listeners = Math.floor(
        expectedAttendees *
          (1 - this.micRatio + this.micRatio * this.cameraRatio)
      );
      const expectedVirtualLoad =
        videos * this.videoWeight +
        mics * this.micWeight +
        listeners * this.listenerWeight;

      const projectedLoadPercent =
        totalCapacity > 0
          ? (expectedVirtualLoad / totalCapacity) * 100
          : 0;

      let riskLevel: "safe" | "warning" | "critical";
      if (projectedLoadPercent > 90) {
        riskLevel = "critical";
      } else if (projectedLoadPercent > 75) {
        riskLevel = "warning";
      } else {
        riskLevel = "safe";
      }

      return {
        windowStart: window.windowStart,
        windowEnd: window.windowEnd,
        expectedSessions,
        expectedAttendees,
        expectedVirtualLoad: Math.round(expectedVirtualLoad * 100) / 100,
        projectedLoadPercent: Math.round(projectedLoadPercent * 100) / 100,
        riskLevel,
      };
    });
  }

  /**
   * Generates a capacity recommendation based on 48-hour forecast peak.
   */
  async getCapacityRecommendation(ctx: RequestContext): Promise<{
    currentServers: number;
    currentCapacity: number;
    peakForecastLoad: number;
    peakForecastAt: Date;
    peakForecastPercent: number;
    serversNeeded: number;
    urgency: "none" | "plan" | "soon" | "immediate";
    reasoning: string;
  }> {
    const forecast = await this.get48HourLoadForecast(ctx);

    const servers = await this.connection
      .getRepository(ctx, BbbServer)
      .find();

    const currentServers = servers.length;
    const currentCapacity = servers.reduce((sum, s) => sum + s.capacity, 0);

    let peakForecastLoad = 0;
    let peakForecastAt = new Date();
    let peakForecastPercent = 0;

    for (const slot of forecast) {
      if (slot.expectedVirtualLoad > peakForecastLoad) {
        peakForecastLoad = slot.expectedVirtualLoad;
        peakForecastAt = slot.windowStart;
        peakForecastPercent = slot.projectedLoadPercent;
      }
    }

    const targetCapacity = peakForecastLoad / this.targetUtilization;
    const serversNeeded = Math.ceil(
      (targetCapacity - currentCapacity) / this.standardServerCapacity
    );

    let urgency: "none" | "plan" | "soon" | "immediate";
    if (peakForecastPercent > 90) {
      urgency = "immediate";
    } else if (peakForecastPercent > 75) {
      urgency = "soon";
    } else if (peakForecastPercent > 60) {
      urgency = "plan";
    } else {
      urgency = "none";
    }

    const reasoning = this.generateReasoning(
      urgency,
      peakForecastPercent,
      serversNeeded,
      peakForecastAt
    );

    return {
      currentServers,
      currentCapacity,
      peakForecastLoad: Math.round(peakForecastLoad * 100) / 100,
      peakForecastAt,
      peakForecastPercent: Math.round(peakForecastPercent * 100) / 100,
      serversNeeded: Math.max(0, serversNeeded),
      urgency,
      reasoning,
    };
  }

  /**
   * Builds the complete dashboard data structure.
   */
  async buildDashboard(ctx: RequestContext): Promise<{
    liveHealth: Awaited<ReturnType<CapacityIntelligenceService["getLivePoolHealth"]>>;
    forecast: Awaited<ReturnType<CapacityIntelligenceService["get48HourLoadForecast"]>>;
    recommendation: Awaited<ReturnType<CapacityIntelligenceService["getCapacityRecommendation"]>>;
    historicalPeak: {
      last7DaysPeakAttendees: number;
      last7DaysPeakLoad: number;
      last7DaysPeakAt: Date;
      avgDailyAttendeeMinutes: number;
    };
  }> {
    const [liveHealth, forecast, recommendation] = await Promise.all([
      this.getLivePoolHealth(ctx),
      this.get48HourLoadForecast(ctx),
      this.getCapacityRecommendation(ctx),
    ]);

    const historicalPeak = await this.getHistoricalPeakStats(ctx);

    return {
      liveHealth,
      forecast,
      recommendation,
      historicalPeak,
    };
  }

  /**
   * Computes historical peak statistics from BbbUsageLedger (last 7 days).
   */
  private async getHistoricalPeakStats(ctx: RequestContext): Promise<{
    last7DaysPeakAttendees: number;
    last7DaysPeakLoad: number;
    last7DaysPeakAt: Date;
    avgDailyAttendeeMinutes: number;
  }> {
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const recentLedger = await this.connection
      .getRepository(ctx, BbbUsageLedger)
      .createQueryBuilder("ledger")
      .where("ledger.startedAt >= :sevenDaysAgo", { sevenDaysAgo })
      .orderBy("ledger.consumedMinutes", "DESC")
      .limit(1)
      .getOne();

    const avgResult = await this.connection
      .getRepository(ctx, BbbUsageLedger)
      .createQueryBuilder("ledger")
      .select("AVG(ledger.consumedMinutes)", "avgMinutes")
      .where("ledger.startedAt >= :sevenDaysAgo", { sevenDaysAgo })
      .getRawOne();

    const last7DaysPeakAttendees = recentLedger
      ? Math.ceil(recentLedger.consumedMinutes / 30)
      : 0;
    const last7DaysPeakLoad = recentLedger
      ? Math.ceil(recentLedger.consumedMinutes / 10)
      : 0;
    const last7DaysPeakAt = recentLedger?.startedAt || new Date();
    const avgDailyAttendeeMinutes = avgResult?.avgMinutes || 0;

    return {
      last7DaysPeakAttendees,
      last7DaysPeakLoad: Math.round(last7DaysPeakLoad * 100) / 100,
      last7DaysPeakAt,
      avgDailyAttendeeMinutes: Math.round(avgDailyAttendeeMinutes * 100) / 100,
    };
  }

  private generateReasoning(
    urgency: string,
    peakForecastPercent: number,
    serversNeeded: number,
    peakForecastAt: Date
  ): string {
    const timeStr = peakForecastAt.toLocaleString();
    if (urgency === "none") {
      return `Peak forecast at ${timeStr} is at ${peakForecastPercent.toFixed(1)}% utilization — within safe thresholds. No action needed.`;
    } else if (urgency === "plan") {
      return `Peak forecast at ${timeStr} will reach ${peakForecastPercent.toFixed(1)}% utilization. Consider adding ${serversNeeded} server(s) within the next few days to maintain 30% headroom.`;
    } else if (urgency === "soon") {
      return `Peak forecast at ${timeStr} will reach ${peakForecastPercent.toFixed(1)}% utilization. Add ${serversNeeded} server(s) within 24 hours to avoid degraded performance.`;
    } else {
      return `URGENT: Peak forecast at ${timeStr} will reach ${peakForecastPercent.toFixed(1)}% utilization. Add ${serversNeeded} server(s) immediately to prevent capacity saturation.`;
    }
  }
}
