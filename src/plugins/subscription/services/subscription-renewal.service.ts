import { Injectable, Inject, forwardRef } from "@nestjs/common";
import {
  Channel,
  EventBus,
  Logger,
  RequestContextService,
  TransactionalConnection,
} from "@vendure/core";
import { LessThan, In } from "typeorm";
import { OrganizationSubscription } from "../entities/organization-subscription.entity";
import { SubscriptionRenewedEvent, SubscriptionInvoicePaidEvent } from "../events/subscription.events";
import { SubscriptionRenewalQueueService } from "./subscription-renewal-queue.service";
import { RenewalResult } from "../types";

const loggerCtx = "SubscriptionRenewalService";

/**
 * Handles the periodic renewal logic for organization-level SaaS subscriptions.
 * 
 * Separation of Concerns (ADR-037):
 * - processRenewals(): Discovery of pending renewals (ScheduledTask entry point).
 * - executeRenewal(): Execution of a single renewal (JobQueue worker entry point).
 */
@Injectable()
export class SubscriptionRenewalService {
  constructor(
    private readonly connection: TransactionalConnection,
    private readonly eventBus: EventBus,
    private readonly requestContextService: RequestContextService,
    @Inject(forwardRef(() => SubscriptionRenewalQueueService))
    private readonly queueService: SubscriptionRenewalQueueService,
  ) {}

  /**
   * Scans for subscriptions that have passed their currentPeriodEnd and
   * enqueues them for background processing.
   */
  async processRenewals(): Promise<{ enqueued: number; failures: number }> {
    const now = new Date();
    
    // Find subscriptions that are due for renewal.
    const subscriptionsToRenew = await this.connection.rawConnection
      .getRepository(OrganizationSubscription)
      .find({
        where: {
          currentPeriodEnd: LessThan(now),
          status: In(["active", "trialing"]),
        },
        select: ["id"],
      });

    let enqueued = 0;
    let failures = 0;

    for (const sub of subscriptionsToRenew) {
      try {
        await this.queueService.addRenewalJob(sub.id as string);
        enqueued++;
      } catch (err: any) {
        failures++;
        Logger.error(
          `Failed to enqueue renewal for subscription ${sub.id}: ${err.message}`,
          loggerCtx,
        );
      }
    }

    return { enqueued, failures };
  }

  /**
   * Executes the actual renewal for a single subscription.
   * Called by the BullMQ worker.
   */
  async executeRenewal(subscriptionId: string): Promise<RenewalResult> {
    const sub = await this.connection.rawConnection
      .getRepository(OrganizationSubscription)
      .findOne({
        where: { id: subscriptionId },
        relations: ["plan"],
      });

    if (!sub) {
      Logger.error(`Subscription ${subscriptionId} not found for renewal`, loggerCtx);
      return RenewalResult.SUBSCRIPTION_NOT_FOUND;
    }

    const oldVersion = sub.version;
    const newVersion = oldVersion + 1;
    const oldPeriodEnd = sub.currentPeriodEnd;
    
    // Default to a 1-month billing cycle.
    const newPeriodStart = new Date(oldPeriodEnd);
    const newPeriodEnd = new Date(oldPeriodEnd);
    newPeriodEnd.setMonth(newPeriodEnd.getMonth() + 1);

    /**
     * CAS Update (INV-017 / RFC-001 §2.2):
     * We increment the version and update timestamps ONLY if the version
     * matches what we read. This prevents double-billing if two workers
     * attempt to renew the same subscription simultaneously.
     */
    const updateResult = await this.connection.rawConnection
      .createQueryBuilder()
      .update(OrganizationSubscription)
      .set({
        version: newVersion,
        currentPeriodStart: newPeriodStart,
        currentPeriodEnd: newPeriodEnd,
        status: "active",
      })
      .where("id = :id AND version = :version", {
        id: sub.id,
        version: oldVersion,
      })
      .execute();

    if (updateResult.affected !== 1) {
      // Another worker already performed this renewal.
      return RenewalResult.CAS_CONFLICT;
    }

    /**
     * PROD SEAM: Juspay Billing Path (INV-018 / INV-023).
     * In a real environment, this is where we'd call the Juspay API.
     * For now, we simulate a successful charge.
     */
    const simulatedInvoiceId = `INV-${sub.id}-${Date.now()}`;

    // Fix BUG-021-style channel resolution: create() expects token or entity, not raw ID.
    const channel = await this.connection.rawConnection
      .getRepository(Channel)
      .findOne({ where: { id: sub.channelId } });

    if (!channel) {
      /**
       * CRITICAL: Channel missing (INV-018 / BUG-033).
       * The subscription period has already advanced in the DB via CAS!
       * This needs manual investigation as side effects (grants/invoices) failed.
       */
      Logger.error(
        `Channel ${sub.channelId} not found for subscription ${sub.id}. PERIOD ADVANCED WITHOUT GRANTS! Needs investigation.`,
        loggerCtx,
      );
      return RenewalResult.CHANNEL_NOT_FOUND;
    }

    const ctx = await this.requestContextService.create({
      apiType: "admin",
      channelOrToken: channel, // Passing the entity is safe and avoids token-lookup failure
    });

    // 1. Publish Renewed Event (Triggers BbbSubscriptionListener → minutes grant)
    this.eventBus.publish(
      new SubscriptionRenewedEvent(
        ctx,
        sub,
        sub.channelId,
        newPeriodStart,
        newPeriodEnd,
        sub.plan.includedBbbMinutes,
      ),
    );

    // 2. Publish Invoice Paid Event (Future-proofing for accounting/tax/Juspay reconciliation)
    this.eventBus.publish(
      new SubscriptionInvoicePaidEvent(
        ctx,
        sub,
        simulatedInvoiceId,
        sub.plan.monthlyPriceInPaise,
      ),
    );

    Logger.info(
      `Renewed subscription ${sub.id} for channel ${sub.channelId} (New Period: ${newPeriodStart.toISOString()} -> ${newPeriodEnd.toISOString()})`,
      loggerCtx,
    );

    return RenewalResult.SUCCESS;
  }
}
