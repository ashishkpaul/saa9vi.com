import { Inject, Injectable } from "@nestjs/common";
import {
  EventBus,
  Logger,
  RequestContext,
  RequestContextService,
  TransactionalConnection,
} from "@vendure/core";
import { BbbMeeting } from "../entities/bbb-meeting.entity";
import { BbbMeetingSample } from "../entities/bbb-meeting-sample.entity";
import { BbbCapacityGrant } from "../entities/bbb-capacity-grant.entity";
import { BbbUsageLedger } from "../entities/bbb-usage-ledger.entity";
import { BbbRoom } from "../entities/bbb-room.entity";
import { BbbServerService } from "./bbb-server.service";
import {
  BbbApiService,
  BbbMisconfiguredError,
  BbbNotFoundError,
  BbbRejectedError,
  BbbUnavailableError,
} from "./bbb-api.service";
import type { BbbServer } from "../entities/bbb-server.entity";
import { BbbEncryptionService } from "./bbb-encryption.service";
import { BbbOpsAlertService } from "./bbb-ops-alert.service";
import { BbbMetricsService } from "./bbb-metrics.service";
import { GrantConsumptionService } from "./bbb-grant-consumption.service";
import { MeetingLifecycleService } from "./bbb-meeting-lifecycle.service";
import { BbbMeteringService } from "./bbb-metering.service";
import { isMeteredOrganization } from "./metered-billing.policy";
import {
  CapacityExhaustedEvent,
  MeetingCompletedEvent,
} from "../events/bbb-events";
import { MEETING_STATE } from "../constants";
import { BBB_PLUGIN_OPTIONS } from "../constants";
import type { BigBlueButtonPluginOptions } from "../types";

const loggerCtx = "BbbReconciliationService";

@Injectable()
export class BbbReconciliationService {
  constructor(
    private readonly connection: TransactionalConnection,
    private readonly ctxService: RequestContextService,
    private readonly serverService: BbbServerService,
    private readonly bbbApiService: BbbApiService,
    private readonly lifecycleService: MeetingLifecycleService,
    private readonly meteringService: BbbMeteringService,
    private readonly eventBus: EventBus,
    private readonly grantConsumption: GrantConsumptionService,
    private readonly encryptionService: BbbEncryptionService,
    private readonly opsAlert: BbbOpsAlertService,
    private readonly metrics: BbbMetricsService,
    @Inject(BBB_PLUGIN_OPTIONS)
    private readonly options: BigBlueButtonPluginOptions,
  ) {}

  /** Grace period: trust local DB within this many ms after provisioning */
  private get meetingGracePeriodMs(): number {
    return this.options.meetingGracePeriodMs ?? 90_000;
  }

  /** How long a meeting can stay in Provisioning before reconciliation acts */
  private get stuckProvisioningTimeoutMs(): number {
    return this.options.stuckProvisioningTimeoutMs ?? 300_000; // 5 min
  }

  /** Max retries before a stuck meeting is marked Failed instead of retried */
  private get maxProvisioningRetries(): number {
    return 3;
  }

  /** Maximum meeting duration (ms) before billing is capped and meeting force-completed */
  private get maxMeetingDurationMs(): number {
    return this.options.maxMeetingDurationMs ?? 24 * 60 * 60 * 1000; // 24 hours
  }

  /** How long a room can stay in Provisioning with no meeting before reset */
  private get roomStaleTimeoutMs(): number {
    return this.options.roomStaleTimeoutMs ?? 300_000; // 5 min
  }

  // ─── 1. Reconcile Active Meetings ────────────────────────────────────────────

