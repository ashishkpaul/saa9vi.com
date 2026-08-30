import { PaymentMethodHandler, LanguageCode, Injector } from '@vendure/core';
import { JUSPAY_HANDLER_CODE } from '../constants';
import { JuspayService } from '../service/juspay.service';

// Declare module-level variable: let juspayService: JuspayService (outside the handler object)
let juspayService: JuspayService;

/**
 * Juspay Payment Handler configuration
 */
export const juspayPaymentHandler = new PaymentMethodHandler({
  code: JUSPAY_HANDLER_CODE,
  description: [{ languageCode: LanguageCode.en, value: 'Juspay Express Checkout' }],
  args: {},

  /**
   * Initialize the payment handler with dependency injection
   */
  init(injector: Injector): void {
    // This is the ONLY correct Vendure DI pattern for strategy classes.
    // Do NOT use injector in createPayment args (audit fix #1).
    juspayService = injector.get(JuspayService);
  },

  /**
   * Cleanup method
   */
  destroy(): void {
    // optional cleanup — leave empty with comment
  },

  /**
   * Create a payment session with Juspay
   */
  createPayment: async (ctx, order, amount, _args, _metadata) => {
    try {
      const result = await juspayService.initiatePaymentSessionInternal(ctx, order, amount);
      return {
        amount,
        state: 'Authorized' as const,
        transactionId: result.juspayOrderId,
        metadata: {
          juspayOrderId: result.juspayOrderId,
          paymentLink:   result.paymentLink,    // storefront redirects here
          juspayStatus:  result.status,
        }
      };
    } catch (err) {
      return { 
        amount, 
        state: 'Declined' as const, 
        metadata: { errorMessage: err.message } 
      };
    }
  },

  /**
   * Settle payment after verification
   */
  settlePayment: async (_ctx, _order, _payment, _args) => {
    // Called by JuspayService after amount verification passes.
    return { success: true };
  },

  /**
   * Create a refund through Juspay
   */
  createRefund: async (_ctx, _input, total, _order, payment, _args) => {
    // total is already in minor units (paise) — Vendure convention
    // FIX audit #4: do NOT convert total again here; initiateRefund handles the /100
    if (!payment.transactionId) {
      return { 
        state: 'Failed' as const, 
        metadata: { errorMessage: 'No Juspay order ID' } 
      };
    }
    return await juspayService.initiateRefund(payment.transactionId, payment.id, total);
  }
});