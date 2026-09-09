import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@vendure/core';
import { RecurringBillingProvider, CreateRecurringSubscriptionInput, ProviderSubscription, CancelSubscriptionOptions } from '../recurring-billing.provider';

const loggerCtx = 'RazorpaySubscriptionProvider';

/**
 * Razorpay Subscription provider implementation.
 *
 * Wraps the Razorpay Subscriptions API to provide recurring billing
 * for Saa9vi subscriptions.
 *
 * Razorpay owns: plan creation, subscription creation, mandate registration,
 * recurring debit execution, payment retries.
 *
 * Saa9vi owns: business state, entitlement, dunning, reconciliation.
 */
@Injectable()
export class RazorpaySubscriptionProvider implements RecurringBillingProvider {
    readonly providerName = 'razorpay';

    private readonly keyId: string;
    private readonly keySecret: string;

    constructor(private configService: ConfigService) {
        this.keyId = process.env.RAZORPAY_KEY_ID || '';
        this.keySecret = process.env.RAZORPAY_KEY_SECRET || '';
    }

    /**
     * Get Razorpay SDK instance.
     */
    private getClient(): any {
        // Dynamic import to avoid hard dependency
        const Razorpay = require('razorpay');
        return new Razorpay({
            key_id: this.keyId,
            key_secret: this.keySecret,
        });
    }

    /**
     * Create a Razorpay Subscription.
     *
     * Flow:
     * 1. Create subscription at Razorpay
     * 2. Return subscription_id + short_url for customer authorization
     * 3. Customer authorizes via Razorpay Standard Checkout
     * 4. Webhooks notify Saa9vi of subscription lifecycle events
     */
    async createSubscription(
        input: CreateRecurringSubscriptionInput,
    ): Promise<ProviderSubscription> {
        const client = this.getClient();

        const subscription = await client.subscriptions.create({
            plan_id: input.planId,
            total_count: input.totalCount || 12,
            quantity: 1,
            start_at: input.startAt,
            expire_by: input.expireBy,
            notify_info: {
                notify_phone: input.customerPhone,
                notify_email: input.customerEmail,
            },
            notes: {
                organizationId: input.organizationId,
                customerId: input.customerId,
                channelId: input.channelId,
            },
        });

        return {
            providerSubscriptionId: subscription.id,
            providerPlanId: input.planId,
            status: subscription.status,
            shortUrl: subscription.short_url,
            mandateId: subscription.mandate_id,
            metadata: subscription,
        };
    }

    /**
     * Fetch subscription details from Razorpay.
     */
    async getSubscription(
        providerSubscriptionId: string,
    ): Promise<ProviderSubscription> {
        const client = this.getClient();
        const subscription = await client.subscriptions.fetch(providerSubscriptionId);

        return {
            providerSubscriptionId: subscription.id,
            providerPlanId: subscription.plan_id,
            status: subscription.status,
            shortUrl: subscription.short_url,
            mandateId: subscription.mandate_id,
            metadata: subscription,
        };
    }

    /**
     * Cancel a Razorpay Subscription.
     */
    async cancelSubscription(
        providerSubscriptionId: string,
        options?: CancelSubscriptionOptions,
    ): Promise<void> {
        const client = this.getClient();
        await client.subscriptions.cancel(providerSubscriptionId, {
            cancel_at_cycle_end: options?.cancelAtCycleEnd ?? false,
        });
    }

    /**
     * Pause a Razorpay Subscription.
     */
    async pauseSubscription(
        providerSubscriptionId: string,
    ): Promise<void> {
        const client = this.getClient();
        await client.subscriptions.pause(providerSubscriptionId, {
            pause_at: 'now',
        });
    }

    /**
     * Resume a Razorpay Subscription.
     */
    async resumeSubscription(
        providerSubscriptionId: string,
    ): Promise<void> {
        const client = this.getClient();
        await client.subscriptions.resume(providerSubscriptionId, {
            resume_at: 'now',
        });
    }
}