  async reconcileActiveMeetings(): Promise<number> {
    const ctx = await this.ctxService.create({ apiType: "admin" });
    // W5: the organization must be joined — billingMode decides metered vs
    // grant behaviour on a confirmed remote end, and the billing-ceiling
    // branch reads meeting.organization for CapacityExhaustedEvent.
    const activeMeetings = await this.connection
      .getRepository(ctx, BbbMeeting)
      .createQueryBuilder("meeting")
      .leftJoinAndSelect("meeting.organization", "organization")
      .where("meeting.state = :state", { state: MEETING_STATE.ACTIVE })
      .getMany();

    let reconciled = 0;
    const now = Date.now();

    for (const meeting of activeMeetings) {
      if (!meeting.bbbMeetingId || !meeting.serverId) continue;

      // ─── GRACE PERIOD ─────────────────────────────────────────────
      // Do not reconcile meetings that were created less than the grace
      // period ago. BBB needs time to initialise the meeting context.
      // Trust the local DB state during this window.
      const meetingAgeMs =
        now - (meeting.provisionedAt?.getTime() ?? meeting.createdAt.getTime());
      if (meetingAgeMs < this.meetingGracePeriodMs) {
        continue;
      }
      // ──────────────────────────────────────────────────────────────

      // ─── BILLING CEILING ──────────────────────────────────────────
      // Force-complete meetings that have been active beyond the max
      // allowed duration (e.g. crashed BBB node with orphaned meeting).
      if (meetingAgeMs > this.maxMeetingDurationMs) {
        const capReason = `Exceeded maxMeetingDurationMs (${Math.round(meetingAgeMs / 3600000)}h active)`;
        const organization = meeting.organization;
        // W5: metered meetings carry grantId = null. A lookup keyed on a null
        // id must never run (it can match an arbitrary row) and a metered
        // meeting must never publish a grant event — skip the grant lookup
        // entirely and let the `organization && guard` below decide.
        const grant = meeting.grantId
          ? await this.connection
              .getRepository(ctx, BbbCapacityGrant)
              .findOne({ where: { id: meeting.grantId } })
          : null;
        await this.connection
          .getRepository(ctx, BbbMeeting)
          .update(meeting.id as string, {
            billingCapped: true,
            billingCapReason: capReason,
            lastReconciledAt: new Date(),
            reconciliationAttemptCount: (meeting.reconciliationAttemptCount ?? 0) + 1,
          });
        // Follow-up: the meeting ENDED (for billing) at the ceiling —
        // provisionedAt + maxMeetingDurationMs — not when this pass happened
        // to run. Passing that as completedAt makes usage book to the month
        // the meeting actually ended in (same rule as reconcile-remote-gone,
        // W5-9/W5-10); the branch condition (age > ceiling) guarantees it is
        // ≤ now.
        await this.lifecycleService.completeMeetingLifecycle(ctx, meeting.id, {
          source: "reconciliation",
          completedAt: new Date(
            (meeting.provisionedAt ?? meeting.createdAt).getTime() +
              this.maxMeetingDurationMs,
          ),
        });
        reconciled++;
        Logger.warn(
          `Meeting ${meeting.id} force-completed: billing capped — ${capReason}`,
          loggerCtx,
        );
        if (organization && grant) {
          this.eventBus.publish(
            new CapacityExhaustedEvent(ctx, organization, grant),
          );
        }
        continue;
      }
      // ──────────────────────────────────────────────────────────────

      // Update reconciliation audit fields
      await this.connection
        .getRepository(ctx, BbbMeeting)
        .update(meeting.id as string, {
          lastReconciledAt: new Date(),
          reconciliationAttemptCount: (meeting.reconciliationAttemptCount ?? 0) + 1,
        });

      const server = await this.serverService.findByIdWithSecret(
        ctx,
        meeting.serverId,
      );
      if (!server) continue;

      // W1/W5: only a CONFIRMED remote end acts — BbbNotFoundError, or a
      // successful getMeetingInfo carrying endTime > 0 (BBB keeps ended
      // meetings queryable for a while, so a missed end event must complete
      // here instead of leaving the meeting ACTIVE until BBB purges it).
      // Unavailable (outage) / Rejected (bad checksum) mean "cannot prove it
      // is gone" → skip this pass, never stale, never forfeit billing.
      // `running === false` alone is NEVER a verdict (it is false before the
      // first participant joins). BBB requires the moderator password on
      // getMeetingInfo (API-Mate capture) — the load below skips the meeting
      // when it is missing.
      let moderatorPW: string | undefined;
      try {
        const withSecrets = await this.connection
          .getRepository(ctx, BbbMeeting)
          .createQueryBuilder("meeting")
          .addSelect("meeting.encryptedModeratorPassword")
          .where("meeting.id = :id", { id: meeting.id as string })
          .getOne();
        if (withSecrets?.encryptedModeratorPassword) {
          moderatorPW = this.encryptionService.decrypt(
            withSecrets.encryptedModeratorPassword,
          );
        }
      } catch {
        moderatorPW = undefined;
      }
      if (!moderatorPW) {
        // W5: a missing/undecryptable moderator password on the meeting row
        // is a PER-MEETING data problem. Sending the call anyway would be
        // unauthenticated — BBB rejects it (BbbRejectedError) and
        // flagServerConfigProblem() would mark the whole SERVER unhealthy
        // because of ONE bad row. Skip this meeting only: warning, no API
        // call, server health untouched.
        Logger.warn(
          `Reconcile skipped for meeting ${meeting.id}: no decryptable moderator password on the meeting row (per-meeting data problem)`,
          loggerCtx,
        );
        continue;
      }
      let confirmedEnd = false;
      let confirmedEndTimeSec = 0;
      try {
        const info = await this.bbbApiService.getMeetingInfo(
          server,
          meeting.bbbMeetingId,
          moderatorPW,
        );
        if (Number(info?.endTime ?? 0) > 0) {
          confirmedEnd = true;
          confirmedEndTimeSec = Number(info.endTime);
        }
      } catch (err) {
        if (err instanceof BbbNotFoundError) {
          confirmedEnd = true;
        } else {
          // Transient outage or config rejection — skip this pass.
          // Misconfigured/Rejected also flags the server unhealthy + a
          // de-duplicated ops alert (spend-alert style): a bad checksum or a
          // missing secret will otherwise fail every meeting, every pass.
          if (
            err instanceof BbbMisconfiguredError ||
            err instanceof BbbRejectedError
          ) {
            await this.flagServerConfigProblem(ctx, server, err);
          }
          Logger.warn(
            `Reconcile skipped for meeting ${meeting.id}: ${(err as Error).message}`,
            loggerCtx,
          );
        }
      }
      if (!confirmedEnd) continue;

      // ─── CONFIRMED REMOTE END (W5) ─────────────────────────────────
      reconciled++;
      if (!isMeteredOrganization(meeting.organization)) {
        // Grant mode is unchanged: confirmed gone → STALE, never billed
        // (markMeetingStale writes no ledger and no metered usage row).
        await this.lifecycleService.markMeetingStale(
          ctx,
          meeting,
          "BBB confirms the meeting ended remotely — grant mode, no billing",
        );
        Logger.info(
          `Reconciled meeting ${meeting.id}: marked as Stale (grant mode, remote end confirmed)`,
          loggerCtx,
        );
        continue;
      }

      // Metered mode: the samples ARE the bill (INV-028). With ≥1 sample the
      // meeting completes through the shared lifecycle so the frozen usage
      // row, the room reset and MeetingCompletedEvent all stay consistent
      // with webhook completions.
      const sampleCount = await this.connection
        .getRepository(ctx, BbbMeetingSample)
        .createQueryBuilder("sample")
        .where("sample.meetingId = :meetingId", {
          meetingId: String(meeting.id),
        })
        .getCount();

      if (sampleCount === 0) {
        // Zero samples can mean metering was BROKEN, not that nobody joined.
        // Stale the meeting (nothing would ever bill) but raise a per-meeting
        // ops alert so the gap cannot hide behind a clean terminal state.
        await this.lifecycleService.markMeetingStale(
          ctx,
          meeting,
          "BBB confirms the meeting ended remotely but zero metering samples exist — metering gap suspected",
        );
        this.opsAlert.notify(
          "bbb-metering-zero-samples",
          `meeting-${meeting.id}`,
          `Metered meeting ${meeting.id} ended on BBB with ZERO metering samples (server ${meeting.serverId}) — metering may be broken`,
          {
            meetingId: String(meeting.id),
            serverId: meeting.serverId,
            sampleCount: 0,
          },
        );
        Logger.warn(
          `Reconciled meeting ${meeting.id}: Stale + zero-sample alert (metering gap suspected)`,
          loggerCtx,
        );
        continue;
      }

      const completedAt = await this.computeReconciledCompletedAt(
        ctx,
        meeting,
        confirmedEndTimeSec,
      );
      await this.lifecycleService.completeMeetingLifecycle(ctx, meeting.id, {
        source: "reconcile-remote-gone",
        completedAt,
      });
      this.metrics.recordReconcileRemoteGoneCompletion();
      // De-duplicated per server for 1 h (BbbOpsAlertService): a server whose
      // webhooks are systematically missing must not spam once per meeting.
      this.opsAlert.notify(
        "bbb-webhook-missed",
        `server-${meeting.serverId}`,
        `Meeting ${meeting.id} ended on BBB without a webhook — completed by reconciliation (reconcile-remote-gone)`,
        {
          meetingId: String(meeting.id),
          serverId: meeting.serverId,
          completedAt: completedAt.toISOString(),
        },
      );
      Logger.info(
        `Reconciled meeting ${meeting.id}: remote end confirmed → COMPLETED via reconcile-remote-gone (completedAt=${completedAt.toISOString()}, samples=${sampleCount})`,
        loggerCtx,
      );
    }
    return reconciled;
  }

