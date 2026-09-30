import { Inject, Injectable } from "@nestjs/common";
import {
  RequestContext,
  TransactionalConnection,
  UserInputError,
} from "@vendure/core";
import { In } from "typeorm";

import { BBB_PLUGIN_OPTIONS } from "../constants";
import type { BigBlueButtonPluginOptions } from "../types";
import { BbbMeeting } from "../entities/bbb-meeting.entity";
import { BbbMeteredUsage } from "../entities/bbb-metered-usage.entity";
import { BbbOrganization } from "../entities/bbb-organization.entity";
import { BbbRoom } from "../entities/bbb-room.entity";
import {
  computeMonthChargePaise,
  monthOf,
  platformDefaultRatePaisePerHour,
  resolveRatePaisePerLearnerHour,
} from "./metered-billing.policy";

/** `periodMonth` keys are `YYYY-MM` (D4); anything else is a caller error. */
const PERIOD_MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

/** One `byRoom` row of `bbbBillingSummary` (plan Phase 4). */
export interface BillingRoomRow {
  roomId: string | null;
  roomName: string | null;
  learnerMinutes: number;
  chargePaise: number;
}

export interface BillingSummary {
  month: string;
  ratePaisePerHour: number;
  totalLearnerMinutes: number;
  totalChargePaise: number;
  spendLimitPaise: number | null;
  spendLimitReached: boolean;
  byRoom: BillingRoomRow[];
}

/** One row of `bbbMeteredMeetings` — the billed history (plan Phase 4). */
export interface MeteredMeetingRow {
  id: string;
  title: string;
  roomId: string | null;
  roomName: string | null;
  startedAt: Date;
  completedAt: Date;
  peakLearners: number;
  peakModerators: number;
  learnerMinutes: number;
  chargePaise: number;
  billingCapped: boolean;
  recordingUrl: string | null;
}

export interface MeteredMeetingList {
  items: MeteredMeetingRow[];
  totalItems: number;
}

export interface PlatformBillingOrganizationRow {
  organizationId: string;
  organizationName: string;
  learnerMinutes: number;
  chargePaise: number;
}

export interface PlatformBillingSummary {
  month: string;
  totalLearnerMinutes: number;
  totalChargePaise: number;
  byOrganization: PlatformBillingOrganizationRow[];
}

/**
 * Read side of ADR-047 metered billing (plan Phase 4 / D2 / D3).
 *
 * Invariants this service exists to hold:
 *  - **D2:** every paise figure passes through `computeMonthChargePaise` — the
 *    single rounding implementation. No local arithmetic, no second rounding.
 *  - **D3:** tenant reads resolve the organization from `ctx.channelId` and
 *    expose no `organizationId` argument (BUG-046's sibling rule, INV-029).
 *  - **Q2:** the displayed rate is `resolveRatePaisePerLearnerHour(org,
 *    platformDefaultRatePaisePerHour(options))` — per-org override, then plugin
 *    option, then the clearly marked placeholder.
 *  - Money is never stored: rows carry `learnerMinutes` + `ratePaisePerHour`.
 */
@Injectable()
export class BbbBillingService {
  constructor(
    private readonly connection: TransactionalConnection,
    @Inject(BBB_PLUGIN_OPTIONS)
    private readonly options: BigBlueButtonPluginOptions,
  ) {}

  private normaliseMonth(month?: string | null): string {
    const resolved = month ?? monthOf(new Date());
    if (!PERIOD_MONTH_RE.test(resolved)) {
      throw new UserInputError(
        `month must be a YYYY-MM period key (e.g. "2030-01"), got ${JSON.stringify(month)}`,
      );
    }
    return resolved;
  }

  /** D3: the tenant's organization comes from the channel, never from an argument. */
  private async orgForChannel(
    ctx: RequestContext,
  ): Promise<BbbOrganization | null> {
    return this.connection.getRepository(ctx, BbbOrganization).findOne({
      where: { channelId: ctx.channelId as string },
    });
  }

