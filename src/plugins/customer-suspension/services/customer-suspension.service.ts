import { Injectable, Logger } from "@nestjs/common";
import {
  Customer,
  ID,
  RequestContext,
  TransactionalConnection,
} from "@vendure/core";
import { CustomerChannelStatus, CustomerStatus } from "../entities/customer-channel-status.entity";
import { CustomerStatusChangeLog, StatusScope } from "../entities/customer-status-change-log.entity";

const loggerCtx = "CustomerSuspensionService";

/**
 * Manages customer suspension at both platform-wide and channel-scoped levels.
 *
 * Two independent status axes:
 *   - Platform-wide: Stored in Customer.customFields.status (SuperAdmin only)
 *   - Channel-scoped: Stored in CustomerChannelStatus entity (academy admin or SuperAdmin)
 *
 * INV-014: Both levels are checked at checkout via OrderProcess.onTransitionStart.
 * Suspension blocks NEW checkouts only — existing entitlements continue until natural expiry.
 */
@Injectable()
export class CustomerSuspensionService {
  constructor(private readonly connection: TransactionalConnection) {}

  // ─── Platform-wide Suspension ──────────────────────────────────────────────

  /**
   * Suspend a customer across all channels/platform-wide.
   * Restricted to SuperAdmin via @Allow decorator in the resolver.
   */
  async suspendPlatformWide(
    ctx: RequestContext,
    customerId: ID,
    reason?: string | null,
  ): Promise<void> {
    const customer = await this.connection
      .getRepository(ctx, Customer)
      .findOne({ where: { id: customerId as string } });

    if (!customer) {
      throw new Error(`Customer ${customerId} not found`);
    }

    const previousStatus = (customer as any).customFields?.status || "Active";

    if (previousStatus === "Suspended") {
      Logger.debug(
        `Customer ${customerId} already suspended at platform level`,
        loggerCtx,
      );
      return;
    }

    // Update the custom field directly on the entity (like CustomerDeletionService does)
    (customer as any).customFields = {
      ...(customer as any).customFields,
      status: "Suspended",
    };
    await this.connection.getRepository(ctx, Customer).save(customer);

    // Log the change
    await this.logStatusChange(
      ctx,
      String(customerId),
      null, // platform-wide, no channelId
      "platform",
      previousStatus,
      "Suspended",
      reason ?? null,
    );

    Logger.log(
      `Customer ${customerId} suspended at platform level. Reason: ${reason || "N/A"}`,
      loggerCtx,
    );
  }

  /**
   * Reinstate a customer across all channels/platform-wide.
   */
  async reinstatePlatformWide(
    ctx: RequestContext,
    customerId: ID,
  ): Promise<void> {
    const customer = await this.connection
      .getRepository(ctx, Customer)
      .findOne({ where: { id: customerId as string } });

    if (!customer) {
      throw new Error(`Customer ${customerId} not found`);
    }

    const previousStatus = (customer as any).customFields?.status || "Active";

    if (previousStatus !== "Suspended") {
      Logger.debug(
        `Customer ${customerId} not suspended at platform level, nothing to reinstate`,
        loggerCtx,
      );
      return;
    }

    (customer as any).customFields = {
      ...(customer as any).customFields,
      status: "Active",
    };
    await this.connection.getRepository(ctx, Customer).save(customer);

    await this.logStatusChange(
      ctx,
      String(customerId),
      null,
      "platform",
      previousStatus,
      "Active",
      null,
    );

    Logger.log(
      `Customer ${customerId} reinstated at platform level`,
      loggerCtx,
    );
  }

  // ─── Channel-scoped Suspension ────────────────────────────────────────────

  /**
   * Suspend a customer for a specific channel/academy.
   * Academy admins can only suspend customers in their own channel.
   * SuperAdmins can suspend in any channel (checked via channel permission scoping).
   */
  async suspendInChannel(
    ctx: RequestContext,
    customerId: ID,
    channelId: string,
    reason?: string | null,
  ): Promise<void> {
    const existing = await this.connection
      .getRepository(ctx, CustomerChannelStatus)
      .findOne({
        where: { customerId: String(customerId), channelId },
      });

    const previousStatus = existing?.status || "Active";

    if (previousStatus === "Suspended") {
      Logger.debug(
        `Customer ${customerId} already suspended in channel ${channelId}`,
        loggerCtx,
      );
      return;
    }

    if (existing) {
      existing.status = "Suspended";
      existing.reason = reason ?? null;
      await this.connection.getRepository(ctx, CustomerChannelStatus).save(existing);
    } else {
      const status = new CustomerChannelStatus({
        customerId: String(customerId),
        channelId,
        status: "Suspended",
        reason: reason ?? null,
      });
      await this.connection.getRepository(ctx, CustomerChannelStatus).save(status);
    }

    await this.logStatusChange(
      ctx,
      String(customerId),
      channelId,
      "channel",
      previousStatus,
      "Suspended",
      reason ?? null,
    );

    Logger.log(
      `Customer ${customerId} suspended in channel ${channelId}. Reason: ${reason || "N/A"}`,
      loggerCtx,
    );
  }

