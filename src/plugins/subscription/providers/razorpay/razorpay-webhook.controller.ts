import { Controller, Post, Headers, Body, UnauthorizedException, Req } from '@nestjs/common';
import { Request } from 'express';
import { RequestContextService, TransactionalConnection, Logger } from '@vendure/core';
import { RazorpayWebhookVerifier } from './razorpay-webhook.verifier';
import { ProviderWebhookQueueService } from '../../services/provider-webhook-queue.service';
import { ProviderWebhookEvent } from '../../entities/provider-webhook-event.entity';

const loggerCtx = 'RazorpayWebhookController';

/**
 * Controller for receiving Razorpay webhooks.
 *
 * Endpoint: POST /payments/razorpay/webhook
 *
 * Boundary: this controller does NOT process business events. It only
 * authenticates, persists to the immutable inbox, and enqueues.
 *
 * Security:
 * - Verifies X-Razorpay-Signature header using webhook secret
 * - Returns 401 if signature is invalid
 * - Persists event to immutable inbox BEFORE processing
 * - Enqueues event ID for BullMQ worker processing
 * - Returns 200 immediately after persisting event (async processing)
 */
@Controller('payments/razorpay')
export class RazorpayWebhookController {
    constructor(
        private webhookVerifier: RazorpayWebhookVerifier,
        private webhookQueue: ProviderWebhookQueueService,
        private requestContextService: RequestContextService,
        private connection: TransactionalConnection,
    ) {}

    @Post('webhook')
    async handleWebhook(
        @Headers('x-razorpay-signature') signature: string,
        @Headers('x-razorpay-event-id') eventId: string,
        @Body() payload: any,
        @Req() req: Request,
    ): Promise<{ status: string }> {
        // Get raw body for signature verification
        // rawBody: true is configured in src/index.ts bootstrap
        const rawBody: Buffer | undefined = (req as any).rawBody;
        if (!rawBody || rawBody.length === 0) {
            Logger.error('Raw body not available for webhook verification - check rawBody: true configuration', loggerCtx);
            throw new UnauthorizedException('Raw body not available');
        }

        // Require signature header
        if (!signature) {
            Logger.warn('Missing X-Razorpay-Signature header', loggerCtx);
            throw new UnauthorizedException('Missing webhook signature');
        }

        // Verify webhook signature
        if (!this.webhookVerifier.verify(rawBody, signature)) {
            throw new UnauthorizedException('Invalid webhook signature');
        }

        // Extract event name
        const event = payload.event;
        if (!event) {
            throw new UnauthorizedException('Missing event in payload');
        }

        // Use x-razorpay-event-id header as the authoritative idempotency key
        // Razorpay recommends using this header to detect duplicate webhook deliveries
        if (!eventId) {
            Logger.error('Missing x-razorpay-event-id header', loggerCtx);
            throw new UnauthorizedException('Missing event ID header');
        }

        // Create request context (system context for webhooks)
        const ctx = await this.requestContextService.create({
            apiType: 'admin',
        });

        // Persist to immutable inbox FIRST (before processing)
        const crypto = require('crypto');
        const payloadHash = crypto.createHash('sha256').update(rawBody).digest('hex');

        const eventRepo = this.connection.getRepository(ctx, ProviderWebhookEvent);
        const webhookEvent = eventRepo.create({
            channelId: null, // Resolved by worker after provider binding lookup (INV-001)
            provider: 'razorpay',
            providerEventId: eventId,
            eventType: event,
            payloadHash,
            rawPayload: payload,
            verifiedAt: new Date(),
            processingStatus: 'pending',
        });

        let savedEvent: ProviderWebhookEvent;
        try {
            savedEvent = await eventRepo.save(webhookEvent);
        } catch (err: any) {
            // UNIQUE(provider, providerEventId) violation → duplicate delivery.
            // Razorpay retries non-2xx responses, so the duplicate path must also
            // recover the "persisted but enqueue failed" failure mode: if the event
            // is still pending, ensure it is (re-)enqueued before returning 2xx.
            const existing = await eventRepo.findOne({
                where: { provider: 'razorpay', providerEventId: eventId },
            });

            if (existing && existing.processingStatus === 'pending') {
                // Recovery: the original delivery may have persisted the event but
                // failed to enqueue it. Re-enqueue now — the worker's idempotency
                // guards make a redundant job a safe no-op.
                await this.webhookQueue.enqueueWebhookEvent(existing.id as number);
                Logger.warn(`Duplicate webhook ${eventId}: pending event re-enqueued for processing`, loggerCtx);
            } else {
                Logger.warn(`Webhook event already received: ${eventId}${existing ? ` (${existing.processingStatus})` : ''}`, loggerCtx);
            }
            return { status: 'ok' };
        }

        // Enqueue for async processing via BullMQ (INV-004)
        // Only the immutable inbox ID is passed — the worker loads the full event
        await this.webhookQueue.enqueueWebhookEvent(savedEvent.id as number);

        // Return 2xx immediately after persisting and enqueuing
        return { status: 'ok' };
    }
}
