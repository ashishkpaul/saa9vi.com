import { Inject, Injectable, forwardRef } from "@nestjs/common";
import {
  ID,
  Logger,
  RequestContext,
  TransactionalConnection,
} from "@vendure/core";
import { BbbRoom, RoomState } from "../entities/bbb-room.entity";
import { BbbMeeting } from "../entities/bbb-meeting.entity";
import { BbbOrganization } from "../entities/bbb-organization.entity";
import { MEETING_STATE } from "../constants";
import { BBB_PLUGIN_OPTIONS } from "../constants";
import { BbbRoomLockService } from "./bbb-room-lock.service";
import { BbbServerService } from "./bbb-server.service";
import { BbbApiService } from "./bbb-api.service";
import { BbbMetricsService } from "./bbb-metrics.service";
import { BbbChannelAccessService } from "./bbb-channel-access.service";
import { BbbMeetingService } from "./bbb-meeting.service";
import { RoomActivatedEvent } from "../events/bbb-events";
import { EventBus } from "@vendure/core";
import type { BigBlueButtonPluginOptions } from "../types";

const loggerCtx = "BbbRoomService";

export interface CreateRoomInput {
  organizationId: ID;
  name: string;
  description?: string;
  slug?: string;
  recordingEnabled?: boolean;
  maxParticipants?: number;
  createdByCustomerId?: string;
}

export type JoinRoomStatus = "active" | "provisioning" | "failed";

export interface RequestProvisioningResult {
  status: JoinRoomStatus;
  /** Present only when status === 'active' */
  currentMeetingId?: string;
}

@Injectable()
export class BbbRoomService {
  constructor(
    private readonly connection: TransactionalConnection,
    private readonly lockService: BbbRoomLockService,
    private readonly serverService: BbbServerService,
    private readonly bbbApiService: BbbApiService,
    private readonly metrics: BbbMetricsService,
    private readonly eventBus: EventBus,
    private readonly channelAccess: BbbChannelAccessService,
    @Inject(forwardRef(() => BbbMeetingService))
    private readonly meetingService: BbbMeetingService,
    @Inject(BBB_PLUGIN_OPTIONS)
    private readonly options: BigBlueButtonPluginOptions,
  ) {}

  /** Debounce window: ignore re-provision requests within this many ms */
  private get provisionDebounceMs(): number {
    return this.options.provisionDebounceMs ?? 15_000;
  }

  /** Short TTL for BBB runtime validation to avoid hammering BBB APIs */
  private get runtimeValidationTtlMs(): number {
    return this.options.runtimeValidationTtlMs ?? 10_000;
  }

  /** Max auto-retries before room requires manual reset */
  private get maxAutoRetries(): number {
    return this.options.maxAutoRetries ?? 3;
  }

  /** Grace period: trust local DB within this many ms after provisioning */
  private get meetingGracePeriodMs(): number {
    return this.options.meetingGracePeriodMs ?? 90_000;
  }

  async findAll(
    ctx: RequestContext,
    orgId: ID,
    options?: { skip?: number; take?: number },
  ): Promise<{ items: BbbRoom[]; totalItems: number }> {
    await this.channelAccess.assertOrganizationAccess(ctx, orgId);
    const take = Math.min(Math.max(options?.take ?? 25, 1), 100);
    const skip = Math.max(options?.skip ?? 0, 0);
    const [items, totalItems] = await this.connection
      .getRepository(ctx, BbbRoom)
      .findAndCount({
        where: { organization: { id: orgId as string } },
        order: { createdAt: "DESC" },
        skip,
        take,
      });
    return { items, totalItems };
  }

  async create(ctx: RequestContext, input: CreateRoomInput): Promise<BbbRoom> {
    await this.channelAccess.assertOrganizationAccess(ctx, input.organizationId);
    const org = await this.connection.getEntityOrThrow(
      ctx,
      BbbOrganization,
      input.organizationId,
    );
    const room = new BbbRoom({
      organization: org,
      name: input.name,
      description: input.description ?? null,
      slug: input.slug ?? null,
      recordingEnabled: input.recordingEnabled ?? org.recordingEnabled,
      maxParticipants: input.maxParticipants ?? org.maxParticipantsPerMeeting,
      createdByCustomerId: input.createdByCustomerId ?? null,
      state: "Idle",
      retryCount: 0,
    });
    return this.connection.getRepository(ctx, BbbRoom).save(room);
  }

