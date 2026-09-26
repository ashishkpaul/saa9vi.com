/**
 * R3 — Razorpay one-time checkout policy (ADR-038 one-time branch; plan §3.9).
 *
 * Pure by design (no Nest, no I/O, no `process.env`) so every security property
 * this slice rests on is pinnable by an infrastructure-free spec:
 *
 *   1. SIGNATURE: the checkout handshake is verified as
 *      HMAC-SHA256(`${razorpay_order_id}|${razorpay_payment_id}`, KEY_SECRET),
 *      compared in constant time. A missing secret, missing signature or any
 *      mismatch is a FAILURE — never a pass-through.
 *   2. ORDER BINDING: the Razorpay order must carry the Vendure order code
 *      (`receipt` / `notes.vendureOrderCode`) that is being paid. This is what
 *      makes a payment captured for order A unusable against order B.
 *   3. PAYMENT BINDING: the payment must belong to the bound Razorpay order,
 *      carry exactly the Vendure order total (minor units) in the order's
 *      currency, and be in a settling provider status.
 *   4. SINGLE-STEP SETTLEMENT: only `captured` settles. `authorized` must be
 *      captured first (the service does that); everything else fails closed.
 */

import * as crypto from 'crypto';

export interface RazorpayCheckoutMetadata {
  razorpayOrderId: string;
  razorpayPaymentId: string;
  razorpaySignature?: string;
}

/** Provider statuses considered settling for single-step settlement. */
export const SETTLING_PROVIDER_STATUSES = ['captured'] as const;

/** Provider statuses we will attempt to capture before settling. */
export const CAPTURABLE_PROVIDER_STATUSES = ['authorized'] as const;

export type BindingFailure =
  | 'missing-metadata'
  | 'order-binding-mismatch'
  | 'payment-order-mismatch'
  | 'amount-mismatch'
  | 'currency-mismatch'
  | 'provider-status-not-settling';

export type SignatureFailure = 'missing-secret' | 'missing-signature' | 'signature-mismatch';

type Ok<T> = { ok: true } & T;
type Fail<R extends string> = { ok: false; reason: R; detail?: string };

/**
 * Extract the checkout handshake from `addPaymentToOrder` metadata.
 * Returns null when any identifier is absent — the caller must fail closed.
 */
export function extractCheckoutMetadata(
  metadata: unknown,
): RazorpayCheckoutMetadata | null {
  if (!metadata || typeof metadata !== 'object') return null;
  const m = metadata as Record<string, unknown>;
  const razorpayOrderId = m.razorpay_order_id ?? m.razorpayOrderId;
  const razorpayPaymentId = m.razorpay_payment_id ?? m.razorpayPaymentId;
  const signatureRaw = m.razorpay_signature ?? m.razorpaySignature;
  if (typeof razorpayOrderId !== 'string' || razorpayOrderId.length === 0) return null;
  if (typeof razorpayPaymentId !== 'string' || razorpayPaymentId.length === 0) return null;
  const razorpaySignature =
    typeof signatureRaw === 'string' && signatureRaw.length > 0 ? signatureRaw : undefined;
  return { razorpayOrderId, razorpayPaymentId, razorpaySignature };
}

/** The exact string Razorpay Checkout signs client-side. */
export function checkoutSignaturePayload(orderId: string, paymentId: string): string {
  return `${orderId}|${paymentId}`;
}

/** Expected signature, hex-encoded. Pure — the secret is supplied by the caller. */
export function computeCheckoutSignature(
  orderId: string,
  paymentId: string,
  keySecret: string,
): string {
  return crypto
    .createHmac('sha256', keySecret)
    .update(checkoutSignaturePayload(orderId, paymentId))
    .digest('hex');
}

/**
 * Verify the client-submitted checkout signature in constant time.
 * Fails closed on a missing secret, missing signature, or length mismatch.
 */
