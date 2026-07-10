import { Injectable, Logger } from "@nestjs/common";
import {
  Customer,
  CustomerService,
  ID,
  Order,
  RequestContext,
  TransactionalConnection,
  User,
  UserService,
} from "@vendure/core";
import { CustomerDeletionLog } from "./entities/customer-deletion-log.entity";
import type { DeletionType } from "./entities/customer-deletion-log.entity";

const loggerCtx = "CustomerDeletionService";

/**
 * Orchestrates customer deletion across all plugins.
 *
 * Two flows:
 *   Flow A (leave_channel):  Remove customer from a single channel.
 *   Flow B (full_delete):    Remove customer from the entire platform.
 *
 * INV-013: Customer deletion is always anonymization, never cascade delete.
 * Immutable data (ledgers, orders, rewards) retains anonymized foreign keys.
 * No cascade delete from Customer to any table — several FKs (ReviewReport.reporter,
 * ReviewReward.customer, ReviewRequest.customer) are declared onDelete: CASCADE
 * at the DB level and would silently destroy financial/audit data.
 */
@Injectable()
export class CustomerDeletionService {
  constructor(
    private readonly connection: TransactionalConnection,
    private readonly customerService: CustomerService,
    private readonly userService: UserService,
  ) {}

  // ─── Plugin handler registry ──────────────────────────────────────────────

  /**
   * Registered by each plugin that needs to clean up customer data.
   * Called in registration order during deletion.
   */
  private channelScopedHandlers: Array<{
    name: string;
    handler: (ctx: RequestContext, customerId: ID, channelId: string) => Promise<void>;
  }> = [];

  private fullDeleteHandlers: Array<{
    name: string;
    handler: (ctx: RequestContext, customerId: ID) => Promise<void>;
  }> = [];

  /**
   * Register a handler for channel-scoped deletion (Flow A).
   * Called by each plugin's module on init.
   */
  registerChannelScopedHandler(
    name: string,
    handler: (ctx: RequestContext, customerId: ID, channelId: string) => Promise<void>,
  ): void {
    this.channelScopedHandlers.push({ name, handler });
  }

  /**
   * Register a handler for full platform deletion (Flow B).
   * Called by each plugin's module on init.
   */
  registerFullDeleteHandler(
    name: string,
    handler: (ctx: RequestContext, customerId: ID) => Promise<void>,
  ): void {
    this.fullDeleteHandlers.push({ name, handler });
  }

  // ─── Flow A: Leave a single channel ───────────────────────────────────────

  /**
   * Remove the customer from a single channel/academy.
   * The customer record is preserved — they may be active in other channels.
   * channelId is resolved from ctx.channelId, never from client input.
   */
  async removeFromChannel(
    ctx: RequestContext,
    customerId: ID,
    channelId: string,
  ): Promise<void> {
    const log = await this.createLog(customerId, channelId, "leave_channel");

    try {
      Logger.log(
        `Flow A: Removing customer ${customerId} from channel ${channelId}`,
        loggerCtx,
      );

      // 1. Run all registered channel-scoped handlers
      for (const h of this.channelScopedHandlers) {
        Logger.debug(`Running channel-scoped handler: ${h.name}`, loggerCtx);
        await h.handler(ctx, customerId, channelId);
      }

      // 2. Unlink Customer from this Channel (Vendure core)
      const customer = await this.connection
        .getRepository(ctx, Customer)
        .findOne({
          where: { id: customerId as string },
          relations: ["channels"],
        });

      if (customer) {
        customer.channels = (customer.channels || []).filter(
          (c) => c.id !== channelId,
        );
        await this.connection.getRepository(ctx, Customer).save(customer);
      }

      // 3. Mark log as completed
      await this.completeLog(log.id);
      Logger.log(
        `Flow A complete: customer ${customerId} removed from channel ${channelId}`,
        loggerCtx,
      );
    } catch (err: any) {
      await this.failLog(log.id, err.message);
      throw err;
    }
  }

