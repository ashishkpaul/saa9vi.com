/**
 * S7A (Phase 7.4) - the shared meeting lifecycle boundary.
 *
 * Owns the meeting-completion lifecycle previously embedded in
 * BbbMeetingService (commit 4): the pessimistic-locked withdrawal of the
 * meeting row, the room reset inside the same transaction, the causal
 * billing step (metered freeze OR grant consumption), and the
 * MeetingCompletedEvent publication. Also owns markMeetingStale() - the
 * ACTIVE-via-runtime to STALE terminal transition used by reconciliation.
 *
 * Extracted so BbbRoomService and BbbReconciliationService depend on this
 * service instead of on BbbMeetingService, which removes the
 * meeting <-> room import cycle. This service must NOT depend on
 * BbbMeetingService or BbbRoomService: it reaches BbbRoom only through the
 * repository inside the completion transaction, so the room reset stays in
 * the same transaction as the meeting commit.
 *
 * The method bodies are mechanical relocations - no behavioral change. The
 * FOR UPDATE OF "meeting" lock, the transaction ordering (meeting commit to
 * billing to event) and the idempotency guards are preserved verbatim.
 */

import { Injectable } from "@nestjs/common";
import { EventBus, ID, Logger, RequestContext, TransactionalConnection } from "@vendure/core";
import { EntityManager } from "typeorm";
import { BbbMeeting } from "../entities/bbb-meeting.entity";
import { BbbRoom } from "../entities/bbb-room.entity";
import { BbbMeteringService } from "./bbb-metering.service";
import { GrantConsumptionService } from "./bbb-grant-consumption.service";
import { BbbMetricsService } from "./bbb-metrics.service";
import { isMeteredOrganization } from "./metered-billing.policy";
import { MeetingCompletedEvent } from "../events/bbb-events";
import { MEETING_STATE, MEETING_STATE_TRANSITIONS } from "../constants";
import type { MeetingState } from "../constants";

const loggerCtx = "MeetingLifecycleService";

export interface CompleteMeetingLifecycleOptions {
  source:
    | "webhook"
    | "end-meeting"
    | "reconciliation"
    | "stale-active-runtime"
    | "reconcile-remote-gone"
    | "manual";
  entityManager?: EntityManager;
  /**
   * W5 — authoritative completion time supplied by the caller: BBB's own
   * `endTime`, or the last metering sample + 1 minute, when reconciliation
   * discovers a remote end hours/days after it happened. Applied only when
   * the row has no completedAt yet (`meeting.completedAt ?? options.completedAt
   * ?? new Date()`). billMeteredMeeting() derives `periodMonth` from the
   * PERSISTED completedAt, so without this a late completion would book the
   * usage — and the fair-billing duration — into the wrong month.
   */
  completedAt?: Date;
  /**
   * Who-ended audit: the user id whose request initiated the end (e.g. the
   * trainer/admin who pressed End in `endMeeting`). The actual completion runs
   * later — via the immediate path, a webhook, or reconciliation — usually
   * under a system context with NO active user. Passed explicitly so the
   * lifecycle stamps the REQUESTING user instead of null. The webhook/
   * reconciliation completions call without it: when absent, the stamp falls
   * back to `ctx.activeUserId`, and only when the row is still un-stamped
   * (keep-first — see below).
   */
  endedByUserId?: string | null;
}

/**
 * The single writer of meeting terminal transitions and their economic
 * consequence. BbbRoomService (runtime staleness), BbbReconciliationService
 * (force-complete / stale detection) and the webhook path all route through
 * here.
 */
@Injectable()
export class MeetingLifecycleService {
  constructor(
    private readonly connection: TransactionalConnection,
    private readonly meteringService: BbbMeteringService,
    private readonly grantConsumption: GrantConsumptionService,
    private readonly eventBus: EventBus,
    private readonly metrics: BbbMetricsService,
  ) {}

  private assertTransitionAllowed(from: MeetingState, to: MeetingState): void {
    const allowed = MEETING_STATE_TRANSITIONS[from];
    if (!allowed.includes(to)) {
      throw new Error(
        `Invalid meeting state transition: ${from} → ${to}. Allowed: ${allowed.join(", ")}`,
      );
    }
  }

  private lifecyclePrefix(
    roomId: string | null | undefined,
    meetingId: ID | string,
  ) {
    return `[Room ${roomId ?? "-"}][Meeting ${meetingId}][Lifecycle]`;
  }

