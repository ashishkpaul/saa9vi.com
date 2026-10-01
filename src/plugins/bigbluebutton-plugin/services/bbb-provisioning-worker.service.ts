import { Injectable, Inject, forwardRef, OnModuleInit } from "@nestjs/common";
import {
  EventBus,
  ID,
  JobQueue,
  JobQueueService,
  Logger,
  RequestContext,
  SerializedRequestContext,
  TransactionalConnection,
} from "@vendure/core";
import * as crypto from "crypto";
import { BbbMeeting } from "../entities/bbb-meeting.entity";
import { BbbOrganization } from "../entities/bbb-organization.entity";
import { BbbCapacityGrant } from "../entities/bbb-capacity-grant.entity";
import { BbbApiService } from "./bbb-api.service";
import { BbbEncryptionService } from "./bbb-encryption.service";
import { BbbServerSelectionService } from "./bbb-server-selection.service";
import { BbbMetricsService } from "./bbb-metrics.service";
import { BbbRoomService } from "./bbb-room.service";
import { BbbProvisioningEnqueuer } from "./bbb-provisioning-enqueuer";
import {
  MeetingProvisionedEvent,
  MeetingFailedEvent,
} from "../events/bbb-events";
import { BBB_PROVISIONING_QUEUE, BILLING_MODE, MEETING_STATE } from "../constants";
import {
  PROVISIONING_ALLOWANCE_EXHAUSTED_ERROR,
  TENANT_SELECTABLE_SOURCE_TYPES,
  grantUnavailableReason,
  hasProvisionableMinutes,
} from "./grant-selection.policy";
import { BbbMeteringService } from "./bbb-metering.service";
import {
  computeMonthChargePaise,
  isMeteredOrganization,
  monthOf,
} from "./metered-billing.policy";

const loggerCtx = "BbbProvisioningWorkerService";

export interface ProvisioningJobData {
  serializedCtx: SerializedRequestContext;
  meetingId: ID;
}

