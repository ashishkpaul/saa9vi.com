/**
 * R3 — one-time checkout (plan §3.9; ADR-038 "One-time commerce" branch).
 *
 * Secrets are NEVER handler config args (they would be persisted in the DB and
 * readable through the Admin API). They are resolved from the process
 * environment only — see `.env.example`.
 */
import { PermissionDefinition } from '@vendure/core';

/** Payment-method code used by `addPaymentToOrder(input: { method: ... })`. */
export const RAZORPAY_HANDLER_CODE = 'razorpay';

/** Razorpay REST base URL (Orders/Payments API — NOT the Subscriptions API). */
export const RAZORPAY_API_BASE_URL = 'https://api.razorpay.com/v1';

/** Dedicated route for ONE-TIME payment events (separate dashboard webhook). */
export const RAZORPAY_PAYMENTS_WEBHOOK_PATH = 'payments/razorpay/checkout-webhook';

/** Public key id — safe to hand to the browser (Razorpay Checkout requires it). */
export function razorpayKeyId(): string {
  return process.env.RAZORPAY_KEY_ID ?? '';
}

/** Secret key — server-side only, never serialized into a response. */
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
 * webhook secret so a single Razorpay account can drive both endpoints.
 *
 * Commit 2: `||` (not `??`) so an explicitly-empty var still falls through
 * to the fallback/empty — an empty secret fails closed downstream
 * (verifyWebhookSignature returns missing-secret; boot guard refuses).
 */
export function razorpayPaymentsWebhookSecret(): string {
  return (
    process.env.RAZORPAY_PAYMENTS_WEBHOOK_SECRET ||
    process.env.RAZORPAY_WEBHOOK_SECRET ||
    ''
  );
}

/**
 * Commit 2: resolved secret for boot validation. Returns the trimmed
 * secret; empty when neither var is set or both are blank.
 */
export function resolvedPaymentsWebhookSecret(): string {
  return razorpayPaymentsWebhookSecret().trim();
}
