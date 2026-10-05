/**
 * ADR-047 Phase 2B — metered attendee-hour billing service.
 *
 * Per-minute sampling of ACTIVE metered meetings, freeze of Σ learner-minutes
 * into {@link BbbMeteredUsage} on completion (INV-028), the stranded-completion
 * recovery scan, and sample retention.
 */
import { Inject, Injectable } from "@nestjs/common";
import {
  EventBus,
  Logger,
  RequestContext,
  RequestContextService,
  TransactionalConnection,
} from "@vendure/core";
import { BbbApiService, BbbNotFoundError } from "./bbb-api.service";
import { BbbServerService } from "./bbb-server.service";
import { BbbMeeting } from "../entities/bbb-meeting.entity";
import { BbbMeetingSample } from "../entities/bbb-meeting-sample.entity";
import { BbbMeteredUsage } from "../entities/bbb-metered-usage.entity";
import { BbbOrganization } from "../entities/bbb-organization.entity";
import {
  BILLING_MODE,
  BBB_PLUGIN_OPTIONS,
  MEETING_STATE,
} from "../constants";
import type { BigBlueButtonPluginOptions } from "../types";
import { MeteredUsageRecordedEvent } from "../events/bbb-events";
import {
  isMeteredOrganization,
  learnerCountFrom,
  monthOf,
  resolveRatePaisePerLearnerHour,
  platformDefaultRatePaisePerHour,
} from "./metered-billing.policy";

const loggerCtx = "BbbMeteringService";

/** Outcome of one sampling tick. Counts only — no entities leak to the task. */
export interface MeteringSampleResult {
  scanned: number;
  sampled: number;
  skipped: number;
  failed: number;
}

@Injectable()
export class BbbMeteringService {
  constructor(
    private readonly connection: TransactionalConnection,
    private readonly ctxService: RequestContextService,
    private readonly bbbApiService: BbbApiService,
    private readonly serverService: BbbServerService,
    private readonly eventBus: EventBus,
    @Inject(BBB_PLUGIN_OPTIONS)
    private readonly options: BigBlueButtonPluginOptions,
  ) {}

  private get defaultRate(): number {
    // Q2: plugin option, else the clearly marked placeholder price — the same
    // single resolution the billing read API uses (platformDefaultRatePaisePerHour),
    // so the metered write and the summary never disagree on the rate.
    return platformDefaultRatePaisePerHour(this.options);
  }

  /**
   * Schema-qualified table refs for the raw statements below.
   *
   * Not cosmetic (BUG-049 / Tier-2 precedent, `BbbPlatformCapacityPolicyService`
   * and `BbbDailyAllowanceService`): TypeORM qualifies entity tables with the
   * connection's `schema`, while a raw string resolves through `search_path`.
   * An unqualified statement therefore writes to (and reads from) the wrong
   * schema in every schema-isolated deployment and e2e run — the sampler would
   * insert rows the billing read can never see.
   */
  private get sampleTableRef(): string {
    return this.qualify("bbb_meeting_sample");
  }

  private get meteredUsageTableRef(): string {
    return this.qualify("bbb_metered_usage");
  }

  private get meetingTableRef(): string {
    return this.qualify("bbb_meeting");
  }

  private get organizationTableRef(): string {
    return this.qualify("bbb_organization");
  }

  private qualify(table: string): string {
    const schema = (
      this.connection.rawConnection.options as { schema?: string }
    ).schema;
    return schema ? `"${schema}"."${table}"` : `"${table}"`;
  }

  private get maxMeetingDurationMs(): number {
    return this.options.maxMeetingDurationMs ?? 24 * 60 * 60 * 1000;
  }

  async sampleActiveMeetings(now = new Date()): Promise<MeteringSampleResult> {
    const ctx = await this.ctxService.create({ apiType: "admin" });
    const result: MeteringSampleResult = { scanned: 0, sampled: 0, skipped: 0, failed: 0 };
    const meetings = await this.connection
      .getRepository(ctx, BbbMeeting)
      .createQueryBuilder("meeting")
      .leftJoinAndSelect("meeting.organization", "organization")
      .leftJoinAndSelect("meeting.server", "server")
      .where("meeting.state = :state", { state: MEETING_STATE.ACTIVE })
      .andWhere("organization.billingMode = :mode", { mode: BILLING_MODE.METERED })
      .getMany();
    result.scanned = meetings.length;
    if (meetings.length === 0) return result;
    const bucketMinute = truncateToMinute(now);
    for (const batch of chunk<BbbMeeting>(meetings, 10)) {
      await Promise.all(
        batch.map((m: BbbMeeting) => this.sampleOneMeeting(ctx, m, bucketMinute).then((o: "sampled" | "skipped" | "failed") => { result[o]++; })),
      );
    }
    if (result.failed > 0 || result.sampled > 0) {
      Logger.info(
        `Metering tick: scanned=${result.scanned} sampled=${result.sampled} skipped=${result.skipped} failed=${result.failed}`,
        loggerCtx,
      );
    }
    return result;
  }