  /**
   * W5 — the authoritative completion time for a reconciliation-discovered
   * remote end:
   *
   * - BBB's own `endTime` when the success path gave us one;
   * - otherwise the last metering sample + 1 minute (the sampler covers whole
   *   minutes, so the meeting ended within that minute at the latest);
   * - clamped to [provisionedAt, now] so a clock-skewed endTime can never
   *   book usage before the meeting existed or in the future.
   *
   * billMeteredMeeting() derives `periodMonth` from the PERSISTED
   * completedAt — completing hours/days later with `new Date()` would book
   * the usage (and the fair-billing duration) into the wrong month.
   */
  private async computeReconciledCompletedAt(
    ctx: RequestContext,
    meeting: BbbMeeting,
    endTimeSec: number,
  ): Promise<Date> {
    const now = new Date();
    const lowerBound = (meeting.provisionedAt ?? meeting.createdAt).getTime();
    let candidateMs: number;
    if (endTimeSec > 0) {
      candidateMs = endTimeSec * 1000;
    } else {
      const lastSample = await this.connection
        .getRepository(ctx, BbbMeetingSample)
        .createQueryBuilder("sample")
        .where("sample.meetingId = :meetingId", {
          meetingId: String(meeting.id),
        })
        .orderBy("sample.bucketMinute", "DESC")
        .getOne();
      candidateMs = lastSample
        ? lastSample.bucketMinute.getTime() + 60_000
        : now.getTime();
    }
    return new Date(
      Math.min(Math.max(candidateMs, lowerBound), now.getTime()),
    );
  }

