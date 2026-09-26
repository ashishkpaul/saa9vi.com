import { PluginCommonModule, RuntimeVendureConfig, VendurePlugin } from '@vendure/core';
import { razorpayPaymentHandler } from './config/razorpay-payment-handler';
import { RazorpayOrdersClient } from './services/razorpay-orders.client';
import { RazorpayCheckoutService } from './services/razorpay-checkout.service';

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
  providers: [RazorpayOrdersClient, RazorpayCheckoutService],
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
