import { ID } from '@vendure/core';

/**
 * Input for creating a recurring subscription at the provider.
 *
 * Slimmed per ADR-039 (2026-09-16 contract review): contains ONLY the fields
 * the Create Subscription request actually consumes. amount/currency/frequency
 * are carried by the Razorpay plan (plan_id); contact fields are not part of
 * the Create Subscription schema (notify_info belongs to the Subscription Link
 * API and is 400-rejected by the Create Subscription endpoint).
 */
export interface CreateRecurringSubscriptionInput {
    /** Saa9vi tenant channel — correlation + notes only. */
    channelId: string;
    /** TenantProfile.id — correlation notes (Channel ↔ TenantProfile is 1:1). */
    tenantProfileId: string;
    /** The Razorpay plan_id (SubscriptionPlan.providerPlanId). */
    planId: string;
    /** Billing cycles. Saa9vi adapter default: 12 (application default — the API has none). */
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