  async findById(ctx: RequestContext, id: ID): Promise<BbbRoom | null> {
    const room = await this.connection.getRepository(ctx, BbbRoom).findOne({
      where: { id: id as string },
      relations: ["organization"],
    });
    if (!room) return null;
    await this.channelAccess.assertRoomAccess(ctx, id);
    return room;
  }

  async findByOrganization(ctx: RequestContext, orgId: ID): Promise<BbbRoom[]> {
    return this.connection.getRepository(ctx, BbbRoom).find({
      where: { organization: { id: orgId as string } },
      order: { createdAt: "DESC" },
    });
  }

  private lifecyclePrefix(
    roomId: ID | string,
    meetingId?: string | null,
  ): string {
    return `[Room ${roomId}][Meeting ${meetingId ?? "-"}][Lifecycle]`;
  }

  /**
   * Acquires a distributed Redis lock then runs a pessimistic-write DB
   * transaction to atomically transition Idle → Provisioning.
   */
  async requestProvisioning(
    ctx: RequestContext,
    roomId: ID,
  ): Promise<RequestProvisioningResult & { shouldEnqueue: boolean }> {
    const result = await this.lockService.withLock(roomId, () =>
      this._doRequestProvisioning(ctx, roomId),
    );

    if (result === null) {
      Logger.debug(
        `${this.lifecyclePrefix(roomId)} distributed lock held, already provisioning`,
        loggerCtx,
      );
      return { status: "provisioning", shouldEnqueue: false };
    }

    return result;
  }

  private async validateRuntimeMeeting(
    ctx: RequestContext,
    room: BbbRoom,
    meeting: BbbMeeting,
  ): Promise<boolean> {
    const prefix = this.lifecyclePrefix(room.id, meeting.id as string);
    const validatedAt = room.lastRuntimeValidatedAt?.getTime() ?? 0;
    if (Date.now() - validatedAt < this.runtimeValidationTtlMs) {
      return true;
    }

    if (!meeting.bbbMeetingId || !meeting.serverId) {
      this.metrics.recordRuntimeValidationFailed();
      Logger.warn(
        `${prefix} runtime validation failed: active meeting missing BBB identifiers`,
        loggerCtx,
      );
      return false;
    }

    const server = await this.serverService.findByIdWithSecret(
      ctx,
      meeting.serverId,
    );
    if (!server) {
      this.metrics.recordRuntimeValidationFailed();
      Logger.warn(
        `${prefix} runtime validation failed: BBB server not found`,
        loggerCtx,
      );
      return false;
    }

    const stillRunning = await this.bbbApiService.isMeetingRunning(
      server,
      meeting.bbbMeetingId,
    );

    if (!stillRunning) {
      this.metrics.recordRuntimeValidationFailed();
      return false;
    }

    await this.connection
      .getRepository(ctx, BbbRoom)
      .update(room.id as string, {
        lastRuntimeValidatedAt: new Date(),
      });
    room.lastRuntimeValidatedAt = new Date();
    return true;
  }