  /**
   * Gate-2: a checksum/auth rejection or a missing/undecryptable secret is a
   * per-server config problem, not a per-meeting verdict. Mark the server
   * unhealthy (selection excludes it) and raise a de-duplicated ops alert —
   * `BbbOpsAlertService.notify` dedupes per (kind, key) for one hour, so one
   * bad server cannot spam once per meeting per pass. Best-effort: alerting
   * must never break the reconciliation pass.
   */
  private async flagServerConfigProblem(
    ctx: RequestContext,
    server: { id?: unknown; name?: string },
    err: BbbMisconfiguredError | BbbRejectedError,
  ): Promise<void> {
    const serverId = String(server?.id ?? "unknown");
    try {
      await this.serverService.markHealthy(ctx, serverId as never, false);
    } catch {
      // Selection exclusion is advisory — the skip above already protected
      // this pass. Never let the health write kill reconciliation.
    }
    this.opsAlert.notify(
      "bbb-server-config",
      `server-${serverId}`,
      `BBB server "${server?.name ?? serverId}" misconfigured: ${err.message}`.substring(0, 300),
      { serverId, messageKey: (err as { messageKey?: string }).messageKey ?? "unknown" },
    );
  }

  // ─── 2. Reconcile Stuck Provisioning ─────────────────────────────────────────

