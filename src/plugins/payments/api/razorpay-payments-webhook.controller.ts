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
  RequestContextService,
  TransactionalConnection,
} from '@vendure/core';
import { razorpayPaymentsWebhookSecret } from '../constants';
import { verifyWebhookSignature } from '../razorpay-checkout.policy';
import { PaymentWebhookEvent } from '../entities/payment-webhook-event.entity';
import {
  isPaymentWebhookDuplicateViolation,
  PaymentWebhookQueueService,
} from '../services/payment-webhook-queue.service';

const loggerCtx = 'RazorpayPaymentsWebhookController';

/**
 * Controller for receiving Razorpay one-time payment webhooks.
 *
 * Endpoint: POST /payments/razorpay/checkout-webhook
 *
 * INV-004 persist-first boundary: this controller does NOT touch orders or
 * payments. It only authenticates, persists to the immutable inbox, enqueues
 * the inbox ID, and returns 2xx immediately. Reconciliation lives in
 * `PaymentWebhookQueueService` (BullMQ `payment-webhook-reconciliation`).
 *
 * When a customer closes the browser before the frontend handshake returns,
 * Razorpay's webhook delivers `payment.captured` directly to this endpoint;
 * the worker settles the payment if the order is still `ArrangingPayment`.
 */
@Controller('payments/razorpay')
export class RazorpayPaymentsWebhookController {
  constructor(
    private readonly webhookQueue: PaymentWebhookQueueService,
    private readonly requestContextService: RequestContextService,
    private readonly connection: TransactionalConnection,
  ) {}

  @Post('checkout-webhook')
  @HttpCode(200)
  async handleWebhook(
    @Headers('x-razorpay-signature') signature: string,
    @Headers('x-razorpay-event-id') headerEventId: string,
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

    const eventType: string = payload?.event ?? 'unknown';
    const payloadHash = PaymentWebhookQueueService.hashRawBody(rawBody);
    const providerEventId = PaymentWebhookQueueService.resolveProviderEventId({
      headerEventId,
      payloadHash,
    });

    // Informational only — the worker re-reads the order from the DB.
    const paymentEntity = payload?.payload?.payment?.entity;
    const vendureOrderCode: string | null =
      paymentEntity?.notes?.vendureOrderCode ??
      payload?.payload?.order?.entity?.receipt ??
      paymentEntity?.receipt ??
      null;

    const ctx = await this.requestContextService.create({ apiType: 'admin' });
    const eventRepo = this.connection.getRepository(ctx, PaymentWebhookEvent);
    const webhookEvent = eventRepo.create({
      provider: 'razorpay',
      providerEventId,
      eventType,
      payloadHash,
      rawPayload: payload,
      verifiedAt: new Date(),
      processingStatus: 'pending',
      vendureOrderCode,
    });

    let savedEvent: PaymentWebhookEvent;
    try {
      savedEvent = await eventRepo.save(webhookEvent);
    } catch (err: any) {
      // Narrow the duplicate path to an actual UNIQUE(provider,
      // providerEventId) violation. Any other DB failure (connection loss,
      // serialization error, unrelated constraint) is rethrown so this
      // request returns non-2xx and Razorpay retries — returning 2xx here
      // would falsely claim the inbox row was persisted (INV-004).
      if (!isPaymentWebhookDuplicateViolation(err)) {
        throw err;
      }
      // UNIQUE(provider, providerEventId) violation → duplicate delivery.
      // Razorpay retries non-2xx responses, so the duplicate path must also
      // recover the "persisted but enqueue failed" mode: if still pending,
      // re-enqueue before returning 2xx (mirrors RazorpayWebhookController).
      const existing = await eventRepo.findOne({
        where: { provider: 'razorpay', providerEventId },
      });
      if (existing && existing.processingStatus === 'pending') {
        await this.webhookQueue.enqueueWebhookEvent(existing.id as number);
        Logger.warn(
          `Duplicate payments webhook ${providerEventId}: pending event re-enqueued`,
          loggerCtx,
        );
      } else {
        Logger.warn(
          `Payments webhook event already received: ${providerEventId}${existing ? ` (${existing.processingStatus})` : ''}`,
          loggerCtx,
        );
      }
      return { status: 'ok' };
    }

    await this.webhookQueue.enqueueWebhookEvent(savedEvent.id as number);
    return { status: 'ok' };
  }
}

