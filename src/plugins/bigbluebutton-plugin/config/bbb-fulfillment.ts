import {
  FulfillmentHandler,
  LanguageCode,
  Logger,
  Order,
  OrderProcess,
  OrderService,
  RequestContext,
  TransactionalConnection,
} from "@vendure/core";
import { BbbCapacityGrant } from "../entities/bbb-capacity-grant.entity";
import { BbbProductAccess } from "../entities/bbb-product-access.entity";
import { BbbOrganizationService } from "../services/bbb-organization.service";
import { BbbEntitlementService } from "../services/bbb-entitlement.service";

const loggerCtx = "BbbFulfillment";

let connection: TransactionalConnection;
let orgService: BbbOrganizationService;
let entitlementService: BbbEntitlementService;
let orderService: OrderService;

/**
 * Called when an order line with a BBB product variant is fulfilled.
 *
 * Two things happen:
 *  1. A BbbCapacityGrant is written for the organization (existing behaviour).
 *  2. If the variant maps to a BbbRoom via BbbProductAccess, a BbbEntitlement
 *     (source: 'purchase') is created for the buyer via BbbEntitlementService.
 */
export const bbbFulfillmentHandler = new FulfillmentHandler({
  code: "bbb-access-fulfillment",
  description: [
    {
      languageCode: LanguageCode.en,
      value: "Grants BigBlueButton meeting access to organization",
    },
  ],
  args: {
    grantedHours: {
      type: "int",
      label: [
        { languageCode: LanguageCode.en, value: "Meeting hours granted" },
      ],
      defaultValue: 10,
    },
    validityDays: {
      type: "int",
      label: [
        { languageCode: LanguageCode.en, value: "Grant valid for (days)" },
      ],
      defaultValue: 30,
    },
  },

  init(injector) {
    connection = injector.get(TransactionalConnection);
    orgService = injector.get(BbbOrganizationService);
    entitlementService = injector.get(BbbEntitlementService);
  },

  async createFulfillment(ctx, orders, lines, args) {
    const order = orders[0];

    for (const line of lines) {
      const org = await orgService.findByChannelId(ctx);
      if (!org) {
        Logger.warn(
          `bbbFulfillmentHandler: No BbbOrganization for channel ${ctx.channelId}.`,
          loggerCtx,
        );
        continue;
      }

      // ── 1. Capacity grant (existing, idempotent) ──────────────────────────
      // Guard against fulfillment retries creating duplicate grants.
      const existingGrant = await connection
        .getRepository(ctx, BbbCapacityGrant)
        .findOne({ where: { orderLineId: String(line.orderLineId) } });

      if (!existingGrant) {
        const validFrom = new Date();
        const validUntil = new Date(
          Date.now() + (args.validityDays as number) * 24 * 60 * 60 * 1000,
        );
        // Resolve productVariantId from the order line for traceability
        const orderLine = order.lines.find(
          (l) => String(l.id) === String(line.orderLineId),
        );
        const productVariantId = orderLine
          ? String(orderLine.productVariant.id)
          : undefined;
        const grant = new BbbCapacityGrant({
          organization: org,
          orderId: String(order.id),
          orderLineId: String(line.orderLineId),
          productVariantId,
          grantedMinutes: (args.grantedHours as number) * 60,
          consumedMinutes: 0,
          validFrom,
          validUntil,
          exhausted: false,
        });
        await connection.getRepository(ctx, BbbCapacityGrant).save(grant);
        Logger.info(
          `BBB capacity grant written: org=${org.slug} hours=${args.grantedHours} validUntil=${validUntil.toISOString()}`,
          loggerCtx,
        );
      } else {
        Logger.info(
          `BBB capacity grant already exists for orderLineId=${line.orderLineId}, skipping (retry-safe)`,
          loggerCtx,
        );
      }

      // ── 2. Room entitlement (INV-003) ──────────────────────────────────────
      // Resolve the productVariantId from the order lines.
      const orderLine = order.lines.find(
        (l) => String(l.id) === String(line.orderLineId),
      );
      if (!orderLine) continue;

      const productAccess = await connection
        .getRepository(ctx, BbbProductAccess)
        .findOne({
          where: { productVariantId: String(orderLine.productVariant.id) },
          relations: ["room"],
        });

      if (productAccess) {
        const expiresAt =
          productAccess.accessDays != null
            ? new Date(
                Date.now() +
                  productAccess.accessDays * 24 * 60 * 60 * 1000,
              )
            : null;

        // Resolve buyer's customerId
        const orderWithCustomer = await connection
          .getRepository(ctx, Order)
          .findOne({
            where: { id: order.id as string },
            relations: ["customer"],
          });
        const customerId = String(orderWithCustomer?.customer?.id);
        if (!customerId || customerId === "undefined") {
          Logger.error(
            `bbbFulfillmentHandler: Could not resolve customerId for order ${order.id}`,
            loggerCtx,
          );
          continue;
        }

        const now = new Date();
        await entitlementService.create(ctx, {
          type: "bbb_room",
          resourceId: String(productAccess.room.id),
          customerId,
          source: "purchase",
          validFrom: now,
          validUntil: expiresAt,
          channelId: (ctx.channelId as string) || null,
        });

        Logger.info(
          `BBB entitlement created: room=${productAccess.room.id} customerId=${customerId} orderId=${order.id}`,
          loggerCtx,
        );
      }
    }

    return {
      method: "BBB Access Grant",
      trackingCode: `BBB-GRANT-${String(order.code)}`,
    };
  },
});

/**
 * Hooks into the Vendure order lifecycle for BBB-specific processing.
 */
export const bbbOrderProcess: OrderProcess<string> = {
  init(injector) {
    orderService = injector.get(OrderService);
  },

  async onTransitionEnd(fromState, toState, { ctx, order }) {
    if (
      fromState === "ArrangingPayment" &&
      (toState === "PaymentAuthorized" || toState === "PaymentSettled")
    ) {
      Logger.info(
        `BBB OrderProcess: order ${order.code} reached ${toState} — fulfillment handler will write grant`,
        loggerCtx,
      );
    }
  },
};