  async reconcileProvisioning(): Promise<number> {
    const ctx = await this.ctxService.create({ apiType: "admin" });
    const cutoff = new Date(Date.now() - this.stuckProvisioningTimeoutMs);

    const stuckMeetings = await this.connection
      .getRepository(ctx, BbbMeeting)
      .createQueryBuilder("meeting")
      .where("meeting.state = :state", { state: MEETING_STATE.PROVISIONING })
      .andWhere("meeting.updatedAt <= :cutoff", { cutoff })
      .getMany();

    let reconciled = 0;
    for (const meeting of stuckMeetings) {
      const retryCount = (meeting.retryCount ?? 0) + 1;

      if (retryCount >= this.maxProvisioningRetries) {
        await this.connection
          .getRepository(ctx, BbbMeeting)
          .update(meeting.id as string, {
            state: MEETING_STATE.FAILED,
            failureReason: `Provisioning timed out after ${retryCount} retries`,
            retryCount,
          });
      } else {
        await this.connection
          .getRepository(ctx, BbbMeeting)
          .update(meeting.id as string, {
            state: MEETING_STATE.PENDING,
            failureReason: `Retry #${retryCount}: previous provisioning timed out`,
            retryCount,
          });
      }
      reconciled++;
      Logger.info(
        `Reconciled stuck provisioning meeting ${meeting.id}: retry=${retryCount}`,
        loggerCtx,
      );
    }
    return reconciled;
  }

  // ─── 3. Consume Grant Minutes (delegated) ─────────────────────────────────
  // S7A (Phase 7.3): the economic operation now lives in
  // GrantConsumptionService (fair-duration guard, duration/cap math,
  // GrantReaderService resolution, idempotent ledger insert — INV-002 —
  // atomic CAS grant update, internal-overhead branch, GrantConsumedEvent).
  // This method remains as a thin delegation for the recovery loop below and
  // existing characterization callers; behavior is unchanged.

  async consumeGrantHours(
    ctx: RequestContext,
    meeting: BbbMeeting,
  ): Promise<void> {
    await this.grantConsumption.consumeGrantHours(ctx, meeting);
  }



  // ─── 4. Reconcile Pending Billing (COMPLETED without ledger row) ────────────
  // Recovery loop: if billing failed after a meeting reached COMPLETED (e.g.
  // transient DB error, worker crash), the webhook may already be marked
  // PROCESSED. This scan guarantees every COMPLETED meeting eventually gets
  // exactly one billing fact. consumeGrantHours() is safe to replay because
  // the ledger INSERT ... ON CONFLICT DO NOTHING is the idempotency decision.
  //
  // The recovered meeting must also re-emit MeetingCompletedEvent, because the
  // original completion suppressed it (billing threw before publication) and
  // session FINISHED is driven solely by that event. Re-publication is safe:
  // the scan filter (ledger.id IS NULL) prevents repeats, and the listener
  // no-ops unless the linked session is still LIVE.

  async reconcilePendingBilling(): Promise<number> {
    const ctx = await this.ctxService.create({ apiType: "admin" });
    const repo = this.connection.getRepository(ctx, BbbMeeting);

    const completedWithoutLedger = await repo
      .createQueryBuilder("meeting")
      .leftJoinAndSelect("meeting.organization", "organization")
      .leftJoin(BbbUsageLedger, "ledger", "ledger.meetingId = meeting.id")
      .where("meeting.state = :state", { state: MEETING_STATE.COMPLETED })
      .andWhere("ledger.id IS NULL")
      .andWhere("meeting.grantId IS NOT NULL")
      .getMany();

    let billed = 0;
    for (const meeting of completedWithoutLedger) {
      try {
        await this.consumeGrantHours(ctx, meeting);
        billed++;
        Logger.info(
          `[reconcilePendingBilling] Recovered billing for completed meeting ${meeting.id}`,
          loggerCtx,
        );

        // Re-establish the lifecycle fact that the failed completion suppressed,
        // so the linked session can leave LIVE. Idempotent by design.
        this.eventBus.publish(
          new MeetingCompletedEvent(
            ctx,
            meeting.id as string,
            meeting.roomId ?? null,
            meeting.organization?.id as string,
            "reconciliation",
            0,
          ),
        );
      } catch (err: any) {
        Logger.error(
          `[reconcilePendingBilling] Billing recovery failed for meeting ${meeting.id}: ${err.message} ` +
            `(MeetingCompletedEvent not re-published; session remains LIVE until recovery succeeds)`,
          loggerCtx,
        );
      }
    }
    return billed;
  }

