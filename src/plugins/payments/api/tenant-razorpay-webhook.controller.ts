import {
  BadRequestException,
  Controller,
  Headers,
  HttpCode,
  Logger,
  Param,
  Post,
  Req,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { Request } from 'express';
import {
  ChannelService,
  RequestContextService,
  TransactionalConnection,
} from '@vendure/core';
import { verifyWebhookSignature } from '../razorpay-checkout.policy';
import { TenantPaymentWebhookEvent } from '../entities/tenant-payment-webhook-event.entity';
import { TenantPaymentAccountService } from '../services/tenant-payment-account.service';
import {
  isTenantPaymentWebhookDuplicateViolation,
  tenantPaymentWebhookDedupeKey,
  TenantPaymentWebhookQueueService,
} from '../services/tenant-payment-webhook-queue.service';

const loggerCtx = 'TenantRazorpayWebhookController';

/**
 * Public, tenant-routed Razorpay Flow B webhook ingress.
 *
 * Endpoint:
 *   POST /payments/razorpay/tenant-webhook/:channelToken
 *
 * The Channel token is a routing identifier only. It never authenticates a
 * delivery or authorizes a payment. Every delivery must pass HMAC-SHA256
 * verification with that Channel's encrypted tenant webhook secret over the
 * exact raw request bytes.
 *
 * INV-004: this controller verifies and persists an immutable ChannelAware
 * inbox event, enqueues only its ID, and acknowledges only after durability
 * and successful enqueue. It does not mutate Orders or Payments.
 */
@Controller('payments/razorpay')
export class TenantRazorpayWebhookController {
  constructor(
    private readonly channelService: ChannelService,
    private readonly requestContextService: RequestContextService,
    private readonly connection: TransactionalConnection,
    private readonly accountService: TenantPaymentAccountService,
    private readonly webhookQueue: TenantPaymentWebhookQueueService,
  ) {}

  @Post('tenant-webhook/:channelToken')
  @HttpCode(200)
  async handleWebhook(
    @Param('channelToken') channelToken: string,
    @Headers('x-razorpay-signature') signature: string,
    @Headers('x-razorpay-event-id') providerEventIdHeader: string,
    @Req() req: Request,
  ): Promise<{ status: string }> {
    const rawBody: Buffer | undefined = (req as any).rawBody;
    if (!rawBody || rawBody.length === 0) {
      throw new UnauthorizedException('Raw webhook body is not available');
    }

    // The route token selects the account only. The secret-based HMAC below is
    // the actual authentication boundary.
    const channel = await this.channelService.getChannelFromToken(channelToken);
    const ctx = await this.requestContextService.create({
      apiType: 'admin',
      channelOrToken: channel.token,
    });

    const webhookSecret = await this.accountService.getWebhookSecret(
      ctx,
      channel.id,
    );
    const signatureResult = verifyWebhookSignature({
      rawBody,
      signature,
      webhookSecret,
    });
    if (!signatureResult.ok) {
      Logger.warn(
        `Tenant Razorpay webhook rejected for channel ${channel.id}: ${signatureResult.reason}`,
        loggerCtx,
      );
      throw new UnauthorizedException('Invalid tenant webhook signature');
    }

    // Only parse after the exact bytes have been authenticated. Razorpay uses
    // x-razorpay-event-id as its unique delivery identifier; unlike Flow A's
    // legacy ingress, this tenant route requires it rather than synthesizing
    // an ID that could collapse unrelated payloads.
    const providerEventId = providerEventIdHeader?.trim();
    if (!providerEventId) {
      throw new BadRequestException('Missing x-razorpay-event-id header');
    }

    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(rawBody.toString('utf8')) as Record<string, unknown>;
    } catch {
      throw new BadRequestException('Webhook payload is not valid JSON');
    }

    const eventType = payload?.['event'];
    if (typeof eventType !== 'string' || eventType.length === 0) {
      throw new BadRequestException('Webhook payload is missing event type');
    }

    const payloadHash = TenantRazorpayWebhookController.hashRawBody(rawBody);
    const dedupeKey = tenantPaymentWebhookDedupeKey(
      String(channel.id),
      providerEventId,
    );
    const paymentEntity = (payload as any)?.payload?.payment?.entity;
    const vendureOrderCode: string | null =
      paymentEntity?.notes?.vendureOrderCode ??
      (payload as any)?.payload?.order?.entity?.receipt ??
      paymentEntity?.receipt ??
      null;

    const eventRepo = this.connection.getRepository(ctx, TenantPaymentWebhookEvent);
    const event = eventRepo.create({
      channels: [channel],
      provider: 'razorpay',
      providerEventId,
      dedupeKey,
      eventType,
      payloadHash,
      rawPayload: payload,
      verifiedAt: new Date(),
      processingStatus: 'pending',
      attemptCount: 0,
      processedAt: null,
      failedAt: null,
      errorMessage: null,
      vendureOrderCode,
    });

    let savedEvent: TenantPaymentWebhookEvent;
    try {
      savedEvent = await eventRepo.save(event);
    } catch (err: any) {
      if (!isTenantPaymentWebhookDuplicateViolation(err)) {
        // A database/connection failure must return non-2xx so Razorpay retries.
        throw err;
      }

      const existing = await eventRepo.findOne({ where: { dedupeKey } });
      if (existing?.processingStatus === 'pending') {
        try {
          await this.webhookQueue.enqueueWebhookEvent(existing.id as number);
        } catch (enqueueError) {
          Logger.error(
            `Could not re-enqueue pending tenant webhook event ${existing.id}: ${String(enqueueError)}`,
            loggerCtx,
          );
          throw new ServiceUnavailableException('Tenant webhook was stored but could not be queued');
        }
      }
      // processed/ignored/failed events are terminal. A pending duplicate is
      // re-enqueued to recover "persisted but enqueue failed" deliveries.
      return { status: 'ok' };
    }

    try {
      await this.webhookQueue.enqueueWebhookEvent(savedEvent.id as number);
    } catch (err) {
      Logger.error(
        `Tenant webhook event ${savedEvent.id} is durable but enqueue failed: ${String(err)}`,
        loggerCtx,
      );
      // Do not acknowledge success. Razorpay's duplicate delivery will find
      // the pending row and retry enqueueing it.
      throw new ServiceUnavailableException('Tenant webhook was stored but could not be queued');
    }

    return { status: 'ok' };
  }

  static hashRawBody(rawBody: Buffer): string {
    return require('crypto').createHash('sha256').update(rawBody).digest('hex');
  }
}
