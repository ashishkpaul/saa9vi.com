import { Inject, Injectable } from "@nestjs/common";
import {
  ID,
  Logger,
  RequestContext,
  TransactionalConnection,
} from "@vendure/core";
import { BbbRoom, RoomState } from "../entities/bbb-room.entity";
import { BbbMeeting } from "../entities/bbb-meeting.entity";
import { BbbOrganization } from "../entities/bbb-organization.entity";
import { BbbEnrollment } from "../entities/bbb-enrollment.entity";
import { BbbEntitlement } from "../entities/bbb-entitlement.entity";
import { In } from "typeorm";
import {
  isEntitlementValid,
  isEnrollmentValid,
} from "./room-access.policy";
import { MEETING_STATE } from "../constants";
import { BBB_PLUGIN_OPTIONS } from "../constants";
import { BbbRoomLockService } from "./bbb-room-lock.service";
import { BbbPlatformCapacityPolicyService } from "./bbb-platform-capacity-policy.service";
import { BbbServerService } from "./bbb-server.service";
import { BbbApiService, BbbNotFoundError } from "./bbb-api.service";
import { BbbMetricsService } from "./bbb-metrics.service";
import { BbbChannelAccessService } from "./bbb-channel-access.service";
import { MeetingLifecycleService } from "./bbb-meeting-lifecycle.service";
import { BbbEncryptionService } from "./bbb-encryption.service";
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

/**
 * A room as the card/detail READ surface returns it (Phase 5.4): the entity plus
 * the computed, never-persisted `studentCount`. Producer surfaces that cannot
 * batch a count (mutations, nested relations) leave the field null in the SDL
 * instead of claiming zero.
 */
