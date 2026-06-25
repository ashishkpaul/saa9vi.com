import { Injectable, OnApplicationBootstrap } from "@nestjs/common";
import {
  EventBus,
  OrderStateTransitionEvent,
  RequestContextService,
  TransactionalConnection,
} from "@vendure/core";

import { ReviewRequestService } from "../services/review-request.service";

@Injectable()
export class ReviewRequestListener implements OnApplicationBootstrap {
  constructor(
    private eventBus: EventBus,
    private reviewRequestService: ReviewRequestService,
    private requestContextService: RequestContextService,
    private connection: TransactionalConnection,
  ) {}

  onApplicationBootstrap() {
    // Listen for order state transitions
    this.eventBus.ofType(OrderStateTransitionEvent).subscribe(async (event) => {
      await this.handleOrderStateTransition(event);
    });
  }

  /**
   * Handle order state transitions to create review requests
   */
  private async handleOrderStateTransition(event: OrderStateTransitionEvent) {
    // Only process transitions to Delivered state
    if (event.toState !== "Delivered") {
      return;
    }

    try {
      const ctx = await this.requestContextService.create({
        apiType: "admin",
        languageCode: event.ctx.languageCode,
        channelOrToken: event.ctx.channel,
      });

      // Create review requests for the delivered order
      const requests = await this.reviewRequestService.createRequestsFromOrder(
        ctx,
        event.order.id,
        {
          reviewDelayDays: 5, // 5 days after delivery
          expiryDays: 60, // 60 days to review
        },
      );

      if (requests.length > 0) {
        console.log(
          `Created ${requests.length} review request(s) for order ${event.order.code}`,
        );
      }
    } catch (error) {
      console.error(
        `Failed to create review requests for order ${event.order.code}`,
        error,
      );
    }
  }
}
