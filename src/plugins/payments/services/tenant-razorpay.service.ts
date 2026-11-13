import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  RequestContext,
  TransactionalConnection,
} from '@vendure/core';
import { TenantPaymentAccountService } from './tenant-payment-account.service';
import {
  TenantRazorpayOrdersClient,
  TenantRazorpayApiError,
  RazorpayOrder,
  RazorpayPayment,
} from './tenant-razorpay-orders.client';
import {
  computeCheckoutSignature,
  assertOrderBinding,
  assertPaymentBinding,
  isCapturableProviderStatus,
} from '../razorpay-checkout.policy';

const loggerCtx = 'TenantRazorpayService';

export interface TenantCheckoutOrderHandle {
  razorpayOrderId: string;
  amountMinor: number;
  currency: string;
  keyId: string;
}

export interface TenantCheckoutMetadata {
  razorpayOrderId: string;
  razorpayPaymentId: string;
  razorpaySignature?: string;
}

@Injectable()
export class TenantRazorpayService {
  constructor(
    private readonly connection: TransactionalConnection,
    private readonly accountService: TenantPaymentAccountService,
    private readonly client: TenantRazorpayOrdersClient,
  ) {}

  private logger = new Logger(loggerCtx);

  /**
   * Create a Razorpay order for the tenant's active order (or specified order).
   * Resolves tenant credentials from ctx.channelId.
   *
   * Fail-closed: rejects if the order doesn't belong to the channel, has no
   * tenant payment account, or isn't in ArrangingPayment state.
   */
  async createCheckoutOrder(
    ctx: RequestContext,
    orderId?: string,
  ): Promise<TenantCheckoutOrderHandle> {
    const channelId = String(ctx.channelId);

    // Resolve tenant credentials — throws if not configured.
    const credentials = await this.accountService.getDecryptedCredentials(
      ctx,
      channelId,
    );

    // Only allow checkout if account is active AND enabled.
    const account = await this.accountService.findByChannel(ctx, channelId);
    if (!account) {
      throw new NotFoundException('No Razorpay payment account found');
    }
    if (account.status !== 'active') {
      throw new Error(
        `Razorpay gateway is not verified (status: ${account.status}). Verify credentials first.`,
      );
    }
    if (!account.isEnabled) {
      throw new Error(
        'Razorpay gateway is disabled. Enable it in Payment Gateways settings.',
      );
    }

    // Find the order and verify it belongs to this channel.
    const orderRepo = this.connection.getRepository(ctx, 'Order');
    const order = orderId
      ? await orderRepo.findOne({
          where: { id: orderId },
          relations: { channels: true },
        })
      : await orderRepo.findOne({
          where: { state: 'ArrangingPayment' },
          relations: { channels: true },
        });

    if (!order) {
      throw new NotFoundException('Order not found');
    }

    const inChannel = (order.channels ?? []).some(
      (c: { id: string }) => String(c.id) === channelId,
    );
    if (!inChannel) {
      throw new NotFoundException('Order not found');
    }

    if (order.state !== 'ArrangingPayment') {
      throw new Error(`Order must be in ArrangingPayment state (got ${order.state})`);
    }

    if (order.totalWithTax <= 0) {
      throw new Error('Order total must be greater than zero');
    }

    // Create Razorpay order using tenant credentials.
    const razorpayOrder = await this.client.createOrder(
      credentials.keyId,
      credentials.keySecret,
      {
        amountMinor: order.totalWithTax,
        currency: order.currencyCode,
        receipt: order.code,
        notes: { vendureOrderCode: order.code },
      },
    );

    return {
      razorpayOrderId: razorpayOrder.id,
      amountMinor: razorpayOrder.amount,
      currency: razorpayOrder.currency,
      keyId: credentials.keyId,
    };
  }

  /**
   * Verify tenant Razorpay credentials by testing API access.
   * Used during tenant payment account verification.
   */
  async verifyCredentials(keyId: string, keySecret: string): Promise<void> {
    try {
      await this.client.testCredentials(keyId, keySecret);
    } catch (err: any) {
      if (err instanceof TenantRazorpayApiError) {
        throw new Error(err.providerMessage);
      }
      throw err;
    }
  }

