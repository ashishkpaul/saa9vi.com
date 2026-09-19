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
 * All identifiers are provider-issued (subscription_id, payment_id) —
 * the processor NEVER trusts payload-declared billing periods or amounts
 * for reconciliation; it establishes the relationship through these
 * provider identifiers against existing Saa9vi rows.
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
      };
    };
    payment?: {
      entity?: {
        id?: string;
        order_id?: string;
        txn_id?: string;
        amount?: number;
        currency?: string;
        status?: string;
      };
    };
  };
}
