/**
 * R3 — one-time checkout (plan §3.9; ADR-038 "One-time" branch).
 *
 * Platform credentials are NEVER handler config args (they would be persisted
 * in the DB and readable through the Admin API). They are resolved from the
 * process environment only.
 */
import { PermissionDefinition } from '@vendure/core';

/** Payment-method code used by addPaymentToOrder for Flow A. */
export const RAZORPAY_HANDLER_CODE = 'razorpay';

/** Payment-method code used by addPaymentToOrder for tenant-client Flow B. */
export const TENANT_RAZORPAY_HANDLER_CODE = 'tenant-razorpay';

/** Razorpay REST base URL (Orders/Payments API — NOT the Subscriptions API). */
export const RAZORPAY_API_BASE_URL = 'https://api.razorpay.com/v1';

/** Dedicated route for ONE-TIME platform payment events (Flow A). */
export const RAZORPAY_PAYMENTS_WEBHOOK_PATH = 'payments/razorpay/checkout-webhook';

/** Public platform key id — safe to hand to the browser (Razorpay Checkout requires it). */
export function razorpayKeyId(): string {
  return process.env.RAZORPAY_KEY_ID ?? '';
}

/** Platform secret key — server-side only, never serialized into a response. */
export function razorpayKeySecret(): string {
  return process.env.RAZORPAY_KEY_SECRET ?? '';
}

/**
 * Permission for managing tenant Razorpay payment accounts.
 * Granted to authorized tenant administrators — allows configuring,
 * verifying, enabling/disabling, and deleting their own channel's
 * Razorpay payment account (Flow B: tenant-client collections).
 */
export const ManageTenantPaymentAccount = new PermissionDefinition({
  name: 'ManageTenantPaymentAccount',
  description: 'Permission to configure and manage tenant Razorpay payment accounts',
});

/**
 * Webhook secret for the one-time endpoint. Falls back to the subscription
 * webhook secret so a single platform Razorpay account can drive both endpoints.
 */
export function razorpayPaymentsWebhookSecret(): string {
  return (
    process.env.RAZORPAY_PAYMENTS_WEBHOOK_SECRET ||
    process.env.RAZORPAY_WEBHOOK_SECRET ||
    ''
  );
}

/** Resolved secret for boot validation. Empty when neither var is set. */
export function resolvedPaymentsWebhookSecret(): string {
  return razorpayPaymentsWebhookSecret().trim();
}
