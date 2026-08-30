import { PluginError, PluginErrorCode } from '../../../common/plugin-error';
import { Injectable, Inject, Logger } from '@nestjs/common';
import { RequestContext, Order, OrderService, PaymentService, EventBus, RequestContextService, TransactionalConnection, ID, isGraphQlErrorResult } from '@vendure/core';
import { JUSPAY_PLUGIN_OPTIONS } from '../constants';
import type { JuspayPluginOptions } from '../options';
import { JuspaySdk } from '../../payments-core';
import { PaymentObservabilityService } from '../../payments-core/service/payment-observability.service';
import { JuspayWebhookEvent } from '../types';
import { JuspayPaymentSettledEvent } from '../events/juspay-payment-settled.event';
import { SellerRefundSettledEvent } from '../events/seller-refund-settled.event';
import { CheckoutLockService } from '../../payments-core/service/checkout-lock.service';
import { PaymentSettlementAudit } from '../entity/payment-settlement-audit.entity';

@Injectable()
export class JuspayService {
  private readonly logger = new Logger(JuspayService.name);

  constructor(
    @Inject(JUSPAY_PLUGIN_OPTIONS) private readonly opts: JuspayPluginOptions,
    private readonly sdk: JuspaySdk,
    private readonly observability: PaymentObservabilityService,
    private readonly checkoutLockService: CheckoutLockService,
    private readonly connection: TransactionalConnection,
    private readonly orderService: OrderService,
    private readonly paymentService: PaymentService,
    private readonly eventBus: EventBus,
    private readonly ctxService: RequestContextService
  ) {}

  /**
   * Initiates a payment session with Juspay
   */
  async initiatePaymentSessionInternal(
    ctx: RequestContext,
    order: Order,
    amount: number // Vendure minor units (paise)
  ): Promise<{ juspayOrderId: string; paymentLink?: string; status: string }> {
    // 1. Guard: if !order.customer throw Error('Order {code} has no customer')
    if (!order.customer) {
      throw new PluginError(PluginErrorCode.CUSTOMER_NOT_FOUND, `Order ${order.code} has no customer`);
    }

    return this.checkoutLockService.withLock(order.code, async () => {
      // 2. juspayOrderId = toJuspayOrderId(order.code)
      const juspayOrderId = this.toJuspayOrderId(order.code);

      // 3. span = observability.startSpan('juspay.createOrder', { orderId, juspayOrderId })
      const span = this.observability.startSpan('juspay.createOrder', {
        orderId: String(order.id),
        juspayOrderId,
      });

      try {
        // 4. Create order with Juspay SDK
        const response = await this.sdk.createOrder({
          order_id: juspayOrderId,
          amount: amount / 100,    // paise → rupees
          customer_id: String(order.customer.id),
          customer_email: order.customer.emailAddress,
          customer_phone: order.customer.phoneNumber ?? '',
          currency: order.currencyCode,
          return_url: this.opts.returnUrl,
          description: `Order ${order.code}`,
          udf1: juspayOrderId,
          udf2: String(order.customerId ?? ''),
        });

        span.end();

        await this.orderService.updateCustomFields(ctx, order.id, {
          juspayOrderId: response.order_id,
        });

        return {
          juspayOrderId: response.order_id,
          paymentLink: response.payment_links?.web,
          status: response.status,
        };
      } catch (err) {
        span.end(err);
        throw err;
      }
    });
  }

  /**
   * Handles incoming webhook events from Juspay
   */
  async handleWebhookEvent(event: JuspayWebhookEvent): Promise<void> {
    // 1. Extract juspayOrderId
    const juspayOrderId = event.content.order.order_id;
    
    // 2. eventKey = `${event.event_name}:${juspayOrderId}`
    const eventKey = `${event.event_name}:${juspayOrderId}`;

    // 3. span = observability.startSpan('juspay.webhookEvent', attrs)
    const span = this.observability.startSpan('juspay.webhookEvent', { 
      eventName: event.event_name, 
      juspayOrderId 
    });

    try {
      // 4. ctx = await ctxService.create({ apiType: 'admin' })
      const ctx = await this.ctxService.create({ apiType: 'admin' });

      // Single idempotency check via shared PaymentEventLog
      const isNew = await this.observability.checkAndRecord(
        ctx,
        `juspay:${eventKey}`,
        'juspay',
        JSON.stringify(event.content.order),
      );
      if (!isNew) {
        this.logger.debug(`Duplicate webhook event skipped: ${eventKey}`);
        span.end();
        return;
      }

      // 7. Process event based on type
      switch (event.event_name) {
        case 'ORDER_SUCCEEDED':
          await this.handleOrderSucceeded(ctx, juspayOrderId, event);
          break;
        case 'ORDER_FAILED':
          await this.handleOrderFailed(ctx, juspayOrderId, event);
          break;
        case 'ORDER_REFUNDED':
          await this.handleOrderRefunded(ctx, juspayOrderId, event);
          break;
        case 'TXN_CREATED':
          this.logger.log(`TXN_CREATED webhook received for order: ${juspayOrderId}`);
          break;
        default:
          this.logger.warn(`Unknown webhook event type: ${event.event_name}`);
      }
    } finally {
      span.end();
    }
  }

