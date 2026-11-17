import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import {
  JobQueue,
  JobQueueService,
  OrderService,
  RequestContextService,
  TransactionalConnection,
} from '@vendure/core';
import * as crypto from 'crypto';
import { TENANT_RAZORPAY_HANDLER_CODE } from '../constants';
import { TenantPaymentWebhookEvent } from '../entities/tenant-payment-webhook-event.entity';
import {
  assertOrderBinding,
  assertPaymentBinding,
  computeCheckoutSignature,
} from '../razorpay-checkout.policy';
import { TenantPaymentAccountService } from './tenant-payment-account.service';
import { TenantRazorpayOrdersClient } from './tenant-razorpay-orders.client';
import { PaymentOpsAlertService } from './payment-ops-alert.service';

const loggerCtx = 'TenantPaymentWebhookQueueService';
const QUEUE_NAME = 'tenant-payment-webhook-reconciliation';
const MAX_ATTEMPTS = 3;
const BULLMQ_RETRIES = MAX_ATTEMPTS - 1;

class TenantPaymentWebhookManualReviewError extends Error {
  constructor(
    readonly kind: string,
    message: string,
    readonly alertPayload: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'TenantPaymentWebhookManualReviewError';
  }
}

/** Only a captured payment is sufficient to settle a Vendure order. */
export const TENANT_SETTLING_WEBHOOK_EVENT_TYPES = ['payment.captured'] as const;

export interface TenantPaymentWebhookJobData {
  eventId: number;
}

/**
 * Scope the provider delivery ID to the tenant account. Razorpay event IDs are
 * unique per event, but the durable inbox must not let one tenant's event key
 * suppress another tenant's independently configured account.
 */
export function tenantPaymentWebhookDedupeKey(
  channelId: string,
  providerEventId: string,
): string {
  return crypto
    .createHash('sha256')
    .update(`razorpay|${channelId}|${providerEventId}`)
    .digest('hex');
}

/** Narrow unique-constraint detection for the tenant webhook inbox. */
export function isTenantPaymentWebhookDuplicateViolation(err: any): boolean {
  if (err?.code === '23505') {
    const constraint = String(err?.constraint ?? '');
    const detail = String(err?.detail ?? '') + String(err?.message ?? '');
    return (
      constraint.includes('UQ_tenant_payment_webhook_event_dedupe') ||
      /tenant_payment_webhook_event.*dedupeKey/i.test(detail) ||
      /dedupeKey/i.test(detail)
    );
  }
  const message = String(err?.message ?? '') + String(err?.detail ?? '');
  return (
    /duplicate key/i.test(message) &&
    /tenant_payment_webhook_event/i.test(message) &&
    /dedupeKey|dedupe_key/i.test(message)
  );
}

/**
 * Persist-first worker for Flow B tenant Razorpay webhooks (INV-004).
 *
 * The queue stores only the inbox ID. The worker loads the event, resolves its
 * ChannelAware owner, re-reads Razorpay's order/payment using that tenant's
 * credentials, and settles through the registered tenant PaymentMethodHandler.
 * Flow A and recurring SubscriptionPlugin workers remain separate.
 */
@Injectable()
export class TenantPaymentWebhookQueueService implements OnModuleInit {
  private jobQueue!: JobQueue<TenantPaymentWebhookJobData>;

  constructor(
    private readonly jobQueueService: JobQueueService,
    private readonly connection: TransactionalConnection,
    private readonly requestContextService: RequestContextService,
    private readonly orderService: OrderService,
    private readonly accountService: TenantPaymentAccountService,
    private readonly client: TenantRazorpayOrdersClient,
    private readonly opsAlert: PaymentOpsAlertService,
  ) {}

  async onModuleInit(): Promise<void> {
    this.jobQueue = await this.jobQueueService.createQueue({
      name: QUEUE_NAME,
      process: async (job) => {
        await this.processWebhookEvent(job.data.eventId);
      },
    });
    Logger.log(`Tenant payment webhook queue initialized: ${QUEUE_NAME}`, loggerCtx);
  }