  private async sampleOneMeeting(
    ctx: RequestContext,
    meeting: BbbMeeting,
    bucketMinute: Date,
  ): Promise<"sampled" | "skipped" | "failed"> {
    try {
      const serverId = meeting.serverId;
      if (!meeting.bbbMeetingId || !serverId) return "skipped";
      // findByIdWithSecret: encryptedApiSecret is select:false, and every
      // adapter call decrypts it — findById would leave it undefined and the
      // checksum step would throw on every tick.
      const bbbServer = await this.serverService.findByIdWithSecret(ctx, String(serverId));
      if (!bbbServer) return "skipped";
      // W1: skip the sample on ANY BBB error — a failed sample is a visible
      // gap (customer-favourable under-billing), never a meeting-killer.
      // notFound (meeting ended without a webhook) is also a skip here: the
      // meeting-ended path / reconciliation owns the terminal transition, not
      // the sampler.
      let info: Awaited<ReturnType<BbbApiService["getMeetingInfo"]>>;
      try {
        info = await this.bbbApiService.getMeetingInfo(bbbServer, meeting.bbbMeetingId);
      } catch (err) {
        if (err instanceof BbbNotFoundError) {
          Logger.info(`Metering sample skipped for meeting ${meeting.id}: meeting ended on BBB`, loggerCtx);
        } else {
          Logger.warn(`Metering sample skipped for meeting ${meeting.id}: ${(err as Error).message}`, loggerCtx);
        }
        return "skipped";
      }
      const learnerCount = learnerCountFrom(info.participantCount, info.moderatorCount);
      const moderatorCount = normaliseCount(info.moderatorCount);
      await this.connection.rawConnection.query(
        `INSERT INTO ${this.sampleTableRef} ("createdAt", "updatedAt", "meetingId", "bucketMinute", "learnerCount", "moderatorCount") VALUES (now(), now(), $1, $2, $3, $4) ON CONFLICT ("meetingId", "bucketMinute") DO NOTHING`,
        [String(meeting.id), bucketMinute, learnerCount, moderatorCount],
      );
      return "sampled";
    } catch (err) {
      Logger.warn(`Metering sample failed for meeting ${meeting?.id}: ${(err as Error).message}`, loggerCtx);
      return "failed";
    }
  }

  async billMeteredMeeting(ctx: RequestContext, meetingId: string): Promise<string | null> {
    const meeting = await this.connection.getRepository(ctx, BbbMeeting)
      .findOne({ where: { id: meetingId }, relations: ["organization"] });
    if (!meeting) {
      Logger.warn(`billMeteredMeeting: meeting ${meetingId} not found`, loggerCtx);
      return null;
    }
    const org = meeting.organization as BbbOrganization;
    if (!isMeteredOrganization(org)) return null;
    const completedAt = meeting.completedAt ?? new Date();
    const samples = await this.connection.getRepository(ctx, BbbMeetingSample)
      .createQueryBuilder("sample")
      .where("sample.meetingId = :meetingId", { meetingId: String(meeting.id) })
      .orderBy("sample.bucketMinute", "ASC")
      .getMany();
    const capped = this.applyDurationCap(meeting, samples);
    const learnerMinutes = capped.kept.reduce((s, r) => s + (r.learnerCount ?? 0), 0);
    const peakLearners = samples.reduce((p, r) => Math.max(p, r.learnerCount ?? 0), 0);
    const peakModerators = samples.reduce((p, r) => Math.max(p, r.moderatorCount ?? 0), 0);
    const ratePaisePerHour = resolveRatePaisePerLearnerHour(org, this.defaultRate);
    const periodMonth = monthOf(completedAt);
    const inserted: Array<{ id: number | string }> =
      await this.connection.rawConnection.query(
      `INSERT INTO ${this.meteredUsageTableRef} ("createdAt", "updatedAt", "meetingId", "organizationId", "channelId", "roomId", "startedAt", "completedAt", "learnerMinutes", "peakLearners", "peakModerators", "ratePaisePerHour", "periodMonth", "billingCapped") VALUES (now(), now(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) ON CONFLICT ("meetingId") DO NOTHING RETURNING "id"`,
      [String(meeting.id), String(org.id), String(org.channelId ?? ""), meeting.roomId ?? null, meeting.provisionedAt ?? meeting.createdAt ?? completedAt, completedAt, learnerMinutes, peakLearners, peakModerators, ratePaisePerHour, periodMonth, meeting.billingCapped ?? false],
    );
    // `RETURNING "id"` yields the integer PK as a JS number; the domain id is
    // the string form (the entity's `id: ID`), so normalise before returning.
    const insertedId = inserted?.[0]?.id;
    let usageId: string | null =
      insertedId === undefined || insertedId === null
        ? null
        : String(insertedId);
    if (!usageId) {
      const existing = await this.connection.getRepository(ctx, BbbMeteredUsage)
        .createQueryBuilder("usage")
        .where("usage.meetingId = :meetingId", { meetingId: String(meeting.id) })
        .getOne();
      usageId = existing ? String(existing.id) : null;
    }
    if (capped.dropped > 0 || samples.length === 0) {
      Logger.warn(`Metered billing gaps for meeting ${meeting.id}: samples=${samples.length} dropped=${capped.dropped} learnerMinutes=${learnerMinutes}`, loggerCtx);
    }
    this.eventBus.publish(new MeteredUsageRecordedEvent(ctx, String(meeting.id), String(org.id), String(org.channelId ?? ""), periodMonth, learnerMinutes, ratePaisePerHour, meeting.billingCapped ?? false));
    return usageId;
  }

