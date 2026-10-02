import { Injectable, Logger } from "@nestjs/common";
import {
  ConfigService,
  EntityNotFoundError,
  ForbiddenError,
  ID,
  RequestContext,
  TransactionalConnection,
} from "@vendure/core";
import { BbbTrialRegistration } from "../entities/trial-registration.entity";
import { BbbScheduledSession } from "../entities/bbb-scheduled-session.entity";
import { BbbEntitlement } from "../entities/bbb-entitlement.entity";
import { BbbRoom } from "../entities/bbb-room.entity";
import { BbbEntitlementService } from "./bbb-entitlement.service";
import { BbbChannelAccessService } from "./bbb-channel-access.service";

const loggerCtx = "TrialRegistrationService";

@Injectable()
export class TrialRegistrationService {
  constructor(
    private readonly connection: TransactionalConnection,
    private readonly entitlementService: BbbEntitlementService,
    private readonly channelAccess: BbbChannelAccessService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Normalize a GraphQL-facing id (e.g. "T_7" under the e2e
   * TestingEntityIdStrategy) to the raw PK form used by the integer id
   * columns here (`scheduledSessionId`, `customerId`, room/registration PKs).
   * Identity under the production AutoIncrementIdStrategy.
   *
   * This service used to pass GraphQL ids straight into repository lookups.
   * That happens to work only when encoded === raw (auto-increment), so under
   * any non-identity strategy (`TestingEntityIdStrategy`, UUID) every
   * registration mutation missed its row. Mirrors `BbbMeetingService.toPk`
   * and `BbbOrganizationService.toInternalId` so the three cannot drift.
   */
  private toPk(id: ID): string {
    const decoded = this.configService.entityIdStrategy.decodeId(String(id));
    return decoded === -1 ? String(id) : String(decoded);
  }

  /**
   * Resolve the registration's owning session and assert the caller may act
   * on it (production-readiness item 2).
   *
   * `BbbTrialRegistration` carries no channel column, so tenant scope is
   * established the same way the list read already does it — through the
   * session's organization (`BbbScheduledSessionService.findByOrganization`
   * asserts this before any registration is ever shown). Until now only the
   * READ path asserted; `updateStatus` and `convertToEnrollment` trusted the
   * raw id, which made them cross-tenant writes. Fail closed when the session
   * is missing rather than proceeding without a tenant scope.
   */
  private async assertRegistrationAccess(
    ctx: RequestContext,
    registration: BbbTrialRegistration,
  ): Promise<BbbScheduledSession> {
    const session = await this.connection
      .getRepository(ctx, BbbScheduledSession)
      .findOne({ where: { id: registration.scheduledSessionId } });
    if (!session) {
      // Unreachable in practice (FK is ON DELETE CASCADE), but a registration
      // without a session has no derivable tenant — never continue blind.
      throw new ForbiddenError();
    }
    await this.channelAccess.assertOrganizationAccess(
      ctx,
      session.organizationId,
    );
    return session;
  }

  async findAllBySession(
    ctx: RequestContext,
    sessionId: string,
  ): Promise<{ items: BbbTrialRegistration[]; totalItems: number }> {
    const [items, totalItems] = await this.connection
      .getRepository(ctx, BbbTrialRegistration)
      .findAndCount({
        where: { scheduledSessionId: this.toPk(sessionId) },
        order: { registeredAt: "DESC" },
      });
    return { items, totalItems };
  }

  async findBySessionAndCustomer(
    ctx: RequestContext,
    sessionId: string,
    customerId: string,
  ): Promise<BbbTrialRegistration | null> {
    return this.connection
      .getRepository(ctx, BbbTrialRegistration)
      .findOne({
        where: { scheduledSessionId: this.toPk(sessionId), customerId },
      });
  }

  async register(
    ctx: RequestContext,
    sessionId: string,
    customerEmail: string,
    customerName: string,
  ): Promise<BbbTrialRegistration> {
    // Use authenticated customer if available, otherwise create from email
    const customerId = ctx.activeUserId as string;
    if (!customerId) {
      throw new Error("Customer authentication required for trial registration");
    }

    const existing = await this.findBySessionAndCustomer(ctx, sessionId, customerId);
    if (existing) {
      return existing;
    }

    // Normalize the GraphQL id once: the raw PK goes into the integer FK
    // column and every repository lookup below (see `toPk`).
    const rawSessionId = this.toPk(sessionId);

    // Validate the session exists and is a trial-eligible session
    const session = await this.connection
      .getRepository(ctx, BbbScheduledSession)
      .findOne({ where: { id: rawSessionId } });

    if (!session) {
      throw new Error(`Scheduled session ${sessionId} not found`);
    }

    if (!session.isTrial) {
      throw new Error(`Session ${sessionId} is not a trial session`);
    }

    // DRAFT sessions are not learner-visible and cannot be registered for.
    if (session.status === "DRAFT") {
      throw new Error(
        `Session ${sessionId} is not yet available for registration. It has not been published.`,
      );
    }

    // Terminal sessions cannot accept new registrations.
    if (session.status === "FINISHED" || session.status === "CANCELLED") {
      throw new Error(
        `Session ${sessionId} is no longer available for registration (status: ${session.status}).`,
      );
    }

    // Capacity check: ensure maxAttendees is not exceeded
    if (session.maxAttendees != null && session.maxAttendees > 0) {
      const registrationRepo = this.connection.getRepository(ctx, BbbTrialRegistration);
      const registrationCount = await registrationRepo.count({
        where: { scheduledSessionId: rawSessionId },
      });
      if (registrationCount >= session.maxAttendees) {
        throw new Error(
          `Trial session ${sessionId} has reached maximum capacity (${session.maxAttendees})`,
        );
      }
    }

    const now = new Date();
    const registration = new BbbTrialRegistration({
      scheduledSessionId: rawSessionId,
      customerId,
      status: "REGISTERED",
      registeredAt: now,
    });

    const saved = await this.connection
      .getRepository(ctx, BbbTrialRegistration)
      .save(registration);

    // ─── Create Entitlement for session access ────────────────────────────
    // This allows the registered trial student to join the session once LIVE.
    // Entitlement validUntil matches the session end time.
    try {
      await this.entitlementService.create(ctx, {
        type: "bbb_session",
        resourceId: rawSessionId,
        customerId,
        source: "trial",
        validFrom: now,
        validUntil: session.endTime,
        channelId: (session as any).channelId ?? null,
      });
    } catch (err) {
      // Non-fatal: entitlement creation failure should not block registration.
      // The student can still be tracked, and entitlement can be backfilled.
      Logger.warn(
        `Failed to create trial entitlement for session ${sessionId} customer ${customerId}: ${(err as Error).message}`,
        loggerCtx,
      );
    }

    return saved;
  }

  async updateStatus(
    ctx: RequestContext,
    id: string,
    status: "REGISTERED" | "ATTENDED" | "CANCELLED" | "NO_SHOW",
  ): Promise<BbbTrialRegistration> {
    const registration = await this.connection.getEntityOrThrow(
      ctx,
      BbbTrialRegistration,
      this.toPk(id),
    );
    // Cross-tenant write guard (production-readiness item 2): the raw id is
    // never trusted — the caller's channel must own the registration's org.
    await this.assertRegistrationAccess(ctx, registration);
    registration.status = status;
    if (status === "ATTENDED") {
      registration.attendedAt = new Date();
    }
    return this.connection.getRepository(ctx, BbbTrialRegistration).save(registration);
  }

  async convertToEnrollment(
    ctx: RequestContext,
    registrationId: string,
    roomId: string,
    accessDays?: number,
  ): Promise<BbbEntitlement> {
    const registration = await this.connection.getEntityOrThrow(
      ctx,
      BbbTrialRegistration,
      this.toPk(registrationId),
    );

    // Channel assert BEFORE any mutation (production-readiness item 2): a
    // tenant must not convert another tenant's registration, and the target
    // room must belong to the SAME organization the registration's session
    // owns — otherwise this mutation is a cross-tenant entitlement write.
    // Mirrors BbbScheduledSessionService.resolveRoomIdForOrganization (D5).
    const session = await this.assertRegistrationAccess(ctx, registration);

    if (registration.status !== "ATTENDED") {
      throw new Error("Only attendees can be converted to enrolled learners.");
    }

    const room = await this.connection
      .getRepository(ctx, BbbRoom)
      .findOne({
        where: {
          id: this.toPk(roomId),
          organization: { id: session.organizationId },
        },
      });
    if (!room) {
      // EntityNotFoundError (not ForbiddenError): whether the id names another
      // tenant's room or no room at all, the answer is "not a room of this
      // organization" — same contract as resolveRoomIdForOrganization.
      throw new EntityNotFoundError("BbbRoom", roomId);
    }

    const expiresAt = accessDays != null
      ? new Date(Date.now() + accessDays * 24 * 60 * 60 * 1000)
      : null;

    const channelId = session.channelId ?? null;

    return this.entitlementService.create(ctx, {
      type: "bbb_room",
      resourceId: String(room.id),
      customerId: registration.customerId,
      source: "trial_conversion",
      validFrom: new Date(),
      validUntil: expiresAt,
      channelId,
    });
  }
}