  async enqueueWebhookEvent(eventId: number): Promise<void> {
    await this.jobQueue.add({ eventId }, { retries: BULLMQ_RETRIES });
  }

  /**
   * Load the inbox event globally only to discover its single owning Channel.
   * All subsequent entity reads/writes run in a RequestContext for that Channel.
   */
  async processWebhookEvent(eventId: number): Promise<void> {
    const globalRepo = this.connection.rawConnection.getRepository(TenantPaymentWebhookEvent);
    const globalEvent = await globalRepo.findOne({
      where: { id: eventId as any },
      relations: { channels: true },
    });
    if (!globalEvent) {
      Logger.error(`Tenant webhook event ${eventId} not found`, loggerCtx);
      return;
    }

    const channels = globalEvent.channels ?? [];
    if (channels.length !== 1) {
      throw new Error(
        `Tenant webhook event ${eventId} must belong to exactly one Channel (found ${channels.length})`,
      );
    }
    const channel = channels[0];
    const ctx = await this.requestContextService.create({
      apiType: 'admin',
      // Pass the token string. Vendure 3.8 RequestContextService expects a
      // token here; passing a Channel object causes channelOrToken.startsWith
      // to fail (DL-029).
      channelOrToken: channel.token,
    });

    const repo = this.connection.getRepository(ctx, TenantPaymentWebhookEvent);
    const event = await repo.findOne({
      where: { id: eventId as any },
      relations: { channels: true },
    });
    if (!event) {
      Logger.error(
        `Tenant webhook event ${eventId} is not visible in its owning Channel context`,
        loggerCtx,
      );
      return;
    }
    if (
      event.processingStatus === 'processed' ||
      event.processingStatus === 'ignored' ||
      event.processingStatus === 'failed'
    ) {
      return;
    }

    event.attemptCount = (event.attemptCount ?? 0) + 1;
    try {
      const outcome = await this.reconcileEvent(ctx, event);
      event.processingStatus = outcome;
      event.processedAt = new Date();
      event.failedAt = null;
      event.errorMessage = null;
      await repo.save(event);
      Logger.log(
        `Tenant webhook event ${event.id} ${outcome} (type: ${event.eventType})`,
        loggerCtx,
      );
    } catch (err: any) {
      event.errorMessage = String(err?.message ?? 'Unknown tenant webhook reconciliation error');
      if (err instanceof TenantPaymentWebhookManualReviewError) {
        event.processingStatus = 'failed';
        event.failedAt = new Date();
        await repo.save(event);
        this.opsAlert.notify(
          err.kind,
          String(event.id),
          err.message,
          {
            tenantWebhookEventId: event.id,
            providerEventId: event.providerEventId,
            eventType: event.eventType,
            vendureOrderCode: event.vendureOrderCode,
            ...err.alertPayload,
          },
        );
        Logger.error(
          `Tenant webhook event ${event.id} requires manual review: ${err.message}`,
          loggerCtx,
        );
        return;
      }
      if (event.attemptCount >= MAX_ATTEMPTS) {
        event.processingStatus = 'failed';
        event.failedAt = new Date();
        await repo.save(event);
        Logger.error(
          `Tenant webhook event ${event.id} permanently failed after ${event.attemptCount} attempts: ${event.errorMessage}`,
          loggerCtx,
        );
      } else {
        await repo.save(event);
        Logger.warn(
          `Tenant webhook event ${event.id} attempt ${event.attemptCount} failed; BullMQ will retry: ${event.errorMessage}`,
          loggerCtx,
        );
      }
      throw err;
    }
  }

