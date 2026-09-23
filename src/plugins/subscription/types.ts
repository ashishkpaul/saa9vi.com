/**
 * @description
 * The plugin can be configured using the following options:
 */

/**
 * @description
 * Recurring-billing provider selection.
 *
 * Per ADR-038, **Razorpay is the sole active provider**: the provider factory
 * resolves `razorpay` (and defaults an omitted provider to Razorpay); other
 * explicit provider values are rejected. `vendure-config.ts` configures
 * `provider: 'razorpay'`.
 */
export type BillingProvider = "razorpay";

export interface RazorpayWebhookConfig {
    /**
     * HMAC-SHA256 secret for the X-Razorpay-Signature header.
     * Required when Razorpay is the provider.
     */
    hmacSecret: string;
}

export interface PluginInitOptions {
    exampleOption?: string;
    /**
     * Explicit provider selection. Fail-closed: if not set in production,
     * the plugin throws at startup.
     */
    provider?: BillingProvider;
    webhook?: RazorpayWebhookConfig;
    /**
     * Catalogue slug of the provider-free entry-tier plan that
     * `FreePlanProvisioningService` activates for every newly registered tenant
     * (plan §3.2). Defaults to `free-basic`.
     *
     * The plan must exist in the catalogue with `providerPlanId` NULL — a plan
     * carrying a `providerPlanId` is provider-wired and is rejected rather than
     * activated locally. When the plan is absent or inactive, provisioning is
     * skipped with a warning; registration still succeeds (fail-soft: a missing
     * catalogue row is an ops gap, not a reason to refuse a registration).
     */
    freePlanSlug?: string;
    /**
     * Razorpay API credentials for real recurring billing (Step 4). When absent:
     *   - dev/test: the renewal worker falls back to a clearly-logged SIMULATED
     *     charge so the CLAIM→ATTEMPT→CHARGE→FINALIZE model still runs without
     *     real money movement.
     *   - production: the plugin throws at startup — silently simulating renewals
     *     in production would advance subscription periods without charging.
     * When present, the real Razorpay API is used.
     */
    billing?: {
        apiKey: string;
        merchantId: string;
        sandbox?: boolean;
    };
}

export enum RenewalResult {
  SUCCESS = "SUCCESS",
  CAS_CONFLICT = "CAS_CONFLICT",
  SUBSCRIPTION_NOT_FOUND = "SUBSCRIPTION_NOT_FOUND",
  CHANNEL_NOT_FOUND = "CHANNEL_NOT_FOUND",
  MANDATE_NOT_FOUND = "MANDATE_NOT_FOUND",
  PAYMENT_FAILED = "PAYMENT_FAILED",
  CHARGE_INITIATED = "CHARGE_INITIATED",
}

/**
 * Expected Razorpay webhook payload shape (subset we consume).
 *
 * ADR-041 G2: the subscription entity's `current_start` and `current_end`
 * fields are the **authoritative source of the provider billing cycle** for
 * charge-bearing events (`subscription.charged`, `subscription.activated`).
 * `paid_count` is mirrored for audit/reconciliation.
 *
 * The earlier note "the processor NEVER trusts payload-declared billing periods"
 * described the pre-G2 model, which avoided provider cycle fields entirely and
 * derived the period from local `currentPeriodEnd + 1 month`. That model
 * produced BUG B (two-month drift). Under ADR-041:
 *
 *   current_start / current_end → authoritative provider billing cycle
 *   payment.entity.amount / currency → amount (unchanged; still provider-issued)
 *
 * Provider identifiers (`subscription.id`, `payment.id`) continue to be the
 * reconciliation keys; the processor does not trust arbitrary payload fields
 * for subscription membership or entitlement. The cycle fields specifically
 * are trusted for period identity (INV-020).
 *
 * Razorpay documents current_start and current_end as Unix epoch seconds
 * representing the current billing cycle start/end.
 */
export interface RazorpayWebhookPayload {
  event?: string;
  contains?: string[];
  payload?: {
    subscription?: {
      entity?: {
        id?: string;
        status?: string;
        notes?: { channelId?: string; planId?: string };
        /** ADR-041 G2: provider billing-cycle start (Unix epoch seconds). */
        current_start?: number;
        /** ADR-041 G2: provider billing-cycle end (Unix epoch seconds). */
        current_end?: number;
        /** ADR-041 G2: number of billing cycles already charged. */
        paid_count?: number;
      };
    };
    payment?: {
      entity?: {
        id?: string;
        order_id?: string;
        invoice_id?: string;
        txn_id?: string;
        amount?: number;
        currency?: string;
        status?: string;
      };
    };
  };
}
