import { Inject, Injectable } from "@nestjs/common";
import {
  EventBus,
  Logger,
  RequestContext,
  RequestContextService,
  TransactionalConnection,
} from "@vendure/core";
import { BbbMeeting } from "../entities/bbb-meeting.entity";
import { BbbCapacityGrant } from "../entities/bbb-capacity-grant.entity";
import { BbbUsageLedger } from "../entities/bbb-usage-ledger.entity";
import { BbbRoom } from "../entities/bbb-room.entity";
import { BbbServerService } from "./bbb-server.service";
import { BbbApiService, BbbNotFoundError } from "./bbb-api.service";
import { BbbEncryptionService } from "./bbb-encryption.service";
import { GrantConsumptionService } from "./bbb-grant-consumption.service";
import { MeetingLifecycleService } from "./bbb-meeting-lifecycle.service";
import { BbbMeteringService } from "./bbb-metering.service";
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
    const activeMeetings = await this.connection
      .getRepository(ctx, BbbMeeting)
      .createQueryBuilder("meeting")
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
        const grant = await this.connection
          .getRepository(ctx, BbbCapacityGrant)
          .findOne({ where: { id: meeting.grantId as string } });
        await this.connection
          .getRepository(ctx, BbbMeeting)
          .update(meeting.id as string, {
            billingCapped: true,
            billingCapReason: capReason,
            lastReconciledAt: new Date(),
            reconciliationAttemptCount: (meeting.reconciliationAttemptCount ?? 0) + 1,
          });
        await this.lifecycleService.completeMeetingLifecycle(ctx, meeting.id, {
          source: "reconciliation",
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

      // W1: only a CONFIRMED notFound means "meeting destroyed" → STALE.
      // Unavailable (outage) / Rejected (bad checksum) means "cannot prove it
      // is gone" → skip this pass, never stale, never forfeit billing.
      // BBB requires the moderator password on getMeetingInfo (API-Mate
      // capture), so load it — without it every call would checksum-fail.
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
      try {
        await this.bbbApiService.getMeetingInfo(
          server,
          meeting.bbbMeetingId,
          moderatorPW,
        );
      } catch (err) {
        if (err instanceof BbbNotFoundError) {
          // Meeting is permanently unreachable on BBB — mark as STALE instead
          // of completing, so no BbbUsageLedger is written.
          await this.lifecycleService.markMeetingStale(
            ctx,
            meeting,
            "BBB getMeetingInfo notFound — meeting destroyed or expired",
          );
          reconciled++;
          Logger.info(
            `Reconciled meeting ${meeting.id}: marked as Stale (BBB missing)`,
            loggerCtx,
          );
        } else {
          // Transient outage or config rejection — skip this pass.
          Logger.warn(
            `Reconcile skipped for meeting ${meeting.id}: ${(err as Error).message}`,
            loggerCtx,
          );
        }
      }
    }
    return reconciled;
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
}
