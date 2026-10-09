import {
  Injectable,
  OnModuleInit,
  Inject,
} from "@nestjs/common";
import { EntityNotFoundError, UserInputError } from "@vendure/core";
import {
  Administrator,
  ConfigService,
  Customer,
  ForbiddenError,
  ID,
  Logger,
  RequestContext,
  TransactionalConnection,
} from "@vendure/core";
import { BbbRoomAccessService } from "./room-access.service";
import { BbbProvisioningEnqueuer, BBB_PROVISIONING_ENQUEUER } from "./bbb-provisioning-enqueuer";
import * as crypto from "crypto";
import { BbbMeeting } from "../entities/bbb-meeting.entity";
import { BbbOrganization } from "../entities/bbb-organization.entity";
import { BbbCapacityGrant } from "../entities/bbb-capacity-grant.entity";
import { BbbRoom } from "../entities/bbb-room.entity";
import { BbbScheduledSession } from "../entities/bbb-scheduled-session.entity";
import { BbbTrialRegistration } from "../entities/trial-registration.entity";
import { BbbEntitlement } from "../entities/bbb-entitlement.entity";
import { BbbApiService, BbbNotFoundError } from "./bbb-api.service";
import { BbbEncryptionService } from "./bbb-encryption.service";
import { BbbServerService } from "./bbb-server.service";
import { BbbServerSelectionService } from "./bbb-server-selection.service";
import { BbbOrganizationService } from "./bbb-organization.service";
import { BbbMemberService } from "./bbb-member.service";
import { BbbRoomService } from "./bbb-room.service";
import { BbbMetricsService } from "./bbb-metrics.service";
import { GrantConsumptionService } from "./bbb-grant-consumption.service";
import { MeetingLifecycleService } from "./bbb-meeting-lifecycle.service";
import { BbbEntitlementService } from "./bbb-entitlement.service";
import { BbbChannelAccessService } from "./bbb-channel-access.service";
import { BbbMeteringService } from "./bbb-metering.service";
import { IST_OFFSET_MS } from "../../../platform/timezone";
import {
  isMeteredOrganization,
  monthOf,
  computeMonthChargePaise,
  isApproachingSpendLimit,
} from "./metered-billing.policy";
import { BbbOpsAlertService } from "./bbb-ops-alert.service";
import { SessionAttendanceService } from "./session-attendance.service";
import {
  MeetingProvisionedEvent,
  MeetingFailedEvent,
} from "../events/bbb-events";
import {
  BBB_PLUGIN_OPTIONS,
  JOIN_STATUS_WAITING_FOR_TRAINER,
  MEETING_STATE,
  MEETING_STATE_TRANSITIONS,
  START_ROOM_POLL_INTERVAL_MS,
  START_ROOM_WAIT_MS_DEFAULT,
  START_ROOM_WAIT_MS_MAX,
} from "../constants";
import type { MeetingState } from "../constants";
import type { BigBlueButtonPluginOptions } from "../types";
import { resolveLogoutUrl } from "./storefront-url";

const loggerCtx = "BbbMeetingService";

export interface CreateMeetingInput {
  organizationId: ID;
  title: string;
  recordingEnabled?: boolean;
  maxParticipants?: number;
  welcomeMessage?: string;
  pluginManifests?: Array<{ url: string }>;
}

/**
 * One row of `bbbRoomRecordings` — the Room Recordings read model.
 *
 * Deliberately a MINIMAL projection over columns `BbbMeeting` actually has:
 * no `startedAt` / `endedAt` / `durationMinutes` exist on the entity, so none
 * are invented here and nothing is derived from a billing table. Attendance
 * and learner-minutes are metered-billing facts and stay on the billing reads
 * (`bbbMeteredMeetings`).
 *
 * `recordingUrl` is never null in a returned row — the query filters on it —
 * and it is whatever the `rap-publish-ended` webhook (or the getRecordings
 * repair pass) stored. Never invented.
 */
export interface RoomRecordingRow {
  id: string;
  title: string;
  roomId: string | null;
  completedAt: Date;
  recordingUrl: string;
}

/**
 * A22 (Phase 5.2) — result of the dashboard's "Start class" action
 * (`bbbStartRoom`).
 *
 * - `active`   → the room is live and `joinUrl` is a **moderator** URL.
 * - `starting` → provisioning is in flight; the UI calls again (idempotent —
 *                the lock and debounce in `requestProvisioning` absorb repeats).
 * - `failed`   → the room is Failed beyond its auto-retry budget and needs a
 *                reset (`resetBbbRoom`).
 * - `unavailable` → the org cannot provision right now (suspended or monthly
 *                spend cap); `message` is a tenant-safe sentence, never the raw
 *                worker `failureReason` (A22/S4.2).
 */
export interface StartRoomResult {
  status: "active" | "starting" | "failed" | "unavailable";
  joinUrl?: string;
  currentMeetingId?: ID;
  /** The room's state when the call returned — `roomState` drives the badge. */
  roomState: string;
  /** Tenant-safe reason when status is 'failed' or 'unavailable'. */
  message?: string;
}

/**
 * Tenant-safe sentence for metered-gate refusals (A22/S4.2).
 *
 * The worker stores a detailed `failureReason` for operators; the dashboard
 * must never see it. A suspended org, an org at its monthly spend cap, and a
 * legacy grant org with no provisionable grant all read as a paused account —
 * one sentence, one code path, no pricing or plan wording.
 */
