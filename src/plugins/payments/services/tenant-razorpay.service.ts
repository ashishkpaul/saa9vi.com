import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  OrderService,
  RequestContext,
  TransactionalConnection,
} from '@vendure/core';
import { TenantPaymentAccountService } from './tenant-payment-account.service';
import { TenantPaymentWebhookEvent } from '../entities/tenant-payment-webhook-event.entity';
import {
  TenantRazorpayOrdersClient,
  TenantRazorpayApiError,
} from './tenant-razorpay-orders.client';
import {
  assertOrderBinding,
  assertPaymentBinding,
  extractCheckoutMetadata,
  isCapturableProviderStatus,
  verifyCheckoutSignature,
} from '../razorpay-checkout.policy';

const loggerCtx = 'TenantRazorpayService';

export interface TenantCheckoutOrderHandle {
  razorpayOrderId: string;
  amountMinor: number;
  currency: string;
  keyId: string;
}

export type TenantSettleOutcome =
  | {
      ok: true;
      paymentId: string;
      method?: string;
      providerStatus: string;
      razorpayOrderId: string;
      signatureVerified: boolean;
    }
  | { ok: false; errorCode: string; detail: string };

@Injectable()
export class TenantRazorpayService {
  constructor(
    private readonly connection: TransactionalConnection,
    private readonly orderService: OrderService,
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
    const activeUserId = ctx.activeUserId;

    // Enforce authentication in the service as well as the GraphQL resolver.
    // This protects any future internal caller from accidentally bypassing the
    // Shop resolver's login guard.
    if (!activeUserId) {
      throw new NotFoundException('Order not found');
    }

    const orderRepo = this.connection.getRepository(ctx, 'Order');

    // An explicit order ID is untrusted input. For the implicit path, use
    // Vendure's active-order lookup for this authenticated user instead of
    // selecting an arbitrary ArrangingPayment order in the current channel.
    const candidate = orderId !== undefined
      ? await orderRepo.findOne({ where: { id: orderId } })
      : await this.orderService.getActiveOrderForUser(ctx, activeUserId);

    if (!candidate) {
      throw new NotFoundException('Order not found');
    }

    // Always reload the candidate with the relations needed for the security
    // decision. Do not rely on Permission.Owner to resource-bind a custom
    // resolver argument: the service itself proves customer ownership.
    const order = await orderRepo.findOne({
      where: { id: candidate.id },
      relations: { channels: true, customer: { user: true } },
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

    const orderOwnerUserId = order.customer?.user?.id;
    if (
      orderOwnerUserId == null ||
      String(orderOwnerUserId) !== String(activeUserId)
    ) {
      throw new NotFoundException('Order not found');
    }

    if ((order.customFields as { paymentPurpose?: string } | null)?.paymentPurpose === 'platform-service') {
      throw new Error('Tenant Razorpay cannot be used for Saa9vi platform-service orders');
    }

    if (order.state !== 'ArrangingPayment') {
      throw new Error(`Order must be in ArrangingPayment state (got ${order.state})`);
    }

    if (order.totalWithTax <= 0) {
      throw new Error('Order total must be greater than zero');
    }

    // Only resolve/decrypt tenant secrets after the order's channel and owner
    // have been proven. This prevents unauthorized order IDs from triggering
    // credential access or external Razorpay calls.
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

    const credentials = await this.accountService.getDecryptedCredentials(
      ctx,
      channelId,
    );

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
   * Verify and settle a tenant-funded payment for the current Shop API customer.
   *
   * This method is invoked by the Flow B PaymentMethodHandler from
   * Vendure's addPaymentToOrder lifecycle. Shop calls require exact customer
   * ownership and an enabled account. The verified webhook worker uses an
   * Admin RequestContext and a server-derived Checkout HMAC; it may reconcile
   * a payment already captured before checkout was disabled. Provider state,
   * order binding, amount and currency are re-read for both call paths.
   */
  async verifyAndSettle(
    ctx: RequestContext,
    orderId: string,
    metadata: unknown,
  ): Promise<TenantSettleOutcome> {
    const channelId = String(ctx.channelId);
    const activeUserId = ctx.activeUserId;

    const isShopSettlement = ctx.apiType === 'shop';
    const isWebhookSettlement = ctx.apiType === 'admin';

    if ((!isShopSettlement && !isWebhookSettlement) || (isShopSettlement && !activeUserId)) {
      return {
        ok: false,
        errorCode: 'AUTHENTICATION_REQUIRED',
        detail: 'Tenant payment settlement requires an authenticated Shop customer or the verified webhook worker',
      };
    }

    // Bind the payment request to a freshly-loaded order in the active Channel
    // and to the authenticated customer. The handler receives an Order object,
    // but the service does not trust its possibly-stale relations.
    const orderRepo = this.connection.getRepository(ctx, 'Order');
    const order = await orderRepo.findOne({
      where: { id: orderId },
      relations: { channels: true, customer: { user: true } },
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
    // Shop calls must prove customer ownership. The Admin context is used
    // only by the tenant webhook worker after it verifies the tenant webhook
    // HMAC and derives a Checkout HMAC with the tenant Key Secret; provider
    // order/payment truth is fetched again below before settlement.
    if (
      isShopSettlement &&
      (
        order.customer?.user?.id == null ||
        String(order.customer.user.id) !== String(activeUserId)
      )
    ) {
      return { ok: false, errorCode: 'ORDER_NOT_FOUND', detail: 'Order not found' };
    }
    if (order.state !== 'ArrangingPayment') {
      return {
        ok: false,
        errorCode: 'ORDER_NOT_PAYABLE',
        detail: `Order is not awaiting payment (state: ${order.state})`,
      };
    }
    if (order.totalWithTax <= 0) {
      return { ok: false, errorCode: 'INVALID_ORDER_AMOUNT', detail: 'Order total must be positive' };
    }

    const paymentPurpose = (order.customFields as { paymentPurpose?: string } | null)?.paymentPurpose;
    if (paymentPurpose === 'platform-service') {
      return {
        ok: false,
        errorCode: 'PAYMENT_FLOW_MISMATCH',
        detail: 'Platform-service orders must use the platform payment method',
      };
    }

    const md = extractCheckoutMetadata(metadata);
    if (!md) {
      return {
        ok: false,
        errorCode: 'MISSING_METADATA',
        detail: 'Checkout metadata must include Razorpay order and payment IDs',
      };
    }

    // Admin-context settlement is reserved for the signed tenant webhook
    // worker. Requiring a matching durable inbox event prevents an arbitrary
    // Admin API call from using the server-side settlement path directly.
    if (isWebhookSettlement) {
      const webhookEventId = (metadata as Record<string, unknown> | null)?.[
        'tenant_webhook_event_id'
      ];
      if (
        typeof webhookEventId !== 'string' &&
        typeof webhookEventId !== 'number'
      ) {
        return {
          ok: false,
          errorCode: 'WEBHOOK_EVENT_REQUIRED',
          detail: 'Tenant webhook settlement requires a persisted verified event',
        };
      }

      const webhookEventRepo = this.connection.getRepository(
        ctx,
        TenantPaymentWebhookEvent,
      );
      const webhookEvent = await webhookEventRepo.findOne({
        where: { id: webhookEventId as any },
        relations: { channels: true },
      });
      const webhookPayment = (webhookEvent?.rawPayload as any)?.payload?.payment?.entity;
      const eventBelongsToChannel = (webhookEvent?.channels ?? []).some(
        (candidate: { id: string }) => String(candidate.id) === channelId,
      );
      if (
        !webhookEvent ||
        !webhookEvent.verifiedAt ||
        webhookEvent.provider !== 'razorpay' ||
        webhookEvent.eventType !== 'payment.captured' ||
        webhookEvent.processingStatus !== 'pending' ||
        !eventBelongsToChannel ||
        webhookPayment?.id !== md.razorpayPaymentId ||
        webhookPayment?.order_id !== md.razorpayOrderId
      ) {
        return {
          ok: false,
          errorCode: 'WEBHOOK_EVENT_BINDING_MISMATCH',
          detail: 'Persisted tenant webhook event does not match this provider payment/order',
        };
      }
    }

    // Payment is not ChannelAware in Vendure. This lookup therefore checks
    // transaction IDs globally, preventing a previously-recorded provider
    // payment from being attached to a second Vendure order or tenant.
    const existingPayment = await this.connection
      .getRepository(ctx, 'Payment')
      .findOne({ where: { transactionId: md.razorpayPaymentId } });
    if (existingPayment) {
      return {
        ok: false,
        errorCode: 'PAYMENT_ALREADY_USED',
        detail: 'This Razorpay payment has already been recorded',
      };
    }

    // The account state is re-read at settlement time and checked before any
    // tenant secret is decrypted or provider API is called.
    let credentials: {
      keyId: string;
      keySecret: string;
    };
    try {
      credentials = isShopSettlement
        ? await this.accountService.getActiveDecryptedCredentials(ctx, channelId)
        : await this.accountService.getWebhookSettlementCredentials(ctx, channelId);
    } catch {
      return {
        ok: false,
        errorCode: 'TENANT_ACCOUNT_UNAVAILABLE',
        detail: 'Tenant Razorpay account must be configured, active and enabled',
      };
    }

    // Browser-returned identifiers are untrusted. Shop settlement always
    // requires a valid HMAC; unlike the platform webhook worker, Flow B has no
    // internal/admin caller path in this G-1 slice.
    const signature = verifyCheckoutSignature({
      orderId: md.razorpayOrderId,
      paymentId: md.razorpayPaymentId,
      signature: md.razorpaySignature,
      keySecret: credentials.keySecret,
    });
    if (!signature.ok) {
      return {
        ok: false,
        errorCode: 'SIGNATURE_INVALID',
        detail: 'Razorpay checkout signature verification failed',
      };
    }

    try {
      const razorpayOrder = await this.client.fetchOrder(
        credentials.keyId,
        credentials.keySecret,
        md.razorpayOrderId,
      );

      if (razorpayOrder.id !== md.razorpayOrderId) {
        return {
          ok: false,
          errorCode: 'PROVIDER_ORDER_ID_MISMATCH',
          detail: 'Razorpay returned a different provider order ID',
        };
      }

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
      if (razorpayOrder.amount !== order.totalWithTax) {
        return {
          ok: false,
          errorCode: 'ORDER_AMOUNT_MISMATCH',
          detail: 'Razorpay order amount does not match the Vendure order total',
        };
      }
      if (razorpayOrder.currency !== order.currencyCode) {
        return {
          ok: false,
          errorCode: 'ORDER_CURRENCY_MISMATCH',
          detail: 'Razorpay order currency does not match the Vendure order currency',
        };
      }

      let payment = await this.client.fetchPayment(
        credentials.keyId,
        credentials.keySecret,
        md.razorpayPaymentId,
      );

      // Do not capture an authorization until its provider payment ID, order,
      // exact amount and currency have all been checked against Vendure.
      if (payment.id !== md.razorpayPaymentId) {
        return {
          ok: false,
          errorCode: 'PROVIDER_PAYMENT_ID_MISMATCH',
          detail: 'Razorpay returned a different provider payment ID',
        };
      }
      if (payment.order_id !== md.razorpayOrderId) {
        return {
          ok: false,
          errorCode: 'PAYMENT_ORDER_MISMATCH',
          detail: 'Razorpay payment belongs to a different provider order',
        };
      }
      if (payment.amount !== order.totalWithTax) {
        return {
          ok: false,
          errorCode: 'PAYMENT_AMOUNT_MISMATCH',
          detail: 'Razorpay payment amount does not match the Vendure order total',
        };
      }
      if (payment.currency !== order.currencyCode) {
        return {
          ok: false,
          errorCode: 'PAYMENT_CURRENCY_MISMATCH',
          detail: 'Razorpay payment currency does not match the Vendure order currency',
        };
      }

      if (isCapturableProviderStatus(payment.status)) {
        payment = await this.client.capturePayment(
          credentials.keyId,
          credentials.keySecret,
          {
            razorpayPaymentId: payment.id,
            amountMinor: order.totalWithTax,
            currency: order.currencyCode,
          },
        );
      }

      if (payment.id !== md.razorpayPaymentId) {
        return {
          ok: false,
          errorCode: 'CAPTURE_PAYMENT_ID_MISMATCH',
          detail: 'Razorpay capture returned a different payment ID',
        };
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
        signatureVerified: true,
      };
    } catch (err: any) {
      if (err instanceof TenantRazorpayApiError) {
        return { ok: false, errorCode: 'PROVIDER_ERROR', detail: err.message };
      }
      throw err;
    }
  }

}
