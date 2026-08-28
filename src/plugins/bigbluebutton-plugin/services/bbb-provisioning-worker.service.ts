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
import { BbbCapacityGrant } from "../entities/bbb-capacity-grant.entity";
import { BbbApiService } from "./bbb-api.service";
import { BbbEncryptionService } from "./bbb-encryption.service";
import { BbbServerSelectionService } from "./bbb-server-selection.service";
import { BbbMetricsService } from "./bbb-metrics.service";
import { BbbRoomService } from "./bbb-room.service";
import {
  MeetingProvisionedEvent,
  MeetingFailedEvent,
} from "../events/bbb-events";
import { BBB_PROVISIONING_QUEUE, MEETING_STATE } from "../constants";

const loggerCtx = "BbbProvisioningWorkerService";

export interface ProvisioningJobData {
  serializedCtx: SerializedRequestContext;
  meetingId: ID;
}

@Injectable()
export class BbbProvisioningWorkerService implements OnModuleInit {
  private provisioningQueue: JobQueue<ProvisioningJobData>;

  constructor(
    private readonly connection: TransactionalConnection,
    private readonly jobQueueService: JobQueueService,
    private readonly bbbApiService: BbbApiService,
    private readonly serverSelectionService: BbbServerSelectionService,
    private readonly encryptionService: BbbEncryptionService,
    private readonly metrics: BbbMetricsService,
    private readonly eventBus: EventBus,
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

    await this.connection
      .getRepository(ctx, BbbMeeting)
      .update(meetingId as string, {
        state: MEETING_STATE.PROVISIONING,
      });

    try {
      const server = await this.serverSelectionService.selectServer(ctx);
      if (!server) {
        throw new Error("No healthy BBB server available");
      }

      // Resolve the active grant at provisioning time — immutable linkage
      const grant = await this.connection
        .getRepository(ctx, BbbCapacityGrant)
        .createQueryBuilder("grant")
        .where("grant.organizationId = :orgId", {
          orgId: meeting.organization.id,
        })
        .andWhere("grant.exhausted = :exhausted", { exhausted: false })
        .andWhere("grant.validFrom <= :now", { now: new Date() })
        .andWhere("grant.validUntil >= :now", { now: new Date() })
        .orderBy("grant.validUntil", "ASC")
        .addOrderBy("grant.createdAt", "ASC")
        .getOne();

      if (!grant) {
        throw new Error(
          "No active capacity grant found for this organization. Please purchase or renew a plan.",
        );
      }

      const remainingMinutes =
        (grant.grantedMinutes ?? 0) - (grant.consumedMinutes ?? 0);
      if (remainingMinutes <= 0) {
        throw new Error("No minutes remaining on plan");
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
          grantId: grant.id as string,
          encryptedAttendeePassword: encryptedAttendeePW,
          encryptedModeratorPassword: encryptedModeratorPW,
          state: MEETING_STATE.ACTIVE,
          provisionedAt: new Date(),
        });

      this.metrics.recordProvisioningSucceeded(Date.now() - startedAt);
      Logger.info(
        `Meeting ${meetingId} provisioned → BBB meetingID: ${bbbMeetingId} (grantId: ${grant.id})`,
        loggerCtx,
      );

      this.eventBus.publish(
        new MeetingProvisionedEvent(
          meetingId as string,
          bbbMeetingId,
          meeting.roomId ?? null,
          meeting.organization.id as string,
          grant.id as string,
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
}
