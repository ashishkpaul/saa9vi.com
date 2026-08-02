import { Injectable, Logger } from "@nestjs/common";
import {
  ForbiddenError,
  ID,
  Permission,
  RequestContext,
  TransactionalConnection,
} from "@vendure/core";
import { BbbEntitlement } from "../entities/bbb-entitlement.entity";
import type {
  EntitlementType,
  EntitlementSource,
} from "../entities/bbb-entitlement.entity";
import { BbbChannelAccessService } from "./bbb-channel-access.service";

const loggerCtx = "BbbEntitlementService";

export interface CreateEntitlementInput {
  type: EntitlementType;
  resourceId: string;
  customerId: ID;
  source: EntitlementSource;
  validFrom?: Date | null;
  validUntil?: Date | null;
  channelId?: string | null;
}

/**
 * Manages access entitlements for BBB resources (sessions, rooms).
 *
 * This is the ADR-targeted access primitive. Currently handles:
 * - "bbb_session": scheduled session access (purchased or trial)
 * - "bbb_room": (future) room access
 *
 * Key design decisions:
 * - Entitlements are idempotent: creating the same (customerId, type, resourceId)
 *   twice is a no-op (fails silently).
 * - No admin UI yet. No expiry cron job yet. Those come in later phases.
 */
@Injectable()
export class BbbEntitlementService {
  constructor(
    private readonly connection: TransactionalConnection,
    private readonly channelAccess: BbbChannelAccessService,
  ) {}

  /**
   * Creates an entitlement idempotently — if one already exists for the
   * same (customerId, type, resourceId), the create is silently skipped.
   */
  async create(
    ctx: RequestContext,
    input: CreateEntitlementInput,
  ): Promise<BbbEntitlement> {
    // Enforce channel isolation: a non-SuperAdmin may only create an
    // entitlement for the channel they are operating under.
    if (!ctx.userHasPermissions([Permission.SuperAdmin])) {
      const channelId = ctx.channelId as string;
      if (input.channelId && input.channelId !== channelId) {
        throw new ForbiddenError();
      }
    }

    const existing = await this.connection
      .getRepository(ctx, BbbEntitlement)
      .findOne({
        where: {
          customerId: String(input.customerId),
          type: input.type,
          resourceId: input.resourceId,
        },
      });

    if (existing) {
      Logger.debug(
        `Entitlement already exists for customer=${input.customerId} type=${input.type} resource=${input.resourceId} — skipping`,
        loggerCtx,
      );
      return existing;
    }

    const entitlement = new BbbEntitlement({
      type: input.type,
      resourceId: input.resourceId,
      customerId: String(input.customerId),
      source: input.source,
      validFrom: input.validFrom ?? null,
      validUntil: input.validUntil ?? null,
      channelId: input.channelId ?? null,
    });

    const saved = await this.connection
      .getRepository(ctx, BbbEntitlement)
      .save(entitlement);

    Logger.log(
      `Entitlement created: customer=${saved.customerId} type=${saved.type} resource=${saved.resourceId} source=${saved.source}`,
      loggerCtx,
    );

    return saved;
  }

  /**
   * Checks if a customer has valid (non-expired, started) access.
   */
  async hasAccess(
    ctx: RequestContext,
    customerId: ID,
    type: EntitlementType,
    resourceId: string,
  ): Promise<boolean> {
    const channelId = ctx.channelId as string;
    const entitlement = await this.connection
      .getRepository(ctx, BbbEntitlement)
      .findOne({
        where: {
          customerId: String(customerId),
          type,
          resourceId,
          channelId,
        },
      });

    if (!entitlement) return false;

    const now = new Date();

    // Not started yet
    if (entitlement.validFrom && entitlement.validFrom > now) {
      return false;
    }

    // Expired
    if (entitlement.validUntil && entitlement.validUntil < now) {
      return false;
    }

    return true;
  }

  /**
   * Deletes an entitlement (for revocation or manual override).
   */
  async delete(
    ctx: RequestContext,
    customerId: ID,
    type: EntitlementType,
    resourceId: string,
  ): Promise<void> {
    const channelId = ctx.channelId as string;
    await this.connection.getRepository(ctx, BbbEntitlement).delete({
      customerId: String(customerId),
      type,
      resourceId,
      channelId,
    });
  }
}