  // ─── Flow B: Full platform deletion ───────────────────────────────────────

  /**
   * Permanently remove the customer from the entire platform.
   * Anonymizes all personal data. Preserves immutable ledger rows (INV-002, INV-010).
   * Uses CustomerService.softDelete() to set deletedAt and fire CustomerEvent.
   */
  async fullDelete(ctx: RequestContext, customerId: ID): Promise<void> {
    const log = await this.createLog(customerId, null, "full_delete");

    try {
      Logger.log(
        `Flow B: Full deletion of customer ${customerId}`,
        loggerCtx,
      );

      // 1. Verify no pending orders — check states where checkout is still in
      //    progress or fulfillment is outstanding. Delivered and Cancelled are
      //    terminal resting states — orders in those states will simply sit in
      //    history (anonymized) per INV-013.
      const pendingOrderStates = [
        "AddingItems",
        "ArrangingPayment",
        "ArrangingAdditionalPayment",
        "Modifying",
        "PaymentAuthorized",
        "PaymentSettled",
        "PartiallyShipped",
        "Shipped",
        "PartiallyDelivered",
      ];
      const pendingOrders = await this.connection
        .getRepository(ctx, Order)
        .count({
          where: {
            customer: { id: customerId as string },
            state: pendingOrderStates as any,
          },
        });

      if (pendingOrders > 0) {
        throw new Error(
          `Customer ${customerId} has ${pendingOrders} active order(s). Complete or cancel before deleting.`,
        );
      }

      // 2. Run all registered full-delete handlers
      for (const h of this.fullDeleteHandlers) {
        Logger.debug(`Running full-delete handler: ${h.name}`, loggerCtx);
        await h.handler(ctx, customerId);
      }

      // 3. Anonymize PII fields on Customer record
      const customer = await this.connection
        .getRepository(ctx, Customer)
        .findOne({ where: { id: customerId as string }, relations: ["user"] });

      if (customer) {
        const deletedEmail = `deleted-${customerId}@saa9vi.invalid`;
        customer.firstName = "[deleted]";
        customer.lastName = "[deleted]";
        customer.emailAddress = deletedEmail;
        customer.phoneNumber = null as any;
        await this.connection.getRepository(ctx, Customer).save(customer);

        // 4. Anonymize User identifier
        if (customer.user) {
          const user = await this.connection
            .getRepository(ctx, User)
            .findOne({ where: { id: customer.user.id as string } });
          if (user) {
            user.identifier = deletedEmail;
            await this.connection.getRepository(ctx, User).save(user);
          }
        }

        // 5. Soft-delete via Vendure core — sets deletedAt, cascades to User,
        //    publishes CustomerEvent('deleted') for downstream subscribers
        await this.customerService.softDelete(ctx, customerId);
      }

      // 6. Mark log as completed
      await this.completeLog(log.id);
      Logger.log(
        `Flow B complete: customer ${customerId} fully deleted`,
        loggerCtx,
      );
    } catch (err: any) {
      await this.failLog(log.id, err.message);
      throw err;
    }
  }

  // ─── Log helpers ──────────────────────────────────────────────────────────

  private async createLog(
    customerId: ID,
    channelId: string | null,
    deletionType: DeletionType,
  ): Promise<CustomerDeletionLog> {
    return this.connection.getRepository(CustomerDeletionLog).save(
      new CustomerDeletionLog({
        customerId: String(customerId),
        channelId,
        deletionType,
        requestedAt: new Date(),
        status: "PENDING",
      }),
    );
  }

  private async completeLog(logId: ID): Promise<void> {
    await this.connection.getRepository(CustomerDeletionLog).update(logId, {
      status: "COMPLETED",
      processedAt: new Date(),
    });
  }

  private async failLog(logId: ID, errorMessage: string): Promise<void> {
    await this.connection.getRepository(CustomerDeletionLog).update(logId, {
      status: "FAILED",
      processedAt: new Date(),
      errorMessage,
    });
  }
}
