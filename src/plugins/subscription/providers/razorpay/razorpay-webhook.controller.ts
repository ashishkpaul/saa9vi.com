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
        @Body() payload: any,
        @Req() req: Request,
    ): Promise<{ status: string }> {
        // Get raw body for signature verification
        const rawBody = (req as any).rawBody || JSON.stringify(payload);

        // Verify webhook signature
        if (!this.webhookVerifier.verify(rawBody, signature)) {
            throw new UnauthorizedException('Invalid webhook signature');
        }

        // Extract event name
        const event = payload.event;
        if (!event) {
            throw new UnauthorizedException('Missing event in payload');
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
            providerEventId: payload.event_id || payload.id || `evt_${Date.now()}`,
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
            Logger.warn(`Webhook event already received: ${webhookEvent.providerEventId}`, loggerCtx);
            return { status: 'ok' };
        }

        // Process webhook asynchronously
        await this.webhookProcessor.processWebhook(ctx, event, payload);

        return { status: 'ok' };
    }
}