  /**
   * Initiates a refund through Juspay
   */
  async initiateRefund(
    juspayOrderId: string,
    paymentId: ID,
    amountMinorUnits: number // already paise — do NOT double convert
  ): Promise<{ state: 'Settled' | 'Failed'; metadata: Record<string, any> }> {
    // 1. span = observability.startSpan('juspay.createRefund', { juspayOrderId })
    const span = this.observability.startSpan('juspay.createRefund', { juspayOrderId });

    try {
      // 2. Create refund with Juspay SDK
      const result = await this.sdk.createRefund({
        order_id: juspayOrderId,
        unique_request_id: `ref-${paymentId}-${Date.now()}`,
        amount: amountMinorUnits / 100   // paise → rupees for API call
      });

      span.end();

      return {
        state: result.status === 'SUCCESS' ? 'Settled' : 'Failed',
        metadata: { 
          juspayRefundId: result.unique_request_id, 
          status: result.status 
        }
      };
    } catch (err) {
      span.end(err);
      return { 
        state: 'Failed', 
        metadata: { errorMessage: err.message } 
      };
    }
  }

  /**
   * Handles successful order events
   */
  private async handleOrderSucceeded(
    ctx: RequestContext,
    juspayOrderId: string,
    event: JuspayWebhookEvent
  ): Promise<void> {
    // 1. span = observability.startSpan('juspay.verifyStatus', { juspayOrderId })
    const span = this.observability.startSpan('juspay.verifyStatus', { juspayOrderId });

    let statusResponse;
    let spanError: Error | undefined;

    try {
      // 2. Verify status with Juspay
      statusResponse = await this.sdk.getOrderStatus(juspayOrderId);
    } catch (err: any) {
      spanError = err;
      this.logger.error(`Failed to verify status for order ${juspayOrderId}:`, err);
      throw err; // Re-throw for job retry
    } finally {
      span.end(spanError);
    }

    // 3. CHARGED status check
    if (statusResponse.status !== 'CHARGED') {
      this.logger.warn(`Order ${juspayOrderId} status is ${statusResponse.status}, not CHARGED. Skipping settlement.`);
      return;
    }

    // 4. Find order
    const order = await this.findOrderByJuspayId(ctx, juspayOrderId);
    if (!order) {
      this.logger.warn(`Order not found for Juspay order ID: ${juspayOrderId}`);
      return;
    }

    // 5. Find authorized payment
    const pendingPayment = order.payments?.find(p => p.state === 'Authorized');
    if (!pendingPayment) {
      this.logger.warn(`No authorized payment found for order ${order.code} - already settled?`);
      return;
    }

    // 6. Amount guard - compare with pending payment amount
    const capturedMinor = Math.round(statusResponse.amount * 100);
    const expectedAmount = pendingPayment.amount;

    if (capturedMinor !== expectedAmount) {
      this.logger.error(`AMOUNT MISMATCH — settlement BLOCKED — manual reconciliation required for order ${juspayOrderId}. Expected: ${expectedAmount}, Captured: ${capturedMinor}`);
      return;
    }

    // 7. Settle payment with DB transaction and pessimistic locking to prevent race conditions
    await this.connection.withTransaction(ctx, async (txCtx) => {
      const orderRepo = this.connection.getRepository(txCtx, Order);

      const freshOrder = await orderRepo
        .createQueryBuilder('order')
        .leftJoinAndSelect('order.payments', 'payment')
        .where('order.id = :id', { id: order.id })
        .setLock('pessimistic_write')
        .getOne();

      const freshPayment = freshOrder?.payments?.find(
        p => p.id === pendingPayment.id
      );

      if (!freshPayment || freshPayment.state !== 'Authorized') {
        this.logger.warn(
          `Settlement skipped: payment already processed for order ${order.code}`
        );
        return;
      }

      await this.paymentService.settlePayment(txCtx, freshPayment.id);

      // Write comprehensive audit record
      const auditRepo = this.connection.getRepository(txCtx, PaymentSettlementAudit);
      await auditRepo.save(auditRepo.create({
        orderId: order.code,
        juspayOrderId: juspayOrderId,
        amount: capturedMinor,
        status: 'SETTLED',
        verified: true
      }));
    });

    // 9. Emit event
    await this.eventBus.publish(new JuspayPaymentSettledEvent(
      ctx, 
      String(order.id), 
      String(pendingPayment.id), 
      juspayOrderId,
      capturedMinor, 
      statusResponse.currency
    ));

    // 10. Log success
    this.logger.log(`Payment settled: order=${order.code} amount=${capturedMinor} ${statusResponse.currency}`);
  }