  private get defaultRate(): number {
    return platformDefaultRatePaisePerHour(this.options);
  }

  async getSummary(
    ctx: RequestContext,
    month?: string,
  ): Promise<BillingSummary> {
    const period = this.normaliseMonth(month);
    const org = await this.orgForChannel(ctx);
    const rows = org
      ? await this.connection.getRepository(ctx, BbbMeteredUsage).find({
          where: { organizationId: String(org.id), periodMonth: period },
        })
      : [];
    const totalLearnerMinutes = rows.reduce((sum, r) => sum + r.learnerMinutes, 0);
    // D2: the ONLY money computation for the month — one rounding pass.
    const totalChargePaise = computeMonthChargePaise(rows);

    const byRoom = await this.groupRowsByRoom(ctx, rows);
    const spendLimitPaise = org?.monthlySpendLimitPaise ?? null;
    return {
      month: period,
      ratePaisePerHour: resolveRatePaisePerLearnerHour(org, this.defaultRate),
      totalLearnerMinutes,
      totalChargePaise,
      spendLimitPaise,
      spendLimitReached:
        spendLimitPaise != null && totalChargePaise >= spendLimitPaise,
      byRoom,
    };
  }

  /** Groups usage rows by `roomId`, resolving display names in one query. */
  private async groupRowsByRoom(
    ctx: RequestContext,
    rows: BbbMeteredUsage[],
  ): Promise<BillingRoomRow[]> {
    const grouped = new Map<string, BbbMeteredUsage[]>();
    const roomless: BbbMeteredUsage[] = [];
    for (const row of rows) {
      if (row.roomId) {
        const list = grouped.get(row.roomId);
        if (list) list.push(row);
        else grouped.set(row.roomId, [row]);
      } else {
        roomless.push(row);
      }
    }

    const roomIds = [...grouped.keys()]
      .map(Number)
      .filter((n) => Number.isInteger(n) && n > 0);
    const rooms = roomIds.length
      ? await this.connection.getRepository(ctx, BbbRoom).find({
          where: { id: In(roomIds) },
        })
      : [];
    const nameById = new Map(rooms.map((r) => [String(r.id), r.name]));

    const result: BillingRoomRow[] = [...grouped.entries()].map(
      ([roomId, roomRows]) => ({
        roomId,
        roomName: nameById.get(roomId) ?? null,
        learnerMinutes: roomRows.reduce((s, r) => s + r.learnerMinutes, 0),
        chargePaise: computeMonthChargePaise(roomRows),
      }),
    );
    if (roomless.length > 0) {
      result.push({
        roomId: null,
        roomName: null,
        learnerMinutes: roomless.reduce((s, r) => s + r.learnerMinutes, 0),
        chargePaise: computeMonthChargePaise(roomless),
      });
    }
    // Deterministic order: largest charge first (stable sort keeps ties in
    // insertion order).
    result.sort((a, b) => b.chargePaise - a.chargePaise);
    return result;
  }

