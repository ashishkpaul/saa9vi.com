import { Inject, Injectable, forwardRef } from "@nestjs/common";
import {
  EventBus,
  Logger,
  RequestContext,
  RequestContextService,
  TransactionalConnection,
} from "@vendure/core";
import { EntityManager } from "typeorm";
import { BbbMeeting } from "../entities/bbb-meeting.entity";
import { BbbCapacityGrant } from "../entities/bbb-capacity-grant.entity";
import { BbbUsageLedger } from "../entities/bbb-usage-ledger.entity";
import { BbbRoom } from "../entities/bbb-room.entity";
import { BbbServerService } from "./bbb-server.service";
import { BbbApiService } from "./bbb-api.service";
import { BbbMeetingService } from "./bbb-meeting.service";
import {
  GrantConsumedEvent,
  CapacityExhaustedEvent,
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
    @Inject(forwardRef(() => BbbMeetingService))
    private readonly meetingService: BbbMeetingService,
    private readonly eventBus: EventBus,
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

  /** Minimum meeting duration (ms) before billing is applied */
  private get fairBillingMinDurationMs(): number {
    return this.options.fairBillingMinDurationMs ?? 120_000; // 2 min
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
        await this.meetingService.completeMeetingLifecycle(ctx, meeting.id, {
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

      const info = await this.bbbApiService.getMeetingInfo(
        server,
        meeting.bbbMeetingId,
      );

      // getMeetingInfo returns null when the meeting has been fully destroyed
      // on BBB. isMeetingRunning() returns false for meetings with no joiners
      // yet (hasUserJoined=false), so we must NOT use it here — it would
      // prematurely complete perfectly valid meetings that are waiting for
      // their first participant to join.
      if (info === null) {
        // Meeting is permanently unreachable on BBB — mark as STALE instead
        // of completing, so no BbbUsageLedger is written.
        await this.meetingService.markMeetingStale(
          ctx,
          meeting,
          "BBB getMeetingInfo returned null — meeting destroyed or expired",
        );
        reconciled++;
        Logger.info(
          `Reconciled meeting ${meeting.id}: marked as Stale (BBB missing)`,
          loggerCtx,
        );
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

  // ─── 3. Consume Grant Minutes (Transactional) ────────────────────────────────

  async consumeGrantHours(
    ctx: RequestContext,
    meeting: BbbMeeting,
  ): Promise<void> {
    if (!meeting.provisionedAt) {
      Logger.warn(
        `Meeting ${meeting.id} has no provisionedAt — cannot bill consumption`,
        loggerCtx,
      );
      return;
    }

    if (!meeting.grantId) {
      Logger.warn(
        `Meeting ${meeting.id} has no grantId stored — was it provisioned before the grantId column existed?`,
        loggerCtx,
      );
      return;
    }

    const provisionedAt = meeting.provisionedAt;
    const endedAt = meeting.completedAt ?? new Date();
    const durationMs = endedAt.getTime() - provisionedAt.getTime();

    // Fair billing guard: skip billing for micro-sessions under threshold.
    if (durationMs < this.fairBillingMinDurationMs) {
      Logger.info(
        `Meeting ${meeting.id} lasted less than fair billing threshold (${Math.round(durationMs / 1000)}s). Skipping billing.`,
        loggerCtx,
      );
      return;
    }

    // Billing ceiling: cap duration if the meeting was force-completed.
    const effectiveDurationMs = meeting.billingCapped
      ? Math.min(durationMs, this.maxMeetingDurationMs)
      : durationMs;

    // Round up to nearest minute; minimum 1 minute.
    const durationMinutes = Math.max(1, Math.ceil(effectiveDurationMs / (1000 * 60)));

    const grant = await this.connection
      .getRepository(ctx, BbbCapacityGrant)
      .findOne({ where: { id: meeting.grantId as string } });

    if (!grant) {
      Logger.warn(
        `Meeting ${meeting.id}: stored grantId ${meeting.grantId} not found`,
        loggerCtx,
      );
      return;
    }

    // Transactional: ledger + grant update must succeed or fail together
    await this.connection.rawConnection.transaction(
      async (em: EntityManager) => {
        const existing = await em.getRepository(BbbUsageLedger).findOne({
          where: {
            meeting: { id: meeting.id as string } as any,
            grant: { id: grant.id as string } as any,
          },
        });

        if (existing) {
          Logger.warn(
            `Meeting ${meeting.id}: billing ledger entry already exists. Skipping duplicate.`,
            loggerCtx,
          );
          return;
        }

        await em.getRepository(BbbUsageLedger).save(
          new BbbUsageLedger({
            meeting,
            grant,
            consumedMinutes: durationMinutes,
            startedAt: provisionedAt,
            completedAt: endedAt,
          }),
        );

        // internal_overhead grants: write ledger row only, skip exhaustion logic
        if (grant.sourceType === "internal_overhead") {
          return;
        }

        // Atomic increment on minutes columns
        await em
          .getRepository(BbbCapacityGrant)
          .createQueryBuilder()
          .update()
          .set({
            consumedMinutes: () => `"consumedMinutes" + :increment`,
            exhausted: () =>
              `CASE WHEN ("consumedMinutes" + :increment) >= "grantedMinutes" THEN TRUE ELSE FALSE END`,
          })
          .where("id = :id", { id: grant.id as string })
          .setParameters({ increment: durationMinutes })
          .execute();
      },
    );

    Logger.info(
      `Billed meeting ${meeting.id}: ${durationMinutes}min consumed${meeting.billingCapped ? " (CAPPED)" : ""} (${(grant.consumedMinutes ?? 0) + durationMinutes}/${grant.grantedMinutes}min)`,
      loggerCtx,
    );

    // internal_overhead grants don't participate in quota alerts
    if (grant.sourceType === "internal_overhead") {
      return;
    }

    const remainingMinutes =
      (grant.grantedMinutes ?? 0) - ((grant.consumedMinutes ?? 0) + durationMinutes);
    this.eventBus.publish(
      new GrantConsumedEvent(
        grant.id as string,
        meeting.id as string,
        (grant.organization?.id as string) ?? "",
        durationMinutes,
        Math.max(0, remainingMinutes),
      ),
    );
  }

  // ─── 4. Reconcile Room State Drift ──────────────────────────────────────────

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
