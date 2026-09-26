import {
  Fulfillment,
  FulfillmentHandler,
  FulfillmentService,
  LanguageCode,
  Logger,
  Order,
  OrderLine,
  OrderProcess,
  OrderService,
  RequestContext,
  TransactionalConnection,
} from "@vendure/core";
import { In } from "typeorm";
import { BbbCapacityGrant } from "../entities/bbb-capacity-grant.entity";
import { BbbProductAccess } from "../entities/bbb-product-access.entity";
import { BbbScheduledSession } from "../entities/bbb-scheduled-session.entity";
import { BbbOrganizationService } from "../services/bbb-organization.service";
import { BbbEntitlementService } from "../services/bbb-entitlement.service";

const loggerCtx = "BbbFulfillment";

let connection: TransactionalConnection;
let orgService: BbbOrganizationService;
let entitlementService: BbbEntitlementService;
let orderService: OrderService;
let fulfillmentService: FulfillmentService;

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

    // ── 0. Resolve the order lines ONCE ────────────────────────────────────
    // The `order` handed to this handler comes from Vendure's
    // getOrdersFromLines(), which loads relations ['order', 'order.channels']
    // only — its `lines` relation is undefined. Reading `order.lines.find`
    // therefore threw "Cannot read properties of undefined (reading 'find')",
    // making EVERY addFulfillmentToOrder call fail with CREATE_FULFILLMENT_ERROR
    // so no order-source capacity grant could ever be written
    // (proved by R4-02, 2026-09-25).
    //
    // This is the documented Vendure pattern: load the OrderLines from the
    // `lines` input rather than from `order.lines` — see the canonical
    // `digitalFulfillmentHandler` in the Digital Products guide, which does the
    // same `find({ where: { id: In(lines.map(l => l.orderLineId)) },
    // relations: { productVariant: true } })`.
    const orderLinesById = new Map<string, OrderLine>();
    const resolvedLines = await connection.getRepository(ctx, OrderLine).find({
      where: { id: In(lines.map((l) => String(l.orderLineId))) },
      relations: { productVariant: true },
    });
    for (const l of resolvedLines) {
      orderLinesById.set(String(l.id), l);
    }

    for (const line of lines) {
      const org = await orgService.findByChannelId(ctx);
      if (!org) {
        Logger.warn(
          `bbbFulfillmentHandler: No BbbOrganization for channel ${ctx.channelId}.`,
          loggerCtx,
        );
        continue;
      }

      const orderLine = orderLinesById.get(String(line.orderLineId));
      const productVariantId = orderLine?.productVariant
        ? String(orderLine.productVariant.id)
        : undefined;

      // ── 1. Capacity grant (existing, idempotent) ──────────────────────────
      // Guard against fulfillment retries creating duplicate grants.
      const existingGrant = await connection
        .getRepository(ctx, BbbCapacityGrant)
        .findOne({ where: { orderLineId: String(line.orderLineId) } });

      if (!existingGrant) {
        const validFrom = new Date();
        const validityDays = Number(args.validityDays) || 30;
        const grantedHours = Number(args.grantedHours) || 10;
        const validUntil = new Date(
          Date.now() + validityDays * 24 * 60 * 60 * 1000,
        );
        const grant = new BbbCapacityGrant({
          organization: org,
          orderId: String(order.id),
          orderLineId: String(line.orderLineId),
          productVariantId,
          grantedMinutes: grantedHours * 60,
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
      // Uses the line resolved in step 0 (see the note there).
      if (!productVariantId) continue;

      const productAccess = await connection
        .getRepository(ctx, BbbProductAccess)
        .findOne({
          where: { productVariantId },
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

/** Handler code declared above — the automatic path must use the same one. */
const BBB_FULFILLMENT_HANDLER_CODE = "bbb-access-fulfillment";

/**
 * Option A (R3 decision 1, 2026-09-26) — AUTOMATIC FULFILLMENT.
 *
 * Before this, the order-source capacity grant had no automatic producer: the
 * `PaymentSettled` listener wrote only the BbbEntitlement, and the grant required
 * a manual Admin `addFulfillmentToOrder` (proved by R4-02, 2026-09-25). A paying
 * customer therefore received access but **no minutes** unless an operator
 * fulfilled the order.
 *
 * Now, when an order reaches `PaymentSettled`, the BBB-eligible lines are
 * fulfilled automatically, which invokes this module's own
 * `bbbFulfillmentHandler` and writes `BbbCapacityGrant(sourceType='order')`.
 *
 * Deliberate properties:
 *   1. BBB-ONLY: a line is eligible when its variant maps to a room
 *      (BbbProductAccess) or to a scheduled session (BbbScheduledSession).
 *      Mixed orders leave their non-BBB lines to the normal shipping flow —
 *      this hook must never ship a t-shirt.
 *   2. IDEMPOTENT: an order that already has a fulfillment is skipped, so the
 *      manual Admin path stays safe on top of the automatic one.
 *   3. FAIL-SOFT: fulfillment runs after the payment transition is persisted, so
 *      an error here must never surface as a failed checkout. It is logged at
 *      error level and can be retried (Admin fulfillment / reconciliation); the
 *      grant's absence is visible in the capacity ledger.
 *   4. NO HIDDEN POLICY: handler arguments are left empty so the handler's
 *      declared defaults (10h / 30d → 600 minutes) remain the single source of
 *      truth for how much capacity a purchase grants.
 */
async function autoFulfillBbbOrder(ctx: RequestContext, order: Order): Promise<void> {
  try {
    const orderWithLines = await connection.getRepository(ctx, Order).findOne({
      where: { id: order.id },
      relations: { lines: { productVariant: true } },
    });
    if (!orderWithLines?.lines?.length) {
      return;
    }

    // (2) idempotency — never fulfil an order twice.
    const existingFulfillment = await connection
      .getRepository(ctx, Fulfillment)
      .findOne({ where: { orders: { id: String(order.id) } } });
    if (existingFulfillment) {
      Logger.debug(
        `Option A: order ${order.code} already fulfilled (${existingFulfillment.id}); skipping`,
        loggerCtx,
      );
      return;
    }

    // (1) eligibility
    const variantIds = orderWithLines.lines
      .map((l) => (l.productVariant ? String(l.productVariant.id) : ""))
      .filter((id) => id.length > 0);
    if (!variantIds.length) {
      return;
    }

    const [roomAccess, sessions] = await Promise.all([
      connection
        .getRepository(ctx, BbbProductAccess)
        .find({ where: { productVariantId: In(variantIds) } }),
      connection
        .getRepository(ctx, BbbScheduledSession)
        .find({ where: { productVariantId: In(variantIds) } }),
    ]);
    const eligibleVariantIds = new Set<string>([
      ...roomAccess.map((r) => String(r.productVariantId)),
      ...sessions
        .map((s) => (s.productVariantId ? String(s.productVariantId) : ""))
        .filter((id) => id.length > 0),
    ]);

    const eligibleLines = orderWithLines.lines.filter(
      (l) => l.productVariant && eligibleVariantIds.has(String(l.productVariant.id)),
    );
    if (!eligibleLines.length) {
      return;
    }

    const result = await orderService.createFulfillment(ctx, {
      lines: eligibleLines.map((l) => ({ orderLineId: String(l.id), quantity: l.quantity })),
      handler: {
        code: BBB_FULFILLMENT_HANDLER_CODE,
        arguments: [
          { name: "grantedHours", value: "10" },
          { name: "validityDays", value: "30" },
        ],
      },
    });

    if ("id" in result && result.id) {
      Logger.info(
        `Option A auto-fulfillment: order ${order.code} → fulfillment ${result.id} (${eligibleLines.length} BBB line(s))`,
        loggerCtx,
      );
    } else {
      Logger.error(
        `Option A auto-fulfillment returned an error for order ${order.code}: ${JSON.stringify(result)}`,
        loggerCtx,
      );
    }
  } catch (err) {
    // (3) fail-soft — a completed payment must not be broken by delivery.
    Logger.error(
      `Option A auto-fulfillment failed for order ${order.code}: ${(err as Error).message}`,
      loggerCtx,
    );
  }
}

/**
 * Hooks into the Vendure order lifecycle for BBB-specific processing.
 */
export const bbbOrderProcess: OrderProcess<string> = {
  init(injector) {
    orderService = injector.get(OrderService);
    fulfillmentService = injector.get(FulfillmentService);
  },

  async onTransitionEnd(_fromState, toState, { ctx, order }) {
    if (toState !== "PaymentSettled") {
      return;
    }

    Logger.info(
      `BBB OrderProcess: order ${order.code} reached PaymentSettled — automatic fulfillment (Option A)`,
      loggerCtx,
    );
    await autoFulfillBbbOrder(ctx, order);
  },
};