  /**
   * Handles failed order events
   */
  private async handleOrderFailed(
    ctx: RequestContext,
    juspayOrderId: string,
    event: JuspayWebhookEvent
  ): Promise<void> {
    const order = await this.findOrderByJuspayId(ctx, juspayOrderId);
    if (!order) {
      this.logger.warn(`Order not found for failed Juspay order ID: ${juspayOrderId}`);
      return;
    }

    const pendingPayment = order.payments?.find(p => p.state === 'Authorized');
    if (!pendingPayment) {
      this.logger.warn(`No authorized payment found for failed order ${order.code}`);
      return;
    }

      // ✅ Use orderService.transitionPaymentToState – it handles both payment and order state
      const result = await this.orderService.transitionPaymentToState(
        ctx,
        pendingPayment.id,
        'Cancelled'
      );

    if (isGraphQlErrorResult(result)) {
      this.logger.error(`Payment cancel failed ${pendingPayment.id}: ${result.message}`);
      return;
    }

    this.logger.log(`Payment cancelled: order=${order.code} error=${event.content.order.error_code}`);
  }

  /**
   * Handles refunded order events
   */
  private async handleOrderRefunded(
    ctx: RequestContext,
    juspayOrderId: string,
    event: JuspayWebhookEvent
  ): Promise<void> {
    const order = await this.findOrderByJuspayId(ctx, juspayOrderId);
    if (!order) {
      this.logger.warn(`Order not found for refunded Juspay order ID: ${juspayOrderId}`);
      return;
    }

    const refunds = event.content.order.refunds ?? [];

    for (const refund of refunds) {
      this.logger.log(
        `Refund confirmed: ${refund.amount} paise on order ${order.code} ref=${refund.unique_request_id} status=${refund.status}`,
      );

      if (refund.status !== 'SUCCESS' && refund.status !== 'PROCESSED') {
        continue;
      }

      await this.eventBus.publish(new SellerRefundSettledEvent(
        ctx,
        order.id,
        refund.amount,
        refund.unique_request_id,
        order.currencyCode,
      ));
    }
  }

  /**
   * Finds order by Juspay order ID
   */
  private async findOrderByJuspayId(ctx: RequestContext, juspayOrderId: string): Promise<Order | undefined> {
    const queryBuilder = this.connection.getRepository(ctx, Order)
      .createQueryBuilder('order')
      .leftJoinAndSelect('order.payments', 'payment')
      .leftJoinAndSelect('order.customer', 'customer')
      .where('order.customFieldsJuspayOrderId = :juspayOrderId', { juspayOrderId });

    const result = await queryBuilder.getOne();
    return result ?? undefined;
  }

  /**
   * Converts Vendure order code to Juspay order ID format
   */
  private toJuspayOrderId(vendureOrderCode: string): string {
    return 'vnd-' + vendureOrderCode.replace(/[^a-zA-Z0-9\-_]/g, '-');
  }

  /**
   * Gets the status of a Juspay order
   */
  async getOrderStatus(juspayOrderId: string): Promise<string> {
    const span = this.observability.startSpan('juspay.getOrderStatus', { juspayOrderId });
    
    try {
      const response = await this.sdk.getOrderStatus(juspayOrderId);
      span.end();
      return response.status;
    } catch (err) {
      span.end(err);
      throw err;
    }
  }

  /**
   * Initiates a payment session for storefront use
   */
  async initiatePaymentSession(
    ctx: RequestContext,
    orderId: string
  ): Promise<{ juspayOrderId: string; paymentLink: string | null; status: string }> {
    // Find the order
    const order = await this.orderService.findOne(ctx, orderId);
    if (!order) {
      throw new PluginError(PluginErrorCode.ENTITY_NOT_FOUND, `Order not found: ${orderId}`);
    }

    // Check if order already has a Juspay order ID
    if (order.customFields?.juspayOrderId) {
      // Return existing session info
      const status = await this.getOrderStatus(order.customFields.juspayOrderId);
      return {
        juspayOrderId: order.customFields.juspayOrderId,
        paymentLink: null, // No new link for existing session
        status
      };
    }

    // Initiate new payment session
    const result = await this.initiatePaymentSessionInternal(ctx, order, order.totalWithTax);
    return {
      juspayOrderId: result.juspayOrderId,
      paymentLink: result.paymentLink || null,
      status: result.status
    };
  }

  /**
   * Cancels a Juspay payment session
   */
  async cancelPaymentSession(ctx: RequestContext, orderId: string): Promise<boolean> {
    const order = await this.orderService.findOne(ctx, orderId);
    if (!order) {
      throw new PluginError(PluginErrorCode.ENTITY_NOT_FOUND, `Order not found: ${orderId}`);
    }

    if (!order.customFields?.juspayOrderId) {
      throw new PluginError(PluginErrorCode.ENTITY_NOT_FOUND, `No Juspay session found for order: ${orderId}`);
    }

    // Juspay does not expose a cancel-order API. To void an in-progress session,
    // the recommended approach is to let it expire or use the refund API after capture.
    // Silently clearing the local reference would leave an open session at Juspay
    // and risk a double-charge if the customer completes payment on the old session.
    throw new PluginError(
      PluginErrorCode.PAYMENT_GATEWAY_ERROR,
      `cancelPaymentSession is not implemented: Juspay does not support server-side session cancellation. ` +
      `Order ${order.code} has active Juspay session ${order.customFields.juspayOrderId}. ` +
      `Handle via order cancellation flow or let the session expire (TTL: 15 min).`
    );
  }
}