  async getMeteredMeetings(
    ctx: RequestContext,
    month?: string,
    skip?: number,
    take?: number,
  ): Promise<MeteredMeetingList> {
    const period = this.normaliseMonth(month);
    const org = await this.orgForChannel(ctx);
    // D3: no organization argument — org from ctx.channelId; an empty channel
    // is an empty list, never "every tenant's history" (BUG-046's sibling rule).
    if (!org) return { items: [], totalItems: 0 };

    const rows = await this.connection.getRepository(ctx, BbbMeteredUsage).find({
      where: { organizationId: String(org.id), periodMonth: period },
      order: { completedAt: "DESC" },
    });

    // Inner-join semantics against bbb_meeting: usage rows whose meeting row is
    // absent are summary-only and never listed (never invent a title/link).
    const meetingIds = [
      ...new Set(
        rows.map((r) => Number(r.meetingId)).filter((n) => Number.isInteger(n) && n > 0),
      ),
    ];
    const meetings = meetingIds.length
      ? await this.connection.getRepository(ctx, BbbMeeting).find({
          where: { id: In(meetingIds) },
        })
      : [];
    const meetingById = new Map(meetings.map((m) => [String(m.id), m]));

    const roomIds = [
      ...new Set(
        rows.map((r) => (r.roomId ? Number(r.roomId) : NaN)).filter((n) => Number.isInteger(n) && n > 0),
      ),
    ];
    const rooms = roomIds.length
      ? await this.connection.getRepository(ctx, BbbRoom).find({
          where: { id: In(roomIds) },
        })
      : [];
    const roomNameById = new Map(rooms.map((r) => [String(r.id), r.name]));

    const all: MeteredMeetingRow[] = [];
    for (const row of rows) {
      const meeting = meetingById.get(String(Number(row.meetingId)));
      if (!meeting) continue;
      all.push({
        id: String(meeting.id),
        title: meeting.title,
        roomId: row.roomId,
        roomName: row.roomId ? (roomNameById.get(row.roomId) ?? null) : null,
        startedAt: row.startedAt,
        completedAt: row.completedAt,
        peakLearners: row.peakLearners,
        peakModerators: row.peakModerators,
        learnerMinutes: row.learnerMinutes,
        // Display share for THIS meeting only — the billed month total stays a
        // single computeMonthChargePaise pass (D2). The same helper keeps the
        // per-row figure on the same rule as everything else.
        chargePaise: computeMonthChargePaise([row]),
        billingCapped: row.billingCapped,
        // Stored by the rap-publish-ended webhook; null until BBB reports one.
        recordingUrl: meeting.recordingUrl ?? null,
      });
    }

    const takeN = Math.min(Math.max(take ?? 25, 1), 100);
    const skipN = Math.max(skip ?? 0, 0);
    // v1: an org-month of usage rows is small enough to paginate in memory so
    // `totalItems` always matches the LISTED (meeting-joined) rows.
    return { items: all.slice(skipN, skipN + takeN), totalItems: all.length };
  }

  async getPlatformSummary(
    ctx: RequestContext,
    month?: string,
  ): Promise<PlatformBillingSummary> {
    const period = this.normaliseMonth(month);
    const rows = await this.connection.getRepository(ctx, BbbMeteredUsage).find({
      where: { periodMonth: period },
    });
    const orgIds = [
      ...new Set(
        rows.map((r) => Number(r.organizationId)).filter((n) => Number.isInteger(n) && n > 0),
      ),
    ];
    const orgs = orgIds.length
      ? await this.connection.getRepository(ctx, BbbOrganization).find({
          where: { id: In(orgIds) },
        })
      : [];
    const orgById = new Map(orgs.map((o) => [String(o.id), o]));
    const kept = rows.filter((r) => orgById.has(String(Number(r.organizationId))));

    const grouped = new Map<string, BbbMeteredUsage[]>();
    for (const row of kept) {
      const key = String(Number(row.organizationId));
      const list = grouped.get(key);
      if (list) list.push(row);
      else grouped.set(key, [row]);
    }
    const byOrganization: PlatformBillingOrganizationRow[] = [...grouped.entries()]
      .map(([organizationId, orgRows]) => ({
        organizationId,
        organizationName: orgById.get(organizationId)?.name ?? "",
        learnerMinutes: orgRows.reduce((s, r) => s + r.learnerMinutes, 0),
        chargePaise: computeMonthChargePaise(orgRows),
      }))
      .sort((a, b) => b.chargePaise - a.chargePaise);

    return {
      month: period,
      totalLearnerMinutes: kept.reduce((s, r) => s + r.learnerMinutes, 0),
      // D2: one rounding pass across the whole platform-month as well.
      totalChargePaise: computeMonthChargePaise(kept),
      byOrganization,
    };
  }
}