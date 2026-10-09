import { PluginCommonModule, RuntimeVendureConfig, VendurePlugin, TransactionalConnection, PaymentMethod } from '@vendure/core';
import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { razorpayPaymentHandler } from './config/razorpay-payment-handler';
import { RazorpayOrdersClient } from './services/razorpay-orders.client';
import { RazorpayCheckoutService } from './services/razorpay-checkout.service';
import { PaymentWebhookQueueService } from './services/payment-webhook-queue.service';
import { PaymentWebhookEvent } from './entities/payment-webhook-event.entity';
import { razorpayShopApiExtensions } from './api/razorpay-shop.schema';
import { RazorpayShopResolver } from './api/razorpay-shop.resolver';
import { RazorpayPaymentsWebhookController } from './api/razorpay-payments-webhook.controller';
import { PaymentOpsAlertService } from './services/payment-ops-alert.service';

/** Vendure core handler code for the dev-only dummy payment handler. */
export const DUMMY_PAYMENT_HANDLER_CODE = 'dummy-payment-handler';

const loggerCtx = 'PaymentsPlugin';

/**
 * Commit 1 hygiene guard: in any non-dev deployment, boot must fail when a
 * PaymentMethod row still uses the dummy handler — tenants must pay through
 * the platform Razorpay method. Dev/test keep the dummy for e2e fixtures.
 */
@Injectable()
export class PaymentsProductionGuard implements OnApplicationBootstrap {
  constructor(private readonly connection: TransactionalConnection) {}

  async onApplicationBootstrap(): Promise<void> {
    if (process.env.APP_ENV === 'dev' || process.env.NODE_ENV === 'test') return;
    let methods: PaymentMethod[] = [];
    try {
      methods = await this.connection.rawConnection.getRepository(PaymentMethod).find();
    } catch (err: any) {
      Logger.warn(
        `PaymentsProductionGuard: could not list PaymentMethods (${err?.message}) — skipping dummy check`,
        loggerCtx,
      );
      return;
    }
    const offenders = methods.filter((m) => (m.handler as { code?: string })?.code === DUMMY_PAYMENT_HANDLER_CODE);
    if (offenders.length > 0) {
      const detail = offenders.map((m) => `${m.code} (id=${m.id})`).join(', ');
      throw new Error(
        `Refusing to start: ${offenders.length} PaymentMethod(s) use the dev-only dummy handler (${DUMMY_PAYMENT_HANDLER_CODE}): ${detail}. ` +
          `Remove or disable them via the Admin API before deploying.`,
      );
    }
  }
}

/**
 * R3 — one-time commerce (plan §3.9; ADR-038 "One-time commerce" branch).
 *
 * Boundary: this plugin owns the ONE-TIME payment lifecycle only — Razorpay
 * Orders/Payments API, checkout signature verification, and `PaymentSettled`
 * settlement. Recurring billing stays in `SubscriptionPlugin`
 * (`production-readiness.md` §7/§9 keep the two provider lifecycles separate).
 *
 * It does not own fulfillment: downstream access (entitlement + capacity grant)
 * is produced by the BigBlueButton plugin from the `PaymentSettled` transition —
 * see `bbbOrderProcess` (Option A, automatic fulfillment).
 */
@VendurePlugin({
  imports: [PluginCommonModule],
  entities: [PaymentWebhookEvent],
  providers: [RazorpayOrdersClient, RazorpayCheckoutService, PaymentWebhookQueueService, PaymentsProductionGuard, PaymentOpsAlertService],
  controllers: [RazorpayPaymentsWebhookController],
  shopApiExtensions: {
    schema: razorpayShopApiExtensions,
    resolvers: [RazorpayShopResolver],
  },
  configuration: (config: RuntimeVendureConfig) => {
    // Register alongside `dummyPaymentHandler`, which stays available for local
    // development and the existing e2e suites (it is the only handler that can
    // deterministically decline/error a payment).
    const handlers = config.paymentOptions.paymentMethodHandlers ?? [];
    if (!handlers.some((h) => h.code === razorpayPaymentHandler.code)) {
      config.paymentOptions.paymentMethodHandlers = [...handlers, razorpayPaymentHandler];
    }
    return config;
  },
  compatibility: '^3.0.0',
})
export class PaymentsPlugin {}