  /**
   * ADR-047 Phase 2B — metered recovery scan.
   *
   * COMPLETED meetings of metered orgs with no `BbbMeteredUsage` row (crashed
   * between completion and billing, or billed zero-row write failed) are
   * billed, then their `MeetingCompletedEvent` is re-published so the linked
   * session can leave LIVE — mirrors the grant recovery above.
   */
  async reconcilePendingMeteredBilling(): Promise<number> {
    const ctx = await this.ctxService.create({ apiType: "admin" });
    const meetingIds = await this.meteringService.findUnbilledCompletedMeetings();
    let billed = 0;
    for (const meetingId of meetingIds) {
      try {
        const usageId = await this.meteringService.billMeteredMeeting(ctx, meetingId);
        if (!usageId) continue;
        billed++;
        Logger.info(
          `[reconcilePendingMeteredBilling] Recovered metered billing for completed meeting ${meetingId}`,
          loggerCtx,
        );
        const meeting = await this.connection
          .getRepository(ctx, BbbMeeting)
          .findOne({ where: { id: meetingId }, relations: ["organization"] });
        if (!meeting) continue;
        this.eventBus.publish(
          new MeetingCompletedEvent(
            ctx,
            meeting.id as string,
            meeting.roomId ?? null,
            (meeting.organization as { id?: unknown })?.id as string,
            "reconciliation",
            0,
          ),
        );
      } catch (err: any) {
        Logger.error(
          `[reconcilePendingMeteredBilling] Recovery failed for meeting ${meetingId}: ${err.message} ` +
            `(MeetingCompletedEvent not re-published; session remains LIVE until recovery succeeds)`,
          loggerCtx,
        );
      }
    }
    return billed;
  }

  // ─── 5. Reconcile Room State Drift ──────────────────────────────────────────

  async reconcileRooms(): Promise<number> {
    const ctx = await this.ctxService.create({ apiType: "admin" });
    const staleCutoff = new Date(Date.now() - this.roomStaleTimeoutMs);
    let reconciled = 0;

    // Case 1 & 2: rooms stuck in Provisioning
    const provisioningRooms = await this.connection
      .getRepository(ctx, BbbRoom)
      .find({ where: { state: "Provisioning" } });

    for (const room of provisioningRooms) {
      const meeting = await this.connection
        .getRepository(ctx, BbbMeeting)
        .findOne({
          where: { roomId: room.id as string },
          order: { createdAt: "DESC" },
        });

      if (!meeting) {
        // No meeting at all — job was lost; reset if old enough
        if (
          room.lastProvisionRequestedAt &&
          room.lastProvisionRequestedAt < staleCutoff
        ) {
          await this.connection
            .getRepository(ctx, BbbRoom)
            .update(room.id as string, {
              state: "Idle",
              currentMeetingId: null,
            });
          reconciled++;
          Logger.info(
            `Room ${room.id}: Provisioning→Idle (no meeting found, job lost)`,
            loggerCtx,
          );
        }
        continue;
      }

      if (meeting.state === MEETING_STATE.ACTIVE) {
        await this.connection
          .getRepository(ctx, BbbRoom)
          .update(room.id as string, {
            state: "Active",
            currentMeetingId: meeting.id as string,
          });
        reconciled++;
        Logger.info(
          `Room ${room.id}: Provisioning→Active (meeting ${meeting.id} is active)`,
          loggerCtx,
        );
      } else if (
        meeting.state === MEETING_STATE.FAILED ||
        meeting.state === MEETING_STATE.COMPLETED ||
        meeting.state === MEETING_STATE.STALE
      ) {
        await this.connection
          .getRepository(ctx, BbbRoom)
          .update(room.id as string, { state: "Idle", currentMeetingId: null });
        reconciled++;
        Logger.info(
          `Room ${room.id}: Provisioning→Idle (meeting ${meeting.id} is ${meeting.state})`,
          loggerCtx,
        );
      }
    }

    // Case 3: rooms marked Active but meeting is gone/completed
    const activeRooms = await this.connection
      .getRepository(ctx, BbbRoom)
      .find({ where: { state: "Active" } });

    for (const room of activeRooms) {
      if (!room.currentMeetingId) {
        await this.connection
          .getRepository(ctx, BbbRoom)
          .update(room.id as string, { state: "Idle" });
        reconciled++;
        Logger.info(
          `Room ${room.id}: Active→Idle (no currentMeetingId)`,
          loggerCtx,
        );
        continue;
      }

      const meeting = await this.connection
        .getRepository(ctx, BbbMeeting)
        .findOne({ where: { id: room.currentMeetingId } });

      if (!meeting || meeting.state !== MEETING_STATE.ACTIVE) {
        await this.connection
          .getRepository(ctx, BbbRoom)
          .update(room.id as string, { state: "Idle", currentMeetingId: null });
        reconciled++;
        Logger.info(
          `Room ${room.id}: Active→Idle (meeting ${room.currentMeetingId} no longer active)`,
          loggerCtx,
        );
      }
    }

    return reconciled;
  }

