import { Controller, Post, Headers, Body, UnauthorizedException, Req } from '@nestjs/common';
import { Request } from 'express';
import { EventBus, RequestContextService, TransactionalConnection, ChannelService, Logger } from '@vendure/core';
import { RazorpayWebhookVerifier } from './razorpay-webhook.verifier';
import { RazorpayWebhookProcessor } from './razorpay-webhook.processor';
import { ProviderWebhookEvent } from '../../entities/provider-webhook-event.entity';

const loggerCtx = 'RazorpayWebhookController';

/**
 * Controller for receiving Razorpay webhooks.
 *
 * Endpoint: POST /payments/razorpay/webhook
 *
 * Security:
 * - Verifies X-Razorpay-Signature header using webhook secret
 * - Returns 401 if signature is invalid
 * - Persists event to immutable inbox BEFORE processing
 * - Returns 200 immediately after persisting event (async processing)
 */
@Controller('payments/razorpay')
export class RazorpayWebhookController {
    constructor(
        private webhookVerifier: RazorpayWebhookVerifier,
        private webhookProcessor: RazorpayWebhookProcessor,
        private requestContextService: RequestContextService,
        private connection: TransactionalConnection,
        private channelService: ChannelService,
        private eventBus: EventBus,
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
            channelId: String(ctx.channelId),
            provider: 'razorpay',
            providerEventId: eventId,
            eventType: event,
            payloadHash,
            rawPayload: payload,
            verifiedAt: new Date(),
            processingStatus: 'pending',
        });

        try {
            await eventRepo.save(webhookEvent);
        } catch (err) {
            // If UNIQUE constraint violation, event already received
            Logger.warn(`Webhook event already received: ${eventId}`, loggerCtx);
            return { status: 'ok' };
        }

        // Process webhook asynchronously (non-blocking)
        // The processor will update the event status when complete
        setImmediate(() => {
            this.webhookProcessor.processWebhook(ctx, event, payload).catch((err) => {
                Logger.error(`Webhook processing failed: ${err.message}`, loggerCtx);
            });
        });

        // Return 2xx immediately after persisting
        return { status: 'ok' };
    }
}