  /**
   * Reinstate a customer for a specific channel/academy.
   */
  async reinstateInChannel(
    ctx: RequestContext,
    customerId: ID,
    channelId: string,
  ): Promise<void> {
    const existing = await this.connection
      .getRepository(ctx, CustomerChannelStatus)
      .findOne({
        where: { customerId: String(customerId), channelId },
      });

    if (!existing) {
      Logger.debug(
        `No channel status record found for customer ${customerId} in channel ${channelId}`,
        loggerCtx,
      );
      return;
    }

    const previousStatus = existing.status;

    if (previousStatus !== "Suspended") {
      Logger.debug(
        `Customer ${customerId} not suspended in channel ${channelId}`,
        loggerCtx,
      );
      return;
    }

    existing.status = "Active";
    existing.reason = null;
    await this.connection.getRepository(ctx, CustomerChannelStatus).save(existing);

    await this.logStatusChange(
      ctx,
      String(customerId),
      channelId,
      "channel",
      previousStatus,
      "Active",
      null,
    );

    Logger.log(
      `Customer ${customerId} reinstated for channel ${channelId}`,
      loggerCtx,
    );
  }

  /**
   * Find the channel status entity for a customer in a specific channel.
   * Used by the admin resolver for querying status.
   */
  async findChannelStatus(
    ctx: RequestContext,
    customerId: ID,
    channelId: string,
  ): Promise<CustomerChannelStatus | null> {
    return this.connection
      .getRepository(ctx, CustomerChannelStatus)
      .findOne({
        where: { customerId: String(customerId), channelId },
      });
  }

  /**
   * Check if a customer is suspended at either level.
   * This is the single enforcement point used by OrderProcess.
   *
   * Returns: 'platform', 'channel', or null (not suspended)
   */
  async getSuspensionScope(
    ctx: RequestContext,
    customerId: ID,
    channelId: string,
  ): Promise<"platform" | "channel" | null> {
    // Check platform-wide status first (takes precedence)
    const customer = await this.connection
      .getRepository(ctx, Customer)
      .findOne({ where: { id: customerId as string } });

    if ((customer as any).customFields?.status === "Suspended") {
      return "platform";
    }

    // Check channel-scoped status
    const channelStatus = await this.connection
      .getRepository(ctx, CustomerChannelStatus)
      .findOne({
        where: { customerId: String(customerId), channelId },
      });

    if (channelStatus?.status === "Suspended") {
      return "channel";
    }

    return null;
  }

  // ─── Audit Log Helper ───────────────────────────────────────────────────────

  private async logStatusChange(
    ctx: RequestContext,
    customerId: string,
    channelId: string | null,
    scope: StatusScope,
    previousStatus: string,
    newStatus: string,
    reason: string | null,
  ): Promise<CustomerStatusChangeLog> {
    const log = new CustomerStatusChangeLog({
      customerId,
      channelId,
      scope,
      previousStatus,
      newStatus,
      reason,
      changedByAdministratorId: ctx.activeUserId?.toString() ?? null,
      changedAt: new Date(),
    });

    return await this.connection.getRepository(ctx, CustomerStatusChangeLog).save(log);
  }

  // ─── Query Methods ──────────────────────────────────────────────────────────

  /**
   * List all channel status records for a customer.
   */
  async listChannelStatuses(
    ctx: RequestContext,
    customerId: ID,
  ): Promise<CustomerChannelStatus[]> {
    return this.connection
      .getRepository(ctx, CustomerChannelStatus)
      .find({
        where: { customerId: String(customerId) },
        order: { createdAt: "DESC" },
      });
  }

  /**
   * List status change log with optional filters.
   */
  async listStatusChanges(
    ctx: RequestContext,
    options?: {
      customerId?: ID;
      channelId?: string;
      scope?: StatusScope;
    },
  ): Promise<CustomerStatusChangeLog[]> {
    const where: any = {};

    if (options?.customerId) {
      where.customerId = String(options.customerId);
    }
    if (options?.channelId) {
      where.channelId = options.channelId;
    }
    if (options?.scope) {
      where.scope = options.scope;
    }

    return this.connection
      .getRepository(ctx, CustomerStatusChangeLog)
      .find({
        where,
        order: { changedAt: "DESC" },
      });
  }
}
