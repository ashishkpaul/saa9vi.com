import { Injectable } from "@nestjs/common";
import { RequestContext, TransactionalConnection } from "@vendure/core";
import { BbbTrialRegistration } from "../entities/trial-registration.entity";
import { BbbEnrollment } from "../entities/bbb-enrollment.entity";
import { BbbRoom } from "../entities/bbb-room.entity";

@Injectable()
export class TrialRegistrationService {
  constructor(private readonly connection: TransactionalConnection) {}

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

    const registration = new BbbTrialRegistration({
      scheduledSessionId: sessionId,
      customerId,
      status: "REGISTERED",
      registeredAt: new Date(),
    });

    return this.connection.getRepository(ctx, BbbTrialRegistration).save(registration);
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
  ): Promise<BbbEnrollment> {
    const registration = await this.connection.getEntityOrThrow(
      ctx,
      BbbTrialRegistration,
      registrationId,
    );

    if (registration.status !== "ATTENDED") {
      throw new Error("Only attendees can be converted to enrolled learners.");
    }

    const room = await this.connection.getEntityOrThrow(ctx, BbbRoom, roomId);

    const expiresAt = accessDays != null
      ? new Date(Date.now() + accessDays * 24 * 60 * 60 * 1000)
      : null;

    // Check for existing deactivated enrollment to reactivate
    const existing = await this.connection
      .getRepository(ctx, BbbEnrollment)
      .findOne({
        where: { roomId, customerId: registration.customerId },
      });

    if (existing) {
      existing.active = true;
      existing.expiresAt = expiresAt;
      existing.source = "trial_conversion";
      return this.connection.getRepository(ctx, BbbEnrollment).save(existing);
    }

    // Create fresh enrollment
    const enrollment = new BbbEnrollment({
      room,
      roomId,
      customerId: registration.customerId,
      orderId: null,
      active: true,
      expiresAt,
      source: "trial_conversion",
    });

    return this.connection.getRepository(ctx, BbbEnrollment).save(enrollment);
  }
}