export type BbbRoomCard = BbbRoom & { studentCount: number };

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
    private readonly capacityPolicyService: BbbPlatformCapacityPolicyService,
    private readonly lifecycleService: MeetingLifecycleService,
    private readonly encryptionService: BbbEncryptionService,
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
    // ADR-031 room capacity rule: default from the effective platform
    // capacity policy, tenant may raise up to maxRoomCapacity. When no
    // policy rows exist (feature not adopted), preserve INV-014 current
    // behavior exactly (org value is both default and ceiling).
    let maxParticipants: number;
    if (await this.capacityPolicyService.hasAnyPolicy(ctx)) {
      const policy = await this.capacityPolicyService.getEffectivePolicy(
        ctx,
        org.channelId,
      );
      // Write-through denormalized cache (INV-014 invariant stays true:
      // room can never exceed the org value, which now tracks the policy
      // limit). Manual admin-form edits are overridden by policy per ADR-031.
      await this.capacityPolicyService.syncOrganizationCache(ctx, org, policy);
      maxParticipants = this.capacityPolicyService.resolveRoomCapacity(
        policy,
        input.maxParticipants,
      );
    } else {
      // INV-014 (pre-adoption): org value is default and ceiling.
      maxParticipants = Math.min(
        input.maxParticipants ?? org.maxParticipantsPerMeeting,
        org.maxParticipantsPerMeeting,
      );
    }
    if (input.slug) {
      const existing = await this.connection.getRepository(ctx, BbbRoom).findOne({
        where: { slug: input.slug },
        relations: ["organization"],
      });
      if (existing) {
        return existing;
      }
    }
    const room = new BbbRoom({
      organization: org,
      name: input.name,
      description: input.description ?? null,
      slug: input.slug ?? null,
      recordingEnabled: input.recordingEnabled ?? org.recordingEnabled,
      maxParticipants,
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

  // ─── Room card reads (Phase 5.4) ───────────────────────────────────────────
  //
  // The tenant Rooms screen and the room detail read through these two methods
  // so the card stats arrive with the page: two extra queries for the whole
  // list, never one per room. `findAll`/`findById` stay untouched — they serve
  // the provisioning hot paths (joinRoom, the worker) where a count would be
  // pure overhead.

  /**
   * Room list + student counts, for `bbbRooms`.
   */
  async findAllCards(
    ctx: RequestContext,
    orgId: ID,
    options?: { skip?: number; take?: number },
  ): Promise<{ items: BbbRoomCard[]; totalItems: number }> {
    const page = await this.findAll(ctx, orgId, options);
    return {
      items: await this.withStudentCounts(ctx, page.items),
      totalItems: page.totalItems,
    };
  }

  /**
   * Single room + student count, for `bbbRoom`.
   */
  async findCard(ctx: RequestContext, id: ID): Promise<BbbRoomCard | null> {
    const room = await this.findById(ctx, id);
    if (!room) return null;
    const [card] = await this.withStudentCounts(ctx, [room]);
    return card;
  }

  /**
   * Phase 5.4 — attach `studentCount` to a page of rooms with **two** queries.
   *
   * `studentCount` is the number of DISTINCT customers holding EITHER an active
   * enrollment for the room OR a valid `bbb_room` entitlement for it, so a
   * person who has both is counted once (a card counts people, not rows). The
   * validity windows come from the shared INV-027 helpers
   * (`isEnrollmentValid` / `isEntitlementValid`) rather than being re-invented
   * here — the count must agree with what the room would actually admit.
   *
   * `trainerCount` is deliberately NOT computed: D5 keeps trainers org-wide (no
   * trainer-room ACL), so the number is an organization-level fact the People
   * tab already owns; the card shows it from there.
   */
  private async withStudentCounts(
    ctx: RequestContext,
    rooms: BbbRoom[],
  ): Promise<BbbRoomCard[]> {
    if (rooms.length === 0) return [];
    const roomIds = rooms.map((room) => String(room.id));
    const now = new Date();

    const [enrollments, entitlements] = await Promise.all([
      this.connection.getRepository(ctx, BbbEnrollment).find({
        where: { roomId: In(roomIds), active: true },
      }),
      this.connection.getRepository(ctx, BbbEntitlement).find({
        where: { type: "bbb_room", resourceId: In(roomIds) },
      }),
    ]);

    const studentsByRoom = new Map<string, Set<string>>();
    const addStudent = (roomId: string, customerId: string) => {
      let set = studentsByRoom.get(roomId);
      if (!set) {
        set = new Set<string>();
        studentsByRoom.set(roomId, set);
      }
      set.add(customerId);
    };
    for (const enrollment of enrollments) {
      if (isEnrollmentValid(enrollment, now)) {
        addStudent(String(enrollment.roomId), String(enrollment.customerId));
      }
    }
    for (const entitlement of entitlements) {
      if (isEntitlementValid(entitlement, now)) {
        addStudent(String(entitlement.resourceId), String(entitlement.customerId));
      }
    }

    return rooms.map((room) =>
      Object.assign(room, {
        studentCount: studentsByRoom.get(String(room.id))?.size ?? 0,
      }),
    );
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

  /**
   * W1: existence check via `getMeetingInfo` — success (even with zero
   * participants) means the BBB meeting is still valid. Only a CONFIRMED
   * `BbbNotFoundError` returns false. `Unavailable`/`Rejected` (outage, bad
   * checksum) returns TRUE — we cannot prove it is gone, and returning false
   * here completes the DB meeting while the BBB meeting is still live
   * (split class, metering stopped for the old one).
   */
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

    // Load the moderator password — BBB requires it on getMeetingInfo. If
    // the meeting row lacks it, fall back to a password-less probe.
    let moderatorPW: string | undefined;
    try {
      const withSecrets = await this.connection
        .getRepository(ctx, BbbMeeting)
        .createQueryBuilder("meeting")
        .addSelect("meeting.encryptedModeratorPassword")
        .where("meeting.id = :id", { id: meeting.id as string })
        .getOne();
      const enc = (withSecrets as BbbMeeting | null)?.encryptedModeratorPassword;
      if (enc) {
        try {
          moderatorPW = this.encryptionService.decrypt(enc);
        } catch {
          moderatorPW = undefined;
        }
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
        this.metrics.recordRuntimeValidationFailed();
        return false;
      }
      // Outage / config rejection — assume still valid.
      Logger.warn(
        `${prefix} runtime validation ambiguous (${(err as Error).message}) — treating as still valid`,
        loggerCtx,
      );
      return true;
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
      await this.lifecycleService.completeMeetingLifecycle(
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
