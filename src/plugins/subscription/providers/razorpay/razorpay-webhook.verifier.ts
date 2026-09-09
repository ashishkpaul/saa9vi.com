import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@vendure/core';

const loggerCtx = 'RazorpayWebhookVerifier';

/**
 * Verifies Razorpay webhook signatures.
 *
 * Razorpay signs webhooks using HMAC-SHA256 with the webhook secret.
 * The signature is sent in the X-Razorpay-Signature header.
 */
@Injectable()
export class RazorpayWebhookVerifier {
    private readonly webhookSecret: string;

    constructor(private configService: ConfigService) {
        this.webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET || '';
    }

    /**
     * Verify the webhook signature.
     *
     * @param rawBody The raw request body bytes
     * @param signature The X-Razorpay-Signature header value
     * @returns true if the signature is valid
     */
    verify(rawBody: Buffer | string, signature: string): boolean {
        if (!this.webhookSecret) {
            Logger.warn('RAZORPAY_WEBHOOK_SECRET not configured - webhook verification disabled', loggerCtx);
            return false;
        }

        const crypto = require('crypto');
        const body = Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : rawBody;
        const expectedSignature = crypto
            .createHmac('sha256', this.webhookSecret)
            .update(body)
            .digest('hex');

        // Use timing-safe comparison to prevent timing attacks
        const sigBuffer = Buffer.from(signature, 'utf8');
        const expectedBuffer = Buffer.from(expectedSignature, 'utf8');

        if (sigBuffer.length !== expectedBuffer.length) {
            return false;
        }

        return crypto.timingSafeEqual(sigBuffer, expectedBuffer);
    }
}