export const START_ROOM_ACCOUNT_PAUSED_MESSAGE =
  "Your account is paused — contact support";


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
  constructor(
    private readonly connection: TransactionalConnection,
    private readonly configService: ConfigService,
    private readonly bbbApiService: BbbApiService,
    private readonly serverService: BbbServerService,
    private readonly serverSelectionService: BbbServerSelectionService,
    private readonly orgService: BbbOrganizationService,
    private readonly encryptionService: BbbEncryptionService,
    private readonly memberService: BbbMemberService,
    // S7A: no longer an @Inject-wrapped circular reference. BbbRoomService
    // injects MeetingLifecycleService (not BbbMeetingService), so this edge is
    // one-directional and the DI cycle the old forward-ref wrapper papered over
    // is gone.
    private readonly roomService: BbbRoomService,
    private readonly metrics: BbbMetricsService,
    private readonly grantConsumption: GrantConsumptionService,
    private readonly lifecycleService: MeetingLifecycleService,
    private readonly entitlementService: BbbEntitlementService,
    private readonly roomAccessService: BbbRoomAccessService,
    private readonly channelAccess: BbbChannelAccessService,
    private readonly meteringService: BbbMeteringService,
    private readonly sessionAttendanceService: SessionAttendanceService,
    private readonly opsAlert: BbbOpsAlertService,
    @Inject(BBB_PROVISIONING_ENQUEUER)
    private readonly provisioningEnqueuer: BbbProvisioningEnqueuer,
    // W6: join URLs carry BBB's logoutURL, which is built from the documented
    // `storefrontUrl` option (falling back to STOREFRONT_URL) — the same
    // resolution the /create call uses, so the two can never diverge.
    @Inject(BBB_PLUGIN_OPTIONS)
    private readonly options: BigBlueButtonPluginOptions,
  ) {}

  /**
   * Kept for backwards compatibility with the plugin bootstrap call.
   * The single provisioning queue consumer lives in
   * BbbProvisioningWorkerService — this service is enqueue-only.
   */
  async onModuleInit() {}

  async init() {}

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

  /**
   * Normalize a GraphQL-facing id (e.g. "T_1" under the e2e
   * TestingEntityIdStrategy) to the raw PK form for column comparisons.
   * Identity under the production AutoIncrementIdStrategy.
   */
  private toPk(id: ID): string {
    const decoded = this.configService.entityIdStrategy.decodeId(String(id));
    return decoded === -1 ? String(id) : String(decoded);
  }

  async findAll(
    ctx: RequestContext,
    orgId?: ID,
    options?: { skip?: number; take?: number },
    roomId?: ID,
  ): Promise<{ items: BbbMeeting[]; totalItems: number }> {
    // Explicit ids are always channel-asserted (the asserts bypass SuperAdmin
    // internally), so an argument can never widen the read beyond the caller's
    // own channel.
    if (orgId) {
      await this.channelAccess.assertOrganizationAccess(ctx, orgId);
    }
    if (roomId) {
      await this.channelAccess.assertRoomAccess(ctx, roomId);
    }
    const qb = this.connection
      .getRepository(ctx, BbbMeeting)
      .createQueryBuilder("meeting")
      .leftJoinAndSelect("meeting.organization", "org")
      .orderBy("meeting.createdAt", "DESC");
    if (orgId) {
      qb.andWhere("org.id = :orgId", { orgId: this.toPk(orgId) });
    }
    if (roomId) {
      qb.andWhere("meeting.roomId = :roomId", { roomId: this.toPk(roomId) });
    }
    if (!orgId && !roomId && !this.channelAccess.isPlatformCaller(ctx)) {
      // BUG-046 / INV-029: the no-argument path derives the organization set
      // from ctx.channelId (the same org→channels join bbbOrganizations uses),
      // so a tenant-scoped list can no longer widen to every tenant's meetings.
      // The unrestricted listing remains for platform callers only.
      qb.innerJoin("org.channels", "tenantChannel").andWhere(
        "tenantChannel.id = :tenantChannelId",
        { tenantChannelId: ctx.channelId as string },
      );
    }
    const take = Math.min(Math.max(options?.take ?? 25, 1), 100);
    const skip = Math.max(options?.skip ?? 0, 0);
    const [items, totalItems] = await qb
      .skip(skip)
      .take(take)
      .getManyAndCount();
    return { items, totalItems };
  }

  /**
   * Room Recordings read model — a channel-scoped query over `BbbMeeting`.
   *
   * Why this exists: the Recordings tab used to read `bbbMeteredMeetings`
   * (a `BbbMeteredUsage`-backed read), so a GRANT-billed tenant's recordings
   * were invisible — grant meetings never write a metered-usage row, even
   * when the `rap-publish-ended` webhook stored a playback link. Recording
   * facts live on `BbbMeeting`; billing facts stay on the billing reads.
   *
   * Scope and semantics:
   * - **Channel-scoped (INV-001 / D3)**: the organization is derived from
   *   `ctx.channelId` server-side. There is deliberately NO `organizationId`
   *   argument, so a tenant read can never widen to another tenant.
   * - **Only real recordings**: `recordingUrl IS NOT NULL` — the URL is
   *   whatever BBB reported, never invented, so "Pending" rows simply do not
   *   appear here.
   * - **IST month**: the window is the IST calendar month of `completedAt`,
   *   expressed as absolute UTC instants (`IST_OFFSET_MS`, no DST) so it
   *   matches `monthOf()` / `istDateParts()` exactly — the same month key the
   *   billing reads use.
   * - **Minimal projection**: only columns `BbbMeeting` actually has.
   */
  async getRecordings(
    ctx: RequestContext,
    month?: string,
    skip?: number,
    take?: number,
  ): Promise<{ items: RoomRecordingRow[]; totalItems: number }> {
    const period = month ?? monthOf(new Date());
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) {
      throw new UserInputError(
        `month must be a YYYY-MM period key (e.g. "2030-01"), got ${JSON.stringify(month)}`,
      );
    }
    const [year, mon] = period.split("-").map(Number);
    // IST calendar month → absolute UTC instants: IST midnight of the 1st is
    // (UTC midnight of the 1st) − 5:30. `[start, end)` is half-open, so a
    // completion at exactly the boundary books to the later month.
    const start = new Date(Date.UTC(year, mon - 1, 1) - IST_OFFSET_MS);
    const end = new Date(Date.UTC(year, mon, 1) - IST_OFFSET_MS);

    const takeN = Math.min(Math.max(take ?? 25, 1), 100);
    const skipN = Math.max(skip ?? 0, 0);

    const [rows, totalItems] = await this.connection
      .getRepository(ctx, BbbMeeting)
      .createQueryBuilder("meeting")
      .innerJoin("meeting.organization", "org")
      .select([
        "meeting.id",
        "meeting.title",
        "meeting.roomId",
        "meeting.completedAt",
        "meeting.recordingUrl",
      ])
      .andWhere("org.channelId = :channelId", {
        channelId: ctx.channelId as string,
      })
      .andWhere("meeting.recordingUrl IS NOT NULL")
      .andWhere(
        "meeting.completedAt IS NOT NULL AND meeting.completedAt >= :start AND meeting.completedAt < :end",
        { start, end },
      )
      .orderBy("meeting.completedAt", "DESC")
      .skip(skipN)
      .take(takeN)
      .getManyAndCount();

    return {
      items: rows.map((m) => ({
        id: String(m.id),
        title: m.title,
        roomId: m.roomId ?? null,
        completedAt: m.completedAt,
        recordingUrl: m.recordingUrl as string,
      })),
      totalItems,
    };
  }

  async findById(ctx: RequestContext, id: ID): Promise<BbbMeeting | null> {
    const meeting = await this.connection.getRepository(ctx, BbbMeeting).findOne({
      where: { id: id as string },
      relations: ["organization"],
    });
    if (!meeting) return null;
    await this.channelAccess.assertMeetingAccess(ctx, id);
    return meeting;
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
      // W5 audit trail: attribute the meeting to the requesting user at insert
      // (null = system origin). Provisioning later flips state without touching it.
      startedByUserId: ctx.activeUserId != null ? String(ctx.activeUserId) : null,
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
      // Enqueue via the single provisioning consumer (BbbProvisioningWorkerService).
      this.provisioningEnqueuer
        .enqueueProvisioning(ctx, saved.id)
        .catch((err: unknown) =>
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

  // ─── Dynamic Join URL Generation ────────────────────────────────────────────

  /**
   * Validates that a meeting still exists on BBB before returning a join URL.
   *
   * W1: `getMeetingInfo` now throws typed errors, so the old dead branch
   * (string-matching "[notFound]" on a method that never threw) actually
   * works: only `BbbNotFoundError` means gone. `Unavailable`/`Rejected`
   * (timeout, outage, checksum) is treated as still existing so a freshly
   * provisioned room can generate a join URL — the BBB join itself is the
   * authoritative gate. Sends the moderator password (BBB requires it).
   */
  private async validateMeetingExistsOnBbb(
    server: import("../entities/bbb-server.entity").BbbServer,
    meeting: BbbMeeting,
  ): Promise<boolean> {
    if (!meeting.bbbMeetingId) {
      return false;
    }

    let moderatorPW: string | undefined;
    if ((meeting as BbbMeeting).encryptedModeratorPassword) {
      try {
        moderatorPW = this.encryptionService.decrypt(
          (meeting as BbbMeeting).encryptedModeratorPassword,
        );
      } catch {
        moderatorPW = undefined;
      }
    }

    try {
      await this.bbbApiService.getMeetingInfo(
        server,
        meeting.bbbMeetingId,
        moderatorPW,
      );
      return true;
    } catch (err: any) {
      if (err instanceof BbbNotFoundError) {
        return false;
      }
      Logger.warn(
        `[validateMeetingExistsOnBbb] Ambiguous BBB error for meeting ${meeting.id} (${meeting.bbbMeetingId}): ${(err as Error).message} — treating as still existing`,
        loggerCtx,
      );
      return true;
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

    const logoutURL = resolveLogoutUrl(
      this.options.storefrontUrl,
      process.env.STOREFRONT_URL,
    );

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
    // Channel ownership BEFORE the secret-bearing read. findByIdWithSecrets
    // returns `encryptedModeratorPassword`, so an unscoped meetingId here would
    // be a cross-tenant moderator-credential disclosure — and this is reached
    // from the admin surface (bbbModeratorJoinUrl). The attendee path
    // (getAttendeeJoinUrl) is deliberately NOT gated by a channel assert: it has
    // its own entitlement/enrollment check and must stay reachable by learners
    // who hold no admin channel at all.
    await this.channelAccess.assertMeetingAccess(ctx, meetingId);

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

    const logoutURL = resolveLogoutUrl(
      this.options.storefrontUrl,
      process.env.STOREFRONT_URL,
    );

    return this.bbbApiService.buildJoinUrl(server, {
      fullName: moderatorName,
      meetingID: meeting.bbbMeetingId,
      password: moderatorPW,
      logoutURL,
    });
  }

  /**
   * Unified role-based join routing:
   * - TRAINER / ORG_ADMIN => moderator URL
   * - STUDENT with meeting org membership => attendee URL
   * - STUDENT with session entitlement (trial/purchase) => attendee URL
   *
   * Authorization priority:
   * 1. Organization membership (moderator)
   * 2. Organization membership (student → attendee)
   * 3. BbbEntitlement for "bbb_session" type (via activeMeeting → session)
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

    // ─── Path 1: Organization membership (moderator or student) ──────────
    const member = await this.memberService.findActiveMembership(
      ctx,
      customer.id,
      meeting.organization.id,
    );

    if (member) {
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

    // ─── Path 2: Session entitlement (trial/purchase attendee) ───────────
    // Resolve the BbbScheduledSession linked to this meeting (if any)
    const session = await this.connection
      .getRepository(ctx, BbbScheduledSession)
      .findOne({
        where: { activeMeeting: { id: meeting.id as string } },
      });

    if (session) {
      const hasSessionAccess = await this.entitlementService.hasAccess(
        ctx,
        customer.id,
        "bbb_session",
        String(session.id),
      );

      if (hasSessionAccess) {
        return this.getAttendeeJoinUrl(
          ctx,
          meetingId,
          participantName,
          customer.id as string,
        );
      }
    }

    throw new Error(
      "You do not have access to this meeting. Purchase a session or obtain an enrollment to join.",
    );
  }

  // ─── End Meeting (with billing) ─────────────────────────────────────────────

  async endMeeting(ctx: RequestContext, meetingId: ID): Promise<BbbMeeting> {
    await this.channelAccess.assertMeetingAccess(ctx, meetingId);
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
        // Post-ack who-ended contract (BUG-059): a failed /end must not
        // complete the meeting or stamp a human — RETHROW before the stamp
        // below, so endedByUserId stays null and the state stays Active.
        // Reconciliation / the meeting-ended webhook later completes it under
        // a system ctx (keep-first → stays null, W5-11(c)).
        Logger.warn(
          `Failed to end meeting via BBB API: ${(err as Error).message}. Meeting stays ACTIVE; endedByUserId stays null.`,
          loggerCtx,
        );
        throw err;
      }
    }

    // Who-ended audit (post-ack): stamp the REQUESTING user only after BBB
    // acknowledges /end. api.endMeeting THROWS on any failure (typed errors —
    // the catch above rethrows, BUG-059), so a failed end never reaches this
    // line: endedByUserId stays null instead of crediting a human with a
    // meeting that never ended. Conditional write (WHERE endedByUserId IS
    // NULL) so concurrent end requests keep the FIRST requester, never the
    // last. The later webhook/reconcile completion runs under a system ctx
    // and keeps this value (lifecycle keep-first).
    const requesterId =
      ctx.activeUserId != null ? String(ctx.activeUserId) : null;
    if (requesterId != null) {
      await this.connection
        .getRepository(ctx, BbbMeeting)
        .createQueryBuilder()
        .update(BbbMeeting)
        .set({ endedByUserId: requesterId })
        .where("id = :id", { id: String(meeting.id) })
        .andWhere("endedByUserId IS NULL")
        .execute();
    }

    return this.lifecycleService.completeMeetingLifecycle(ctx, meeting, {
      source: "end-meeting",
      endedByUserId: requesterId,
    });
  }

  // ─── Room-based Join ────────────────────────────────────────────────────────

  // INV-027: the old `provisionAndJoin` seam (Gate 1's private join-URL
  // wrapper) was removed with the gates — joinRoom now resolves access through
  // BbbRoomAccessService before provisioning and builds the role-based URL
  // inline, exactly as the entitlement/enrollment path always did.

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
      // W5 audit trail: who launched this room meeting (null = system auto-start).
      startedByUserId: ctx.activeUserId != null ? String(ctx.activeUserId) : null,
    });
    try {
      const saved = await this.connection
        .getRepository(ctx, BbbMeeting)
        .save(meeting);

      // NOTE: setImmediate defers the queue add to avoid a transaction race.
      // The TypeORM save() opens its own transaction; the worker must not
      // query for the meeting before that transaction commits.
      setImmediate(() => {
        // Enqueue via the single provisioning consumer (BbbProvisioningWorkerService).
        this.provisioningEnqueuer
          .enqueueProvisioning(ctx, saved.id)
          .catch((err: unknown) =>
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
   *
   * Access is evaluated first (INV-027 — preview denial ⇔ join denial), then
   * the product invariant "learners never provision" is enforced at this
   * service boundary:
   *
   * - **Moderator (ORG_ADMIN / TRAINER)**
   *   - room Active → returns the moderator join URL.
   *   - room Idle/Failed (within retry budget) → provisions a new meeting and
   *     returns `provisioning`; the frontend polls `bbbRoom(id)` until
   *     `state === Active` and calls again.
   * - **Non-moderator (learner via entitlement/enrollment)**
   *   - room Active → returns the attendee join URL.
   *   - room NOT Active → returns `waiting_for_trainer` and causes **no**
   *     `requestProvisioning`, no `BbbMeeting` row, no room state flip and no
   *     provisioning job (`JOIN_STATUS_WAITING_FOR_TRAINER`).
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

    // ── INV-027 (BUG-045) — authorize BEFORE provisioning ────────────────────
    // Single shared evaluation (BbbRoomAccessService): membership → legacy
    // member → entitlement → enrollment — the same sources bbbRoomStatus uses,
    // so preview denial ⇔ join denial. Previously the gates ran only inside the
    // `status === 'active'` branch AFTER requestProvisioning, so a denied
    // customer could still enqueue a meeting on an idle room, and the two
    // surfaces' source lists had drifted apart (enrollment honored by preview
    // but not join; membership honored by join but not preview).
    const room = await this.roomService.findById(ctx, roomId);
    if (!room) throw new Error("Room not found");

    const access = await this.roomAccessService.evaluate(
      ctx,
      customerId,
      room.organization.id,
      roomId,
    );
    if (!access.allowed) {
      Logger.warn(
        `[joinRoom] access DENIED (INV-027) roomId=${roomId} customerId=${customerId} orgId=${room.organization.id}`,
        loggerCtx,
      );
      throw new Error(
        "You do not have access to this room. Please purchase a plan to join.",
      );
    }
    Logger.info(
      `[joinRoom] access allowed (INV-027) source=${access.source} isModerator=${access.isModerator} customerId=${customerId} roomId=${roomId}`,
      loggerCtx,
    );

    // ── Product invariant — learners never provision ──────────────────────────
    // Tenant Admin / Trainer START a class; learners only JOIN a class that has
    // already been started. An authorized non-moderator on a non-active room
    // gets a terminal "waiting for trainer" answer, returned BEFORE
    // `requestProvisioning` so it causes no BbbMeeting row, no Idle→Provisioning
    // flip and no provisioning job.
    //
    // This sits at the SERVICE boundary (not the resolver) on purpose: any
    // future Shop/Admin caller that reaches `joinRoom` inherits the rule, and
    // INV-027 still guarantees preview denial ⇔ join denial above it.
    if (!access.isModerator && room.state !== "Active") {
      Logger.info(
        `[joinRoom] non-moderator (source=${access.source}) on non-active room ${roomId} (state=${room.state}) → ${JOIN_STATUS_WAITING_FOR_TRAINER}; provisioning skipped`,
        loggerCtx,
      );
      return { status: JOIN_STATUS_WAITING_FOR_TRAINER };
    }

    const result = await this.roomService.requestProvisioning(ctx, roomId);
    Logger.info(
      `[joinRoom] requestProvisioning returned status=${result.status} currentMeetingId=${result.currentMeetingId ?? "null"} shouldEnqueue=${!!result.shouldEnqueue}`,
      loggerCtx,
    );

    if (result.status === "active" && result.currentMeetingId) {
      const isModerator = access.isModerator;
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
            await this.lifecycleService.completeMeetingLifecycle(ctx, result.currentMeetingId, {
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
      // Second fence for the SAME invariant: a non-moderator may only reach
      // here when the room was Active and requestProvisioning decided the
      // Active reference was stale (stale-active rebuild). Letting a learner
      // trigger that rebuild would still be "a non-moderator causing
      // provisioning", so it is refused here too — before the insert.
      if (!access.isModerator) {
        Logger.info(
          `[joinRoom] non-moderator blocked from enqueuing on room ${roomId} (stale-active rebuild) → ${JOIN_STATUS_WAITING_FOR_TRAINER}`,
          loggerCtx,
        );
        return { status: JOIN_STATUS_WAITING_FOR_TRAINER };
      }
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

  // ─── A22 (Phase 5.2) — admin "Start class" ─────────────────────────────────

  /**
   * The admin twin of `joinRoom`, behind the `bbbStartRoom` mutation.
   *
   * Why it exists (A22): the dashboard is Admin-API only, `bbbModeratorJoinUrl`
   * needs an ALREADY Active meeting, and the Shop `bbbJoinRoom` is not
   * reachable with an administrator session — so the tenant Rooms screen had no
   * way to open a class. This reuses joinRoom's exact pieces rather than
   * re-implementing them, so the two surfaces cannot drift:
   *
   *   `BbbRoomAccessService.evaluate` (INV-027) → `requestProvisioning` (Redis
   *   lock + debounce + Idle→Provisioning) → `createRoomMeetingAndEnqueue` →
   *   `getModeratorJoinUrl`.
   *
   * Authorization, in this order:
   *  1. `roomService.findById` asserts room access, so a foreign tenant's room
   *     is ForbiddenError before anything else (INV-029).
   *  2. If the administrator has a linked **Customer**, the shared INV-027
   *     evaluation must return `allowed && isModerator`: a non-member, a buyer
   *     (entitlement) and an enrolled student are all refused, and a refusal
   *     happens BEFORE provisioning — so no meeting row is created.
   *  3. An Administrator with no linked Customer is authorized by the
   *     channel-scoped permission gate on the mutation (`BbbManageRooms` on the
   *     tenant's own channel — Channel=Tenant, INV-001).
   *
   * Returns `status: 'active'` with a moderator `joinUrl` when the room is live,
   * `'starting'` while provisioning is in flight (the UI calls again — repeats
   * are absorbed by the lock/debounce), or `'failed'` when the room is Failed
   * beyond its auto-retry budget.
   */
  async startRoomAsModerator(
    ctx: RequestContext,
    roomId: ID,
    options?: { moderatorName?: string; waitMs?: number },
  ): Promise<StartRoomResult> {
    const room = await this.roomService.findById(ctx, roomId);
    if (!room) throw new EntityNotFoundError("BbbRoom", roomId);

    // ── INV-027: authorize BEFORE provisioning ─────────────────────────────
    const callerCustomerId = await this.resolveCallerCustomerId(ctx);
    if (callerCustomerId !== null) {
      const access = await this.roomAccessService.evaluate(
        ctx,
        callerCustomerId,
        room.organization.id,
        roomId,
      );
      if (!access.allowed || !access.isModerator) {
        Logger.warn(
          `[startRoom] access DENIED (INV-027/A22) roomId=${roomId} customerId=${callerCustomerId} allowed=${access.allowed} isModerator=${access.isModerator} source=${access.source ?? "none"}`,
          loggerCtx,
        );
        throw new ForbiddenError();
      }
      Logger.info(
        `[startRoom] access allowed as moderator (source=${access.source}) customerId=${callerCustomerId} roomId=${roomId}`,
        loggerCtx,
      );
    }

    // ── A22/S4.2: synchronous metered-gate check ───────────────────────────
    // Provisioning itself is async (the worker enforces the same guards inside
    // its try), so without this the synchronous mutation would answer
    // 'starting' for a suspended/spend-capped org and only fail minutes later.
    // This mirrors the worker's `assertMeteredProvisionable` (D2 single money
    // implementation) and returns a tenant-safe 'unavailable' BEFORE anything
    // is enqueued. The message is deliberately generic: the worker's detailed
    // failureReason stays operator-side.
    const gateRefusal = await this.meteredGateRefusal(ctx, room.organization);
    if (gateRefusal) {
      Logger.warn(
        `[startRoom] metered gate refused room ${roomId}: ${gateRefusal.reason}`,
        loggerCtx,
      );
      return {
        status: "unavailable",
        roomState: room.state,
        message: START_ROOM_ACCOUNT_PAUSED_MESSAGE,
      };
    }

    const moderatorName =
      options?.moderatorName?.trim() ||
      (await this.resolveCallerDisplayName(ctx)) ||
      room.name;

    const result = await this.roomService.requestProvisioning(ctx, roomId);

    if (result.status === "active" && result.currentMeetingId) {
      try {
        const joinUrl = await this.getModeratorJoinUrl(
          ctx,
          result.currentMeetingId,
          moderatorName,
        );
        return {
          status: "active",
          joinUrl,
          currentMeetingId: result.currentMeetingId,
          roomState: "Active",
        };
      } catch (err: any) {
        if (err?.message?.includes("already ended on the server")) {
          Logger.warn(
            `[startRoom] room ${roomId} is Active but meeting ${result.currentMeetingId} is stale on BBB — resetting and provisioning again`,
            loggerCtx,
          );
          try {
            await this.lifecycleService.completeMeetingLifecycle(
              ctx,
              result.currentMeetingId,
              { source: "stale-active-runtime" },
            );
          } catch (completeErr) {
            Logger.warn(
              `[startRoom] failed to complete stale meeting: ${(completeErr as Error).message}`,
              loggerCtx,
            );
          }
          await this.createRoomMeetingAndEnqueue(ctx, roomId);
          return { status: "starting", roomState: "Provisioning" };
        }
        // Transient (network/DNS/decrypt): never tear the room down — report
        // progress and let the next call serve the URL.
        Logger.warn(
          `[startRoom] transient join-URL failure for room ${roomId}: ${err?.message}`,
          loggerCtx,
        );
        return {
          status: "starting",
          currentMeetingId: result.currentMeetingId,
          roomState: "Active",
        };
      }
    }

    if (result.shouldEnqueue) {
      await this.createRoomMeetingAndEnqueue(ctx, roomId);
    } else {
      this.metrics.recordProvisioningSuppressed();
    }

    const settled = await this.waitForRoomSettled(ctx, roomId, options?.waitMs);
    if (settled.state === "Failed") {
      const failedMeeting = settled.currentMeetingId
        ? await this.connection
            .getRepository(ctx, BbbMeeting)
            .findOne({ where: { id: settled.currentMeetingId } })
        : null;
      return {
        status: "failed",
        roomState: settled.state,
        message: failedMeeting?.failureReason
          ? this.tenantSafeFailureMessage(failedMeeting.failureReason)
          : undefined,
      };
    }
    if (settled.state === "Active" && settled.currentMeetingId) {
      try {
        const joinUrl = await this.getModeratorJoinUrl(
          ctx,
          settled.currentMeetingId,
          moderatorName,
        );
        return {
          status: "active",
          joinUrl,
          currentMeetingId: settled.currentMeetingId,
          roomState: settled.state,
        };
      } catch (err: any) {
        Logger.warn(
          `[startRoom] room ${roomId} became Active but the join URL is not ready yet: ${err?.message}`,
          loggerCtx,
        );
        return {
          status: "starting",
          currentMeetingId: settled.currentMeetingId,
          roomState: settled.state,
        };
      }
    }

    return {
      status: "starting",
      currentMeetingId: settled.currentMeetingId,
      roomState: settled.state,
    };
  }

  /**
   * Synchronous mirror of the worker's `assertMeteredProvisionable` (S4.2).
   *
   * Grant orgs are always provisionable here (the grant gate runs at worker
   * time); metered orgs are refused when suspended or at/over their monthly
   * spend limit (D2 single money implementation). Returns null when the org
   * may provision.
   */
  private async meteredGateRefusal(
    ctx: RequestContext,
    organization: BbbOrganization,
  ): Promise<{ reason: "suspended" | "spend-limit" } | null> {
    if (!isMeteredOrganization(organization)) return null;
    if (organization.suspended) return { reason: "suspended" };
    const limit = organization.monthlySpendLimitPaise;
    if (limit === null || limit === undefined) return null;
    const rows = await this.meteringService.monthUsageRows(
      ctx,
      String(organization.id),
      monthOf(new Date()),
    );
    const monthCharge = computeMonthChargePaise(rows);
    // Soft ceiling (ADR-047 decision 12): the cap itself stays an unlocked
    // read; the compensating control is visibility — once month-to-date
    // reaches 90% of the limit, an operator alert fires (deduped hourly) so
    // the approach is seen before the refusal is hit.
    if (isApproachingSpendLimit(monthCharge, limit)) {
      this.opsAlert.notify(
        "spend-limit-approach",
        String(organization.id),
        `Org ${String(organization.id)} is at ${monthCharge}/${limit} paise (${Math.floor(
          (monthCharge * 100) / limit,
        )}% of monthly spend limit)`,
        {
          organizationId: String(organization.id),
          channelId: String(organization.channelId ?? ""),
          monthChargePaise: monthCharge,
          limitPaise: limit,
          month: monthOf(new Date()),
        },
      );
    }
    return monthCharge >= limit ? { reason: "spend-limit" } : null;
  }

  /**
   * Maps a worker `failureReason` to a tenant-safe sentence (S4.2).
   *
   * Metered-gate failures (suspended org, monthly spend limit) read as a
   * paused account; everything else gets a generic provisioning sentence.
   * Unknown internals (BBB ids, grant vocabulary, paise amounts) never leave
   * the server — they stay in the worker log + meeting row for operators.
   */
  private tenantSafeFailureMessage(failureReason: string): string {
    const lowered = failureReason.toLowerCase();
    if (
      lowered.includes("suspend") ||
      lowered.includes("spend limit") ||
      lowered.includes("spend-limit")
    ) {
      return START_ROOM_ACCOUNT_PAUSED_MESSAGE;
    }
    // Legacy grant gate (grant-selection.policy.ts PROVISIONING_NO_GRANT_ERROR
    // and PROVISIONING_ALLOWANCE_EXHAUSTED_ERROR). Both raw strings end
    // "Please purchase or renew a plan." — correct for the operator log, but a
    // pricing-message leak on a tenant surface. They also must NOT fall through
    // to the generic retry: re-clicking cannot create a capacity grant, so
    // "try again" would be actively wrong. Grant mode is still reachable
    // (existing rows keep the DDL default), so this is mapped, not dead code.
    if (
      lowered.includes("capacity grant") ||
      lowered.includes("purchase or renew")
    ) {
      return START_ROOM_ACCOUNT_PAUSED_MESSAGE;
    }
    return "Class could not be started — please try again";
  }

  /**
   * Polls the room row while the provisioning worker owns the state machine.
   *
   * A plain repository read — channel ownership was already asserted by
   * `findById` in `startRoomAsModerator`, so this deliberately loads no
   * relations and takes no locks: it must not hold a transaction open across
   * the wait.
   */
  private async waitForRoomSettled(
    ctx: RequestContext,
    roomId: ID,
    waitMs?: number,
  ): Promise<{ state: string; currentMeetingId?: string }> {
    const budget = Math.min(
      waitMs ?? START_ROOM_WAIT_MS_DEFAULT,
      START_ROOM_WAIT_MS_MAX,
    );
    const deadline = Date.now() + Math.max(budget, 0);
    for (;;) {
      const room = await this.connection
        .getRepository(ctx, BbbRoom)
        .findOne({ where: { id: roomId as string } });
      if (!room) throw new EntityNotFoundError("BbbRoom", roomId);
      if (
        room.state === "Active" ||
        room.state === "Failed" ||
        Date.now() >= deadline
      ) {
        return {
          state: room.state,
          currentMeetingId: room.currentMeetingId ?? undefined,
        };
      }
      await new Promise((resolve) =>
        setTimeout(resolve, START_ROOM_POLL_INTERVAL_MS),
      );
    }
  }

  /**
   * The Customer behind the active user, when there is one.
   *
   * Administrators are not customers, so this is a resolution rather than a
   * requirement: `null` means "an administrator session" (see the authorization
   * notes in `startRoomAsModerator`).
   */
  private async resolveCallerCustomerId(
    ctx: RequestContext,
  ): Promise<ID | null> {
    if (!ctx.activeUserId) return null;
    const customer = await this.connection
      .getRepository(ctx, Customer)
      .findOne({ where: { user: { id: ctx.activeUserId as string } } });
    return customer ? customer.id : null;
  }

  /** Best-effort moderator display name for the join URL (admins only). */
  private async resolveCallerDisplayName(
    ctx: RequestContext,
  ): Promise<string | null> {
    if (!ctx.activeUserId) return null;
    const administrator = await this.connection
      .getRepository(ctx, Administrator)
      .findOne({ where: { user: { id: ctx.activeUserId as string } } });
    if (!administrator) return null;
    const name = [administrator.firstName, administrator.lastName]
      .filter(Boolean)
      .join(" ")
      .trim();
    return name.length > 0 ? name : null;
  }

  // ─── Update ────────────────────────────────────────────────────────────────────

  async update(
    ctx: RequestContext,
    id: ID,
    input: { title?: string; recordingEnabled?: boolean },
  ): Promise<BbbMeeting> {
    const meeting = await this.findById(ctx, id);
    if (!meeting) throw new EntityNotFoundError("BbbMeeting", id);
    if (input.title !== undefined) meeting.title = input.title;
    if (input.recordingEnabled !== undefined)
      meeting.recordingEnabled = input.recordingEnabled;
    return this.connection.getRepository(ctx, BbbMeeting).save(meeting);
  }

  // ─── Delete ────────────────────────────────────────────────────────────────────

  async delete(ctx: RequestContext, id: ID): Promise<void> {
    const meeting = await this.findById(ctx, id);
    if (!meeting) throw new EntityNotFoundError("BbbMeeting", id);
    await this.connection.getRepository(ctx, BbbMeeting).remove(meeting);
  }

  // ─── Webhook Handler ─────────────────────────────────────────────────────────

  /**
   * Extracts the external BBB meeting ID from a webhook payload.
   *
   * Supports three payload shapes:
   *
   * 1. Legacy / pre-W3 direct format:
   *    `{ meetingID: "ext-id" }`
   *
   * 2. Old bbb-webhooks nested camelCase (pre-W3 processor):
   *    `{ event: { data: { attributes: { meeting: { externalMeetingId: "ext-id" } } } } }`
   *
   * 3. W3 bbb-webhooks data node (current — processor passes `event.data`):
   *    `{ id: "meeting-ended", attributes: { meeting: { "external-meeting-id": "ext-id" } } }`
   *    Hyphenated keys are the canonical bbb-webhooks source shape.
   *    Falls back to `"internal-meeting-id"` when external is absent.
   *
   * Correlation priority:
   *   externalMeetingId + serverId (preferred — stable across restarts)
   *   internalMeetingId + serverId (fallback — requires nullable
   *     `bbbInternalMeetingId` column, which is already on BbbMeeting)
   *
   * TODO(W3-correlation): the `serverId` parameter is threaded through from
   * the persisted event (BbbWebhookEvent.serverId). Pass it here once the
   * processor is updated to load serverId from the event row. Until then,
   * correlation uses externalMeetingId alone (the current production behaviour
   * is unchanged for meeting-ended; only rap-publish-ended is new and it
   * carries attributes["record-id"], not a meeting ID, so it looks up by
   * bbbRecordingId instead — see handleWebhookEvent).
   */
  private extractBbbMeetingId(payload: Record<string, unknown>): string | null {
    // 1. Legacy direct format
    if (typeof payload.meetingID === "string" && payload.meetingID) {
      return payload.meetingID;
    }
    // 2. Old nested camelCase format
    try {
      const externalId = (payload.event as any)?.data?.attributes?.meeting
        ?.externalMeetingId;
      if (typeof externalId === "string" && externalId) return externalId;
    } catch {
      // ignore
    }
    // 3. W3: processor passes event.data — hyphenated keys from bbb-webhooks source
    try {
      const attrs = (payload.attributes as any)?.meeting;
      if (attrs) {
        const ext = attrs["external-meeting-id"];
        if (typeof ext === "string" && ext) return ext;
        const int_ = attrs["internal-meeting-id"];
        if (typeof int_ === "string" && int_) return int_;
      }
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

  /**
   * Entry point called by BbbWebhookProcessorService.
   *
   * @param serverId  The BbbServer.id that authenticated and received this
   *   event — enforced in meeting lookups so a server cannot complete a
   *   meeting that was provisioned on a different server.
   */
  async handleWebhookEvent(
    ctx: RequestContext,
    eventType: string,
    payload: Record<string, unknown>,
    webhookEventId?: string,
    serverId?: string | null,
  ): Promise<void> {
    // ── rap-publish-ended: correlate on external-meeting-id / record-id ────
    if (eventType === BbbMeetingService.BBB_EVENTS.RECORDING_READY) {
      await this.handleRapPublishEnded(ctx, payload, serverId ?? null);
      return;
    }

    // ── All other events: correlate on external meeting ID + serverId ───────
    const bbbMeetingId = this.extractBbbMeetingId(payload);
    if (!bbbMeetingId) {
      this.metrics.recordWebhookParseFailure();
      return;
    }

    const meetingRepo = this.connection.getRepository(ctx, BbbMeeting);
    let meeting: BbbMeeting | null = null;

    if (serverId) {
      // Preferred: scope lookup to the server that delivered the event.
      meeting = await meetingRepo.findOne({
        where: { bbbMeetingId, serverId },
      });
      if (!meeting) {
        // Fallback: find by external ID alone, then validate server match.
        const byExternal = await meetingRepo.findOne({ where: { bbbMeetingId } });
        if (byExternal && byExternal.serverId && byExternal.serverId !== serverId) {
          Logger.warn(
            `Webhook event "${eventType}" for bbbMeetingId ${bbbMeetingId}: ` +
              `authenticated server ${serverId} does not match meeting.serverId ${byExternal.serverId} — dropping`,
            loggerCtx,
          );
          return;
        }
        meeting = byExternal;
      }
    } else {
      meeting = await meetingRepo.findOne({ where: { bbbMeetingId } });
    }

    if (!meeting) {
      Logger.warn(
        `Webhook event "${eventType}" for unknown bbbMeetingId: ${bbbMeetingId}`,
        loggerCtx,
      );
      return;
    }

    switch (eventType) {
      case BbbMeetingService.BBB_EVENTS.MEETING_ENDED:
        await this.lifecycleService.completeMeetingLifecycle(ctx, meeting, {
          source: "webhook",
        });
        await this.updateTrialAttendanceForMeeting(ctx, meeting, payload);
        // 3D.3b — derive SessionAttendance from the final attendee snapshot.
        // NOTE(attendance-gap): a real meeting-ended event carries no attendee
        // list. The attendee extraction below will always return an empty set.
        // Attendance must be tracked separately by reading getMeetingInfo
        // during metering and recording the userIDs seen at join time.
        // This is tracked as a separate task pending schema approval.
        try {
          const session = await this.connection
            .getRepository(ctx, BbbScheduledSession)
            .findOne({
              where: { activeMeeting: { id: meeting.id as string } },
            });
          if (session) {
            const attendeeIds = this.extractWebhookAttendeeCustomerIds(payload);
            await this.sessionAttendanceService.recordMeetingEndedAttendance(
              ctx,
              session,
              attendeeIds,
              webhookEventId ?? null,
              new Date(),
            );
          }
        } catch (err) {
          Logger.error(
            `Session attendance derivation failed for meeting ${meeting.id}: ${(err as Error).message}`,
            loggerCtx,
          );
        }
        break;
      default:
        Logger.debug(`Unhandled webhook event: ${eventType}`, loggerCtx);
    }
  }

  /**
   * Handle `rap-publish-ended` (recording published).
   *
   * Correlation priority (item 2 fix):
   *   1. attributes.meeting["external-meeting-id"] + serverId  (preferred)
   *   2. attributes["record-id"] against bbbInternalMeetingId + serverId
   *      (record-id IS the internal meeting id in BBB)
   *   3. Same lookups without serverId scope as fallback for events with no
   *      serverId (legacy or mis-configured delivery)
   *
   * bbb-webhooks payload shape (W3, from source):
   * ```
   * {
   *   id: "rap-publish-ended",
   *   attributes: {
   *     "record-id": "<internalMeetingId>",
   *     success: true,
   *     workflow: "presentation",
   *     recording: {
   *       playback: { link?: "…", url?: "…" },  // field name TBC from live capture
   *       ...
   *     },
   *     meeting: { "external-meeting-id": "…", "internal-meeting-id": "…" }
   *   }
   * }
   * ```
   */
  private async handleRapPublishEnded(
    ctx: RequestContext,
    payload: Record<string, unknown>,
    serverId: string | null,
  ): Promise<void> {
    const attrs = (payload.attributes ?? {}) as Record<string, unknown>;

    if (attrs.success !== true) {
      Logger.debug("rap-publish-ended: success !== true, skipping", loggerCtx);
      return;
    }
    const workflow = attrs.workflow as string | undefined;
    if (workflow && workflow !== "presentation") {
      Logger.debug(
        `rap-publish-ended: workflow "${workflow}" is not "presentation", skipping`,
        loggerCtx,
      );
      return;
    }

    const recordId = attrs["record-id"] as string | undefined;
    const recording = (attrs.recording ?? {}) as Record<string, unknown>;
    const playback = (recording.playback ?? {}) as Record<string, unknown>;
    // TODO(W3-playback): confirm field name from live capture — expected .link
    const playbackUrl =
      (playback.link as string | undefined) ??
      (playback.url as string | undefined) ??
      null;

    const meetingRepo = this.connection.getRepository(ctx, BbbMeeting);
    let meeting: BbbMeeting | null = null;

    // Priority 1: external-meeting-id + serverId
    const meetingAttrs = (attrs.meeting ?? {}) as Record<string, unknown>;
    const externalId = meetingAttrs["external-meeting-id"] as string | undefined;

    if (externalId) {
      if (serverId) {
        meeting = await meetingRepo.findOne({
          where: { bbbMeetingId: externalId, serverId },
        });
      }
      if (!meeting) {
        meeting = await meetingRepo.findOne({ where: { bbbMeetingId: externalId } });
        if (meeting && serverId && meeting.serverId && meeting.serverId !== serverId) {
          Logger.warn(
            `rap-publish-ended: externalId ${externalId} found but server mismatch ` +
              `(auth'd=${serverId}, meeting.serverId=${meeting.serverId}) — dropping`,
            loggerCtx,
          );
          return;
        }
      }
    }

    // Priority 2: record-id matches bbbInternalMeetingId (record-id IS the internal meeting id)
    if (!meeting && recordId) {
      if (serverId) {
        meeting = await meetingRepo.findOne({
          where: { bbbInternalMeetingId: recordId, serverId },
        });
      }
      if (!meeting) {
        meeting = await meetingRepo.findOne({ where: { bbbInternalMeetingId: recordId } });
        if (meeting && serverId && meeting.serverId && meeting.serverId !== serverId) {
          Logger.warn(
            `rap-publish-ended: recordId ${recordId} found via bbbInternalMeetingId but server mismatch ` +
              `(auth'd=${serverId}, meeting.serverId=${meeting.serverId}) — dropping`,
            loggerCtx,
          );
          return;
        }
      }
    }

    if (!meeting) {
      Logger.warn(
        `rap-publish-ended: no meeting found (externalId=${externalId ?? "n/a"} recordId=${recordId ?? "n/a"})`,
        loggerCtx,
      );
      return;
    }

    const updates: Partial<Pick<BbbMeeting, "bbbRecordingId" | "recordingUrl">> = {};
    if (recordId && meeting.bbbRecordingId !== recordId) {
      updates.bbbRecordingId = recordId;
    }
    if (playbackUrl && meeting.recordingUrl !== playbackUrl) {
      updates.recordingUrl = playbackUrl;
    }

    if (Object.keys(updates).length > 0) {
      await meetingRepo.update(meeting.id as string, updates);
      Logger.info(
        `rap-publish-ended: meeting ${meeting.id} updated — recordId=${recordId ?? "n/a"} playbackUrl=${playbackUrl ?? "(none)"}`,
        loggerCtx,
      );
    } else {
      Logger.debug(
        `rap-publish-ended: meeting ${meeting.id} already up to date (idempotent)`,
        loggerCtx,
      );
    }
  }

  private extractWebhookAttendeeCustomerIds(
    payload: Record<string, unknown>,
  ): Set<string> {
    const candidates = [
      (payload.meeting as any)?.attendees,
      (payload.event as any)?.data?.attributes?.meeting?.attendees,
      (payload.event as any)?.data?.attributes?.attendees,
      (payload as any).attendees,
    ];

    const attendees = candidates.find((value) => Array.isArray(value)) as
      | Array<Record<string, unknown>>
      | undefined;

    const ids = new Set<string>();
    for (const attendee of attendees ?? []) {
      const id =
        attendee.userId ??
        attendee.userID ??
        attendee.customerId ??
        attendee.externalUserId ??
        (attendee as any).metadata?.customerId;
      if (id != null) ids.add(String(id));
    }
    return ids;
  }

  private async updateTrialAttendanceForMeeting(
    ctx: RequestContext,
    meeting: BbbMeeting,
    payload: Record<string, unknown>,
  ): Promise<void> {
    const session = await this.connection
      .getRepository(ctx, BbbScheduledSession)
      .findOne({
        where: { activeMeeting: { id: meeting.id as string } },
      });

    if (!session) return;

    const registrationRepo = this.connection.getRepository(
      ctx,
      BbbTrialRegistration,
    );
    const registrations = await registrationRepo.find({
      where: { scheduledSessionId: String(session.id) },
    });

    if (!registrations.length) return;

    const attendeeCustomerIds = this.extractWebhookAttendeeCustomerIds(payload);
    const now = new Date();

    for (const registration of registrations) {
      if (attendeeCustomerIds.has(String(registration.customerId))) {
        registration.status = "ATTENDED";
        registration.attendedAt = registration.attendedAt ?? now;
      } else if (registration.status === "REGISTERED") {
        registration.status = "NO_SHOW";
      }
      await registrationRepo.save(registration);
    }

    session.status = "FINISHED";
    await this.connection.getRepository(ctx, BbbScheduledSession).save(session);

    Logger.info(
      `Updated trial attendance for session ${session.id} from meeting-ended webhook: registrations=${registrations.length} attendees=${attendeeCustomerIds.size}`,
      loggerCtx,
    );
  }
}
