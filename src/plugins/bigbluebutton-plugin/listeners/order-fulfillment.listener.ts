import { Injectable, OnApplicationBootstrap } from "@nestjs/common";
import {
  EventBus,
  Logger,
  Order,
  OrderStateTransitionEvent,
  RequestContext,
  TransactionalConnection,
} from "@vendure/core";
import { BbbEnrollment } from "../entities/bbb-enrollment.entity";
import { BbbProductAccess } from "../entities/bbb-product-access.entity";

const loggerCtx = "BbbOrderFulfillmentListener";

/**
 * Automatically provisions BBB room enrollments when an order is paid.
 *
 * This complements the manual fulfillment handler by making enrollment creation
 * happen directly from the Vendure order lifecycle. It uses the existing
 * BbbProductAccess mapping table rather than ProductVariant custom fields, so
 * it stays aligned with the dashboard-managed product → room configuration.
 */
@Injectable()
export class BbbOrderFulfillmentListener implements OnApplicationBootstrap {
  constructor(
    private readonly eventBus: EventBus,
    private readonly connection: TransactionalConnection,
  ) {}

  onApplicationBootstrap(): void {
    this.eventBus.ofType(OrderStateTransitionEvent).subscribe((event) => {
      if (event.toState !== "PaymentSettled") return;

      this.handlePaymentSettled(event.ctx, event.order as Order).catch((err) => {
        Logger.error(
          `Failed to provision BBB enrollments for order ${event.order.code}: ${(err as Error).message}`,
          loggerCtx,
        );
      });
    });
  }

  private async handlePaymentSettled(
    ctx: RequestContext,
    eventOrder: Order,
  ): Promise<void> {
    const order = await this.connection.getRepository(ctx, Order).findOne({
      where: { id: eventOrder.id as string },
      relations: ["customer", "lines", "lines.productVariant"],
    });

    if (!order?.customer) {
      Logger.warn(
        `Order ${eventOrder.code} reached PaymentSettled without a customer; skipping BBB enrollment provisioning`,
        loggerCtx,
      );
      return;
    }

    const customerId = String(order.customer.id);
    const enrollmentRepo = this.connection.getRepository(ctx, BbbEnrollment);

    for (const line of order.lines ?? []) {
      const productVariantId = String(line.productVariant?.id ?? "");
      if (!productVariantId) continue;

      const productAccess = await this.connection
        .getRepository(ctx, BbbProductAccess)
        .findOne({
          where: { productVariantId },
          relations: ["room"],
        });

      if (!productAccess?.room) continue;

      const roomId = String(productAccess.room.id);
      const expiresAt =
        productAccess.accessDays != null
          ? new Date(Date.now() + productAccess.accessDays * 24 * 60 * 60 * 1000)
          : null;
      const now = new Date();

      const existing = await enrollmentRepo.findOne({
        where: { roomId, customerId },
      });

      if (existing) {
        existing.active = true;
        existing.orderId = String(order.id);
        existing.expiresAt = expiresAt;
        existing.validFrom = now;
        existing.validUntil = expiresAt;
        existing.source = "purchase";
        await enrollmentRepo.save(existing);
        Logger.info(
          `Reactivated BBB enrollment room=${roomId} customer=${customerId} order=${order.code}`,
          loggerCtx,
        );
        continue;
      }

      await enrollmentRepo.save(
        new BbbEnrollment({
          room: productAccess.room,
          roomId,
          customerId,
          orderId: String(order.id),
          active: true,
          validFrom: now,
          validUntil: expiresAt,
          expiresAt,
          source: "purchase",
        }),
      );

      Logger.info(
        `Provisioned BBB enrollment room=${roomId} customer=${customerId} order=${order.code}`,
        loggerCtx,
      );
    }
  }
}