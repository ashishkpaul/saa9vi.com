/**
 * Juspay plugin configuration options.
 */
export interface JuspayPluginOptions {
  /**
   * Juspay API key — Basic Auth username (password always empty)
   */
  apiKey: string;

  /**
   * Sent as x-merchantid on every request
   */
  merchantId: string;

  /**
   * Default false
   */
  sandbox?: boolean;

  /**
   * Full URL Juspay redirects to after payment.
   * Example: 'https://mystore.com/order-confirmation'
   * REQUIRED — no hardcoded fallback allowed
   */
  returnUrl: string;

  /**
   * Username configured in Juspay Dashboard for webhook Basic Auth
   */
  webhookUsername: string;

  /**
   * Password configured in Juspay Dashboard for webhook Basic Auth
   */
  webhookPassword: string;

  /**
   * Optional HMAC-SHA256 secret for x-jp-signature header verification.
   * When set, both Basic Auth AND HMAC must pass.
   */
  webhookHmacSecret?: string;

  /**
   * BullMQ retry count. Default 3.
   */
  webhookJobRetries?: number;
}