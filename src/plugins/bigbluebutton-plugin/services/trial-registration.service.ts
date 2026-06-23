import { Injectable } from "@nestjs/common";
import { RequestContext, TransactionalConnection } from "@vendure/core";
import { BbbTrialRegistration } from "../entities/trial-registration.entity";

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
}