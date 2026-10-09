import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import {
  JobQueue,
  JobQueueService,
  Order,
  OrderService,
  RequestContextService,
  TransactionalConnection,
} from '@vendure/core';
import * as crypto from 'crypto';
import { PaymentWebhookEvent } from '../entities/payment-webhook-event.entity';
import { RAZORPAY_HANDLER_CODE } from '../constants';
import { RazorpayCheckoutService } from './razorpay-checkout.service';
import { PaymentOpsAlertService } from './payment-ops-alert.service';

const loggerCtx = 'PaymentWebhookQueueService';
const QUEUE_NAME = 'payment-webhook-reconciliation';

/**
 * Commit 2: only these event types may settle an order. Everything else
 * (payment.failed, payment.authorized, refund.*, …) is terminal-by-inspection
 * and reconciles to 'ignored' with an ignored-by-type marker — never a retry.
 */
export const SETTLING_WEBHOOK_EVENT_TYPES = ['payment.captured', 'order.paid'] as const;

const MAX_ATTEMPTS = 3;
const BULLMQ_RETRIES = MAX_ATTEMPTS - 1;

export interface PaymentWebhookJobData {
  eventId: number;
}

/**
 * Narrow check: is this error a UNIQUE(provider, providerEventId)
 * violation on the one-time `payment_webhook_event` inbox? Prefer the
 * machine-readable PostgreSQL SQLSTATE (23505 = unique_violation); fall
 * back to the human-readable message for drivers that lose code
 * metadata. Anything else (connection loss, serialization failure,
 * other constraints) must NOT take the duplicate-delivery path — the
 * caller rethrows so the webhook returns non-2xx and Razorpay retries.
 * (Mirrors `isProviderWebhookDuplicateViolation` for the recurring
 * `ProviderWebhookEvent` inbox.)
 */
export function isPaymentWebhookDuplicateViolation(err: any): boolean {
  if (err?.code === '23505') {
    const meta =
      String(err?.constraint ?? '') +
      String(err?.detail ?? '') +
      String(err?.message ?? '');
    // Generated index names (e.g. IDX_0766a0e6389097e1aed592cba0) carry
    // no column info; only narrow when metadata names the inbox key.
    if (!meta) return true;
    return /provider/i.test(meta) && /providerEventId/i.test(meta);
  }
  const msg = String(err?.message ?? '') + String(err?.detail ?? '');
  return (
    /duplicate key/i.test(msg) &&
    /provider/i.test(msg) &&
    /providerEventId|provider_event|providerEvent/i.test(msg)
  );
}

/**
 * R3 — BullMQ queue for one-time payment webhook reconciliation (INV-004).
 * Enqueue carries ONLY the inbox ID; the worker loads the row by ID.
 * Boundary: one-time commerce only. The recurring inbox
 * (`ProviderWebhookEvent` / `provider-webhook-processing`) stays in
 * SubscriptionPlugin — the two lifecycles must not merge (ADR-038).
 */
@Injectable()
export class PaymentWebhookQueueService implements OnModuleInit {
  private jobQueue!: JobQueue<PaymentWebhookJobData>;

  constructor(
    private readonly jobQueueService: JobQueueService,
    private readonly connection: TransactionalConnection,
    private readonly requestContextService: RequestContextService,
    private readonly orderService: OrderService,
    private readonly checkoutService: RazorpayCheckoutService,
    private readonly opsAlert: PaymentOpsAlertService,
  ) {}

  async onModuleInit(): Promise<void> {
    this.jobQueue = await this.jobQueueService.createQueue({
      name: QUEUE_NAME,
      process: async (job) => {
        await this.processWebhookEvent(job.data.eventId);
      },
    });
    Logger.log(`Payment webhook reconciliation queue initialized: ${QUEUE_NAME}`, loggerCtx);
  }

  async enqueueWebhookEvent(eventId: number): Promise<void> {
    await this.jobQueue.add({ eventId }, { retries: BULLMQ_RETRIES });
  }

