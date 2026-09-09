import { ID } from '@vendure/core';

/**
 * Input for creating a recurring subscription at the provider.
 */
export interface CreateRecurringSubscriptionInput {
    channelId: string;
    organizationId: string;
    customerId: string;
    customerEmail: string;
    customerPhone: string;
    planId: string;
    amount: number;
    currency: string;
    frequency: 'monthly' | 'yearly';
    totalCount?: number;
    startAt?: number;
    expireBy?: number;
}

/**
 * Provider subscription result.
 */
export interface ProviderSubscription {
    providerSubscriptionId: string;
    providerPlanId: string;
    status: string;
    shortUrl?: string;
    mandateId?: string;
    metadata?: Record<string, unknown>;
}

/**
 * Options for canceling a subscription.
 */
export interface CancelSubscriptionOptions {
    cancelAtCycleEnd?: boolean;
}

/**
 * Recurring billing provider interface.
 *
 * This is the abstraction boundary: Saa9vi's subscription domain
 * talks to this interface, never to a specific provider directly.
 *
 * Implementations: RazorpaySubscriptionProvider, JuspaySubscriptionProvider (legacy)
 */
export interface RecurringBillingProvider {
    readonly providerName: string;

    createSubscription(
        input: CreateRecurringSubscriptionInput,
    ): Promise<ProviderSubscription>;

    getSubscription(
        providerSubscriptionId: string,
    ): Promise<ProviderSubscription>;

    cancelSubscription(
        providerSubscriptionId: string,
        options?: CancelSubscriptionOptions,
    ): Promise<void>;

    pauseSubscription?(
        providerSubscriptionId: string,
    ): Promise<void>;

    resumeSubscription?(
        providerSubscriptionId: string,
    ): Promise<void>;
}
