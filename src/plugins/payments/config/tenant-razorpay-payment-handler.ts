import {
  CreatePaymentErrorResult,
  CreatePaymentResult,
  LanguageCode,
  PaymentMethodHandler,
  SettlePaymentResult,
} from '@vendure/core';
import { TENANT_RAZORPAY_HANDLER_CODE } from '../constants';
import { TenantRazorpayService } from '../services/tenant-razorpay.service';

let tenantRazorpayService: TenantRazorpayService;

/**
 * Flow B only: learner/customer → tenant.
 *
 * This handler resolves credentials from the active Channel's
 * TenantPaymentAccount through TenantRazorpayService. It never reads or falls
 * back to Saa9vi's platform RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET values.
 *
 * Verification and capture happen before returning Settled, so Vendure's
 * addPaymentToOrder mutation records a normal settled Payment. Webhook-based
 * recovery is deliberately not handled here; that is the separate G-3 scope.
 */
export const tenantRazorpayPaymentHandler = new PaymentMethodHandler({
  code: TENANT_RAZORPAY_HANDLER_CODE,
  description: [
    {
      languageCode: LanguageCode.en,
      value: 'Tenant Razorpay — direct tenant-client collection',
    },
  ],
  args: {},

  init(injector) {
    tenantRazorpayService = injector.get(TenantRazorpayService);
  },

  async createPayment(
    ctx,
    order,
    amount,
    _args,
    metadata,
  ): Promise<CreatePaymentResult | CreatePaymentErrorResult> {
    if (amount !== order.totalWithTax) {
      return {
        amount,
        state: 'Error',
        errorMessage: 'Tenant Razorpay checkout must settle the full Vendure order total',
        metadata: { tenant_razorpay_error_code: 'ORDER_AMOUNT_MISMATCH' },
      };
    }

    const outcome = await tenantRazorpayService.verifyAndSettle(
      ctx,
      String(order.id),
      metadata,
    );

    if (!outcome.ok) {
      return {
        amount,
        state: 'Error',
        errorMessage: `${outcome.errorCode}${outcome.detail ? `: ${outcome.detail}` : ''}`,
        metadata: {
          tenant_razorpay_error_code: outcome.errorCode,
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
    // Provider capture is performed and verified before createPayment returns
    // 'Settled'; Vendure has no subsequent capture step to perform.
    return { success: true };
  },
});
