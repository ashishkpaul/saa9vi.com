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
  * Implementations: RazorpaySubscriptionProvider (active, ADR-038)
 */
/**
 * A provider call failed.
 *
 * Provider adapters throw this instead of letting a raw SDK error object escape
 * — otherwise the object reaches GraphQL as
 * `Unexpected error value: { … }` (BUG-041's observable symptom) and leaks
 * provider internals into a public error message.
 *
 * Deliberately provider-neutral: the adapter fills in the metadata it actually
 * has (its own name, the operation, the provider's error code and HTTP status)
 * and the domain layer never inspects a provider-specific payload — the
 * boundary ADR-038 draws. It never carries a raw response body, request body,
 * credential or secret.
 */
export class RecurringBillingProviderError extends Error {
    readonly provider: string;
    readonly operation: string;
    readonly providerCode?: string;
    readonly statusCode?: number;

    constructor(
        message: string,
        details: {
            provider: string;
            operation: string;
            providerCode?: string;
            statusCode?: number;
        },
    ) {
        super(message);
        this.name = 'RecurringBillingProviderError';
        this.provider = details.provider;
        this.operation = details.operation;
        this.providerCode = details.providerCode;
        this.statusCode = details.statusCode;
    }
}

/** Stable machine-readable code for {@link ProviderSubscriptionNoActiveCycleError}. */
export const PROVIDER_SUBSCRIPTION_NO_ACTIVE_CYCLE =
    'PROVIDER_SUBSCRIPTION_NO_ACTIVE_CYCLE';

/**
 * The provider reports that the subscription has NO active billing cycle, so
 * there is nothing to cancel or supersede: it was never billed. At Razorpay
 * this is the documented `400 BAD_REQUEST_ERROR` / "Subscription cannot be
 * cancelled since no billing cycle is going on" response, and it is reachable
 * while the subscription is `created` **or** `authenticated`.
 *
 * This is a TERMINAL provider-side condition, not a failed intent. The domain
 * layer treats it as "already stopped" and continues the local operation,
 * because failing here blocks two supported flows: cancelling an unauthorized
 * subscription, and changing plan before the first billing cycle (BUG-041).
 *
 * Callers must key off THIS TYPE, never off a provider status string —
 * `authenticated` is equally cycle-less, so a `providerStatus === 'created'`
 * check would be incomplete.
 */
export class ProviderSubscriptionNoActiveCycleError extends RecurringBillingProviderError {
    readonly code = PROVIDER_SUBSCRIPTION_NO_ACTIVE_CYCLE;

    constructor(details: {
        provider: string;
        operation: string;
        providerCode?: string;
        statusCode?: number;
        message?: string;
    }) {
        super(
            details.message ??
                `Provider reports no active billing cycle for this subscription ` +
                    `(${details.provider}:${details.operation}) — nothing to cancel`,
            details,
        );
        this.name = 'ProviderSubscriptionNoActiveCycleError';
    }
}

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
