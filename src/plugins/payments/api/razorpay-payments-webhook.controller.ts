import {
  Body,
  Controller,
  Headers,
  HttpCode,
  Logger,
  Post,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { Request } from 'express';
import {
  Order,
  OrderService,
  RequestContext,
  RequestContextService,
  TransactionalConnection,
} from '@vendure/core';
import {
  RAZORPAY_HANDLER_CODE,
  razorpayPaymentsWebhookSecret,
} from '../constants';
import { verifyWebhookSignature } from '../razorpay-checkout.policy';
import { RazorpayCheckoutService } from '../services/razorpay-checkout.service';

const loggerCtx = 'RazorpayPaymentsWebhookController';

/**
 * Controller for receiving Razorpay one-time payment webhooks.
 *
 * Endpoint: POST /payments/razorpay/checkout-webhook
 *
 * Boundary: handles asynchronous reconciliation for one-time orders (e.g.
 * `payment.captured` or `order.paid`).
 *
 * When a customer closes the browser before the frontend handshake returns,
 * Razorpay's webhook delivers `payment.captured` directly to this endpoint.
 * We authenticate the signature, extract the Vendure order from the receipt / notes,
 * and settle the payment if it is still in `ArrangingPayment`.
 */
@Controller('payments/razorpay')
export class RazorpayPaymentsWebhookController {
  constructor(
    private readonly checkoutService: RazorpayCheckoutService,
    private readonly orderService: OrderService,
    private readonly connection: TransactionalConnection,
    private readonly requestContextService: RequestContextService,
  ) {}

  @Post('checkout-webhook')
  @HttpCode(200)
  async handleWebhook(
    @Headers('x-razorpay-signature') signature: string,
    @Body() payload: any,
    @Req() req: Request,
  ): Promise<{ status: string }> {
    const rawBody: Buffer | undefined = (req as any).rawBody;
    if (!rawBody || rawBody.length === 0) {
      Logger.error(
        'Raw body not available for payments webhook verification — check rawBody: true configuration',
        loggerCtx,
      );
      throw new UnauthorizedException('Raw body not available');
    }

    const secret = razorpayPaymentsWebhookSecret();
    const sigCheck = verifyWebhookSignature({
      rawBody,
      signature,
      webhookSecret: secret,
    });

    if (!sigCheck.ok) {
      Logger.warn(
        `One-time payments webhook signature rejected: ${sigCheck.reason}`,
        loggerCtx,
      );
      throw new UnauthorizedException('Invalid webhook signature');
    }

    const event = payload?.event;
    if (event !== 'payment.captured' && event !== 'order.paid') {
      Logger.debug(`Ignoring non-settling event: ${event}`, loggerCtx);
      return { status: 'ignored' };
    }

    // Extract payment/order entity from payload
    const paymentEntity = payload?.payload?.payment?.entity;
    const razorpayPaymentId = paymentEntity?.id;
    const razorpayOrderId = paymentEntity?.order_id ?? payload?.payload?.order?.entity?.id;
    const vendureOrderCode =
      paymentEntity?.notes?.vendureOrderCode ??
      payload?.payload?.order?.entity?.receipt ??
      paymentEntity?.receipt;

    if (!razorpayPaymentId || !razorpayOrderId || !vendureOrderCode) {
      Logger.warn(
        `Webhook payload missing required identifiers (paymentId=${razorpayPaymentId}, orderId=${razorpayOrderId}, code=${vendureOrderCode})`,
        loggerCtx,
      );
      return { status: 'missing_identifiers' };
    }

    // Find the Vendure order by code
    const order = await this.connection.rawConnection.getRepository(Order).findOne({
      where: { code: vendureOrderCode },
      relations: { channels: true },
    });

    if (!order) {
      Logger.warn(
        `Webhook received for unknown Vendure order code: ${vendureOrderCode}`,
        loggerCtx,
      );
      return { status: 'order_not_found' };
    }

    if (order.state !== 'ArrangingPayment') {
      Logger.debug(
        `Order ${order.code} already in state ${order.state}; skipping webhook settlement`,
        loggerCtx,
      );
      return { status: 'already_settled' };
    }

    // Create an internal admin RequestContext scoped to the order's primary channel
    const channel = order.channels?.[0];
    const ctx = await this.requestContextService.create({
      apiType: 'admin',
      channelOrToken: channel,
    });

    const addPaymentResult = await this.orderService.addPaymentToOrder(ctx, order.id, {
      method: RAZORPAY_HANDLER_CODE,
      metadata: {
        razorpay_order_id: razorpayOrderId,
        razorpay_payment_id: razorpayPaymentId,
        // Webhook traffic has no client signature; the service relies on provider re-read.
      },
    });

    if ('state' in addPaymentResult && (addPaymentResult.state === 'PaymentSettled' || addPaymentResult.state === 'ArrangingPayment')) {
      Logger.debug(
        `Webhook reconciled order ${order.code} successfully (order state: ${addPaymentResult.state})`,
        loggerCtx,
      );
      return { status: 'reconciled' };
    }

    Logger.error(
      `Webhook failed to settle order ${order.code}: ${JSON.stringify(addPaymentResult)}`,
      loggerCtx,
    );
    return { status: 'settle_failed' };
  }
}
