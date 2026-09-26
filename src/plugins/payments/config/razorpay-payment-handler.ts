import {
  CreatePaymentErrorResult,
  CreatePaymentResult,
  LanguageCode,
  PaymentMethodHandler,
  SettlePaymentResult,
} from '@vendure/core';
import { RAZORPAY_HANDLER_CODE } from '../constants';
import { RazorpayCheckoutService } from '../services/razorpay-checkout.service';

let checkoutService: RazorpayCheckoutService;

/**
 * R3 — one-time Razorpay payment handler (single-step settlement, decision 2).
 *
 * `createPayment` never trusts client input on its own: every path re-reads the
 * Razorpay order + payment server-to-server, and SHOP traffic must additionally
 * present a valid HMAC-SHA256 checkout signature (see
 * `razorpay-checkout.policy.ts`). Any mismatch returns an explicit `Error`
 * payment state — there is no fall-through to `Settled`.
 *
 * Secrets are env-only (`RAZORPAY_KEY_ID`/`RAZORPAY_KEY_SECRET`); the handler
 * deliberately declares **no** config args so no key material can be persisted
 * in the database or read back through the Admin API.
 *
 * `settlePayment` is a no-op because settlement happens on creation; it stays
 * implemented so a two-step deployment (authorize now, capture later) needs no
 * handler change — only `settlePayment` would gain the capture call.
 */
export const razorpayPaymentHandler = new PaymentMethodHandler({
  code: RAZORPAY_HANDLER_CODE,
  description: [
    {
      languageCode: LanguageCode.en,
      value: 'Razorpay — one-time payment (cards, UPI, netbanking, wallets)',
    },
  ],
  args: {},

  init(injector) {
    checkoutService = injector.get(RazorpayCheckoutService);
  },

  async createPayment(
    ctx,
    order,
    amount,
    _args,
    metadata,
  ): Promise<CreatePaymentResult | CreatePaymentErrorResult> {
    const outcome = await checkoutService.verifyAndSettle(ctx, order, metadata);

    if (!outcome.ok) {
      return {
        amount,
        state: 'Error',
        errorMessage: `${outcome.errorCode}${outcome.detail ? `: ${outcome.detail}` : ''}`,
        // Only non-sensitive, server-derived identifiers are echoed back.
        metadata: {
          razorpay_error_code: outcome.errorCode,
        },
      };
    }

    return {
      amount,
      state: 'Settled',
      transactionId: outcome.paymentId,
      metadata: {
        razorpay_order_id: outcome.razorpayOrderId,
        razorpay_payment_id: outcome.paymentId,
        razorpay_method: outcome.method,
        razorpay_status: outcome.providerStatus,
        razorpay_signature_verified: outcome.signatureVerified,
      },
    };
  },

  settlePayment(): SettlePaymentResult {
    // Single-step settlement: the payment was captured by the provider before
    // `createPayment` returned 'Settled', so there is nothing left to capture.
    return { success: true };
  },
});
