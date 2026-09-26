import { Injectable } from '@nestjs/common';
import { Logger, Order, RequestContext } from '@vendure/core';
import { razorpayKeyId, razorpayKeySecret } from '../constants';
import {
  assertOrderBinding,
  assertPaymentBinding,
  extractCheckoutMetadata,
  isCapturableProviderStatus,
  verifyCheckoutSignature,
} from '../razorpay-checkout.policy';
import { RazorpayApiError, RazorpayOrdersClient } from './razorpay-orders.client';

const loggerCtx = 'RazorpayCheckoutService';

export interface CheckoutOrderHandle {
  razorpayOrderId: string;
  amountMinor: number;
  currency: string;
  /** Public key id — required by Razorpay Checkout in the browser. */
  keyId: string;
}

export type SettleOutcome =
  | {
      ok: true;
      paymentId: string;
      method?: string;
      providerStatus: string;
      razorpayOrderId: string;
      /** true when the client handshake was cryptographically verified. */
      signatureVerified: boolean;
    }
  | { ok: false; errorCode: string; detail: string };

/**
 * R3 — one-time checkout orchestration.
 *
 * Flow (single-step settlement, decision 2):
 *   Shop mutation        → createCheckoutOrder() → Razorpay Order (Orders API)
 *   Razorpay Checkout    → client pays; returns order/payment id + signature
 *   addPaymentToOrder    → verifyAndSettle() → handler returns 'Settled'
 *   payment.*  webhook   → reconciliation safety net (same verifyAndSettle,
 *                          admin/system ctx — no client signature to trust)
 *
 * The two enforcement layers are independent on purpose:
 *   - SHOP traffic must present a valid HMAC signature (`shop` apiType).
 *   - Every path re-reads the payment and Razorpay order server-to-server, so a
 *     forged/absent signature can never be substituted for provider truth.
 */
@Injectable()
export class RazorpayCheckoutService {
  constructor(private readonly client: RazorpayOrdersClient) {}

  isConfigured(): boolean {
    return this.client.isConfigured();
  }

  /** Creates the Razorpay order that the browser will open Checkout against. */
  async createCheckoutOrder(
    ctx: RequestContext,
    order: Order,
  ): Promise<CheckoutOrderHandle> {
    if (!this.isConfigured()) {
      throw new RazorpayApiError(0, 'Razorpay keys are not configured');
    }

    const razorpayOrder = await this.client.createOrder({
      amountMinor: order.totalWithTax,
      currency: order.currencyCode,
      receipt: order.code,
      notes: {
        vendureOrderCode: order.code,
        vendureChannelId: String(ctx.channelId ?? ''),
      },
    });

    Logger.info(
      `Created Razorpay order ${razorpayOrder.id} for Vendure order ${order.code} (${razorpayOrder.amount} ${razorpayOrder.currency})`,
      loggerCtx,
    );

    return {
      razorpayOrderId: razorpayOrder.id,
      amountMinor: razorpayOrder.amount,
      currency: razorpayOrder.currency,
      keyId: razorpayKeyId(),
    };
  }

  /**
   * Verify the checkout handshake and confirm provider truth, then report the
   * outcome the payment handler turns into `Settled` or an explicit failure.
   */
  async verifyAndSettle(
    ctx: RequestContext,
    order: Order,
    metadata: unknown,
  ): Promise<SettleOutcome> {
    const md = extractCheckoutMetadata(metadata);
    if (!md) {
      return this.fail(
        'CHECKOUT_METADATA_MISSING',
        'metadata must carry razorpay_order_id and razorpay_payment_id',
        order.code,
      );
    }

    // ── Layer 1: client handshake (mandatory for shop traffic) ──────────────
    let signatureVerified = false;
    const sigResult = verifyCheckoutSignature({
      orderId: md.razorpayOrderId,
      paymentId: md.razorpayPaymentId,
      signature: md.razorpaySignature,
      keySecret: razorpayKeySecret(),
    });

    if (sigResult.ok) {
      signatureVerified = true;
    } else if (ctx.apiType === 'shop') {
      return this.fail('SIGNATURE_INVALID', sigResult.reason, order.code);
    } else {
      // Trusted internal caller (webhook reconciliation) with no client
      // signature to verify — layer 2 (provider re-read) is the authority.
      Logger.warn(
        `No verifiable checkout signature for order ${order.code} (${sigResult.reason}); relying on provider re-read`,
        loggerCtx,
      );
    }

    // ── Layer 2: provider truth ─────────────────────────────────────────────
    try {
      const razorpayOrder = await this.client.fetchOrder(md.razorpayOrderId);
      const orderBinding = assertOrderBinding({
        receipt: razorpayOrder.receipt,
        notes: razorpayOrder.notes,
        expectedOrderCode: order.code,
      });
      if (!orderBinding.ok) {
        return this.fail('ORDER_BINDING_MISMATCH', orderBinding.detail ?? '', order.code);
      }

      let payment = await this.client.fetchPayment(md.razorpayPaymentId);

      // Single-step settlement: capture an authorization before asserting.
      if (isCapturableProviderStatus(payment.status)) {
        payment = await this.client.capturePayment({
          razorpayPaymentId: payment.id,
          amountMinor: payment.amount,
          currency: payment.currency,
        });
      }

      const binding = assertPaymentBinding({
        paymentOrderId: payment.order_id,
        expectedRazorpayOrderId: md.razorpayOrderId,
        paymentAmountMinor: payment.amount,
        expectedAmountMinor: order.totalWithTax,
        paymentCurrency: payment.currency,
        expectedCurrency: order.currencyCode,
        providerStatus: payment.status,
      });
      if (!binding.ok) {
        const errorCode =
          binding.reason === 'amount-mismatch'
            ? 'PAYMENT_AMOUNT_MISMATCH'
            : binding.reason === 'currency-mismatch'
              ? 'PAYMENT_CURRENCY_MISMATCH'
              : binding.reason === 'payment-order-mismatch'
                ? 'PAYMENT_ORDER_MISMATCH'
                : 'PAYMENT_NOT_SETTLING';
        return this.fail(errorCode, binding.detail ?? '', order.code);
      }

      Logger.info(
        `Verified Razorpay payment ${payment.id} for Vendure order ${order.code} (status=${payment.status}, signatureVerified=${signatureVerified})`,
        loggerCtx,
      );

      return {
        ok: true,
        paymentId: payment.id,
        method: payment.method,
        providerStatus: payment.status,
        razorpayOrderId: md.razorpayOrderId,
        signatureVerified,
      };
    } catch (err: any) {
      if (err instanceof RazorpayApiError) {
        return this.fail('PROVIDER_ERROR', err.message, order.code);
      }
      throw err;
    }
  }

  private fail(errorCode: string, detail: string, orderCode: string): SettleOutcome {
    Logger.error(
      `Razorpay checkout refused for order ${orderCode}: ${errorCode}${detail ? ` — ${detail}` : ''}`,
      loggerCtx,
    );
    return { ok: false, errorCode, detail };
  }
}
