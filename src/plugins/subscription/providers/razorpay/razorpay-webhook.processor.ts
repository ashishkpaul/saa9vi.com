import { Injectable, Logger } from '@nestjs/common';
import { RequestContext, TransactionalConnection } from '@vendure/core';
import { SubscriptionProviderBinding } from '../../entities/subscription-provider-binding.entity';
import { SubscriptionBillingAttempt, BillingAttemptStatus } from '../../entities/subscription-billing-attempt.entity';
import { OrganizationSubscription } from '../../entities/organization-subscription.entity';
import { ProviderWebhookEvent } from '../../entities/provider-webhook-event.entity';
import { SubscriptionService } from '../../services/subscription.service';

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
    channelId?: string;
    planId?: string;
    rawPayload: any;
}

@Injectable()
export class RazorpayWebhookProcessor {
    constructor(
        private connection: TransactionalConnection,
        private readonly subscriptionService: SubscriptionService,
    ) {}

    /**
     * Process a webhook event from the immutable inbox.
     * Uses the authoritative event ID from the inbox record (x-razorpay-event-id header).
     * Resolves channel from SubscriptionProviderBinding, not arbitrary context.
     */
    async processInboxEvent(ctx: RequestContext, inboxEvent: ProviderWebhookEvent): Promise<void> {
        const providerEventId = inboxEvent.providerEventId;
        const event = inboxEvent.eventType;
        // Unwrap the Razorpay envelope: rawPayload is the full webhook body
        // { event, contains, payload }, while normalizeEvent expects the
        // inner payload object (C-1-E runtime finding).
        const payload = inboxEvent.rawPayload?.payload ?? inboxEvent.rawPayload;

        // Idempotency check using the authoritative inbox event ID
        if (await this.isEventProcessed(ctx, providerEventId)) {
            Logger.log(`Event ${providerEventId} already processed`, loggerCtx);
            return;
        }

        const ne = this.normalizeEvent(event, payload, providerEventId);

        switch (event) {
            case 'subscription.authenticated':
                await this.updateBinding(ctx, ne.providerSubscriptionId, 'authenticated', false, ne.channelId, ne.planId);
                break;
            case 'subscription.activated':
                await this.updateBinding(ctx, ne.providerSubscriptionId, 'active', true, ne.channelId, ne.planId);
                if (ne.providerPaymentId && ne.amountPaise) await this.recordAttempt(ctx, ne, 'succeeded');
                break;
            case 'subscription.charged':
                if (ne.providerPaymentId && ne.amountPaise) await this.recordAttempt(ctx, ne, 'succeeded');
                break;
            case 'subscription.halted':
                await this.updateBinding(ctx, ne.providerSubscriptionId, 'halted', false, ne.channelId, ne.planId);
                if (ne.providerPaymentId) await this.recordAttempt(ctx, ne, 'failed');
                break;
            case 'subscription.cancelled':
                await this.updateBinding(ctx, ne.providerSubscriptionId, 'cancelled', false, ne.channelId, ne.planId);
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
        const notes = sub?.notes || {};
        return {
            eventType: event,
            providerEventId: eventId,
            providerSubscriptionId: sub?.id || payload.subscription_id,
            providerPaymentId: pay?.id || payload.payment_id,
            providerInvoiceId: inv?.id || payload.invoice_id,
            amountPaise: pay?.amount || inv?.amount,
            currency: pay?.currency || inv?.currency,
            status: sub?.status || pay?.status || 'unknown',
            channelId: notes.channelId,
            planId: sub?.plan_id,
            rawPayload: payload,
        };
    }

    private async updateBinding(
        ctx: RequestContext,
        subId: string,
        status: string,
        active: boolean,
        channelId?: string,
        planId?: string,
    ): Promise<void> {
        const repo = this.connection.getRepository(ctx, SubscriptionProviderBinding);
        const binding = await repo.findOne({
            where: { providerSubscriptionId: subId },
            relations: ['subscription'],
        });
        if (binding) {
            binding.providerStatus = status;
            binding.active = active;
            await repo.save(binding);
            // ADR-039 lifecycle: provider authorization events drive the local
            // subscription out of pending_provider_auth. Razorpay is the
            // authoritative activation source (INV-004); CAS on version is
            // not needed here — this is a one-way pre-auth → active transition
            // and dunning/renewal own everything after 'active'.
            if (active && binding.subscription?.status === 'pending_provider_auth') {
                const subRepo = this.connection.getRepository(ctx, OrganizationSubscription);
                binding.subscription.status = 'active';
                await subRepo.save(binding.subscription);
                Logger.log(
                    `OrganizationSubscription ${binding.subscription.id} pending_provider_auth → active ` +
                        `(provider sub ${subId})`,
                    loggerCtx,
                );
            }
        } else if (channelId) {
            // ⚠️ LEGACY / UNREACHABLE (ADR-039): binding creation at subscription
            // creation time (subscribeToPlan) is the SOLE first-binding mechanism.
            // This lazy branch predates that decision and cannot be reached via
            // the production worker — the queue fails closed (C-1-A runtime
            // evidence) before the processor runs when no binding exists.
            // Retained as defensive compat only; do not rely on it.
            try {
                await this.subscriptionService.createProviderBinding(
                    ctx,
                    channelId,
                    'razorpay',
                    subId,
                    planId || '',
                    status,
                    { initialEvent: true },
                );
                Logger.log(
                    `Created lazy SubscriptionProviderBinding for ${subId} on channel ${channelId}`,
                    loggerCtx,
                );
            } catch (err) {
                // If the OrganizationSubscription doesn't exist yet for this channel,
                // log and let a retry or manual reconciliation handle it.
                Logger.warn(
                    `Could not create binding for ${subId}: ${err instanceof Error ? err.message : String(err)}`,
                    loggerCtx,
                );
            }
        }
    }

    private async recordAttempt(ctx: RequestContext, ne: NormalizedBillingEvent, status: BillingAttemptStatus): Promise<void> {
        const bindingRepo = this.connection.getRepository(ctx, SubscriptionProviderBinding);
        const binding = await bindingRepo.findOne({
            where: { providerSubscriptionId: ne.providerSubscriptionId },
            relations: ['subscription'],
        });
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
