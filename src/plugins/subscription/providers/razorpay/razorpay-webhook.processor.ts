import { Injectable, Logger } from '@nestjs/common';
import { RequestContext, TransactionalConnection } from '@vendure/core';
import { SubscriptionProviderBinding } from '../../entities/subscription-provider-binding.entity';
import { OrganizationSubscription } from '../../entities/organization-subscription.entity';
import { ProviderWebhookEvent } from '../../entities/provider-webhook-event.entity';
import { SubscriptionService } from '../../services/subscription.service';
import { SubscriptionBillingAttemptService } from '../../services/subscription-billing-attempt.service';
import { SubscriptionRenewalService } from '../../services/subscription-renewal.service';
import { SubscriptionBillingAttempt, BillingAttemptStatus } from '../../entities/subscription-billing-attempt.entity';

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
        private readonly attemptService: SubscriptionBillingAttemptService,
        private readonly renewalService: SubscriptionRenewalService,
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

        let binding: SubscriptionProviderBinding | null = null;
        let haltedBinding: SubscriptionProviderBinding | null = null;
        let cancelledBinding: SubscriptionProviderBinding | null = null;

        switch (event) {
            case 'subscription.pending':
                // Razorpay 'pending' = recurring payments are failing and provider
                // retries are in progress. Mirror on the binding AND bridge the
                // Saa9vi FSM to past_due so the dunning job can discover it
                // (RFC-001 §4.2). Do NOT record a billing attempt — no charge
                // event is attached to this state transition.
                binding = await this.updateBinding(ctx, ne.providerSubscriptionId, 'pending', false, ne.channelId, ne.planId);
                if (binding?.subscription?.id) {
                    await this.renewalService.markPastDueFromWebhook(binding.subscription.id as string);
                }
                Logger.log(`Subscription ${ne.providerSubscriptionId} is pending provider retry (dunning)`, loggerCtx);
                break;

            case 'subscription.authenticated':
                await this.updateBinding(ctx, ne.providerSubscriptionId, 'authenticated', false, ne.channelId, ne.planId);
                break;

            case 'subscription.activated':
                await this.updateBinding(ctx, ne.providerSubscriptionId, 'active', true, ne.channelId, ne.planId);
                if (ne.providerPaymentId && ne.amountPaise) {
                    await this.recordAttempt(ctx, ne, 'succeeded');
                }
                break;

            case 'subscription.charged':
                if (ne.providerPaymentId && ne.amountPaise) {
                    await this.recordAttempt(ctx, ne, 'succeeded');
                }
                break;

            case 'subscription.halted':
                // Halted = retries exhausted, subscription suspended by provider.
                // Bridge to past_due (dunning recovery path) and record the
                // charge failure when the event carries payment details.
                haltedBinding = await this.updateBinding(ctx, ne.providerSubscriptionId, 'halted', false, ne.channelId, ne.planId);
                if (haltedBinding?.subscription?.id) {
                    await this.renewalService.markPastDueFromWebhook(haltedBinding.subscription.id as string);
                }
                if (ne.providerPaymentId && ne.amountPaise) {
                    await this.recordAttempt(ctx, ne, 'failed');
                }
                break;

            case 'subscription.cancelled':
                cancelledBinding = await this.updateBinding(ctx, ne.providerSubscriptionId, 'cancelled', false, ne.channelId, ne.planId);
                if (cancelledBinding?.subscription?.id) {
                    await this.renewalService.markCancelledFromWebhook(cancelledBinding.subscription.id as string);
                }
                break;

            case 'payment.failed':
                if (ne.providerPaymentId) {
                    await this.recordAttempt(ctx, ne, 'failed');
                }
                break;

            case 'payment.charge_failed':
                if (ne.providerPaymentId) {
                    await this.recordAttempt(ctx, ne, 'failed');
                }
                break;

            default:
                // Unknown event types are persisted history, not failures.
                Logger.log(`Unhandled event type ${event} — marking PROCESSED (no-op)`, loggerCtx);
        }
    }

    /**
     * Update the SubscriptionProviderBinding status + active flag.
     *
     * This is the canonical binding mutation seam — all status transitions
     * from the webhook go through here so the binding always reflects the
     * provider's authoritative state.
     */
    private async updateBinding(
        ctx: RequestContext,
        subId: string,
        status: string,
        active: boolean,
        channelId?: string,
        planId?: string,
    ): Promise<SubscriptionProviderBinding | null> {
        const bindingRepo = this.connection.getRepository(ctx, SubscriptionProviderBinding);
        const binding = await bindingRepo.findOne({
            where: { providerSubscriptionId: subId },
            relations: ['subscription'],
        });

        if (!binding) {
            // No binding = not a Saa9vi-managed subscription.
            Logger.warn(`No provider binding found for subscription ${subId}`, loggerCtx);
            return null;
        }

        binding.providerStatus = status;
        binding.active = active;
        await bindingRepo.save(binding);

        Logger.log(`Binding ${binding.id} for subscription ${subId} → status=${status}, active=${active}`, loggerCtx);

        // ADR-039: binding creation at subscription-creation time is the SOLE
        // first-binding mechanism. This lazy branch predates that decision and
        // is unreachable via the production worker (the queue fails closed
        // before the processor runs when no binding exists). Retained as
        // defensive compat only; do not rely on it.
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

        return binding;
    }

    /**
     * Record a billing attempt result from a provider webhook event.
     *
     * R2-F authority boundary: this method delegates ALL persistence to
     * SubscriptionBillingAttemptService — it never calls attemptRepo.create()
     * or attemptRepo.save() directly.
     *
     * Reconciliation pattern (INV-019):
     *   1. Look for an existing 'initiated' attempt created by the renewal worker
     *      (matched by providerSubscriptionId + channelId).
     *   2. If found → transition it to terminal state via the service's CAS-guarded
     *      recordAttemptSuccess/recordAttemptFailure (wins exactly once).
     *   3. If not found → create a terminal attempt directly via recordAttemptFromWebhook
     *      (for charges that fire outside the renewal scan window, e.g. the initial
     *      payment on subscription.activated).
     *
     * After a successful charge, finalizeAfterPayment() is called on the renewal
     * service to advance the subscription period.
     */
    private async recordAttempt(ctx: RequestContext, ne: NormalizedBillingEvent, status: BillingAttemptStatus): Promise<void> {
        const bindingRepo = this.connection.getRepository(ctx, SubscriptionProviderBinding);
        const binding = await bindingRepo.findOne({
            where: { providerSubscriptionId: ne.providerSubscriptionId },
            relations: ['subscription'],
        });
        if (!binding) {
            Logger.warn(`No provider binding for subscription ${ne.providerSubscriptionId} — cannot record attempt`, loggerCtx);
            return;
        }

        const channelId = ne.channelId || binding.channelId;
        const subscriptionId = binding.subscription.id;
        const now = new Date();
        const billingPeriodStart = now.toISOString().split('T')[0];

        // Idempotency: if a terminal attempt already exists for this payment ID, skip.
        if (ne.providerPaymentId) {
            const existing = await this.attemptService.findAttemptByProviderPaymentId(channelId, ne.providerPaymentId);
            if (existing && existing.status !== 'initiated') {
                Logger.log(
                    `Event ${ne.providerEventId} matches terminal attempt ${existing.id} (status=${existing.status}) — no-op`,
                    loggerCtx,
                );
                return;
            }
        }

        // Try to reconcile an existing 'initiated' attempt from the renewal worker.
        const existingAttempt = await this.attemptService.findInitiatedAttemptByProviderSubscriptionId(
            channelId,
            ne.providerSubscriptionId,
        );

        let attemptId: string;

        if (existingAttempt) {
            // Reconcile: transition the initiated attempt via the service.
            // CRITICAL (crash-consistency): providerEventId/providerInvoiceId are
            // persisted in the SAME atomic CAS UPDATE as the terminal status —
            // there is NO separate metadata pre-write. A crash between "event id
            // visible" and "terminal" would otherwise let a replayed webhook be
            // swallowed by isEventProcessed() while the attempt stays initiated
            // and the subscription never finalizes.
            if (status === 'succeeded') {
                const won = await this.attemptService.recordAttemptSuccess(
                    existingAttempt.id,
                    ne.providerPaymentId,
                    ne.providerEventId,
                    ne.providerInvoiceId,
                );
                if (!won) {
                    Logger.log(
                        `Attempt ${existingAttempt.id} already left 'initiated' — CAS no-op for ${ne.eventType}`,
                        loggerCtx,
                    );
                    return;
                }
                attemptId = existingAttempt.id as string;
            } else {
                const won = await this.attemptService.recordAttemptFailure(
                    existingAttempt.id,
                    ne.status || 'charge_failed',
                    ne.providerPaymentId,
                    ne.providerEventId,
                    ne.providerInvoiceId,
                );
                if (!won) {
                    Logger.log(
                        `Attempt ${existingAttempt.id} already left 'initiated' — CAS no-op for ${ne.eventType}`,
                        loggerCtx,
                    );
                    return;
                }
                attemptId = existingAttempt.id as string;
            }
        } else {
            // Webhook-only charge (no preceding renewal-worker attempt).
            // Create a terminal attempt directly via the service.
            const invoiceId = ne.providerInvoiceId || `INV-${subscriptionId}-${billingPeriodStart}`;
            const amountPaise = ne.amountPaise || binding.subscription.plan.monthlyPriceInPaise || 0;
            const created = await this.attemptService.recordAttemptFromWebhook({
                subscriptionId,
                channelId,
                invoiceId,
                billingPeriodStart,
                amountPaise,
                provider: 'razorpay',
                providerSubscriptionId: ne.providerSubscriptionId,
                providerPaymentId: ne.providerPaymentId,
                providerInvoiceId: ne.providerInvoiceId,
                providerEventId: ne.providerEventId,
                status,
                failureReason: status === 'failed' ? (ne.status || 'charge_failed') : undefined,
            });
            attemptId = created.id as string;
        }

        // On successful charge, finalize the subscription period.
        if (status === 'succeeded') {
            const result = await this.renewalService.finalizeAfterPayment(attemptId);
            if (result !== 'SUCCESS') {
                Logger.warn(
                    `Finalize-after-payment for attempt ${attemptId} returned ${result} — ` +
                        `subscription ${subscriptionId} period may need manual reconciliation`,
                    loggerCtx,
                );
            }
        }
    }

    /**
     * Idempotency check: has this provider event ALREADY reached a terminal
     * billing attempt?
     *
     * A match is only "processed" when the attempt carrying the event ID is
     * TERMINAL (succeeded | failed). Since 72961d6 the event ID is persisted
     * in the same atomic CAS UPDATE as the terminal status, so an initiated
     * attempt can never carry a providerEventId — but the terminal-status
     * guard is kept as defense-in-depth: a merely-initiated match must fall
     * through to the reconciliation path so the charge can still finalize.
     */
    private async isEventProcessed(ctx: RequestContext, eventId: string): Promise<boolean> {
        if (!eventId) return false;
        const repo = this.connection.getRepository(ctx, SubscriptionBillingAttempt);
        return !!(await repo.findOne({
            where: [
                { providerEventId: eventId, status: 'succeeded' },
                { providerEventId: eventId, status: 'failed' },
            ],
        }));
    }

    /**
     * Normalize a raw Razorpay webhook payload into a common billing event shape.
     *
     * Razorpay sends: { event, contains, payload: { subscription: { entity }, payment?: { entity } } }
     * We extract the fields we need for reconciliation and finalization.
     */
    private normalizeEvent(event: string, payload: any, eventId: string): NormalizedBillingEvent {
        const subscriptionEntity = payload?.subscription?.entity ?? payload?.subscription ?? {};
        const paymentEntity = payload?.payment?.entity ?? payload?.payment ?? {};
        const charge = paymentEntity;

        const subId: string | undefined = subscriptionEntity.id;

        // Extract payment ID: from the payment entity or the charge result
        const paymentId: string | undefined = paymentEntity.id || charge?.id;

        // Extract invoice ID
        const invoiceId: string | undefined = paymentEntity.invoice_id || charge?.invoice_id;

        // Amount in paise and currency
        const amountPaise: number | undefined = charge?.amount || paymentEntity.amount;
        const currency: string | undefined = charge?.currency || paymentEntity.currency;

        // Status: Razorpay payment object has 'status' field
        const status: string = charge?.status || paymentEntity.status || 'unknown';

        return {
            eventType: event,
            providerEventId: eventId,
            providerSubscriptionId: subId || '',
            providerPaymentId: paymentId,
            providerInvoiceId: invoiceId,
            amountPaise,
            currency,
            status,
            channelId: subscriptionEntity.notes?.channelId,
            planId: subscriptionEntity.notes?.planId,
            rawPayload: payload,
        };
    }
}