  private async reconcileEvent(
    ctx: import('@vendure/core').RequestContext,
    event: TenantPaymentWebhookEvent,
  ): Promise<'processed' | 'ignored'> {
    if (
      !(TENANT_SETTLING_WEBHOOK_EVENT_TYPES as readonly string[]).includes(event.eventType)
    ) {
      // payment.authorized, payment.failed, refunds and unrelated events are
      // durable receipts, but they must never settle or reverse an order.
      return 'ignored';
    }

    const payload = (event.rawPayload ?? {}) as any;
    const paymentEntity = payload?.payload?.payment?.entity;
    const razorpayPaymentId =
      typeof paymentEntity?.id === 'string' ? paymentEntity.id : '';
    const razorpayOrderId =
      typeof paymentEntity?.order_id === 'string' ? paymentEntity.order_id : '';
    if (!razorpayPaymentId || !razorpayOrderId) {
      return 'ignored';
    }

    const channelId = String(ctx.channelId);
    // A payment can be captured shortly before an administrator disables the
    // tenant's checkout. Reconciliation must still finish that money movement;
    // this resolver intentionally bypasses only the new-checkout enabled gate.
    const credentials = await this.accountService.getWebhookSettlementCredentials(
      ctx,
      channelId,
    );

    const razorpayOrder = await this.client.fetchOrder(
      credentials.keyId,
      credentials.keySecret,
      razorpayOrderId,
    );
    if (razorpayOrder.id !== razorpayOrderId) {
      throw new Error('Razorpay order lookup returned a different order ID');
    }

    const vendureOrderCode =
      razorpayOrder.notes?.vendureOrderCode ?? razorpayOrder.receipt ?? null;
    if (!vendureOrderCode) {
      Logger.warn(
        `Tenant webhook event ${event.id} provider order has no Vendure order binding`,
        loggerCtx,
      );
      return 'ignored';
    }

    const orderRepo = this.connection.getRepository(ctx, 'Order');
    const order = await orderRepo.findOne({
      where: { code: vendureOrderCode },
      relations: { channels: true },
    });
    if (!order) {
      throw new TenantPaymentWebhookManualReviewError(
        'tenant-payment-webhook-order-not-found',
        `Captured tenant payment ${razorpayPaymentId} references unknown Vendure order code ${vendureOrderCode}`,
        { razorpayOrderId, razorpayPaymentId, vendureOrderCode },
      );
    }

    const inChannel = (order.channels ?? []).some(
      (candidate: { id: string }) => String(candidate.id) === channelId,
    );
    if (!inChannel) {
      throw new TenantPaymentWebhookManualReviewError(
        'tenant-payment-webhook-channel-mismatch',
        `Captured tenant payment resolved order ${order.code} outside Channel ${channelId}`,
        { razorpayOrderId, razorpayPaymentId, orderId: order.id, orderCode: order.code },
      );
    }

    const orderBinding = assertOrderBinding({
      receipt: razorpayOrder.receipt,
      notes: razorpayOrder.notes,
      expectedOrderCode: order.code,
    });
    if (
      !orderBinding.ok ||
      (razorpayOrder.receipt && razorpayOrder.receipt !== order.code) ||
      (razorpayOrder.notes?.vendureOrderCode &&
        razorpayOrder.notes.vendureOrderCode !== order.code)
    ) {
      throw new Error(
        orderBinding.ok
          ? 'Razorpay receipt/notes contain conflicting Vendure order codes'
          : orderBinding.detail ?? 'Razorpay provider order is not bound to the Vendure order',
      );
    }

    const paymentRepo = this.connection.rawConnection.getRepository('Payment' as never) as {
      findOne: (options: unknown) => Promise<{
        id: string;
        state?: string;
        order?: { id: string } | null;
      } | null>;
    };
    const recordedPayment = await paymentRepo.findOne({
      where: { transactionId: razorpayPaymentId },
      relations: { order: true },
    });
    if (recordedPayment) {
      if (
        String(recordedPayment.order?.id) === String(order.id) &&
        recordedPayment.state === 'Settled'
      ) {
        return 'ignored';
      }
      throw new TenantPaymentWebhookManualReviewError(
        'tenant-payment-webhook-duplicate-payment',
        `Razorpay payment ${razorpayPaymentId} is already recorded but is not a settled payment for Vendure order ${order.code}`,
        {
          razorpayOrderId,
          razorpayPaymentId,
          orderId: order.id,
          orderCode: order.code,
          recordedPaymentId: recordedPayment.id,
          recordedPaymentState: recordedPayment.state,
          recordedOrderId: recordedPayment.order?.id,
        },
      );
    }

    if (order.state !== 'ArrangingPayment') {
      throw new TenantPaymentWebhookManualReviewError(
        'tenant-payment-webhook-unmatched-capture',
        `Captured tenant payment ${razorpayPaymentId} arrived for order ${order.code} in state ${order.state} without a matching Vendure Payment`,
        {
          razorpayOrderId,
          razorpayPaymentId,
          orderId: order.id,
          orderCode: order.code,
          orderState: order.state,
        },
      );
    }

    if (
      (order.customFields as { paymentPurpose?: string } | null)?.paymentPurpose ===
      'platform-service'
    ) {
      throw new TenantPaymentWebhookManualReviewError(
        'tenant-payment-webhook-flow-mismatch',
        `Tenant webhook event ${event.id} attempted to settle platform-service order ${order.code}`,
        { razorpayOrderId, razorpayPaymentId, orderId: order.id, orderCode: order.code },
      );
    }

    const payment = await this.client.fetchPayment(
      credentials.keyId,
      credentials.keySecret,
      razorpayPaymentId,
    );
    if (payment.id !== razorpayPaymentId) {
      throw new Error('Razorpay payment lookup returned a different payment ID');
    }

    const binding = assertPaymentBinding({
      paymentOrderId: payment.order_id,
      expectedRazorpayOrderId: razorpayOrderId,
      paymentAmountMinor: payment.amount,
      expectedAmountMinor: order.totalWithTax,
      paymentCurrency: payment.currency,
      expectedCurrency: order.currencyCode,
      providerStatus: payment.status,
    });
    if (!binding.ok) {
      throw new Error(
        `Tenant Razorpay payment failed provider binding: ${binding.reason} — ${binding.detail ?? ''}`,
      );
    }
    if (
      razorpayOrder.amount !== order.totalWithTax ||
      razorpayOrder.currency !== order.currencyCode
    ) {
      throw new Error('Razorpay order amount/currency do not match the Vendure order');
    }

    // The controller verified the original webhook HMAC before persisting this
    // event. The worker now derives the normal Checkout HMAC server-side so
    // Vendure's registered tenant PaymentMethodHandler can re-read provider
    // truth and run the same settlement checks as the synchronous Shop flow.
    const checkoutSignature = computeCheckoutSignature(
      razorpayOrderId,
      razorpayPaymentId,
      credentials.keySecret,
    );
    const addPaymentResult = await this.orderService.addPaymentToOrder(ctx, order.id, {
      method: TENANT_RAZORPAY_HANDLER_CODE,
      metadata: {
        razorpay_order_id: razorpayOrderId,
        razorpay_payment_id: razorpayPaymentId,
        razorpay_signature: checkoutSignature,
        tenant_webhook_event_id: String(event.id),
      },
    });

    const result = addPaymentResult as any;
    if (
      result?.errorCode ||
      result?.errorResults?.length ||
      !['Settled', 'PaymentSettled'].includes(result?.state)
    ) {
      throw new TenantPaymentWebhookManualReviewError(
        'tenant-payment-webhook-settlement-not-completed',
        `Razorpay captured payment ${razorpayPaymentId}, but Vendure did not settle order ${order.code}: ${JSON.stringify(result)}`,
        {
          razorpayOrderId,
          razorpayPaymentId,
          orderId: order.id,
          orderCode: order.code,
          vendureState: result?.state ?? 'unknown',
        },
      );
    }

    return 'processed';
  }
}
