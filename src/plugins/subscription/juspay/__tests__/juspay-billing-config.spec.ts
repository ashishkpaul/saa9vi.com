import { describe, expect, it } from 'vitest';
import { resolveBillingConfig } from '../juspay-billing-config';

const asEnv = (o: Record<string, string | undefined>) => o as unknown as NodeJS.ProcessEnv;

describe('resolveBillingConfig (Juspay credential wiring)', () => {
  const base = asEnv({ NODE_ENV: 'development' });

  it('passes env values through to billing when both credentials are set', () => {
    const cfg = resolveBillingConfig(
      asEnv({ NODE_ENV: 'development', JUSPAY_API_KEY: ' test-api-key ', JUSPAY_MERCHANT_ID: 'test-merchant', JUSPAY_SANDBOX: 'true' }),
    );
    expect(cfg).toEqual({ apiKey: 'test-api-key', merchantId: 'test-merchant', sandbox: true });
  });

  it('defaults sandbox to false when JUSPAY_SANDBOX is unset', () => {
    const cfg = resolveBillingConfig(asEnv({ NODE_ENV: 'development', JUSPAY_API_KEY: 'k', JUSPAY_MERCHANT_ID: 'm' }));
    expect(cfg).toEqual({ apiKey: 'k', merchantId: 'm', sandbox: false });
  });

  it('returns undefined when either credential is missing (dev simulates)', () => {
    expect(resolveBillingConfig(asEnv({ NODE_ENV: 'development', JUSPAY_API_KEY: 'k' }))).toBeUndefined();
    expect(resolveBillingConfig(asEnv({ NODE_ENV: 'development', JUSPAY_MERCHANT_ID: 'm' }))).toBeUndefined();
    expect(resolveBillingConfig(base)).toBeUndefined();
  });

  it('returns undefined when credentials are whitespace-only', () => {
    expect(resolveBillingConfig(asEnv({ NODE_ENV: 'development', JUSPAY_API_KEY: '   ', JUSPAY_MERCHANT_ID: 'm' }))).toBeUndefined();
  });

  it('refuses to boot in production with JUSPAY_SANDBOX=true', () => {
    expect(() =>
      resolveBillingConfig(
        asEnv({ NODE_ENV: 'production', JUSPAY_API_KEY: 'k', JUSPAY_MERCHANT_ID: 'm', JUSPAY_SANDBOX: 'true' }),
      ),
    ).toThrow(/JUSPAY_SANDBOX=true is forbidden in production/);
  });

  it('allows JUSPAY_SANDBOX=true outside production', () => {
    expect(() =>
      resolveBillingConfig(asEnv({ NODE_ENV: 'development', JUSPAY_SANDBOX: 'true', JUSPAY_API_KEY: 'k', JUSPAY_MERCHANT_ID: 'm' })),
    ).not.toThrow();
  });
});