  /**
   * INV-004 worker entrypoint: load the inbox row by ID, reconcile, and
   * advance the processing lifecycle.
   *
   * State transitions (mirror ProviderWebhookQueueService semantics):
   *   pending + attempt → increment attemptCount, keep pending (retry visibility)
   *   processed / ignored → terminal, stamp processedAt (ignored = terminal by
   *     inspection: unusable delivery, see reconcileEvent)
   *   failure + attempts left → keep pending, rethrow for BullMQ retry
   *   failure + no attempts left → failed + failedAt (terminal), rethrow
   */
  async processWebhookEvent(eventId: number): Promise<void> {
    const ctx = await this.requestContextService.create({ apiType: 'admin' });
    const repo = this.connection.getRepository(ctx, PaymentWebhookEvent);
    const event = await repo.findOne({ where: { id: eventId } });
    if (!event) {
      Logger.error(`Payment webhook event ${eventId} not found — refusing to invent it`, loggerCtx);
      return;
    }
    if (event.processingStatus === 'processed' || event.processingStatus === 'ignored') {
      Logger.log(
        `Payment webhook event ${eventId} already ${event.processingStatus} — skipping`,
        loggerCtx,
      );
      return;
    }
    if (event.processingStatus === 'failed') {
      Logger.warn(`Payment webhook event ${eventId} already terminally failed — skipping`, loggerCtx);
      return;
    }

    event.attemptCount += 1;

    try {
      const outcome = await this.reconcileEvent(event);
      event.processingStatus = outcome; // 'processed' | 'ignored'
      event.processedAt = new Date();
      event.failedAt = null;
      event.errorMessage = null;
      await repo.save(event);
      Logger.log(`Payment webhook event ${eventId} ${outcome} successfully`, loggerCtx);
    } catch (err: any) {
      event.errorMessage = err?.message || 'Unknown error';
      if (event.attemptCount >= MAX_ATTEMPTS) {
        event.processingStatus = 'failed';
        event.failedAt = new Date();
        await repo.save(event);
        Logger.error(
          `Payment webhook event ${eventId} terminal failure after ${event.attemptCount} attempts: ${err?.message}`,
          loggerCtx,
        );
      } else {
        await repo.save(event);
        Logger.warn(
          `Payment webhook event ${eventId} attempt ${event.attemptCount} failed (will retry): ${err?.message}`,
          loggerCtx,
        );
      }
      throw err;
    }
  }

