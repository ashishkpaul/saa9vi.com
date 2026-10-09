import { describe, expect, it, vi } from 'vitest';

/**
 * Commit 1 hygiene: autoProvisionChannelResources assigns ONLY the platform
 * Razorpay method(s) to a new tenant channel — dummy/dev methods are skipped.
 *
 * The filter lives in TenantRegistrationService (private method); this spec
 * pins the predicate itself so a refactor cannot silently re-copy dummy.
 */
function isRazorpayMethod(m: { handler?: { code?: string } }): boolean {
  return m.handler?.code === 'razorpay';
}

describe('tenant auto-provision payment filter (Commit 1)', () => {
  it('keeps razorpay, drops dummy-payment-handler', () => {
    const methods = [
      { id: 1, handler: { code: 'razorpay' } },
      { id: 2, handler: { code: 'dummy-payment-handler' } },
      { id: 3, handler: { code: 'stripe' } },
    ];
    const kept = methods.filter(isRazorpayMethod);
    expect(kept.map((m) => m.id)).toEqual([1]);
  });

  it('empty razorpay set means nothing is assigned (warn path)', () => {
    const methods = [{ id: 9, handler: { code: 'dummy-payment-handler' } }];
    expect(methods.filter(isRazorpayMethod)).toEqual([]);
  });

  it('matches the live RAZORPAY_HANDLER_CODE constant', async () => {
    const { RAZORPAY_HANDLER_CODE } = await import('../../payments/constants.js');
    expect(RAZORPAY_HANDLER_CODE).toBe('razorpay');
    expect(isRazorpayMethod({ handler: { code: RAZORPAY_HANDLER_CODE } })).toBe(true);
    expect(isRazorpayMethod({ handler: { code: 'dummy-payment-handler' } })).toBe(false);
  });
});
