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
import { BbbScheduledSession } from "../entities/bbb-scheduled-session.entity";
import { BbbEntitlementService } from "../services/bbb-entitlement.service";

const loggerCtx = "BbbOrderFulfillmentListener";

/**
 * Automatically provisions BBB room enrollments when an order is paid.
 *
 * This handler provides dual-path provisioning:
 * 1. Session products (BbbScheduledSession.productVariantId match):
 *    Creates BbbEntitlement for "bbb_session" access type.
 * 2. Room products (BbbProductAccess → BbbRoom match):
 *    Creates BbbEnrollment for room access (legacy path).
 *
 * Both paths operate idempotently — if access already exists, it is updated
 * rather than duplicated.
 */
@Injectable()
export class BbbOrderFulfillmentListener implements OnApplicationBootstrap {
  constructor(
    private readonly eventBus: EventBus,
    private readonly connection: TransactionalConnection,
    private readonly entitlementService: BbbEntitlementService,
  ) {}

  onApplicationBootstrap(): void {
    this.eventBus.ofType(OrderStateTransitionEvent).subscribe((event) => {
      if (event.toState !== "PaymentSettled") return;

      this.handlePaymentSettled(event.ctx, event.order as Order).catch((err) => {
        Logger.error(
          `Failed to provision BBB access for order ${event.order.code}: ${(err as Error).message}`,
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
        `Order ${eventOrder.code} reached PaymentSettled without a customer; skipping BBB access provisioning`,
        loggerCtx,
      );
      return;
    }

    const customerId = String(order.customer.id);
    const now = new Date();

    for (const line of order.lines ?? []) {
      const productVariantId = String(line.productVariant?.id ?? "");
      if (!productVariantId) continue;

      // ─── Session product path (Entitlement-based) ─────────────────────────
      // Check if this productVariantId matches a BbbScheduledSession first.
      // This is the preferred path — session-specific access via Entitlement.
      const session = await this.connection
        .getRepository(ctx, BbbScheduledSession)
        .findOne({
          where: { productVariantId },
        });

      if (session) {
        await this.entitlementService.create(ctx, {
          type: "bbb_session",
          resourceId: String(session.id),
          customerId,
          source: "purchase",
          validFrom: now,
          validUntil: session.endTime,
          channelId: (session as any).channelId ?? null,
        });

        Logger.info(
          `Provisioned session entitlement: customer=${customerId} session=${session.id} order=${order.code}`,
          loggerCtx,
        );
        continue; // Skip room path for session purchases
      }

      // ─── Room product path (BbbEnrollment-based, legacy) ──────────────────
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

      const enrollmentRepo = this.connection.getRepository(ctx, BbbEnrollment);
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