export function verifyCheckoutSignature(input: {
  orderId: string;
  paymentId: string;
  signature?: string;
  keySecret: string;
}): Ok<{}> | Fail<SignatureFailure> {
  if (!input.keySecret) return { ok: false, reason: 'missing-secret' };
  if (!input.signature) return { ok: false, reason: 'missing-signature' };

  const expected = computeCheckoutSignature(input.orderId, input.paymentId, input.keySecret);
  const provided = Buffer.from(input.signature, 'utf8');
  const expectedBuf = Buffer.from(expected, 'utf8');
  if (provided.length !== expectedBuf.length) return { ok: false, reason: 'signature-mismatch' };
  if (!crypto.timingSafeEqual(provided, expectedBuf)) {
    return { ok: false, reason: 'signature-mismatch' };
  }
  return { ok: true };
}

/**
 * The Razorpay order must be the one we created for THIS Vendure order:
 * `receipt` (or `notes.vendureOrderCode`) carries the Vendure order code.
 */
export function assertOrderBinding(input: {
  receipt?: string | null;
  notes?: Record<string, string> | null;
  expectedOrderCode: string;
}): Ok<{}> | Fail<BindingFailure> {
  const receiptMatches = input.receipt === input.expectedOrderCode;
  const noteMatches = input.notes?.vendureOrderCode === input.expectedOrderCode;
  if (receiptMatches || noteMatches) return { ok: true };
  return {
    ok: false,
    reason: 'order-binding-mismatch',
    detail: `razorpay receipt/notes do not carry vendure order code ${input.expectedOrderCode}`,
  };
}

/** Payment-level binding: same provider order, exact amount, same currency, settling. */
export function assertPaymentBinding(input: {
  paymentOrderId: string | null;
  expectedRazorpayOrderId: string;
  paymentAmountMinor: number;
  expectedAmountMinor: number;
  paymentCurrency: string;
  expectedCurrency: string;
  providerStatus: string;
}): Ok<{}> | Fail<BindingFailure> {
  if (input.paymentOrderId !== input.expectedRazorpayOrderId) {
    return {
      ok: false,
      reason: 'payment-order-mismatch',
      detail: `payment belongs to ${input.paymentOrderId ?? 'no order'}, expected ${input.expectedRazorpayOrderId}`,
    };
  }
  if (input.paymentAmountMinor !== input.expectedAmountMinor) {
    return {
      ok: false,
      reason: 'amount-mismatch',
      detail: `paid ${input.paymentAmountMinor} minor units, expected ${input.expectedAmountMinor}`,
    };
  }
  if (input.paymentCurrency !== input.expectedCurrency) {
    return {
      ok: false,
      reason: 'currency-mismatch',
      detail: `paid in ${input.paymentCurrency}, expected ${input.expectedCurrency}`,
    };
  }
  if (!isSettlingProviderStatus(input.providerStatus)) {
    return {
      ok: false,
      reason: 'provider-status-not-settling',
      detail: `provider status ${input.providerStatus}`,
    };
  }
  return { ok: true };
}

export function isSettlingProviderStatus(status: string): boolean {
  return (SETTLING_PROVIDER_STATUSES as readonly string[]).includes(status);
}

export function isCapturableProviderStatus(status: string): boolean {
  return (CAPTURABLE_PROVIDER_STATUSES as readonly string[]).includes(status);
}

/**
 * Verifies Razorpay webhook signatures:
 *   expected = HMAC-SHA256(rawBody, webhookSecret)
 * Uses constant-time comparison to prevent timing attacks.
 */
export function verifyWebhookSignature(input: {
  rawBody: Buffer | string;
  signature?: string;
  webhookSecret: string;
}): Ok<{}> | Fail<'missing-secret' | 'missing-signature' | 'signature-mismatch'> {
  if (!input.webhookSecret) {
    return { ok: false, reason: 'missing-secret' };
  }
  if (!input.signature) {
    return { ok: false, reason: 'missing-signature' };
  }
  const body = Buffer.isBuffer(input.rawBody)
    ? input.rawBody.toString('utf8')
    : input.rawBody;

  const expected = crypto
    .createHmac('sha256', input.webhookSecret)
    .update(body)
    .digest('hex');

  const sigBuf = Buffer.from(input.signature, 'utf8');
  const expBuf = Buffer.from(expected, 'utf8');

  if (sigBuf.length !== expBuf.length) {
    return { ok: false, reason: 'signature-mismatch' };
  }
  if (!crypto.timingSafeEqual(sigBuf, expBuf)) {
    return { ok: false, reason: 'signature-mismatch' };
  }
  return { ok: true };
}
