import { Injectable, Logger } from "@nestjs/common";
import { RequestContext, TransactionalConnection } from "@vendure/core";
import { BbbTrialRegistration } from "../entities/trial-registration.entity";
import { BbbScheduledSession } from "../entities/bbb-scheduled-session.entity";
import { BbbEntitlement } from "../entities/bbb-entitlement.entity";
import { BbbEntitlementService } from "./bbb-entitlement.service";

const loggerCtx = "TrialRegistrationService";

@Injectable()
export class TrialRegistrationService {
  constructor(
    private readonly connection: TransactionalConnection,
    private readonly entitlementService: BbbEntitlementService,
  ) {}

  async findAllBySession(
    ctx: RequestContext,
    sessionId: string,
  ): Promise<{ items: BbbTrialRegistration[]; totalItems: number }> {
    const [items, totalItems] = await this.connection
      .getRepository(ctx, BbbTrialRegistration)
      .findAndCount({
        where: { scheduledSessionId: sessionId },
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
        where: { scheduledSessionId: sessionId, customerId },
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

    // Validate the session exists and is a trial-eligible session
    const session = await this.connection
      .getRepository(ctx, BbbScheduledSession)
      .findOne({ where: { id: sessionId } });

    if (!session) {
      throw new Error(`Scheduled session ${sessionId} not found`);
    }

    if (!session.isTrial) {
      throw new Error(`Session ${sessionId} is not a trial session`);
    }

    // Capacity check: ensure maxAttendees is not exceeded
    if (session.maxAttendees != null && session.maxAttendees > 0) {
      const registrationRepo = this.connection.getRepository(ctx, BbbTrialRegistration);
      const registrationCount = await registrationRepo.count({
        where: { scheduledSessionId: sessionId },
      });
      if (registrationCount >= session.maxAttendees) {
        throw new Error(
          `Trial session ${sessionId} has reached maximum capacity (${session.maxAttendees})`,
        );
      }
    }

    const now = new Date();
    const registration = new BbbTrialRegistration({
      scheduledSessionId: sessionId,
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
        resourceId: sessionId,
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
      id,
    );
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
      registrationId,
    );

    if (registration.status !== "ATTENDED") {
      throw new Error("Only attendees can be converted to enrolled learners.");
    }

    const expiresAt = accessDays != null
      ? new Date(Date.now() + accessDays * 24 * 60 * 60 * 1000)
      : null;

    const session = await this.connection
      .getRepository(ctx, BbbScheduledSession)
      .findOne({ where: { id: registration.scheduledSessionId } });

    const channelId = (session as any)?.channelId ?? null;

    return this.entitlementService.create(ctx, {
      type: "bbb_room",
      resourceId: roomId,
      customerId: registration.customerId,
      source: "trial_conversion",
      validFrom: new Date(),
      validUntil: expiresAt,
      channelId,
    });
  }
}