  private async _doRequestProvisioning(
    ctx: RequestContext,
    roomId: ID,
  ): Promise<RequestProvisioningResult & { shouldEnqueue: boolean }> {
    // ─────────────────────────────────────────────────────────────
    // Phase 1: transactional state read only
    // NO BBB network calls inside transaction
    // ─────────────────────────────────────────────────────────────

    const initial = await this.connection.rawConnection.transaction(
      async (manager) => {
        const room = await manager.findOne(BbbRoom, {
          where: { id: roomId as string },
          lock: { mode: "pessimistic_write" },
        });

        if (!room) {
          throw new Error(`Room ${roomId} not found`);
        }

        // Already provisioning
        if (room.state === "Provisioning") {
          return {
            type: "provisioning" as const,
          };
        }

        // Failed beyond retry budget
        if (room.state === "Failed" && room.retryCount >= this.maxAutoRetries) {
          return {
            type: "failed" as const,
          };
        }

        // Debounce rapid clicks on non-Active rooms only.
        // Active rooms bypass debounce so a user who joins within the
        // debounce window of provisioning completing gets their join URL
        // immediately rather than incorrectly returning status=provisioning.
        if (room.state !== "Active" && room.lastProvisionRequestedAt) {
          const elapsed = Date.now() - room.lastProvisionRequestedAt.getTime();

          if (elapsed < this.provisionDebounceMs) {
            Logger.debug(
              `${this.lifecyclePrefix(room.id, room.currentMeetingId)} debounced (${elapsed}ms since last request)`,
              loggerCtx,
            );

            return {
              type: "provisioning" as const,
            };
          }
        }

        // Active room
        if (room.state === "Active") {
          if (!room.currentMeetingId) {
            Logger.warn(
              `${this.lifecyclePrefix(room.id)} active room missing currentMeetingId`,
              loggerCtx,
            );

            return {
              type: "stale-room" as const,
            };
          }

          const existingMeeting = await manager.findOne(BbbMeeting, {
            where: { id: room.currentMeetingId },
          });

          return {
            type: "active-room" as const,
            room,
            existingMeeting,
          };
        }

        // Idle path → transition to provisioning
        room.state = "Provisioning";
        room.currentMeetingId = null;
        room.lastRuntimeValidatedAt = null;
        room.lastProvisionRequestedAt = new Date();

        await manager.save(room);

        return {
          type: "enqueue" as const,
        };
      },
    );

    // ─────────────────────────────────────────────────────────────
    // Fast exits
    // ─────────────────────────────────────────────────────────────

    if (initial.type === "provisioning") {
      return {
        status: "provisioning",
        shouldEnqueue: false,
      };
    }

    if (initial.type === "failed") {
      return {
        status: "failed",
        shouldEnqueue: false,
      };
    }

    if (initial.type === "enqueue") {
      return {
        status: "provisioning",
        shouldEnqueue: true,
      };
    }

    if (initial.type === "stale-room") {
      return {
        status: "provisioning",
        shouldEnqueue: true,
      };
    }

    // ─────────────────────────────────────────────────────────────
    // Active room validation path
    // BBB network call OUTSIDE transaction
    // ─────────────────────────────────────────────────────────────

    if (initial.type === "active-room") {
      const { room, existingMeeting } = initial;

      const prefix = this.lifecyclePrefix(room.id, room.currentMeetingId);

      // Missing meeting row
      if (!existingMeeting) {
        this.metrics.recordStaleActiveDetected();

        Logger.warn(
          `${prefix} active room references missing meeting`,
          loggerCtx,
        );

        await this.connection
          .getRepository(ctx, BbbRoom)
          .update(room.id as string, {
            state: "Idle",
            currentMeetingId: null,
            lastRuntimeValidatedAt: null,
          });

        this.metrics.recordStaleActiveRecovered();
        this.metrics.recordReprovisionTriggered();

        return {
          status: "provisioning",
          shouldEnqueue: true,
        };
      }

      // DB already says inactive
      if (existingMeeting.state !== MEETING_STATE.ACTIVE) {
        this.metrics.recordStaleActiveDetected();

        Logger.warn(
          `${prefix} room references non-active meeting (${existingMeeting.state})`,
          loggerCtx,
        );

        await this.connection
          .getRepository(ctx, BbbRoom)
          .update(room.id as string, {
            state: "Idle",
            currentMeetingId: null,
            lastRuntimeValidatedAt: null,
          });

        this.metrics.recordStaleActiveRecovered();
        this.metrics.recordReprovisionTriggered();

        return {
          status: "provisioning",
          shouldEnqueue: true,
        };
      }

      // Runtime validation TTL cache
      const validatedAt = room.lastRuntimeValidatedAt?.getTime() ?? 0;

      if (Date.now() - validatedAt < this.runtimeValidationTtlMs) {
        return {
          status: "active",
          currentMeetingId: room.currentMeetingId ?? undefined,
          shouldEnqueue: false,
        };
      }

      // ─── GRACE PERIOD ─────────────────────────────────────────────
      // Do not interrogate the BBB API if the meeting was created less
      // than the grace period ago. BBB needs time to provision meeting
      // context. Trust the local DB state during this window.
      const meetingAgeMs =
        Date.now() -
        (existingMeeting.provisionedAt?.getTime() ??
          existingMeeting.createdAt.getTime());
      if (meetingAgeMs < this.meetingGracePeriodMs) {
        return {
          status: "active",
          currentMeetingId: room.currentMeetingId ?? undefined,
          shouldEnqueue: false,
        };
      }
      // ──────────────────────────────────────────────────────────────

      // BBB runtime validation (outside transaction)
      const runtimeRunning = await this.validateRuntimeMeeting(
        ctx,
        room,
        existingMeeting,
      );

      if (runtimeRunning) {
        return {
          status: "active",
          currentMeetingId: room.currentMeetingId ?? undefined,
          shouldEnqueue: false,
        };
      }

      // ───────────────────────────────────────────────────────────
      // Runtime stale → reconcile in short transaction
      // ───────────────────────────────────────────────────────────

      this.metrics.recordStaleActiveDetected();

      Logger.warn(`${prefix} BBB runtime reports meeting ended`, loggerCtx);

      // completeMeetingLifecycle manages its own transaction internally.
      // Wrapping it in another transaction would create a nested transaction
      // anti-pattern that TypeORM handles poorly (the inner transaction gets
      // a separate connection from the pool, breaking isolation).
      await this.meetingService.completeMeetingLifecycle(
        ctx,
        existingMeeting.id,
        {
          source: "stale-active-runtime",
        },
      );

      this.metrics.recordStaleActiveRecovered();
      this.metrics.recordReprovisionTriggered();

      return {
        status: "provisioning",
        shouldEnqueue: true,
      };
    }

    // Fallback safety
    return {
      status: "failed",
      shouldEnqueue: false,
    };
  }

