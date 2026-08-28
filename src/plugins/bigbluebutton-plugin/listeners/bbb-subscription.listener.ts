import { Injectable, OnModuleInit } from "@nestjs/common";
import { EventBus, Logger, TransactionalConnection } from "@vendure/core";
import { BbbCapacityGrant } from "../entities/bbb-capacity-grant.entity";
import { BbbOrganization } from "../entities/bbb-organization.entity";
import { SubscriptionRenewedEvent } from "../../subscription/events/subscription.events";

const loggerCtx = "BbbSubscriptionListener";

@Injectable()
export class BbbSubscriptionListener implements OnModuleInit {
  constructor(
    private readonly eventBus: EventBus,
    private readonly connection: TransactionalConnection,
  ) {}

  onModuleInit() {
    this.eventBus.ofType(SubscriptionRenewedEvent).subscribe(async (event) => {
      try {
        const org = await this.connection
          .getRepository(event.ctx, BbbOrganization)
          .findOne({ where: { channelId: event.channelId } });

        if (!org) {
          Logger.warn(
            `SubscriptionRenewedEvent: No BbbOrganization found for channelId ${event.channelId}`,
            loggerCtx,
          );
          return;
        }

        // BUG-032: Idempotency check for recurring grants
        const existingGrant = await this.connection
          .getRepository(event.ctx, BbbCapacityGrant)
          .findOne({
            where: {
              organization: { id: org.id },
              validFrom: event.billingPeriodStart,
              sourceType: "subscription",
            },
          });

        if (existingGrant) {
          Logger.warn(
            `SubscriptionRenewedEvent: Duplicate grant attempted for org=${org.slug} validFrom=${event.billingPeriodStart}. Skipping.`,
            loggerCtx,
          );
          return;
        }

        const grant = new BbbCapacityGrant({
          organization: org,
          grantedMinutes: event.grantedMinutes,
          consumedMinutes: 0,
          validFrom: event.billingPeriodStart,
          validUntil: event.billingPeriodEnd,
          exhausted: false,
          sourceType: "subscription",
          isUnbounded: false,
        });

        const saved = await this.connection
          .getRepository(event.ctx, BbbCapacityGrant)
          .save(grant);

        Logger.info(
          `Created recurring subscription capacity grant: org=${org.slug} grantId=${saved.id} minutes=${event.grantedMinutes}`,
          loggerCtx,
        );
      } catch (err: any) {
        Logger.error(
          `Failed to process SubscriptionRenewedEvent for channel ${event.channelId}: ${err.message}`,
          loggerCtx,
        );
      }
    });
  }
}
