import { Injectable, Logger } from '@nestjs/common';
import { RequestContext, TransactionalConnection } from '@vendure/core';
import { SubscriptionProviderBinding } from '../../entities/subscription-provider-binding.entity';
import { SubscriptionBillingAttempt, BillingAttemptStatus } from '../../entities/subscription-billing-attempt.entity';
import { OrganizationSubscription } from '../../entities/organization-subscription.entity';
import { ProviderWebhookEvent } from '../../entities/provider-webhook-event.entity';

const loggerCtx = 'RazorpayWebhookProcessor';

export interface NormalizedBillingEvent {
    eventType: string;
    providerEventId: string;
    providerSubscriptionId: string;
    providerPaymentId?: string;
    providerInvoiceId?: string;
    amountPaise?: number;
    currency?: string;
    status: string;
    rawPayload: any;
}

@Injectable()
export class RazorpayWebhookProcessor {
    constructor(private connection: TransactionalConnection) {}

    /**
     * Process a webhook event from the immutable inbox.
     * Uses the authoritative event ID from the inbox record (x-razorpay-event-id header).
     * Resolves channel from SubscriptionProviderBinding, not arbitrary context.
     */
    async processInboxEvent(ctx: RequestContext, inboxEvent: ProviderWebhookEvent): Promise<void> {
        const providerEventId = inboxEvent.providerEventId;
        const event = inboxEvent.eventType;
        const payload = inboxEvent.rawPayload;

        // Idempotency check using the authoritative inbox event ID
        if (await this.isEventProcessed(ctx, providerEventId)) {
            Logger.log(`Event ${providerEventId} already processed`, loggerCtx);
            return;
        }

        const ne = this.normalizeEvent(event, payload, providerEventId);

        switch (event) {
            case 'subscription.authenticated':
                await this.updateBinding(ctx, ne.providerSubscriptionId, 'authenticated', false);
                break;
            case 'subscription.activated':
                await this.updateBinding(ctx, ne.providerSubscriptionId, 'active', true);
                if (ne.providerPaymentId && ne.amountPaise) await this.recordAttempt(ctx, ne, 'succeeded');
                break;
            case 'subscription.charged':
                if (ne.providerPaymentId && ne.amountPaise) await this.recordAttempt(ctx, ne, 'succeeded');
                break;
            case 'subscription.halted':
                await this.updateBinding(ctx, ne.providerSubscriptionId, 'halted', false);
                if (ne.providerPaymentId) await this.recordAttempt(ctx, ne, 'failed');
                break;
            case 'subscription.cancelled':
                await this.updateBinding(ctx, ne.providerSubscriptionId, 'cancelled', false);
                break;
            case 'payment.failed':
                if (ne.providerPaymentId && ne.amountPaise) await this.recordAttempt(ctx, ne, 'failed');
                break;
            default:
                Logger.warn(`Unhandled Razorpay event: ${event}`, loggerCtx);
        }
    }

    private normalizeEvent(event: string, payload: any, eventId: string): NormalizedBillingEvent {
        const sub = payload.subscription?.entity;
        const pay = payload.payment?.entity;
        const inv = payload.invoice?.entity;
        return {
            eventType: event,
            providerEventId: eventId,
            providerSubscriptionId: sub?.id || payload.subscription_id,
            providerPaymentId: pay?.id || payload.payment_id,
            providerInvoiceId: inv?.id || payload.invoice_id,
            amountPaise: pay?.amount || inv?.amount,
            currency: pay?.currency || inv?.currency,
            status: sub?.status || pay?.status || 'unknown',
            rawPayload: payload,
        };
    }

    private async updateBinding(ctx: RequestContext, subId: string, status: string, active: boolean): Promise<void> {
        const repo = this.connection.getRepository(ctx, SubscriptionProviderBinding);
        const binding = await repo.findOne({ where: { providerSubscriptionId: subId } });
        if (binding) {
            binding.providerStatus = status;
            binding.active = active;
            await repo.save(binding);
        }
    }

    private async recordAttempt(ctx: RequestContext, ne: NormalizedBillingEvent, status: BillingAttemptStatus): Promise<void> {
        const bindingRepo = this.connection.getRepository(ctx, SubscriptionProviderBinding);
        const binding = await bindingRepo.findOne({ where: { providerSubscriptionId: ne.providerSubscriptionId } });
        if (!binding) return;

        const attemptRepo = this.connection.getRepository(ctx, SubscriptionBillingAttempt);
        const attempt = attemptRepo.create({
            subscription: { id: binding.subscription.id } as OrganizationSubscription,
            channelId: binding.channelId,
            provider: 'razorpay',
            providerSubscriptionId: ne.providerSubscriptionId,
            providerPaymentId: ne.providerPaymentId,
            providerInvoiceId: ne.providerInvoiceId,
            providerEventId: ne.providerEventId,
            amountPaise: ne.amountPaise || 0,
            currency: ne.currency || 'INR',
            billingPeriodStart: new Date().toISOString().split('T')[0],
            status,
        });
        await attemptRepo.save(attempt);
    }

    private async isEventProcessed(ctx: RequestContext, eventId: string): Promise<boolean> {
        if (!eventId) return false;
        const repo = this.connection.getRepository(ctx, SubscriptionBillingAttempt);
        return !!(await repo.findOne({ where: { providerEventId: eventId } }));
    }
}