  /** Called by the provisioning worker when a meeting goes Active */
  async onMeetingActive(
    ctx: RequestContext,
    roomId: ID,
    meetingId: ID,
  ): Promise<void> {
    // Internal worker callback — NOT a tenant-admin path. Query the room
    // directly (bypassing the channel guard) so provisioning is not blocked.
    const room = await this.connection.getRepository(ctx, BbbRoom).findOne({
      where: { id: roomId as string },
      relations: ["organization"],
    });
    await this.connection.getRepository(ctx, BbbRoom).update(
      { id: roomId as string },
      {
        state: "Active",
        currentMeetingId: meetingId as string,
        retryCount: 0,
        lastRuntimeValidatedAt: new Date(),
      },
    );
    Logger.info(
      `${this.lifecyclePrefix(roomId, meetingId as string)} room → Active`,
      loggerCtx,
    );

    this.eventBus.publish(
      new RoomActivatedEvent(
        roomId as string,
        meetingId as string,
        (room?.organization?.id as string) ?? "",
      ),
    );
  }

  /** Called by the provisioning worker when a meeting fails */
  async onMeetingFailed(ctx: RequestContext, roomId: ID): Promise<void> {
    const repo = this.connection.getRepository(ctx, BbbRoom);
    const room = await repo.findOne({ where: { id: roomId as string } });
    if (!room) return;

    const newRetryCount = (room.retryCount ?? 0) + 1;
    const newState: RoomState =
      newRetryCount >= this.maxAutoRetries ? "Failed" : "Idle";

    await repo.update(
      { id: roomId as string },
      {
        state: newState,
        currentMeetingId: null,
        retryCount: newRetryCount,
        lastRuntimeValidatedAt: null,
      },
    );
    Logger.info(
      `${this.lifecyclePrefix(roomId)} room → ${newState} (retryCount: ${newRetryCount})`,
      loggerCtx,
    );
  }

  /** Called when a meeting completes normally (ended/reconciled) */
  async onMeetingCompleted(ctx: RequestContext, roomId: ID): Promise<void> {
    await this.connection
      .getRepository(ctx, BbbRoom)
      .update(
        { id: roomId as string },
        { state: "Idle", currentMeetingId: null, lastRuntimeValidatedAt: null },
      );
    Logger.info(
      `${this.lifecyclePrefix(roomId)} room → Idle (meeting completed)`,
      loggerCtx,
    );
  }

  /** Manual reset by admin/trainer — clears Failed state */
  async resetFailedRoom(ctx: RequestContext, roomId: ID): Promise<BbbRoom> {
    await this.channelAccess.assertRoomAccess(ctx, roomId);
    await this.connection.getRepository(ctx, BbbRoom).update(
      { id: roomId as string },
      {
        state: "Idle",
        retryCount: 0,
        currentMeetingId: null,
        lastRuntimeValidatedAt: null,
      },
    );
    return this.findById(ctx, roomId) as Promise<BbbRoom>;
  }
}