  /**
   * Verify and settle a payment created through tenant checkout.
   * Resolves tenant credentials from ctx.channelId.
   *
   * This is the settlement path called by the tenant Razorpay payment handler
   * via addPaymentToOrder. It verifies the checkout signature, re-reads the
   * payment from the tenant's Razorpay account, and binds it to the order.
   */
  async verifyAndSettle(
    ctx: RequestContext,
    orderId: string,
    metadata: unknown,
  ): Promise<
    | {
        ok: true;
        paymentId: string;
        method?: string;
        providerStatus: string;
        razorpayOrderId: string;
        signatureVerified: boolean;
      }
    | { ok: false; errorCode: string; detail: string }
  > {
    const channelId = String(ctx.channelId);

    // Resolve tenant credentials — fail-closed if not configured.
    const credentials = await this.accountService.getDecryptedCredentials(
      ctx,
      channelId,
    );

    // Verify the order belongs to this channel.
    const orderRepo = this.connection.getRepository(ctx, 'Order');
    const order = await orderRepo.findOne({
      where: { id: orderId },
      relations: { channels: true },
    });
    if (!order) {
      return { ok: false, errorCode: 'ORDER_NOT_FOUND', detail: 'Order not found' };
    }
    const inChannel = (order.channels ?? []).some(
      (c: { id: string }) => String(c.id) === channelId,
    );
    if (!inChannel) {
      return { ok: false, errorCode: 'ORDER_NOT_FOUND', detail: 'Order not found' };
    }

    // Extract and verify checkout metadata.
    const md = this.extractMetadata(metadata);
    if (!md) {
      return {
        ok: false,
        errorCode: 'MISSING_METADATA',
        detail: 'Checkout metadata missing',
      };
    }

    // Layer 1: verify checkout signature using tenant's key secret.
    const expectedSig = computeCheckoutSignature(
      md.razorpayOrderId,
      md.razorpayPaymentId,
      credentials.keySecret,
    );
    const signatureVerified =
      md.razorpaySignature !== undefined &&
      md.razorpaySignature.length > 0 &&
      md.razorpaySignature === expectedSig;

    if (!signatureVerified && ctx.apiType === 'shop') {
      return {
        ok: false,
        errorCode: 'SIGNATURE_INVALID',
        detail: 'Checkout signature verification failed',
      };
    }

    // Layer 2: provider truth — re-read order and payment from tenant's Razorpay account.
    try {
      const razorpayOrder = await this.client.fetchOrder(
        credentials.keyId,
        credentials.keySecret,
        md.razorpayOrderId,
      );

      const orderBinding = assertOrderBinding({
        receipt: razorpayOrder.receipt,
        notes: razorpayOrder.notes,
        expectedOrderCode: order.code,
      });
      if (!orderBinding.ok) {
        return {
          ok: false,
          errorCode: 'ORDER_BINDING_MISMATCH',
          detail: orderBinding.detail ?? '',
        };
      }

      let payment = await this.client.fetchPayment(
        credentials.keyId,
        credentials.keySecret,
        md.razorpayPaymentId,
      );

      // Single-step settlement: capture an authorization before asserting.
      if (isCapturableProviderStatus(payment.status)) {
        payment = await this.client.capturePayment(
          credentials.keyId,
          credentials.keySecret,
          {
            razorpayPaymentId: payment.id,
            amountMinor: payment.amount,
            currency: payment.currency,
          },
        );
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
        return {
          ok: false,
          errorCode: binding.reason,
          detail: binding.detail ?? '',
        };
      }

      this.logger.log(
        `Tenant Razorpay payment ${payment.id} verified for order ${order.code} (channel ${channelId})`,
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
      if (err instanceof TenantRazorpayApiError) {
        return { ok: false, errorCode: 'PROVIDER_ERROR', detail: err.message };
      }
      throw err;
    }
  }

  private extractMetadata(
    metadata: unknown,
  ): TenantCheckoutMetadata | null {
    if (!metadata || typeof metadata !== 'object') return null;
    const m = metadata as Record<string, unknown>;
    const razorpayOrderId = m.razorpay_order_id ?? m.razorpayOrderId;
    const razorpayPaymentId = m.razorpay_payment_id ?? m.razorpayPaymentId;
    const signatureRaw = m.razorpay_signature ?? m.razorpaySignature;
    if (
      typeof razorpayOrderId !== 'string' ||
      razorpayOrderId.length === 0
    ) {
      return null;
    }
    if (
      typeof razorpayPaymentId !== 'string' ||
      razorpayPaymentId.length === 0
    ) {
      return null;
    }
    const razorpaySignature =
      typeof signatureRaw === 'string' && signatureRaw.length > 0
        ? signatureRaw
        : undefined;
    return { razorpayOrderId, razorpayPaymentId, razorpaySignature };
  }
}