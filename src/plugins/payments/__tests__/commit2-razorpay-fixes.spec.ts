import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

/**
 * Commit 2 — Razorpay fixes: secret fallback, boot refusal, event-type gate,
 * captured-on-settled ops alert.
 */
describe('razorpayPaymentsWebhookSecret || fallback (Commit 2)', () => {
  const OLD = { ...process.env };

  beforeEach(() => {
    delete process.env.RAZORPAY_PAYMENTS_WEBHOOK_SECRET;
    delete process.env.RAZORPAY_WEBHOOK_SECRET;
  });
  afterEach(() => {
    process.env.RAZORPAY_PAYMENTS_WEBHOOK_SECRET = OLD.RAZORPAY_PAYMENTS_WEBHOOK_SECRET;
    process.env.RAZORPAY_WEBHOOK_SECRET = OLD.RAZORPAY_WEBHOOK_SECRET;
  });

  it('empty-string primary falls through to the fallback (|| not ??)', async () => {
    process.env.RAZORPAY_PAYMENTS_WEBHOOK_SECRET = '';
    process.env.RAZORPAY_WEBHOOK_SECRET = 'fallback-secret';
    const { razorpayPaymentsWebhookSecret } = await import('../constants.js');
    expect(razorpayPaymentsWebhookSecret()).toBe('fallback-secret');
  });

  it('primary wins when set', async () => {
    process.env.RAZORPAY_PAYMENTS_WEBHOOK_SECRET = 'primary';
    process.env.RAZORPAY_WEBHOOK_SECRET = 'fallback-secret';
    const { razorpayPaymentsWebhookSecret } = await import('../constants.js');
    expect(razorpayPaymentsWebhookSecret()).toBe('primary');
  });

  it('empty when both unset/blank (fail-closed downstream)', async () => {
    process.env.RAZORPAY_PAYMENTS_WEBHOOK_SECRET = '';
    process.env.RAZORPAY_WEBHOOK_SECRET = '';
    const { razorpayPaymentsWebhookSecret, resolvedPaymentsWebhookSecret } = await import('../constants.js');
    expect(razorpayPaymentsWebhookSecret()).toBe('');
    expect(resolvedPaymentsWebhookSecret()).toBe('');
  });
});

describe('assertProductionSecrets payments-secret refusal (Commit 2)', () => {
  function prodEnv(overrides: Record<string, string | undefined> = {}): Record<string, string | undefined> {
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

  it('refuses when both webhook secrets are blank (presence or format path)', async () => {
    const { assertProductionSecrets } = await import('../../../platform/security/require-production-secrets.js');
    expect(() =>
      assertProductionSecrets(
        prodEnv({ RAZORPAY_PAYMENTS_WEBHOOK_SECRET: '', RAZORPAY_WEBHOOK_SECRET: '' }) as never,
      ),
    ).toThrow(/RAZORPAY_(PAYMENTS_)?WEBHOOK_SECRET/);
  });

  it('passes on fallback secret alone', async () => {
    const { assertProductionSecrets } = await import('../../../platform/security/require-production-secrets.js');
    expect(() =>
      assertProductionSecrets(prodEnv({ RAZORPAY_PAYMENTS_WEBHOOK_SECRET: '' }) as never),
    ).not.toThrow();
  });

  it('dev skips the payments-secret check', async () => {
    const { assertProductionSecrets } = await import('../../../platform/security/require-production-secrets.js');
    expect(() => assertProductionSecrets({ APP_ENV: 'dev' } as never)).not.toThrow();
  });
});

describe('SETTLING_WEBHOOK_EVENT_TYPES (Commit 2)', () => {
  it('only payment.captured / order.paid settle', async () => {
    const { SETTLING_WEBHOOK_EVENT_TYPES } = await import('../services/payment-webhook-queue.service.js');
    expect([...SETTLING_WEBHOOK_EVENT_TYPES]).toEqual(['payment.captured', 'order.paid']);
  });
});

describe('reconcileEvent settled-order branches (Commit 2 correction)', () => {
  it('duplicate delivery of the SAME payment → ignored, NO ops alert', async () => {
    const { PaymentWebhookQueueService } = await import('../services/payment-webhook-queue.service.js');
    const alerts: string[] = [];
    const svc = new PaymentWebhookQueueService(
      {} as never,
      {
        rawConnection: {
          getRepository: (entity: unknown) => {
            if (String(entity) === 'Payment') {
              return { find: async () => [{ transactionId: 'pay_SAME', metadata: {} }] };
            }
            return {
              findOne: async () => ({
                id: 1,
                code: 'ORDER1',
                state: 'PaymentSettled',
                channels: [{ id: 1 }],
              }),
            };
          },
        },
      } as never,
      {} as never,
      {} as never,
      {} as never,
      { notify: (...a: unknown[]) => { alerts.push(String(a[0])); } } as never,
    );
    const outcome = await (svc as any).reconcileEvent({
      id: 11,
      eventType: 'payment.captured',
      rawPayload: {
        event: 'payment.captured',
        payload: {
          payment: { entity: { id: 'pay_SAME', order_id: 'order_X', notes: { vendureOrderCode: 'ORDER1' } } },
        },
      },
    });
    expect(outcome).toBe('ignored');
    expect(alerts).toEqual([]);
  });

  it('DIFFERENT captured payment on settled order → ignored WITH ops alert', async () => {
    const { PaymentWebhookQueueService } = await import('../services/payment-webhook-queue.service.js');
    const alerts: string[] = [];
    const svc = new PaymentWebhookQueueService(
      {} as never,
      {
        rawConnection: {
          getRepository: (entity: unknown) => {
            if (String(entity) === 'Payment') {
              return { find: async () => [{ transactionId: 'pay_OTHER', metadata: {} }] };
            }
            return {
              findOne: async () => ({
                id: 1,
                code: 'ORDER1',
                state: 'PaymentSettled',
                channels: [{ id: 1 }],
              }),
            };
          },
        },
      } as never,
      {} as never,
      {} as never,
      {} as never,
      { notify: (...a: unknown[]) => { alerts.push(String(a[0])); } } as never,
    );
    const outcome = await (svc as any).reconcileEvent({
      id: 12,
      eventType: 'payment.captured',
      rawPayload: {
        event: 'payment.captured',
        payload: {
          payment: { entity: { id: 'pay_NEW', order_id: 'order_X', notes: { vendureOrderCode: 'ORDER1' } } },
        },
      },
    });
    expect(outcome).toBe('ignored');
    expect(alerts).toEqual(['payment-captured-on-settled-order']);
  });

  it('payment.failed → ignored-by-type, no alert, no settle attempt', async () => {
    const { PaymentWebhookQueueService } = await import('../services/payment-webhook-queue.service.js');
    let settleCalled = false;
    const svc = new PaymentWebhookQueueService(
      {} as never,
      { rawConnection: { getRepository: () => { throw new Error('must not touch DB for failed events'); } } } as never,
      {} as never,
      { addPaymentToOrder: async () => { settleCalled = true; } } as never,
      {} as never,
      { notify: () => { throw new Error('must not alert for failed events'); } } as never,
    );
    const outcome = await (svc as any).reconcileEvent({
      id: 13,
      eventType: 'payment.failed',
      rawPayload: { event: 'payment.failed', payload: { payment: { entity: { id: 'pay_F' } } } },
    });
    expect(outcome).toBe('ignored');
    expect(settleCalled).toBe(false);
  });
});
