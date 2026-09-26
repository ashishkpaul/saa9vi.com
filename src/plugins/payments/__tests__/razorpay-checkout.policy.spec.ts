/**
 * R3 — Razorpay checkout policy (ADR-038 one-time branch; plan §3.9).
 *
 * Infrastructure-free by design (no Postgres, no Redis, no Razorpay): the
 * policy module is pure, and this spec pins the properties the payment handler
 * depends on —
 *
 *   1. ALGORITHM: the checkout handshake is
 *      HMAC-SHA256(`${razorpay_order_id}|${razorpay_payment_id}`, KEY_SECRET),
 *      pinned against a fixed vector so a silent algorithm/format change fails.
 *   2. FAIL-CLOSED: missing secret, missing signature, wrong length and any
 *      tampering all refuse — there is no path that returns ok without a match.
 *   3. ORDER BINDING: a payment captured for another Vendure order cannot be
 *      applied here (receipt / notes must carry this order's code).
 *   4. PAYMENT BINDING: provider order id, exact minor-unit amount, currency
 *      and a settling status are all required.
 *   5. SINGLE-STEP: only `captured` settles; `authorized` must be captured
 *      first (the service does that), `created`/`failed` never settle.
 */

import { describe, expect, it } from 'vitest';
import {
  CAPTURABLE_PROVIDER_STATUSES,
  SETTLING_PROVIDER_STATUSES,
  assertOrderBinding,
  assertPaymentBinding,
  checkoutSignaturePayload,
  computeCheckoutSignature,
  extractCheckoutMetadata,
  isCapturableProviderStatus,
  isSettlingProviderStatus,
  verifyCheckoutSignature,
} from '../razorpay-checkout.policy';

const SECRET = 'test_secret_key';
const ORDER = 'order_ABC123';
const PAYMENT = 'pay_XYZ789';
/** Pinned HMAC-SHA256(`order_ABC123|pay_XYZ789`, 'test_secret_key'). */
const VALID_SIG = 'b0b12113290ee2725c910a905e505ee6bb5ee8f268c106200dcc08f5fe79ad64';

describe('checkout signature (algorithm + fail-closed)', () => {
  it('signs exactly `${orderId}|${paymentId}`', () => {
    expect(checkoutSignaturePayload(ORDER, PAYMENT)).toBe('order_ABC123|pay_XYZ789');
  });

  it('matches the pinned HMAC-SHA256 vector', () => {
    expect(computeCheckoutSignature(ORDER, PAYMENT, SECRET)).toBe(VALID_SIG);
  });

  it('accepts the correct signature', () => {
    expect(
      verifyCheckoutSignature({
        orderId: ORDER,
        paymentId: PAYMENT,
        signature: VALID_SIG,
        keySecret: SECRET,
      }),
    ).toEqual({ ok: true });
  });

  it('refuses a signature computed for a different payment', () => {
    const other = computeCheckoutSignature(ORDER, 'pay_OTHER', SECRET);
    expect(
      verifyCheckoutSignature({
        orderId: ORDER,
        paymentId: PAYMENT,
        signature: other,
        keySecret: SECRET,
      }),
    ).toEqual({ ok: false, reason: 'signature-mismatch' });
  });

  it('refuses a signature computed for a different order', () => {
    const other = computeCheckoutSignature('order_OTHER', PAYMENT, SECRET);
    expect(
      verifyCheckoutSignature({
        orderId: ORDER,
        paymentId: PAYMENT,
        signature: other,
        keySecret: SECRET,
      }),
    ).toEqual({ ok: false, reason: 'signature-mismatch' });
  });

  it('refuses a signature computed with the wrong secret', () => {
    const other = computeCheckoutSignature(ORDER, PAYMENT, 'wrong_secret');
    expect(
      verifyCheckoutSignature({
        orderId: ORDER,
        paymentId: PAYMENT,
        signature: other,
        keySecret: SECRET,
      }),
    ).toEqual({ ok: false, reason: 'signature-mismatch' });
  });

  it('refuses a missing signature', () => {
    expect(
      verifyCheckoutSignature({ orderId: ORDER, paymentId: PAYMENT, keySecret: SECRET }),
    ).toEqual({ ok: false, reason: 'missing-signature' });
  });

  it('refuses when the secret is not configured (never a pass-through)', () => {
    expect(
      verifyCheckoutSignature({
        orderId: ORDER,
        paymentId: PAYMENT,
        signature: VALID_SIG,
        keySecret: '',
      }),
    ).toEqual({ ok: false, reason: 'missing-secret' });
  });

  it('refuses a truncated signature (length guard before timingSafeEqual)', () => {
    expect(
      verifyCheckoutSignature({
        orderId: ORDER,
        paymentId: PAYMENT,
        signature: VALID_SIG.slice(0, 32),
        keySecret: SECRET,
      }),
    ).toEqual({ ok: false, reason: 'signature-mismatch' });
  });
});