  // ─── 5. Expire Stale Join Links ──────────────────────────────────────────────

  async expireJoinLinks(): Promise<number> {
    const ctx = await this.ctxService.create({ apiType: "admin" });
    const staleMeetings = await this.connection
      .getRepository(ctx, BbbMeeting)
      .createQueryBuilder("meeting")
      .where("meeting.state IN (:...states)", {
        states: [
          MEETING_STATE.COMPLETED,
          MEETING_STATE.ARCHIVED,
          MEETING_STATE.FAILED,
          MEETING_STATE.STALE,
        ],
      })
      .andWhere("meeting.attendeeJoinUrl IS NOT NULL")
      .getMany();

    let cleaned = 0;
    for (const meeting of staleMeetings) {
      await this.connection
        .getRepository(ctx, BbbMeeting)
        .update(meeting.id as string, {
          attendeeJoinUrl: null,
          attendeeJoinUrlExpiresAt: null,
        });
      cleaned++;
    }
    return cleaned;
  }

  // ─── 6. W8 — Repair Recording URLs (missed rap-publish-ended webhooks) ──────
  // The `rap-publish-ended` webhook is the normal writer of `bbbRecordingId`
  // + `recordingUrl` (BbbMeetingService.handleWebhookEvent). If that delivery
  // is dropped — BBB retries for a few minutes then gives up — the recording
  // exists on BBB but the meeting row never gets its playback link. This pass
  // is the pull-side repair: `getRecordings` for completed, recording-enabled
  // meetings whose `recordingUrl` is still NULL, backfilled from BBB's own
  // answer (never invented — the URL only ever comes from the BBB response).
  //
  // Safety properties (W1/W5 rules, mirrored from the metering sampler):
  //  - BOUNDED: 72 h window, ≤ 20 candidates per pass (oldest completedAt
  //    first) — the rest is picked up by the next 5-min tick;
  //  - TYPED errors per meeting: notFound → nothing to repair (silent);
  //    unavailable → transient skip + de-duplicated ops alert, server health
  //    untouched; rejected/misconfigured → flagServerConfigProblem (the
  //    per-server config family) — getRecordings authenticates with the API
  //    secret only, so a rejection IS a server-level problem (unlike
  //    getMeetingInfo, whose moderator-password is a per-meeting concern);
  //  - no meeting-state, billing, or health side effects on the happy path;
  //    a failed pass repairs nothing and kills nothing.
  // Wire-up: the `bbb-reconciliation` scheduled task (6th pass).
  // runBbbReconciliation() deliberately stays at the original five passes —
  // its GraphQL result shape (BbbReconciliationResult) is unchanged.

  /** Only completed meetings from the last 72 h are repair candidates. */
  private static readonly RECORDING_REPAIR_WINDOW_MS = 72 * 60 * 60 * 1000;

  /** Hard cap per pass — oldest completed first; the rest wait for the next tick. */
  private static readonly RECORDING_REPAIR_BATCH = 20;