  /**
   * Load the raw payload from the inbox row, extract the provider
   * identifiers, and settle the bound Vendure order via the same
   * `verifyAndSettle` path the synchronous shop flow uses — with an
   * admin/system ctx (no client signature to trust; provider re-read
   * is the authority).
   *
   * Returns 'ignored' for terminal-by-inspection deliveries that must
   * NOT retry: missing identifiers, unknown order, already-settled order.
   * Throws for retryable failures (provider errors, unexpected order
   * states) so BullMQ redelivers up to MAX_ATTEMPTS.
   */
  private async reconcileEvent(event: PaymentWebhookEvent): Promise<'processed' | 'ignored'> {
    const payload = (event.rawPayload ?? {}) as any;

    // Commit 2: handle only settling event types. payment.failed (and any
    // other non-settling type) is terminal-by-inspection — ignored-by-type,
    // never retried.
    const eventType: string = (event.eventType ?? payload?.event ?? 'unknown') as string;
    if (!(SETTLING_WEBHOOK_EVENT_TYPES as readonly string[]).includes(eventType)) {
      Logger.log(
        `Payment webhook event ${event.id} ignored-by-type (${eventType}) — only ${SETTLING_WEBHOOK_EVENT_TYPES.join('/')} settle orders`,
        loggerCtx,
      );
      return 'ignored';
    }
    const paymentEntity = payload?.payload?.payment?.entity;
    const razorpayPaymentId: string | undefined = paymentEntity?.id;
    const razorpayOrderId: string | undefined =
      paymentEntity?.order_id ?? payload?.payload?.order?.entity?.id;
    const vendureOrderCode: string | undefined =
      paymentEntity?.notes?.vendureOrderCode ??
      payload?.payload?.order?.entity?.receipt ??
      paymentEntity?.receipt;

    if (!razorpayPaymentId || !razorpayOrderId || !vendureOrderCode) {
      Logger.warn(
        `Payment webhook event ${event.id} missing identifiers — ignoring`,
        loggerCtx,
      );
      return 'ignored';
    }

    const orderRepo = this.connection.rawConnection.getRepository(Order);
    const order = await orderRepo.findOne({
      where: { code: vendureOrderCode },
      relations: { channels: true },
    });

    if (!order) {
      Logger.warn(
        `Payment webhook event ${event.id} references unknown order ${vendureOrderCode} — ignoring`,
        loggerCtx,
      );
      return 'ignored';
    }

    if (order.state !== 'ArrangingPayment') {
      // Commit 2 correction: distinguish a benign redelivery (this exact
      // Razorpay payment already recorded on the order — Vendure's payment
      // pipeline is idempotent) from a genuine anomaly (a DIFFERENT payment
      // arriving for an order that is no longer payable).
      const alreadyRecorded = await this.isPaymentAlreadyRecorded(order.id, razorpayPaymentId);
      if (alreadyRecorded) {
        Logger.log(
          `Order ${order.code} already settled with Razorpay payment ${razorpayPaymentId} — duplicate delivery ${event.id} ignored (no alert)`,
          loggerCtx,
        );
        return 'ignored';
      }
      // A CAPTURED payment landing on a non-ArrangingPayment order with NO
      // matching payment is a money-path anomaly (double-settle attempt,
      // stale replay, or manual state move). Still terminal 'ignored' —
      // retrying would risk a second settlement — but raise an ops alert
      // instead of staying silent.
      this.opsAlert.notify(
        'payment-captured-on-settled-order',
        String(order.code),
        `Captured payment ${razorpayPaymentId} for order ${order.code} arrived while order is ${order.state} (event ${event.id}) with no matching payment — ignored, operator review needed`,
        { orderCode: order.code, orderState: order.state, eventId: event.id, eventType, razorpayPaymentId },
      );
      Logger.warn(
        `Order ${order.code} in state ${order.state} received unmatched captured payment ${razorpayPaymentId} (event ${event.id}) — ignored with ops alert`,
        loggerCtx,
      );
      return 'ignored';
    }

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
      },
    });

    const state = (addPaymentResult as any)?.state;
    // addPaymentToOrder returns { state: 'Settled' } when a payment settles
    // the order, or { state: 'ArrangingPayment' } when it ACCEPTS the payment
    // but the order still needs more (e.g. error-result payment recorded,
    // partial payment). Both mean the provider payment was consumed exactly
    // once by Vendure's idempotent payment pipeline — NOT a failure — so both
    // are terminal-PROCESSED. Anything else (Error/Declined/Cancelled result
    // shapes, unexpected payloads) throws for BullMQ retry. NOTE: delivery
    // idempotency UNIQUE(provider, providerEventId) is NOT business
    // idempotency — a second delivery of the same Razorpay payment/order
    // becomes a second inbox row, is reconciled independently, and lands
    // 'ignored' (order no longer ArrangingPayment) once the first settles it.
    if (state === 'Settled' || state === 'PaymentSettled' || state === 'ArrangingPayment') {
      Logger.log(
        `Payment webhook event ${event.id} reconciled order ${order.code} (state: ${state})`,
        loggerCtx,
      );
      return 'processed';
    }

    throw new Error(
      `Webhook reconciliation failed for order ${order.code}: ${JSON.stringify(addPaymentResult)}`,
    );
  }

  /**
   * Commit 2 correction: has this exact Razorpay payment already been
   * recorded on the order (transactionId match)? A redelivered webhook for
   * the SAME payment is benign — the order settled, the payment is there —
   * and must NOT page an operator.
   */
  private async isPaymentAlreadyRecorded(orderId: unknown, razorpayPaymentId: string): Promise<boolean> {
    try {
      const paymentRepo = this.connection.rawConnection.getRepository('Payment' as never) as {
        find: (opts: unknown) => Promise<Array<{ transactionId?: string; metadata?: Record<string, unknown> }>>;
      };
      const payments = await paymentRepo.find({
        where: { order: { id: orderId } },
        relations: { order: true },
      }).catch(async () => {
        // Fallback: query without the relation join (driver-dependent).
        const repo2 = this.connection.rawConnection.getRepository('Payment' as never) as {
          find: (opts: unknown) => Promise<Array<{ transactionId?: string; metadata?: Record<string, unknown> }>>;
        };
        return repo2.find({ where: { orderId } });
      });
      return payments.some(
        (p) =>
          p.transactionId === razorpayPaymentId ||
          (p.metadata as Record<string, unknown> | undefined)?.['razorpay_payment_id'] === razorpayPaymentId,
      );
    } catch {
      // Fail toward alerting: if we cannot prove the payment is recorded,
      // the caller raises the ops alert rather than silently ignoring.
      return false;
    }
  }

  /**
   * Stable idempotency key for one-time deliveries (INV-004).
   * Prefers Razorpay's `x-razorpay-event-id` header; falls back to a
   * `synthetic:<sha256(rawBody)>` key so retries of the same delivery
   * map to the same inbox row even when the header is absent.
   */
  static resolveProviderEventId(input: {
    headerEventId?: string;
    payloadHash: string;
  }): string {
    const header = input.headerEventId?.trim();
    if (header) return header;
    return `synthetic:${input.payloadHash}`;
  }

  /** SHA-256 hex of the exact raw bytes Razorpay signed. */
  static hashRawBody(rawBody: Buffer): string {
    return crypto.createHash('sha256').update(rawBody).digest('hex');
  }
}