  async findUnbilledCompletedMeetings(limit = 100): Promise<string[]> {
    // `bbb_metered_usage.meetingId` is varchar while `bbb_meeting.id` is the
    // integer primary key, so the join must cast explicitly — Postgres refuses
    // `character varying = integer` outright. Both tables are schema-qualified
    // (see `sampleTableRef`).
    const rows: Array<{ meetingId: string }> = await this.connection.rawConnection.query(
      `SELECT m."id" AS "meetingId" FROM ${this.meetingTableRef} m JOIN ${this.organizationTableRef} o ON o."id" = m."organizationId" LEFT JOIN ${this.meteredUsageTableRef} u ON u."meetingId" = CAST(m."id" AS varchar) WHERE m."state" = $1 AND o."billingMode" = $2 AND u."id" IS NULL ORDER BY m."completedAt" ASC NULLS LAST LIMIT $3`,
      [MEETING_STATE.COMPLETED, BILLING_MODE.METERED, limit],
    );
    // pg returns the integer primary key as a JS number, but the domain id is
    // the string form (`BbbMeteredUsage.meetingId` is varchar) — normalise here
    // so callers never see a number where they expect an id.
    return (rows ?? []).map(r => String(r.meetingId));
  }

  async monthUsageRows(ctx: RequestContext, organizationId: string, periodMonth: string): Promise<Array<{ learnerMinutes: number; ratePaisePerHour: number }>> {
    return this.connection.getRepository(ctx, BbbMeteredUsage)
      .createQueryBuilder("usage")
      .select("usage.learnerMinutes", "learnerMinutes")
      .addSelect("usage.ratePaisePerHour", "ratePaisePerHour")
      .where("usage.organizationId = :organizationId", { organizationId })
      .andWhere("usage.periodMonth = :periodMonth", { periodMonth })
      .getRawMany();
  }

  async pruneSamples(olderThanDays = 35): Promise<number> {
    const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000);
    // Never prune a meeting that can still be billed: live meetings, and
    // COMPLETED metered meetings whose usage row has not been frozen yet (their
    // samples ARE the bill). `RETURNING` is what makes the count readable —
    // TypeORM's raw query returns rows, not a `rowCount`, for a DELETE.
    const rows: Array<{ id: number }> = await this.connection.rawConnection.query(
      `DELETE FROM ${this.sampleTableRef} s USING ${this.meetingTableRef} m LEFT JOIN ${this.meteredUsageTableRef} u ON u."meetingId" = CAST(m."id" AS varchar) WHERE s."meetingId" = CAST(m."id" AS varchar) AND s."bucketMinute" < $1 AND m."state" NOT IN ($2, $3) AND (u."id" IS NOT NULL OR m."state" <> $4) RETURNING s."id"`,
      [
        cutoff,
        MEETING_STATE.ACTIVE,
        MEETING_STATE.PROVISIONING,
        MEETING_STATE.COMPLETED,
      ],
    );
    const deleted = rows?.length ?? 0;
    if (deleted > 0) Logger.info(`Pruned ${deleted} meeting samples older than ${cutoff.toISOString()}`, loggerCtx);
    return deleted;
  }

  private applyDurationCap(meeting: BbbMeeting, samples: BbbMeetingSample[]): { kept: BbbMeetingSample[]; dropped: number } {
    if (!meeting.billingCapped || !meeting.provisionedAt) return { kept: samples, dropped: 0 };
    const ceiling = new Date(meeting.provisionedAt).getTime() + this.maxMeetingDurationMs;
    const kept = samples.filter(s => {
      const at = s.bucketMinute instanceof Date ? s.bucketMinute.getTime() : new Date(s.bucketMinute).getTime();
      return at < ceiling;
    });
    return { kept, dropped: samples.length - kept.length };
  }
}

function truncateToMinute(date: Date): Date {
  const t = new Date(date);
  t.setSeconds(0, 0);
  return t;
}

function normaliseCount(value: number | null | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  if (!Number.isInteger(value) || value < 0) return 0;
  return value;
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