describe('extractCheckoutMetadata', () => {
  it('reads the snake_case payload produced by Razorpay Checkout', () => {
    expect(
      extractCheckoutMetadata({
        razorpay_order_id: ORDER,
        razorpay_payment_id: PAYMENT,
        razorpay_signature: VALID_SIG,
      }),
    ).toEqual({ razorpayOrderId: ORDER, razorpayPaymentId: PAYMENT, razorpaySignature: VALID_SIG });
  });

  it('reads camelCase equivalents', () => {
    expect(
      extractCheckoutMetadata({ razorpayOrderId: ORDER, razorpayPaymentId: PAYMENT }),
    ).toEqual({ razorpayOrderId: ORDER, razorpayPaymentId: PAYMENT, razorpaySignature: undefined });
  });

  it('returns null when an identifier is missing', () => {
    expect(extractCheckoutMetadata({ razorpay_payment_id: PAYMENT })).toBeNull();
    expect(extractCheckoutMetadata({ razorpay_order_id: ORDER })).toBeNull();
    expect(extractCheckoutMetadata({})).toBeNull();
    expect(extractCheckoutMetadata(null)).toBeNull();
    expect(extractCheckoutMetadata('nope')).toBeNull();
  });

  it('treats an empty signature string as absent', () => {
    expect(
      extractCheckoutMetadata({
        razorpay_order_id: ORDER,
        razorpay_payment_id: PAYMENT,
        razorpay_signature: '',
      })?.razorpaySignature,
    ).toBeUndefined();
  });
});

describe('order binding (Vendure order ↔ Razorpay order)', () => {
  it('accepts a matching receipt', () => {
    expect(assertOrderBinding({ receipt: 'VEND-1', expectedOrderCode: 'VEND-1' })).toEqual({
      ok: true,
    });
  });

  it('accepts a matching notes.vendureOrderCode when receipt is absent', () => {
    expect(
      assertOrderBinding({
        receipt: null,
        notes: { vendureOrderCode: 'VEND-1' },
        expectedOrderCode: 'VEND-1',
      }),
    ).toEqual({ ok: true });
  });

  it('refuses a payment captured for another order', () => {
    const result = assertOrderBinding({
      receipt: 'VEND-OTHER',
      notes: { vendureOrderCode: 'VEND-OTHER' },
      expectedOrderCode: 'VEND-1',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('order-binding-mismatch');
  });

  it('refuses when receipt and notes are both absent', () => {
    expect(assertOrderBinding({ expectedOrderCode: 'VEND-1' }).ok).toBe(false);
  });
});

describe('payment binding (amount, currency, status)', () => {
  const base = {
    paymentOrderId: 'order_ABC123',
    expectedRazorpayOrderId: 'order_ABC123',
    paymentAmountMinor: 49_900,
    expectedAmountMinor: 49_900,
    paymentCurrency: 'INR',
    expectedCurrency: 'INR',
    providerStatus: 'captured',
  };

  it('accepts a captured payment with exact amount + currency', () => {
    expect(assertPaymentBinding(base)).toEqual({ ok: true });
  });

  it('refuses a payment belonging to another provider order', () => {
    const r = assertPaymentBinding({ ...base, paymentOrderId: 'order_OTHER' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('payment-order-mismatch');
  });

  it('refuses an underpaid order', () => {
    const r = assertPaymentBinding({ ...base, paymentAmountMinor: 100 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('amount-mismatch');
  });

  it('refuses an overpaid order (never silently accept a mismatch)', () => {
    const r = assertPaymentBinding({ ...base, paymentAmountMinor: 1_000_000 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('amount-mismatch');
  });

  it('refuses a currency mismatch', () => {
    const r = assertPaymentBinding({ ...base, paymentCurrency: 'USD' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('currency-mismatch');
  });

  it('never settles a `created` payment', () => {
    const r = assertPaymentBinding({ ...base, providerStatus: 'created' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('provider-status-not-settling');
  });

  it('never settles an `authorized` payment without capture', () => {
    const r = assertPaymentBinding({ ...base, providerStatus: 'authorized' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('provider-status-not-settling');
  });

  it('never settles a `failed` payment', () => {
    expect(assertPaymentBinding({ ...base, providerStatus: 'failed' }).ok).toBe(false);
  });
});

describe('frozen provider-status sets', () => {
  it('settles only on captured — widen deliberately, not accidentally', () => {
    expect([...SETTLING_PROVIDER_STATUSES]).toEqual(['captured']);
    expect(isSettlingProviderStatus('captured')).toBe(true);
    expect(isSettlingProviderStatus('authorized')).toBe(false);
  });

  it('captures only authorized payments', () => {
    expect([...CAPTURABLE_PROVIDER_STATUSES]).toEqual(['authorized']);
    expect(isCapturableProviderStatus('authorized')).toBe(true);
    expect(isCapturableProviderStatus('created')).toBe(false);
  });
});
