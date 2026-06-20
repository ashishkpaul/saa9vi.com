import {
  Injectable,
  NotFoundException,
  OnModuleInit,
  Inject,
  forwardRef,
} from "@nestjs/common";
import {
  Customer,
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
import { EntityManager } from "typeorm";
import { BbbMeeting } from "../entities/bbb-meeting.entity";
import { BbbOrganization } from "../entities/bbb-organization.entity";
import { BbbCapacityGrant } from "../entities/bbb-capacity-grant.entity";
import { BbbRoom } from "../entities/bbb-room.entity";
import { BbbEnrollment } from "../entities/bbb-enrollment.entity";
import { BbbApiService } from "./bbb-api.service";
import { BbbServerService } from "./bbb-server.service";
import { BbbServerSelectionService } from "./bbb-server-selection.service";
import { BbbOrganizationService } from "./bbb-organization.service";
import { BbbEncryptionService } from "./bbb-encryption.service";
import { BbbMemberService } from "./bbb-member.service";
import { BbbRoomService } from "./bbb-room.service";
import { BbbMetricsService } from "./bbb-metrics.service";
import { BbbReconciliationService } from "./bbb-reconciliation.service";
import {
  MeetingProvisionedEvent,
  MeetingCompletedEvent,
  MeetingFailedEvent,
} from "../events/bbb-events";
import {
  BBB_PROVISIONING_QUEUE,
  MEETING_STATE,
  MEETING_STATE_TRANSITIONS,
} from "../constants";
import type { MeetingState } from "../constants";

const loggerCtx = "BbbMeetingService";

export interface CreateMeetingInput {
  organizationId: ID;
  title: string;
  recordingEnabled?: boolean;
  maxParticipants?: number;
  welcomeMessage?: string;
  pluginManifests?: Array<{ url: string }>;
}

export interface ProvisioningJobData {
  serializedCtx: SerializedRequestContext;
  meetingId: ID;
}

interface CompleteMeetingLifecycleOptions {
  source:
    | "webhook"
    | "end-meeting"
    | "reconciliation"
    | "stale-active-runtime"
    | "manual";
  entityManager?: EntityManager;
}

/**
 * Manages BBB meeting lifecycle. Provisioning is always async via job queue.
 * Join URLs are dynamically generated from encrypted passwords — never stored
 * as primary state.
 *
 * Grant linkage is established at provisioning time (immutable) and stored
 * on the meeting record to ensure billing correctness.
 */
@Injectable()
export class BbbMeetingService implements OnModuleInit {
  private provisioningQueue: JobQueue<ProvisioningJobData>;

  constructor(
    private readonly connection: TransactionalConnection,
    private readonly jobQueueService: JobQueueService,
    private readonly bbbApiService: BbbApiService,
    private readonly serverService: BbbServerService,
    private readonly serverSelectionService: BbbServerSelectionService,
    private readonly orgService: BbbOrganizationService,
    private readonly encryptionService: BbbEncryptionService,
    private readonly memberService: BbbMemberService,
    private readonly roomService: BbbRoomService,
    private readonly metrics: BbbMetricsService,
    @Inject(forwardRef(() => BbbReconciliationService))
    private readonly reconciliationService: BbbReconciliationService,
    private readonly eventBus: EventBus,
  ) {}

  async onModuleInit() {
    // forwardRef handles circular DI — no runtime resolution needed
  }

  async init() {
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

  // ─── FSM ─────────────────────────────────────────────────────────────────────

  private assertTransitionAllowed(from: MeetingState, to: MeetingState): void {
    const allowed = MEETING_STATE_TRANSITIONS[from];
    if (!allowed.includes(to)) {
      throw new Error(
        `Invalid meeting state transition: ${from} → ${to}. Allowed: ${allowed.join(", ")}`,
      );
    }
  }

  async transitionState(
    ctx: RequestContext,
    meeting: BbbMeeting,
    toState: MeetingState,
  ): Promise<BbbMeeting> {
    this.assertTransitionAllowed(meeting.state, toState);
    meeting.state = toState;
    if (toState === MEETING_STATE.ACTIVE) meeting.provisionedAt = new Date();
    if (toState === MEETING_STATE.COMPLETED) meeting.completedAt = new Date();
    return this.connection.getRepository(ctx, BbbMeeting).save(meeting);
  }

  // ─── Query ───────────────────────────────────────────────────────────────────

  async findAll(
    ctx: RequestContext,
    orgId?: ID,
    options?: { skip?: number; take?: number },
  ): Promise<{ items: BbbMeeting[]; totalItems: number }> {
    const qb = this.connection
      .getRepository(ctx, BbbMeeting)
      .createQueryBuilder("meeting")
      .leftJoinAndSelect("meeting.organization", "org")
      .orderBy("meeting.createdAt", "DESC");
    if (orgId) {
      qb.where("org.id = :orgId", { orgId: orgId as string });
    }
    const take = Math.min(Math.max(options?.take ?? 25, 1), 100);
    const skip = Math.max(options?.skip ?? 0, 0);
    const [items, totalItems] = await qb
      .skip(skip)
      .take(take)
      .getManyAndCount();
    return { items, totalItems };
  }

  async findById(ctx: RequestContext, id: ID): Promise<BbbMeeting | null> {
    return this.connection.getRepository(ctx, BbbMeeting).findOne({
      where: { id: id as string },
      relations: ["organization"],
    });
  }

  /**
   * Loads meeting with encrypted passwords (select: false columns).
   * Only call this when you need to generate join URLs or terminate meetings.
   */
  async findByIdWithSecrets(
    ctx: RequestContext,
    id: ID,
  ): Promise<BbbMeeting | null> {
    return this.connection
      .getRepository(ctx, BbbMeeting)
      .createQueryBuilder("meeting")
      .addSelect("meeting.encryptedAttendeePassword")
      .addSelect("meeting.encryptedModeratorPassword")
      .leftJoinAndSelect("meeting.organization", "org")
      .where("meeting.id = :id", { id: id as string })
      .getOne();
  }

  // ─── Create + Enqueue ────────────────────────────────────────────────────────

  async createAndEnqueue(
    ctx: RequestContext,
    input: CreateMeetingInput,
  ): Promise<BbbMeeting> {
    const org = await this.connection.getEntityOrThrow(
      ctx,
      BbbOrganization,
      input.organizationId,
    );

    await this.orgService.assertCanCreateMeeting(ctx, org);

    const meeting = new BbbMeeting({
      organization: org,
      title: input.title,
      state: MEETING_STATE.PENDING,
      recordingEnabled: input.recordingEnabled ?? org.recordingEnabled,
      pluginManifestsJson: input.pluginManifests
        ? JSON.stringify(input.pluginManifests)
        : null,
    });

    const saved = await this.connection
      .getRepository(ctx, BbbMeeting)
      .save(meeting);

    // NOTE: setImmediate defers the queue add to the next event loop tick.
    // The caller (e.g. @Transaction() resolver) needs the transaction to commit
    // before the BullMQ worker queries the DB for this meeting. Without this
    // deferral, the worker races the DB commit and sees "Meeting not found".
    setImmediate(() => {
      this.provisioningQueue
        .add({
          serializedCtx: ctx.serialize(),
          meetingId: saved.id,
        })
        .catch((err) =>
          Logger.error(
            `Failed to enqueue provisioning for meeting ${saved.id}: ${(err as Error).message}`,
            loggerCtx,
          ),
        );
    });

    Logger.info(
      `Meeting ${saved.id} created, provisioning enqueued`,
      loggerCtx,
    );
    return saved;
  }

  // ─── Shared Lifecycle Completion ─────────────────────────────────────────────

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
      const meeting = await manager.findOne(BbbMeeting, {
        where: { id: meetingId as string },
        lock: { mode: "pessimistic_write" },
      });

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
      meeting.completedAt = meeting.completedAt ?? new Date();
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
      await this.reconciliationService.consumeGrantHours(ctx, meeting);
      this.metrics.recordBillingSuccess();
      // consumedHours is 0 here — GrantConsumedEvent carries the accurate
      // billing amount. The two events are emitted sequentially:
      // MeetingCompletedEvent first, then GrantConsumedEvent after
      // consumeGrantHours() resolves.
      this.eventBus.publish(
        new MeetingCompletedEvent(
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

  // ─── Provisioning Worker ─────────────────────────────────────────────────────

  /**
   * Provisions a meeting on BBB and stores immutable grant linkage.
   * The active grant is resolved at provisioning time and stored as
   * meeting.grantId so that billing always debits the correct grant,
   * regardless of org-level grant changes during the meeting's lifetime.
   */
  private async doProvisionMeeting(
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

    await this.transitionState(ctx, meeting, MEETING_STATE.PROVISIONING);

    try {
      const server = await this.serverSelectionService.selectServer(ctx);
      if (!server) {
        throw new Error("No healthy BBB server available");
      }

      // Resolve the active grant at provisioning time — immutable linkage
      // Consume earliest-expiring grant first to avoid lapsing unused hours
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

      // S3: capacity guard before provisioning
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

      // Note: pluginManifests is intentionally omitted here. Passing a raw
      // JSON string as a query parameter causes the BBB HTML5 client to crash
      // during plugin initialization. Re-enable only after verifying the
      // correct BBB 3.x API format for plugin manifests.
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

      // NOTE: We bypass the FSM transitionState() here intentionally.
      // The transition is trivially Provisioning → Active which is always
      // valid at this point. Using transitionState() would call .save() on
      // the full entity, overwriting the encryptedAttendeePassword and
      // encryptedModeratorPassword columns (which are select: false and
      // would be saved as undefined). Direct .update() is safer here.
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

      // Notify room (if this meeting was created via a room)
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

      // Notify room of failure
      if (meeting.roomId) {
        await this.roomService.onMeetingFailed(ctx, meeting.roomId);
      }
    }
  }

  // ─── Dynamic Join URL Generation ────────────────────────────────────────────

  /**
   * Validates that a meeting still exists on BBB before returning a join URL.
   *
   * Uses getMeetingInfo() which returns the full meeting record if it
   * exists on BBB (regardless of running/joined state). Unlike
   * isMeetingRunning() which returns false for meetings with no participants,
   * getMeetingInfo() works immediately at creation time and correctly
   * returns null only when the meeting was destroyed or expired.
   *
   * No grace period is needed here because getMeetingInfo resolves instantly
   * on BBB — there is no boot window unlike isMeetingRunning() which has
   * the hasUserJoined=false problem.
   *
   * Transient network errors (timeout, DNS) are rethrown rather than
   * swallowed, so the caller can distinguish "meeting is dead" from
   * "network is flaky" and avoid destroying the room on a transient fault.
   */
  private async validateMeetingExistsOnBbb(
    server: import("../entities/bbb-server.entity").BbbServer,
    meeting: BbbMeeting,
  ): Promise<boolean> {
    if (!meeting.bbbMeetingId) {
      return false;
    }

    try {
      const info = await this.bbbApiService.getMeetingInfo(
        server,
        meeting.bbbMeetingId,
      );
      // getMeetingInfo returns null if the meeting doesn't exist or was destroyed
      return info !== null;
    } catch (err: any) {
      // BBB API network error (timeout, DNS, etc.) — the meeting may still exist.
      // Only treat explicit notFound responses as "meeting gone".
      if (
        err.message?.includes("[notFound]") ||
        err.message?.includes("notFound") ||
        ((err.response as any)?.returncode === "FAILED" &&
          (err.response as any)?.messageKey === "notFound")
      ) {
        return false;
      }
      // Transient network error — rethrow so the caller doesn't destroy the room
      throw err;
    }
  }

  async getAttendeeJoinUrl(
    ctx: RequestContext,
    meetingId: ID,
    participantName: string,
    _userId?: string,
  ): Promise<string> {
    const meeting = await this.findByIdWithSecrets(ctx, meetingId);
    if (!meeting) throw new Error("Meeting not found");
    if (meeting.state !== MEETING_STATE.ACTIVE) {
      throw new Error(`Meeting is not active (state: ${meeting.state})`);
    }
    if (!meeting.bbbMeetingId || !meeting.serverId) {
      throw new Error("Meeting has not been provisioned yet");
    }
    if (!meeting.encryptedAttendeePassword) {
      throw new Error("Meeting passwords were not provisioned");
    }

    const server = await this.serverService.findByIdWithSecret(
      ctx,
      meeting.serverId,
    );
    if (!server) throw new Error("BBB server not found");

    // Validate meeting still exists on BBB (prevents stale URL generation)
    // Note: isMeetingRunning() returns false for new meetings — that's expected.
    // We only need to confirm the meeting hasn't been destroyed/expired.
    const stillExists = await this.validateMeetingExistsOnBbb(server, meeting);
    if (!stillExists) {
      Logger.warn(
        `Meeting ${meetingId} (bbb: ${meeting.bbbMeetingId}) is Active in DB but no longer exists on BBB — join blocked`,
        loggerCtx,
      );
      throw new Error(
        "This meeting has already ended on the server. Please refresh and try again.",
      );
    }

    const attendeePW = this.encryptionService.decrypt(
      meeting.encryptedAttendeePassword,
    );

    const logoutURL = process.env.STOREFRONT_URL
      ? `${process.env.STOREFRONT_URL.replace(/\/$/, "")}/bbb-logout`
      : undefined;

    return this.bbbApiService.buildJoinUrl(server, {
      fullName: participantName,
      meetingID: meeting.bbbMeetingId,
      password: attendeePW,
      logoutURL,
    });
  }

  async getModeratorJoinUrl(
    ctx: RequestContext,
    meetingId: ID,
    moderatorName: string,
  ): Promise<string> {
    const meeting = await this.findByIdWithSecrets(ctx, meetingId);
    if (!meeting) throw new Error("Meeting not found");
    if (meeting.state !== MEETING_STATE.ACTIVE) {
      throw new Error(`Meeting is not active (state: ${meeting.state})`);
    }
    if (!meeting.bbbMeetingId || !meeting.serverId) {
      throw new Error("Meeting has not been provisioned yet");
    }
    if (!meeting.encryptedModeratorPassword) {
      throw new Error("Meeting moderator password was not provisioned");
    }

    const server = await this.serverService.findByIdWithSecret(
      ctx,
      meeting.serverId,
    );
    if (!server) throw new Error("BBB server not found");

    // Validate meeting still exists on BBB (prevents stale URL generation)
    const stillExists = await this.validateMeetingExistsOnBbb(server, meeting);
    if (!stillExists) {
      Logger.warn(
        `Meeting ${meetingId} (bbb: ${meeting.bbbMeetingId}) is Active in DB but no longer exists on BBB — join blocked`,
        loggerCtx,
      );
      throw new Error(
        "This meeting has already ended on the server. Please refresh and try again.",
      );
    }

    const moderatorPW = this.encryptionService.decrypt(
      meeting.encryptedModeratorPassword,
    );

    const logoutURL = process.env.STOREFRONT_URL
      ? `${process.env.STOREFRONT_URL.replace(/\/$/, "")}/bbb-logout`
      : undefined;

    return this.bbbApiService.buildJoinUrl(server, {
      fullName: moderatorName,
      meetingID: meeting.bbbMeetingId,
      password: moderatorPW,
      logoutURL,
    });
  }

  /**
   * Unified role-based join routing (S1):
   * - TRAINER / ORG_ADMIN => moderator URL
   * - STUDENT => attendee URL
   *
   * Membership is enforced before URL generation.
   */
  async getJoinUrl(
    ctx: RequestContext,
    meetingId: ID,
    participantName: string,
  ): Promise<string> {
    const meeting = await this.findById(ctx, meetingId);
    if (!meeting) throw new Error("Meeting not found");

    if (!ctx.activeUserId) {
      throw new Error("Authentication required");
    }
    const customer = await this.connection
      .getRepository(ctx, Customer)
      .findOne({ where: { user: { id: ctx.activeUserId as string } } });
    if (!customer) {
      throw new Error("Authenticated user has no associated customer profile");
    }

    const member = await this.memberService.assertActiveMembership(
      ctx,
      customer.id,
      meeting.organization.id,
    );

    if (this.memberService.isModerator(member)) {
      return this.getModeratorJoinUrl(ctx, meetingId, participantName);
    }

    return this.getAttendeeJoinUrl(
      ctx,
      meetingId,
      participantName,
      customer.id as string,
    );
  }

  // ─── End Meeting (with billing) ─────────────────────────────────────────────

  async endMeeting(ctx: RequestContext, meetingId: ID): Promise<BbbMeeting> {
    const meeting = await this.findByIdWithSecrets(ctx, meetingId);
    if (!meeting) throw new Error("Meeting not found");
    if (meeting.state !== MEETING_STATE.ACTIVE) {
      throw new Error(`Cannot end a meeting in state: ${meeting.state}`);
    }

    // Fire-and-forget BBB end — best effort
    if (
      meeting.bbbMeetingId &&
      meeting.serverId &&
      meeting.encryptedModeratorPassword
    ) {
      try {
        const server = await this.serverService.findByIdWithSecret(
          ctx,
          meeting.serverId,
        );
        if (server) {
          const moderatorPW = this.encryptionService.decrypt(
            meeting.encryptedModeratorPassword,
          );
          await this.bbbApiService.endMeeting(
            server,
            meeting.bbbMeetingId,
            moderatorPW,
          );
          Logger.info(`Meeting ${meetingId} terminated via BBB API`, loggerCtx);
        }
      } catch (err) {
        Logger.warn(
          `Failed to end meeting via BBB API: ${(err as Error).message}. Database state will still transition.`,
          loggerCtx,
        );
      }
    }

    return this.completeMeetingLifecycle(ctx, meeting, {
      source: "end-meeting",
    });
  }

  // ─── Room-based Join ────────────────────────────────────────────────────────

  private async createRoomMeetingAndEnqueue(
    ctx: RequestContext,
    roomId: ID,
  ): Promise<void> {
    const room = await this.roomService.findById(ctx, roomId);
    if (!room) throw new Error("Room not found");

    // ─── Idempotency Check ──────────────────────────────────────────
    // Before creating a new meeting, verify no PENDING or PROVISIONING
    // meeting already exists for this room. This prevents the
    // duplicate-provisioning loop when users click "Start Session"
    // multiple times while a meeting is still being provisioned.
    const existingMeeting = await this.connection
      .getRepository(ctx, BbbMeeting)
      .createQueryBuilder("meeting")
      .where("meeting.roomId = :roomId", { roomId: roomId as string })
      .andWhere("meeting.state IN (:...states)", {
        states: [
          MEETING_STATE.PENDING,
          MEETING_STATE.PROVISIONING,
          MEETING_STATE.ACTIVE,
        ],
      })
      .getOne();

    if (existingMeeting) {
      Logger.info(
        `[createRoomMeetingAndEnqueue] SKIP — meeting ${existingMeeting.id} already ${existingMeeting.state} for room ${roomId}`,
        loggerCtx,
      );
      return;
    }
    // ────────────────────────────────────────────────────────────────

    const meeting = new BbbMeeting({
      organization: room.organization,
      title: room.name,
      state: MEETING_STATE.PENDING,
      recordingEnabled: room.recordingEnabled,
      roomId: roomId as string,
    });
    try {
      const saved = await this.connection
        .getRepository(ctx, BbbMeeting)
        .save(meeting);

      // NOTE: setImmediate defers the queue add to avoid a transaction race.
      // The TypeORM save() opens its own transaction; the worker must not
      // query for the meeting before that transaction commits.
      setImmediate(() => {
        this.provisioningQueue
          .add({
            serializedCtx: ctx.serialize(),
            meetingId: saved.id,
          })
          .catch((err) =>
            Logger.error(
              `Failed to enqueue room meeting ${saved.id}: ${(err as Error).message}`,
              loggerCtx,
            ),
          );
      });

      this.metrics.recordProvisioningEnqueued();
    } catch (err: any) {
      if (
        err?.code === "23505" ||
        err?.message?.includes("uq_bbb_room_active_meeting")
      ) {
        Logger.info(
          `[createRoomMeetingAndEnqueue] DB constraint prevented duplicate meeting for room ${roomId}`,
          loggerCtx,
        );
        return;
      }
      throw err;
    }
  }

  /**
   * Entry point for the shop `bbbJoinRoom` mutation.
   * - If room is Active: returns join URL immediately.
   * - If room is Idle/Failed (within retry budget): provisions a new meeting and returns status.
   * - Frontend polls bbbRoom(id) until state === Active, then calls again.
   */
  async joinRoom(
    ctx: RequestContext,
    roomId: ID,
    participantName: string,
    customerId: ID,
  ): Promise<{ status: string; joinUrl?: string }> {
    Logger.info(
      `[joinRoom] START roomId=${roomId} participantName=${participantName} customerId=${customerId}`,
      loggerCtx,
    );
    Logger.info(
      `[joinRoom] timestamp=${new Date().toISOString()} roomId=${roomId}`,
      loggerCtx,
    );
    const result = await this.roomService.requestProvisioning(ctx, roomId);
    Logger.info(
      `[joinRoom] requestProvisioning returned status=${result.status} currentMeetingId=${result.currentMeetingId ?? "null"} shouldEnqueue=${!!result.shouldEnqueue}`,
      loggerCtx,
    );

    if (result.status === "active" && result.currentMeetingId) {
      const room = await this.roomService.findById(ctx, roomId);
      Logger.info(
        `[joinRoom] room found: id=${room?.id} orgId=${(room as any)?.organization?.id ?? "null"} state=${(room as any)?.state ?? "null"}`,
        loggerCtx,
      );

      // ── Dual-path authorization ─────────────────────────────────────────────
      // Staff (TRAINER / ORG_ADMIN): authorized via org membership → moderator URL.
      // Students: authorized via BbbEnrollment (created by fulfillment) → attendee URL.
      let isModerator = false;
      const staffMember = await this.memberService.findActiveMembership(
        ctx,
        customerId,
        room!.organization.id,
      );

      if (staffMember && this.memberService.isModerator(staffMember)) {
        isModerator = true;
        Logger.info(
          `[joinRoom] staff path: memberId=${(staffMember as any).id} isModerator=true`,
          loggerCtx,
        );
      } else {
        // Enrollment path: authorized via BbbEnrollment (created by fulfillment or admin).
        const enrollment = await this.connection
          .getRepository(ctx, BbbEnrollment)
          .findOne({
            where: {
              roomId: roomId as string,
              customerId: customerId as string,
              active: true,
            },
          });

        if (!enrollment) {
          throw new Error(
            "You do not have access to this room. Please purchase a plan to enroll.",
          );
        }

        // Expire check — prefer validFrom/validUntil window; fall back to legacy expiresAt
        const now = new Date();
        if (enrollment.validFrom && enrollment.validFrom > now) {
          throw new Error("Your enrollment for this room has not started yet.");
        }
        if (enrollment.validUntil && enrollment.validUntil < now) {
          throw new Error("Your enrollment for this room has expired.");
        }
        // Legacy fallback
        if (
          !enrollment.validUntil &&
          enrollment.expiresAt &&
          enrollment.expiresAt < now
        ) {
          throw new Error("Your enrollment for this room has expired.");
        }
        Logger.info(
          `[joinRoom] enrollment path: enrollmentId=${(enrollment as any).id}`,
          loggerCtx,
        );
      }

      Logger.info(
        `[joinRoom] authorization resolved isModerator=${isModerator}`,
        loggerCtx,
      );

      try {
        const joinUrl = isModerator
          ? await this.getModeratorJoinUrl(
              ctx,
              result.currentMeetingId,
              participantName,
            )
          : await this.getAttendeeJoinUrl(
              ctx,
              result.currentMeetingId,
              participantName,
              customerId as string,
            );

        Logger.info(
          `[joinRoom] joinUrl generated: length=${joinUrl.length} meetingId=${result.currentMeetingId} participant=${participantName}`,
          loggerCtx,
        );
        return { status: "active", joinUrl };
      } catch (err: any) {
        // Only teardown the room if we know the meeting is dead on BBB
        // (confirmed by validateMeetingExistsOnBbb returning false).
        // Network timeouts / transient errors must NOT destroy the room
        // or bill the customer.
        if (err.message?.includes("already ended on the server")) {
          Logger.warn(
            `[joinRoom] Room ${roomId} is Active but meeting ${result.currentMeetingId} is stale on BBB. Resetting room and triggering fresh provisioning.`,
            loggerCtx,
          );

          try {
            await this.completeMeetingLifecycle(ctx, result.currentMeetingId, {
              source: "stale-active-runtime",
            });
          } catch (completeErr) {
            Logger.warn(
              `[joinRoom] Failed to complete stale meeting: ${(completeErr as Error).message}`,
              loggerCtx,
            );
          }

          await this.createRoomMeetingAndEnqueue(ctx, roomId);
          return { status: "provisioning" };
        }

        // Transient error (network timeout, DNS, etc.) — don't kill the room.
        // Frontend will retry on the next polling tick.
        Logger.warn(
          `[joinRoom] Transient error generating join URL for room ${roomId} meeting ${result.currentMeetingId}: ${err.message}`,
          loggerCtx,
        );
        return { status: "provisioning" };
      }
    }

    if (result.shouldEnqueue) {
      Logger.info(
        `[joinRoom] shouldEnqueue=true — creating meeting and enqueuing provisioning job`,
        loggerCtx,
      );
      await this.createRoomMeetingAndEnqueue(ctx, roomId);
    } else {
      this.metrics.recordProvisioningSuppressed();
      Logger.info(
        `[joinRoom] provisioning suppressed (debounce or already provisioning)`,
        loggerCtx,
      );
    }

    Logger.info(
      `[joinRoom] RETURN status=${result.status} (no joinUrl)`,
      loggerCtx,
    );
    return { status: result.status };
  }

  // ─── Update ────────────────────────────────────────────────────────────────────

  async update(
    ctx: RequestContext,
    id: ID,
    input: { title?: string; recordingEnabled?: boolean },
  ): Promise<BbbMeeting> {
    const meeting = await this.findById(ctx, id);
    if (!meeting) throw new NotFoundException("Meeting not found");
    if (input.title !== undefined) meeting.title = input.title;
    if (input.recordingEnabled !== undefined)
      meeting.recordingEnabled = input.recordingEnabled;
    return this.connection.getRepository(ctx, BbbMeeting).save(meeting);
  }

  // ─── Delete ────────────────────────────────────────────────────────────────────

  async delete(ctx: RequestContext, id: ID): Promise<void> {
    const meeting = await this.findById(ctx, id);
    if (!meeting) throw new NotFoundException("Meeting not found");
    await this.connection.getRepository(ctx, BbbMeeting).remove(meeting);
  }

  // ─── Webhook Handler ─────────────────────────────────────────────────────────

  /**
   * Normalizes BBB webhook payloads from both formats:
   * - Legacy: { meetingID: "..." }
   * - bbb-webhooks module: { event: { data: { attributes: { meeting: { externalMeetingId: "..." } } } } }
   */
  private extractBbbMeetingId(payload: Record<string, unknown>): string | null {
    // Legacy / direct format
    if (typeof payload.meetingID === "string" && payload.meetingID) {
      return payload.meetingID;
    }
    // bbb-webhooks nested format
    try {
      const externalId = (payload.event as any)?.data?.attributes?.meeting
        ?.externalMeetingId;
      if (typeof externalId === "string" && externalId) return externalId;
    } catch {
      // ignore
    }
    return null;
  }

  /** Canonical BBB event name constants */
  private static readonly BBB_EVENTS = {
    MEETING_ENDED: "meeting-ended",
    RECORDING_READY: "rap-publish-ended",
  } as const;

  async handleWebhookEvent(
    ctx: RequestContext,
    eventType: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    const bbbMeetingId = this.extractBbbMeetingId(payload);
    if (!bbbMeetingId) {
      this.metrics.recordWebhookParseFailure();
      return;
    }

    const meeting = await this.connection
      .getRepository(ctx, BbbMeeting)
      .findOne({ where: { bbbMeetingId } });

    if (!meeting) {
      Logger.warn(
        `Webhook event "${eventType}" for unknown bbbMeetingId: ${bbbMeetingId}`,
        loggerCtx,
      );
      return;
    }

    switch (eventType) {
      case BbbMeetingService.BBB_EVENTS.MEETING_ENDED:
        await this.completeMeetingLifecycle(ctx, meeting, {
          source: "webhook",
        });
        break;
      case BbbMeetingService.BBB_EVENTS.RECORDING_READY: {
        const recordId = payload.recordID as string;
        const playbackUrl = (payload.playback as Record<string, unknown>)
          ?.url as string;
        if (recordId) {
          await this.connection
            .getRepository(ctx, BbbMeeting)
            .update(meeting.id as string, {
              bbbRecordingId: recordId,
              recordingUrl: playbackUrl ?? null,
            });
          Logger.info(
            `Recording ready for meeting ${meeting.id}: ${recordId}`,
            loggerCtx,
          );
        }
        break;
      }
      default:
        Logger.debug(`Unhandled webhook event: ${eventType}`, loggerCtx);
    }
  }
}