  async completeMeetingLifecycle(
    ctx: RequestContext,
    meetingIdOrMeeting: ID | BbbMeeting,
    options: CompleteMeetingLifecycleOptions,
  ): Promise<BbbMeeting> {
    const meetingId =
      typeof meetingIdOrMeeting === "object"
        ? (meetingIdOrMeeting.id as string)
        : (meetingIdOrMeeting as string);

    Logger.info(
      `[Lifecycle] completing meetingId=${meetingId} source=${options.source} timestamp=${new Date().toISOString()}`,
      loggerCtx,
    );

    const run = async (manager: EntityManager) => {
      // A13 fix: load WITH the organization — the completion event below
      // previously carried `meeting.organization?.id` from a relation-less
      // load, which was always `undefined` on this path.
      //
      // The pessimistic lock is scoped to `bbb_meeting` (`FOR UPDATE OF
      // "meeting"`). A relation-less `findOne({ lock })` cannot simply gain
      // `relations: ["organization"]`: the resulting outer join makes Postgres
      // reject the lock outright ("FOR UPDATE cannot be applied to the nullable
      // side of an outer join"). Neither fact is optional — the meeting row is
      // the transaction's serialization point and the organization's
      // `billingMode` decides which billing path runs — so the lock names its
      // table instead of being dropped.
      const meeting = await manager
        .getRepository(BbbMeeting)
        .createQueryBuilder("meeting")
        .leftJoinAndSelect("meeting.organization", "organization")
        .where("meeting.id = :meetingId", { meetingId })
        .setLock("pessimistic_write", undefined, ["meeting"])
        .getOne();

      if (!meeting) {
        throw new Error(`Meeting ${meetingId} not found`);
      }

      const prefix = this.lifecyclePrefix(meeting.roomId, meeting.id);

      if (meeting.state === MEETING_STATE.COMPLETED) {
        this.metrics.recordDuplicateCompletionPrevented();
        Logger.debug(
          `${prefix} completion skipped (${options.source}): already Completed`,
          loggerCtx,
        );
        return { meeting, transitioned: false };
      }

      if (meeting.state !== MEETING_STATE.ACTIVE) {
        Logger.debug(
          `${prefix} completion skipped (${options.source}): current state ${meeting.state}`,
          loggerCtx,
        );
        return { meeting, transitioned: false };
      }

      const previousState = meeting.state;
      meeting.state = MEETING_STATE.COMPLETED;
      // W5: options.completedAt carries the authoritative remote end (BBB
      // endTime / last sample + 1 min) so reconciliation completions book
      // into the correct billing month.
      meeting.completedAt = meeting.completedAt ?? options.completedAt ?? new Date();
      // W5 audit trail: attribute the completion to the requesting user when
      // there is one (endBbbMeeting with an admin session); webhook and
      // reconciliation completions carry no active user → null (system end).
      // Only reached on the first transition to Completed (idempotent above).
      if (meeting.endedByUserId == null) {
        const explicitEndedBy = options.endedByUserId;
        meeting.endedByUserId =
          explicitEndedBy != null
            ? explicitEndedBy
            : ctx.activeUserId != null
              ? String(ctx.activeUserId)
              : null;
      }
      const completed = await manager.save(BbbMeeting, meeting);

      if (completed.roomId) {
        await manager
          .getRepository(BbbRoom)
          .update(completed.roomId as string, {
            state: "Idle",
            currentMeetingId: null,
            lastRuntimeValidatedAt: null,
          });
      }

      Logger.info(`${prefix} completed via ${options.source}`, loggerCtx);

      // Structured lifecycle log
      Logger.info(
        JSON.stringify({
          event: "meeting-lifecycle-completed",
          meetingId: completed.id,
          roomId: completed.roomId,
          source: options.source,
          previousState,
          nextState: MEETING_STATE.COMPLETED,
          grantId: completed.grantId,
        }),
        loggerCtx,
      );

      return { meeting: completed, transitioned: true };
    };

    const { meeting, transitioned } = options.entityManager
      ? await run(options.entityManager)
      : await this.connection.rawConnection.transaction(run);

    if (!transitioned) {
      return meeting;
    }

    if (options.source === "webhook") {
      this.metrics.recordWebhookCompletion();
    }

    try {
      // Metered orgs freeze samples into BbbMeteredUsage; grant orgs keep the
      // append-only ledger path untouched (INV-028).
      if (isMeteredOrganization(meeting.organization)) {
        await this.meteringService.billMeteredMeeting(ctx, meetingId as string);
      } else {
        await this.grantConsumption.consumeGrantHours(ctx, meeting);
      }
      this.metrics.recordBillingSuccess();
      // Causal order (documented): the meeting terminal fact is established,
      // billing is performed synchronously, and MeetingCompletedEvent is
      // published only after billing succeeds — listeners can assume the
      // ledger fact exists. If billing fails, reconciliation
      // (reconcilePendingBilling) replays it; the event is not published for
      // a failed-billing completion.
      this.eventBus.publish(
        new MeetingCompletedEvent(
          ctx,
          meeting.id as string,
          meeting.roomId ?? null,
          meeting.organization?.id as string,
          options.source,
          0,
        ),
      );
    } catch (err) {
      this.metrics.recordBillingFailed();
      Logger.error(
        `${this.lifecyclePrefix(meeting.roomId, meeting.id)} billing failed after ${options.source}: ${(err as Error).message}. Will retry via reconciliation.`,
        loggerCtx,
      );
    }

    return meeting;
  }

  /**
   * Transition a meeting to STALE state when it is permanently unreachable on BBB.
   * STALE is terminal — no further transitions. No BbbUsageLedger row is written.
   */
  async markMeetingStale(
    ctx: RequestContext,
    meeting: BbbMeeting,
    reason: string,
  ): Promise<BbbMeeting> {
    Logger.warn(
      `[STALE] Meeting ${meeting.id} marked as Stale: ${reason}`,
      loggerCtx,
    );

    // Capture before the assignment below — meeting.state is overwritten
    // in place, so reading it in the structured log afterwards would report
    // the NEW state as previousState (observed as previousState:"Stale").
    const previousState = meeting.state;
    this.assertTransitionAllowed(meeting.state, MEETING_STATE.STALE);
    meeting.state = MEETING_STATE.STALE;
    meeting.failureReason = reason;

    // Do NOT set provisionedAt / completedAt — those are for real lifecycle transitions
    const saved = await this.connection
      .getRepository(ctx, BbbMeeting)
      .save(meeting);

    // Structured lifecycle log
    Logger.info(
      JSON.stringify({
        event: "meeting-stale-detected",
        meetingId: meeting.id,
        roomId: meeting.roomId,
        organizationId: meeting.organization?.id as string,
        previousState,
        reason,
        grantId: meeting.grantId,
      }),
      loggerCtx,
    );

    return saved;
  }
}
