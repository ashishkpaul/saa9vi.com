/**
 * Billing status vocabularies for Dashboard filters (INV-015).
 *
 * WHY THIS EXISTS
 * ---------------
 * A filter control that offers a value the backend can never produce is a
 * quieter form of the same INV-015 failure: the operator picks it, the query
 * succeeds, and the ledger renders "no rows for this channel" — an empty state
 * produced by a phantom filter rather than by the data.
 *
 * So every option list below is tied to a value the platform can actually
 * persist, and `__tests__/dashboard-query-state.spec.ts` re-derives that set
 * from the source code that writes it. This module stays import-free on purpose
 * (no entity, no typeorm, no React) so it can be unit-tested in a plain Node
 * environment and cannot drag server types into the Dashboard bundle.
 */

/**
 * Values persisted in `SubscriptionProviderBinding.providerStatus`.
 *
 * The column is provider-reported, written in exactly two places:
 *   1. checkout — `providerSub.status` from the provider's subscribe response
 *      (Razorpay answers `created`, `authenticated` after authorization);
 *   2. every later transition — `RazorpayWebhookProcessor.updateBinding()`,
 *      which writes `pending`, `authenticated`, `active`, `halted` or
 *      `cancelled`.
 *
 * Provider-only terminal states that no code path persists are deliberately
 * absent: adding one here without a writer would re-create the phantom filter.
 */
export const PROVIDER_SUBSCRIPTION_STATUSES = [
    'created',
    'authenticated',
    'active',
    'pending',
    'halted',
    'cancelled',
] as const;

export type ProviderSubscriptionStatus = (typeof PROVIDER_SUBSCRIPTION_STATUSES)[number];

/**
 * Values of `SubscriptionBillingAttempt.status` — the immutable financial fact
 * ledger of INV-002. Mirrors the `BillingAttemptStatus` union in
 * `entities/subscription-billing-attempt.entity.ts`; the regression spec asserts
 * the two stay identical, because a filter option the entity cannot hold always
 * answers with an empty table.
 */
export const BILLING_ATTEMPT_STATUSES = ['initiated', 'succeeded', 'failed'] as const;

export type BillingAttemptStatusOption = (typeof BILLING_ATTEMPT_STATUSES)[number];

/**
 * `RenewalPaymentReconciliationRequired.status` — the `ReconciliationIncidentStatus`
 * enum of the Admin schema. A GraphQL enum cannot hold an unknown value, so
 * these two options are the complete set by construction.
 */
export const RECONCILIATION_INCIDENT_STATUSES = ['PENDING', 'RESOLVED'] as const;

export type ReconciliationIncidentStatusOption = (typeof RECONCILIATION_INCIDENT_STATUSES)[number];

/** `past_due` → `Past due`. Keeps option labels in step with the raw values. */
export function humanizeStatus(status: string): string {
    const spaced = status.replace(/_/g, ' ');
    return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}
