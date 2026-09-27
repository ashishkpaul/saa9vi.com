import {
    ProviderSubscriptionNoActiveCycleError,
    RecurringBillingProviderError,
} from '../recurring-billing.provider';

/**
 * Razorpay error → provider-neutral typed error.
 *
 * WHY THIS FILE EXISTS (BUG-041). The adapter used to call the SDK directly and
 * let whatever it threw escape. For a cancelled subscription without an active
 * billing cycle, the SDK throws a plain object — not an `Error`:
 *
 *     { statusCode: 400, error: { code: 'BAD_REQUEST_ERROR',
 *       description: 'Subscription cannot be cancelled since no billing cycle is going on' } }
 *
 * Vendure therefore serialised it as `Unexpected error value: { … }` with
 * `data: null`, and every provider-wired ADR-044 cancel/change failed — even
 * though Razorpay's answer is a *terminal state*, not a transport failure.
 *
 * The classification is deliberately pinned to the provider's documented
 * condition (HTTP 400 + `BAD_REQUEST_ERROR` + the exact description) and stays
 * in the provider layer: `SubscriptionService` never inspects a Razorpay
 * payload — it catches `ProviderSubscriptionNoActiveCycleError` only. That
 * preserves the ADR-038 boundary.
 */

/** Razorpay's exact documented description for "cancel before any active cycle". */
export const NO_ACTIVE_CYCLE_DESCRIPTION =
    'Subscription cannot be cancelled since no billing cycle is going on';

/** Razorpay's error code for a request it rejected on business grounds. */
export const RAZORPAY_BAD_REQUEST_CODE = 'BAD_REQUEST_ERROR';

export interface RazorpayFailureDetails {
    providerCode?: string;
    description?: string;
    statusCode?: number;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
    return typeof value === 'object' && value !== null
        ? (value as Record<string, unknown>)
        : undefined;
}

function firstNumber(...values: unknown[]): number | undefined {
    for (const value of values) {
        if (typeof value === 'number' && Number.isFinite(value)) return value;
    }
    return undefined;
}

/**
 * Pull the provider's own diagnostics out of whatever the SDK threw.
 *
 * Handles the shapes seen in practice without trusting any of them:
 *   - `{ statusCode, error: { code, description } }` (the observed shape)
 *   - `{ error: { code, description } }`
 *   - `{ response: { status, data: { error: { code, description } } } }`
 *   - an `Error` carrying any of the above as a property
 * Reads only fields, never `JSON.stringify`s the value, so no request body,
 * credential or secret can travel with it.
 */
export function extractRazorpayFailure(err: unknown): RazorpayFailureDetails {
    const anyErr = (typeof err === 'object' && err !== null ? err : undefined) as
        | Record<string, unknown>
        | undefined;

    // The SDK hands back the parsed response body, either directly on the thrown
    // value (under `error`) or nested under `response.data`.
    const body =
        asRecord(anyErr?.error) ??
        asRecord(asRecord(anyErr?.response)?.data) ??
        asRecord(anyErr?.body);

    // The provider body nests the actual code/description one level deeper:
    // `{ error: { code, description } }`.
    const detail = asRecord(body?.error) ?? body ?? anyErr;

    return {
        providerCode: typeof detail?.code === 'string' ? detail.code : undefined,
        description:
            typeof detail?.description === 'string' ? detail.description : undefined,
        statusCode: firstNumber(
            body?.statusCode,
            anyErr?.statusCode,
            body?.status,
            asRecord(anyErr?.response)?.status,
        ),
    };
}

/**
 * Is this the documented "no billing cycle" condition?
 *
 * Keyed on the provider's exact description plus its business-error code, with
 * the HTTP status corroborating when the SDK exposes it. Never keyed on the
 * local `providerStatus`: Razorpay documents the same condition for both
 * `created` and `authenticated` subscriptions, so a status check would be
 * incomplete.
 */
export function isNoActiveCycleFailure(details: RazorpayFailureDetails): boolean {
    return (
        details.providerCode === RAZORPAY_BAD_REQUEST_CODE &&
        details.description === NO_ACTIVE_CYCLE_DESCRIPTION &&
        (details.statusCode === undefined || details.statusCode === 400)
    );
}

/**
 * Translate anything the SDK throws into a typed provider error.
 *
 * Exactly one condition is terminal (`ProviderSubscriptionNoActiveCycleError`);
 * everything else is a real failure and stays fatal, carrying only the provider
 * name, the operation and the provider's code/status — never the raw payload.
 */
export function toProviderError(
    err: unknown,
    provider: string,
    operation: string,
): RecurringBillingProviderError {
    const { providerCode, description, statusCode } = extractRazorpayFailure(err);

    if (isNoActiveCycleFailure({ providerCode, description, statusCode })) {
        return new ProviderSubscriptionNoActiveCycleError({
            provider,
            operation,
            providerCode,
            statusCode,
        });
    }

    return new RecurringBillingProviderError(
        `Recurring billing provider operation failed (${provider}:${operation})`,
        { provider, operation, providerCode, statusCode },
    );
}