  async repairRecordings(): Promise<number> {
    const ctx = await this.ctxService.create({ apiType: "admin" });
    const cutoff = new Date(
      Date.now() - BbbReconciliationService.RECORDING_REPAIR_WINDOW_MS,
    );

    let candidates: BbbMeeting[];
    try {
      candidates = await this.connection
        .getRepository(ctx, BbbMeeting)
        .createQueryBuilder("meeting")
        .where("meeting.state = :state", { state: MEETING_STATE.COMPLETED })
        .andWhere("meeting.recordingEnabled = true")
        .andWhere("meeting.recordingUrl IS NULL")
        .andWhere("meeting.bbbMeetingId IS NOT NULL")
        .andWhere("meeting.serverId IS NOT NULL")
        .andWhere("meeting.completedAt >= :cutoff", { cutoff })
        .orderBy("meeting.completedAt", "ASC")
        .limit(BbbReconciliationService.RECORDING_REPAIR_BATCH)
        .getMany();
    } catch (err) {
      // Candidate loading is infrastructure, not a per-meeting verdict —
      // alert once per pass (deduped) and let the task record the failure.
      this.opsAlert.notify(
        "bbb-recording-repair",
        "pass",
        `Recording repair pass failed to load candidates: ${(err as Error).message}`,
      );
      throw err;
    }

    let repaired = 0;
    const serverCache = new Map<string, BbbServer | null>();
    for (const meeting of candidates) {
      const serverId = String(meeting.serverId);
      if (!serverCache.has(serverId)) {
        try {
          // findByIdWithSecret: encryptedApiSecret is select:false — every
          // adapter call decrypts it (same rule as the metering sampler).
          serverCache.set(
            serverId,
            await this.serverService.findByIdWithSecret(ctx, serverId),
          );
        } catch (err) {
          Logger.warn(
            `Recording repair: server ${serverId} load failed: ${(err as Error).message}`,
            loggerCtx,
          );
          continue;
        }
      }
      const server = serverCache.get(serverId) ?? null;
      if (!server) {
        Logger.warn(
          `Recording repair: server ${serverId} not found for meeting ${meeting.id}`,
          loggerCtx,
        );
        continue;
      }

      try {
        const recordings = await this.bbbApiService.getRecordings(
          server,
          meeting.bbbMeetingId,
        );
        const recording = recordings.find(
          (r) => r.meetingID === meeting.bbbMeetingId,
        );
        if (!recording) {
          // BBB answered SUCCESS with no recording row for this meeting —
          // nothing exists to repair yet; the candidate filter keeps the
          // row eligible for the next pass.
          continue;
        }
        if (!recording.playbackUrl) {
          // Recording exists but is not published yet (no playback URL):
          // link the recordID now for traceability; recordingUrl stays NULL
          // so the row remains a candidate until the playback URL appears.
          if (
            recording.recordID &&
            meeting.bbbRecordingId !== recording.recordID
          ) {
            await this.connection
              .getRepository(ctx, BbbMeeting)
              .update(meeting.id as string, {
                bbbRecordingId: recording.recordID,
              });
          }
          continue;
        }
        await this.connection
          .getRepository(ctx, BbbMeeting)
          .update(meeting.id as string, {
            bbbRecordingId: recording.recordID,
            recordingUrl: recording.playbackUrl,
          });
        repaired++;
        Logger.info(
          `Recording repaired for meeting ${meeting.id}: ${recording.recordID}`,
          loggerCtx,
        );
      } catch (err) {
        if (err instanceof BbbNotFoundError) {
          // No recording for this meeting on BBB — normal, not a failure.
          Logger.info(
            `Recording repair skipped for meeting ${meeting.id}: no recording on BBB`,
            loggerCtx,
          );
        } else if (err instanceof BbbUnavailableError) {
          // Transient (timeout/HTTP 5xx/malformed XML): retry next pass.
          // De-duplicated per server for 1 h so an outage alerts once.
          Logger.warn(
            `Recording repair skipped for meeting ${meeting.id}: ${(err as Error).message}`,
            loggerCtx,
          );
          this.opsAlert.notify(
            "bbb-recording-repair",
            `server-${serverId}`,
            `getRecordings unavailable during recording repair (server ${serverId}) — will retry next pass`,
            {
              serverId,
              meetingId: String(meeting.id),
              messageKey: err.messageKey,
            },
          );
        } else if (
          err instanceof BbbMisconfiguredError ||
          err instanceof BbbRejectedError
        ) {
          await this.flagServerConfigProblem(ctx, server, err);
        } else {
          Logger.error(
            `Recording repair failed for meeting ${meeting.id}: ${(err as Error).message}`,
            loggerCtx,
          );
          this.opsAlert.notify(
            "bbb-recording-repair",
            `server-${serverId}`,
            `Recording repair failed for meeting ${meeting.id} (server ${serverId}): ${(err as Error).message}`.substring(
              0,
              300,
            ),
            { serverId, meetingId: String(meeting.id) },
          );
        }
      }
    }
    if (candidates.length > 0) {
      Logger.info(
        `Recording repair: candidates=${candidates.length} repaired=${repaired}`,
        loggerCtx,
      );
    }
    return repaired;
  }
}
