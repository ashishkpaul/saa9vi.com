/**
 * Commit 3 — production hardening boot-guard cases.
 *
 * Each new guard (SMTP_HOST, CORS allow-list, ASSET_URL_PREFIX) refuses
 * non-dev boot when blank and passes when set. The dummy-handler check from
 * Commit 1 is covered in payments-production-guard.spec.ts.
 */
import { describe, expect, it } from 'vitest';
import { assertProductionSecrets } from './require-production-secrets.js';

type EnvBag = Record<string, string | undefined>;

function prodEnv(overrides: EnvBag = {}): EnvBag {
  return {
    APP_ENV: 'prod',
    SUPERADMIN_PASSWORD: 'x',
    COOKIE_SECRET: 'x',
    RAZORPAY_KEY_ID: 'x',
    RAZORPAY_KEY_SECRET: 'x',
    RAZORPAY_WEBHOOK_SECRET: 'x',
    REDIS_PASSWORD: 'x',
    DB_PASSWORD: 'x',
    BBB_ENCRYPTION_KEY: 'ab'.repeat(32),
    BBB_DEFAULT_RATE_PAISE_PER_LEARNER_HOUR: '2000',
    BBB_PUBLIC_BASE_URL: 'https://meeting.saa9vi.com',
    SMTP_HOST: 'smtp.example.com',
    STOREFRONT_URL: 'https://shop.example.com',
    ASSET_URL_PREFIX: 'https://core.saa9vi.com/assets/',
    ...overrides,
  };
}

function guard(env: EnvBag): void {
  assertProductionSecrets(env as unknown as NodeJS.ProcessEnv);
}

describe('assertProductionSecrets Commit 3 guards', () => {
  it('complete prod env with all Commit 3 fields passes', () => {
    expect(() => guard(prodEnv())).not.toThrow();
  });

  it('missing SMTP_HOST refuses', () => {
    const env = prodEnv();
    delete env.SMTP_HOST;
    expect(() => guard(env)).toThrow(/SMTP_HOST/);
  });

  it('blank SMTP_HOST refuses', () => {
    expect(() => guard(prodEnv({ SMTP_HOST: '   ' }))).toThrow(/SMTP_HOST/);
  });

  it('empty CORS allow-list (no STOREFRONT_URL/ADMIN_URL) refuses', () => {
    const env = prodEnv();
    delete env.STOREFRONT_URL;
    delete env.ADMIN_URL;
    expect(() => guard(env)).toThrow(/STOREFRONT_URL/);
  });

  it('ADMIN_URL alone satisfies the CORS allow-list', () => {
    const env = prodEnv();
    delete env.STOREFRONT_URL;
    env.ADMIN_URL = 'https://admin.example.com';
    expect(() => guard(env)).not.toThrow();
  });

  it('missing ASSET_URL_PREFIX refuses', () => {
    const env = prodEnv();
    delete env.ASSET_URL_PREFIX;
    expect(() => guard(env)).toThrow(/ASSET_URL_PREFIX/);
  });

  it('dev skips all Commit 3 guards', () => {
    expect(() => guard({ APP_ENV: 'dev' })).not.toThrow();
  });
});
