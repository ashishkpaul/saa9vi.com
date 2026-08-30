/**
 * @description
 * The plugin can be configured using the following options:
 */
export interface JuspayWebhookConfig {
    /**
     * Basic Auth username configured in the Juspay dashboard. Required —
     * when empty, ALL webhook requests are rejected (fail-closed).
     */
    username: string;
    /**
     * Basic Auth password configured in the Juspay dashboard. Required.
     */
    password: string;
    /**
     * HMAC-SHA256 secret for the x-jp-signature header. REQUIRED (fail-closed):
     * unlike BuyLits's reference implementation, an unset secret rejects all
     * traffic instead of allowing it. Wire from JUSPAY_WEBHOOK_HMAC_SECRET.
     */
    hmacSecret: string;
    /**
     * Version tag for the current HMAC secret (JUSPAY_WEBHOOK_HMAC_SECRET_VERSION).
     * Recorded on processed events for future secret rotation; not yet used for
     * multi-secret verification.
     */
    hmacSecretVersion?: string;
}

export interface PluginInitOptions {
    exampleOption?: string;
    webhook?: JuspayWebhookConfig;
    /**
     * Juspay API credentials for real recurring billing (Step 4). When absent:
     *   - dev/test: the renewal worker falls back to a clearly-logged SIMULATED
     *     charge so the CLAIM→ATTEMPT→CHARGE→FINALIZE model still runs without
     *     real money movement.
     *   - production: the plugin throws at startup — silently simulating renewals
     *     in production would advance subscription periods without charging.
     * When present, the real Juspay API is used.
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
 * Juspay webhook event names accepted by the processor. Anything else is
 * persisted and marked PROCESSED as 'unhandled_event_type' (harmless, no retry).
 */
export type JuspayWebhookEventName =
  | "MANDATE_ACTIVATED"
  | "MANDATE_PAUSED"
  | "MANDATE_REVOKED"
  | "CHARGE_SUCCEEDED"
  | "CHARGE_FAILED";

/**
 * Expected Juspay webhook payload shape (subset we consume).
 * All identifiers are provider-issued (mandate_id, order_id, txn_id) —
 * the processor NEVER trusts payload-declared billing periods or amounts
 * for reconciliation; it establishes the relationship through these
 * provider identifiers against existing Saa9vi rows.
 */
export interface JuspayWebhookPayload {
  event_name?: string;
  content?: {
    mandate?: {
      mandate_id?: string;
      status?: string;
    };
    order?: {
      order_id?: string;
      status?: string;
      amount?: number;
      currency?: string;
      txn_id?: string;
      error_code?: string;
      error_message?: string;
    };
  };
}