@Injectable()
export class BbbProvisioningWorkerService
  implements OnModuleInit, BbbProvisioningEnqueuer
{
  private provisioningQueue: JobQueue<ProvisioningJobData>;

  constructor(
    private readonly connection: TransactionalConnection,
    private readonly jobQueueService: JobQueueService,
    private readonly bbbApiService: BbbApiService,
    private readonly serverSelectionService: BbbServerSelectionService,
    private readonly encryptionService: BbbEncryptionService,
    private readonly metrics: BbbMetricsService,
    private readonly eventBus: EventBus,
    private readonly meteringService: BbbMeteringService,
    @Inject(forwardRef(() => BbbRoomService))
    private readonly roomService: BbbRoomService,
  ) {}

  async onModuleInit() {
    this.provisioningQueue =
      await this.jobQueueService.createQueue<ProvisioningJobData>({
        name: BBB_PROVISIONING_QUEUE,
        process: async (job) => {
          const { serializedCtx, meetingId } = job.data;
          const ctx = RequestContext.deserialize(serializedCtx);
          await this.doProvisionMeeting(ctx, meetingId, job.id as string);
        },
      });
  }

  async enqueueProvisioning(ctx: RequestContext, meetingId: ID): Promise<void> {
    if (!this.provisioningQueue) {
      await this.onModuleInit();
    }
    await this.provisioningQueue.add({
      serializedCtx: ctx.serialize(),
      meetingId,
    });
    Logger.info(`Enqueued provisioning job for meeting ${meetingId}`, loggerCtx);
  }

  /**
   * Atomically reserves capacity for promotion to PROVISIONING.
   *
   * Runs in one transaction: pessimistic-locks the organization row, counts
   * existing PROVISIONING + ACTIVE meetings, and — only if under the org's
   * concurrentMeetingLimit — flips the meeting to PROVISIONING. Returns false
   * (and leaves the meeting PENDING) when the cap is reached, so concurrent
   * promotions can never push the live count past the configured limit.
   */
  private async reserveProvisioningCapacity(
    ctx: RequestContext,
    meeting: BbbMeeting,
  ): Promise<boolean> {
    const orgId = String(meeting.organization.id);
    const meetingId = String(meeting.id);
    return this.connection.withTransaction(ctx, async (tx) => {
      const org = await this.connection
        .getRepository(tx, BbbOrganization)
        .createQueryBuilder("org")
        .setLock("pessimistic_write")
        .where("org.id = :id", { id: orgId })
        .getOne();
      if (!org) return false;

      const raw = await this.connection
        .getRepository(tx, BbbMeeting)
        .createQueryBuilder("meeting")
        .select("COUNT(meeting.id)", "count")
        .where("meeting.organizationId = :orgId", { orgId })
        .andWhere("meeting.state IN (:...states)", {
          states: [MEETING_STATE.PROVISIONING, MEETING_STATE.ACTIVE],
        })
        .getRawOne<{ count: string }>();
      const live = parseInt(raw?.count ?? "0", 10);
      if (live >= org.concurrentMeetingLimit) return false;

      await this.connection
        .getRepository(tx, BbbMeeting)
        .update(meetingId, { state: MEETING_STATE.PROVISIONING });
      return true;
    });
  }
  async doProvisionMeeting(
    ctx: RequestContext,
    meetingId: ID,
    _jobId: string | number,
  ): Promise<void> {
    const startedAt = Date.now();
    const meeting = await this.connection
      .getRepository(ctx, BbbMeeting)
      .findOne({
        where: { id: meetingId as string },
        relations: ["organization"],
      });

    if (!meeting) {
      Logger.error(
        `Meeting ${meetingId} not found in provisioning worker`,
        loggerCtx,
      );
      return;
    }

    if (meeting.state !== MEETING_STATE.PENDING) {
      Logger.warn(
        `Meeting ${meetingId} is in state ${meeting.state}, skipping provisioning`,
        loggerCtx,
      );
      return;
    }

    // Atomic, capacity-gated promotion PENDING → PROVISIONING.
    // Guards the invariant that (PROVISIONING + ACTIVE) never exceeds the
    // org's concurrentMeetingLimit. Because promotion is what enters
    // PROVISIONING, the pessimistic lock + count + state change must share a
    // single transaction. Otherwise many PENDING meetings pushed by concurrent
    // creation could each promote past the cap as they are processed.
    const promoted = await this.reserveProvisioningCapacity(ctx, meeting);
    if (!promoted) {
      Logger.warn(
        `Meeting ${meetingId} remains PENDING — concurrent meeting limit reached for org ${String(meeting.organization.id)}`,
        loggerCtx,
      );
      return;
    }

    try {
      // ADR-047 Phase 2B - metered orgs skip grant selection entirely (INV-028:
      // the grant path is dormant for metered orgs). Postpaid exposure guards
      // (suspended / spend-limit) run inside the same try so failures flow
      // through the uniform catch below. grantId stays null for metered
      // meetings; server selection and capacity reservation are unchanged.
      if (isMeteredOrganization(meeting.organization)) {
        await this.assertMeteredProvisionable(ctx, meeting);
      }
      const server = await this.serverSelectionService.selectServer(ctx);
      if (!server) {
        throw new Error("No healthy BBB server available");
      }

      // Resolve the active grant at provisioning time — immutable linkage.
      // BUG-036: selection is restricted to tenant-selectable source types
      // (`internal_overhead` is ops headroom, not an allowance) and the minutes
      // gate honours `isUnbounded` through the shared policy helper.
      // Skipped for metered orgs (no grant row is read or consumed).
      // `null` is the metered-path value (the column is nullable); the grant
      // block below only assigns on the non-metered path.
      let grant: BbbCapacityGrant | null = null;
      if (!isMeteredOrganization(meeting.organization)) {
        const grantRepo = this.connection.getRepository(ctx, BbbCapacityGrant);
        const now = new Date();
        grant = await grantRepo
          .createQueryBuilder("grant")
          .where("grant.organizationId = :orgId", {
            orgId: meeting.organization.id,
          })
          .andWhere("grant.exhausted = :exhausted", { exhausted: false })
          .andWhere("grant.sourceType IN (:...sourceTypes)", {
            sourceTypes: [...TENANT_SELECTABLE_SOURCE_TYPES],
          })
          .andWhere("grant.validFrom <= :now", { now })
          .andWhere("grant.validUntil >= :now", { now })
          .orderBy("grant.validUntil", "ASC")
          .addOrderBy("grant.createdAt", "ASC")
          .getOne();

        if (!grant) {
          // Distinguish "exhausted allowance" from "no allowance at all": an
          // exhausted commercial grant is excluded from selection above, so
          // without this probe the caller would be told nothing exists.
          const unusableCommercialGrants = await grantRepo
            .createQueryBuilder("grant")
            .where("grant.organizationId = :orgId", {
              orgId: meeting.organization.id,
            })
            .andWhere("grant.sourceType IN (:...sourceTypes)", {
              sourceTypes: [...TENANT_SELECTABLE_SOURCE_TYPES],
            })
            .andWhere("grant.exhausted = :exhausted", { exhausted: true })
            .andWhere("grant.validFrom <= :now", { now })
            .andWhere("grant.validUntil >= :now", { now })
            .getCount();

          throw new Error(grantUnavailableReason(unusableCommercialGrants > 0));
        }

        // isUnbounded grants are Infinity (matching GrantReaderService), so their
        // `grantedMinutes: -1` sentinel no longer fails this gate.
        if (!hasProvisionableMinutes(grant)) {
          throw new Error(PROVISIONING_ALLOWANCE_EXHAUSTED_ERROR);
        }
      }

      const bbbMeetingId = `bbb-${meeting.id}`;
      const attendeePW = crypto.randomUUID().replace(/-/g, "").substring(0, 16);
      const moderatorPW = crypto
        .randomUUID()
        .replace(/-/g, "")
        .substring(0, 16);

      const { internalMeetingID } = await this.bbbApiService.createMeeting(
        server,
        {
          meetingID: bbbMeetingId,
          name: meeting.title,
          attendeePW,
          moderatorPW,
          record: meeting.recordingEnabled,
          autoStartRecording: false,
          allowStartStopRecording: true,
          maxParticipants: meeting.organization.maxParticipantsPerMeeting,
          logoutURL: process.env.STOREFRONT_URL
            ? `${process.env.STOREFRONT_URL}/bbb-logout`
            : undefined,
        },
      );

      const encryptedAttendeePW = this.encryptionService.encrypt(attendeePW);
      const encryptedModeratorPW = this.encryptionService.encrypt(moderatorPW);

      await this.connection
        .getRepository(ctx, BbbMeeting)
        .update(meetingId as string, {
          bbbMeetingId,
          bbbInternalMeetingId: internalMeetingID,
          serverId: server.id as string,
          grantId: grant ? (grant.id as string) : null,
          encryptedAttendeePassword: encryptedAttendeePW,
          encryptedModeratorPassword: encryptedModeratorPW,
          state: MEETING_STATE.ACTIVE,
          provisionedAt: new Date(),
        });

      this.metrics.recordProvisioningSucceeded(Date.now() - startedAt);
      Logger.info(
        `Meeting ${meetingId} provisioned → BBB meetingID: ${bbbMeetingId} (grantId: ${grant ? String(grant.id) : 'metered'})`,
        loggerCtx,
      );

      this.eventBus.publish(
        new MeetingProvisionedEvent(
          ctx,
          meetingId as string,
          bbbMeetingId,
          meeting.roomId ?? null,
          meeting.organization.id as string,
          grant ? (grant.id as string) : null,
        ),
      );

      if (meeting.roomId) {
        await this.roomService.onMeetingActive(ctx, meeting.roomId, meetingId);
      }
    } catch (err) {
      const msg = (err as Error).message;
      this.metrics.recordProvisioningFailed();
      Logger.error(
        `Provisioning failed for meeting ${meetingId}: ${msg}`,
        loggerCtx,
      );

      await this.connection
        .getRepository(ctx, BbbMeeting)
        .update(meetingId as string, {
          state: MEETING_STATE.FAILED,
          failureReason: msg,
          retryCount: (meeting.retryCount ?? 0) + 1,
        });

      this.eventBus.publish(
        new MeetingFailedEvent(
          meetingId as string,
          meeting.roomId ?? null,
          meeting.organization.id as string,
          msg,
          (meeting.retryCount ?? 0) + 1,
        ),
      );

      if (meeting.roomId) {
        await this.roomService.onMeetingFailed(ctx, meeting.roomId);
      }
    }
  }
  /**
   * ADR-047 Phase 2B - postpaid exposure guards for metered organizations.
   *
   * Runs INSIDE the provisioning try block so a rejection flows through the
   * uniform catch (FAILED + failureReason + MeetingFailedEvent +
   * roomService.onMeetingFailed). Two guards, both readable:
   *   1. suspended orgs never provision;
   *   2. when monthlySpendLimitPaise is set, the month-to-date metered charge
   *      (via the SINGLE computeMonthChargePaise implementation - D2) at or
   *      over the limit rejects the meeting.
   */
  private async assertMeteredProvisionable(
    ctx: RequestContext,
    meeting: BbbMeeting,
  ): Promise<void> {
    const org = meeting.organization as {
      suspended?: boolean;
      monthlySpendLimitPaise?: number | null;
      id?: unknown;
    };
    if (org?.suspended) {
      throw new Error(
        "This organization is suspended. Please contact support to restore service.",
      );
    }
    const limit = org?.monthlySpendLimitPaise;
    if (limit === null || limit === undefined) return;
    const rows = await this.meteringService.monthUsageRows(
      ctx,
      String(meeting.organization.id),
      monthOf(new Date()),
    );
    const monthCharge = computeMonthChargePaise(rows);
    if (monthCharge >= limit) {
      throw new Error(
        `Monthly spend limit reached (${limit} paise). Please contact support to raise the limit.`,
      );
    }
  }
}
