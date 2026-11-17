import type { OrderService, RequestContext, TransactionalConnection } from '@vendure/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { computeCheckoutSignature } from '../razorpay-checkout.policy';
import { TenantPaymentAccountService } from '../services/tenant-payment-account.service';
import type { TenantPaymentEncryptionService } from '../services/tenant-payment-encryption.service';
import type { TenantRazorpayOrdersClient } from '../services/tenant-razorpay-orders.client';
import { TenantRazorpayService } from '../services/tenant-razorpay.service';

const CHANNEL_ID = 'channel-10';
const OWNER_USER_ID = 'user-101';
const OTHER_USER_ID = 'user-202';
const ORDER_ID = 'order-501';
const ORDER_CODE = 'ORDER-501';
const RAZORPAY_ORDER_ID = 'order_rzp_123';
const RAZORPAY_PAYMENT_ID = 'pay_rzp_456';
const KEY_SECRET = 'tenant-test-secret';

function makeOrder(overrides: Record<string, unknown> = {}) {
  return {
    id: ORDER_ID,
    code: ORDER_CODE,
    state: 'ArrangingPayment',
    totalWithTax: 129900,
    currencyCode: 'INR',
    channels: [{ id: CHANNEL_ID }],
    customer: { user: { id: OWNER_USER_ID } },
    customFields: { paymentPurpose: 'tenant-client' },
    ...overrides,
  };
}

function validMetadata(overrides: Record<string, unknown> = {}) {
  return {
    razorpay_order_id: RAZORPAY_ORDER_ID,
    razorpay_payment_id: RAZORPAY_PAYMENT_ID,
    razorpay_signature: computeCheckoutSignature(
      RAZORPAY_ORDER_ID,
      RAZORPAY_PAYMENT_ID,
      KEY_SECRET,
    ),
    ...overrides,
  };
}

describe('TenantPaymentAccountService settlement credentials', () => {
  const ctx = {
    channelId: CHANNEL_ID,
    apiType: 'shop',
  } as RequestContext;

  function makeService(account: Record<string, unknown>) {
    const repository = {
      findOne: vi.fn().mockResolvedValue(account),
    };
    const connection = {
      getRepository: vi.fn().mockReturnValue(repository),
    } as unknown as TransactionalConnection;
    const encryption = {
      decrypt: vi.fn().mockReturnValue('decrypted-tenant-secret'),
    } as unknown as TenantPaymentEncryptionService;
    return {
      service: new TenantPaymentAccountService(connection, encryption),
      repository,
      encryption,
    };
  }

  it('does not decrypt any credential for a disabled account', async () => {
    const { service, encryption } = makeService({
      keyId: 'rzp_test_public',
      encryptedKeySecret: 'ciphertext',
      encryptedWebhookSecret: 'webhook-ciphertext',
      status: 'active',
      isEnabled: false,
    });

    await expect(service.getActiveDecryptedCredentials(ctx, CHANNEL_ID))
      .rejects.toThrow('active and enabled');
    expect(encryption.decrypt).not.toHaveBeenCalled();
  });

  it('does not decrypt any credential for a pending or suspended account', async () => {
    for (const status of ['pending', 'suspended']) {
      const { service, encryption } = makeService({
        keyId: 'rzp_test_public',
        encryptedKeySecret: 'ciphertext',
        encryptedWebhookSecret: 'webhook-ciphertext',
        status,
        isEnabled: true,
      });

      await expect(service.getActiveDecryptedCredentials(ctx, CHANNEL_ID))
        .rejects.toThrow('active and enabled');
      expect(encryption.decrypt).not.toHaveBeenCalled();
    }
  });

  it('decrypts only the tenant Key Secret for an active enabled account', async () => {
    const { service, encryption } = makeService({
      keyId: 'rzp_test_public',
      encryptedKeySecret: 'key-ciphertext',
      encryptedWebhookSecret: 'webhook-ciphertext',
      status: 'active',
      isEnabled: true,
      accountMode: 'test',
    });

    await expect(service.getActiveDecryptedCredentials(ctx, CHANNEL_ID))
      .resolves.toEqual({
        keyId: 'rzp_test_public',
        keySecret: 'decrypted-tenant-secret',
      });
    expect(encryption.decrypt).toHaveBeenCalledOnce();
    expect(encryption.decrypt).toHaveBeenCalledWith('key-ciphertext');
  });
});

describe('TenantRazorpayService verifyAndSettle (G-1)', () => {
  let ctx: RequestContext;
  let orderRepo: { findOne: ReturnType<typeof vi.fn> };
  let paymentRepo: { findOne: ReturnType<typeof vi.fn> };
  let connection: Pick<TransactionalConnection, 'getRepository'>;
  let orderService: Pick<OrderService, 'getActiveOrderForUser'>;
  let accountService: Pick<TenantPaymentAccountService, 'getActiveDecryptedCredentials'>;
  let client: Pick<
    TenantRazorpayOrdersClient,
    'fetchOrder' | 'fetchPayment' | 'capturePayment'
  >;
  let service: TenantRazorpayService;

  beforeEach(() => {
    ctx = {
      channelId: CHANNEL_ID,
      activeUserId: OWNER_USER_ID,
      apiType: 'shop',
    } as RequestContext;

    orderRepo = {
      findOne: vi.fn().mockResolvedValue(makeOrder()),
    };
    paymentRepo = {
      findOne: vi.fn().mockResolvedValue(null),
    };
    connection = {
      getRepository: vi.fn((_ctx: RequestContext, entity: unknown) =>
        String(entity) === 'Payment' ? paymentRepo : orderRepo,
      ),
    } as unknown as Pick<TransactionalConnection, 'getRepository'>;

    orderService = {
      getActiveOrderForUser: vi.fn(),
    } as unknown as Pick<OrderService, 'getActiveOrderForUser'>;

    accountService = {
      getActiveDecryptedCredentials: vi.fn().mockResolvedValue({
        keyId: 'rzp_test_public',
        keySecret: KEY_SECRET,
      }),
    } as unknown as Pick<TenantPaymentAccountService, 'getActiveDecryptedCredentials'>;

    client = {
      fetchOrder: vi.fn().mockResolvedValue({
        id: RAZORPAY_ORDER_ID,
        amount: 129900,
        currency: 'INR',
        receipt: ORDER_CODE,
        status: 'paid',
        notes: { vendureOrderCode: ORDER_CODE },
      }),
      fetchPayment: vi.fn().mockResolvedValue({
        id: RAZORPAY_PAYMENT_ID,
        order_id: RAZORPAY_ORDER_ID,
        amount: 129900,
        currency: 'INR',
        status: 'captured',
        method: 'upi',
      }),
      capturePayment: vi.fn().mockImplementation(async (
        _keyId: string,
        _secret: string,
        input: { razorpayPaymentId: string; amountMinor: number; currency: string },
      ) => ({
        id: input.razorpayPaymentId,
        order_id: RAZORPAY_ORDER_ID,
        amount: input.amountMinor,
        currency: input.currency,
        status: 'captured',
        method: 'upi',
      })),
    } as unknown as Pick<
      TenantRazorpayOrdersClient,
      'fetchOrder' | 'fetchPayment' | 'capturePayment'
    >;

    service = new TenantRazorpayService(
      connection as TransactionalConnection,
      orderService as OrderService,
      accountService as TenantPaymentAccountService,
      client as TenantRazorpayOrdersClient,
    );
  });

  it('verifies provider bindings and returns a settled payment for the owning customer', async () => {
    const result = await service.verifyAndSettle(ctx, ORDER_ID, validMetadata());

    expect(result).toMatchObject({
      ok: true,
      paymentId: RAZORPAY_PAYMENT_ID,
      razorpayOrderId: RAZORPAY_ORDER_ID,
      providerStatus: 'captured',
      signatureVerified: true,
    });
    expect(accountService.getActiveDecryptedCredentials).toHaveBeenCalledWith(ctx, CHANNEL_ID);
    expect(client.fetchOrder).toHaveBeenCalledOnce();
    expect(client.fetchPayment).toHaveBeenCalledOnce();
    expect(client.capturePayment).not.toHaveBeenCalled();
  });

  it('rejects an invalid checkout signature before provider reads', async () => {
    const result = await service.verifyAndSettle(
      ctx,
      ORDER_ID,
      validMetadata({ razorpay_signature: 'invalid-signature' }),
    );

    expect(result).toMatchObject({ ok: false, errorCode: 'SIGNATURE_INVALID' });
    expect(client.fetchOrder).not.toHaveBeenCalled();
    expect(client.fetchPayment).not.toHaveBeenCalled();
  });

  it('rejects an order owned by another customer before reading tenant credentials', async () => {
    orderRepo.findOne.mockResolvedValue(
      makeOrder({ customer: { user: { id: OTHER_USER_ID } } }),
    );

    const result = await service.verifyAndSettle(ctx, ORDER_ID, validMetadata());

    expect(result).toMatchObject({ ok: false, errorCode: 'ORDER_NOT_FOUND' });
    expect(accountService.getActiveDecryptedCredentials).not.toHaveBeenCalled();
    expect(client.fetchOrder).not.toHaveBeenCalled();
  });

  it('rejects a cross-channel order before reading tenant credentials', async () => {
    orderRepo.findOne.mockResolvedValue(makeOrder({ channels: [{ id: 'channel-foreign' }] }));

    const result = await service.verifyAndSettle(ctx, ORDER_ID, validMetadata());

    expect(result).toMatchObject({ ok: false, errorCode: 'ORDER_NOT_FOUND' });
    expect(accountService.getActiveDecryptedCredentials).not.toHaveBeenCalled();
  });

  it('rejects platform-service orders from the tenant payment handler', async () => {
    orderRepo.findOne.mockResolvedValue(
      makeOrder({ customFields: { paymentPurpose: 'platform-service' } }),
    );

    const result = await service.verifyAndSettle(ctx, ORDER_ID, validMetadata());

    expect(result).toMatchObject({ ok: false, errorCode: 'PAYMENT_FLOW_MISMATCH' });
    expect(accountService.getActiveDecryptedCredentials).not.toHaveBeenCalled();
  });

  it('fails closed outside an authenticated Shop API context', async () => {
    const nonShopCtx = { ...ctx, apiType: 'admin' } as RequestContext;

    const result = await service.verifyAndSettle(nonShopCtx, ORDER_ID, validMetadata());

    expect(result).toMatchObject({ ok: false, errorCode: 'AUTHENTICATION_REQUIRED' });
    expect(orderRepo.findOne).not.toHaveBeenCalled();
    expect(accountService.getActiveDecryptedCredentials).not.toHaveBeenCalled();
  });

  it('fails closed when the customer is not authenticated', async () => {
    const anonymousCtx = { ...ctx, activeUserId: undefined } as RequestContext;

    const result = await service.verifyAndSettle(anonymousCtx, ORDER_ID, validMetadata());

    expect(result).toMatchObject({ ok: false, errorCode: 'AUTHENTICATION_REQUIRED' });
    expect(orderRepo.findOne).not.toHaveBeenCalled();
  });

  it('rejects a previously recorded Razorpay payment ID before provider calls', async () => {
    paymentRepo.findOne.mockResolvedValue({ id: 'vendure-payment-99' });

    const result = await service.verifyAndSettle(ctx, ORDER_ID, validMetadata());

    expect(result).toMatchObject({ ok: false, errorCode: 'PAYMENT_ALREADY_USED' });
    expect(client.fetchOrder).not.toHaveBeenCalled();
    expect(client.fetchPayment).not.toHaveBeenCalled();
    expect(client.capturePayment).not.toHaveBeenCalled();
  });

  it('rejects an inactive or disabled tenant account before provider calls', async () => {
    vi.mocked(accountService.getActiveDecryptedCredentials).mockRejectedValue(
      new Error('Tenant Razorpay account must be active and enabled'),
    );

    const result = await service.verifyAndSettle(ctx, ORDER_ID, validMetadata());

    expect(result).toMatchObject({ ok: false, errorCode: 'TENANT_ACCOUNT_UNAVAILABLE' });
    expect(client.fetchOrder).not.toHaveBeenCalled();
    expect(client.fetchPayment).not.toHaveBeenCalled();
  });

  it('rejects a provider order whose receipt/notes do not bind to this Vendure order', async () => {
    vi.mocked(client.fetchOrder).mockResolvedValue({
      id: RAZORPAY_ORDER_ID,
      amount: 129900,
      currency: 'INR',
      receipt: 'OTHER-ORDER',
      status: 'paid',
      notes: { vendureOrderCode: 'OTHER-ORDER' },
    });

    const result = await service.verifyAndSettle(ctx, ORDER_ID, validMetadata());

    expect(result).toMatchObject({ ok: false, errorCode: 'ORDER_BINDING_MISMATCH' });
    expect(client.fetchPayment).not.toHaveBeenCalled();
  });

  it('rejects provider order amount and currency mismatches before fetching a payment', async () => {
    vi.mocked(client.fetchOrder).mockResolvedValueOnce({
      id: RAZORPAY_ORDER_ID,
      amount: 1,
      currency: 'INR',
      receipt: ORDER_CODE,
      status: 'paid',
      notes: { vendureOrderCode: ORDER_CODE },
    });

    const amountResult = await service.verifyAndSettle(ctx, ORDER_ID, validMetadata());
    expect(amountResult).toMatchObject({ ok: false, errorCode: 'ORDER_AMOUNT_MISMATCH' });
    expect(client.fetchPayment).not.toHaveBeenCalled();

    vi.mocked(client.fetchOrder).mockResolvedValueOnce({
      id: RAZORPAY_ORDER_ID,
      amount: 129900,
      currency: 'USD',
      receipt: ORDER_CODE,
      status: 'paid',
      notes: { vendureOrderCode: ORDER_CODE },
    });
    const currencyResult = await service.verifyAndSettle(ctx, ORDER_ID, validMetadata());
    expect(currencyResult).toMatchObject({ ok: false, errorCode: 'ORDER_CURRENCY_MISMATCH' });
    expect(client.fetchPayment).not.toHaveBeenCalled();
  });

  it('rejects a provider order response with a different ID', async () => {
    vi.mocked(client.fetchOrder).mockResolvedValue({
      id: 'order_rzp_unexpected',
      amount: 129900,
      currency: 'INR',
      receipt: ORDER_CODE,
      status: 'paid',
      notes: { vendureOrderCode: ORDER_CODE },
    });

    const result = await service.verifyAndSettle(ctx, ORDER_ID, validMetadata());

    expect(result).toMatchObject({ ok: false, errorCode: 'PROVIDER_ORDER_ID_MISMATCH' });
    expect(client.fetchPayment).not.toHaveBeenCalled();
  });

  it('rejects a provider payment response with a different ID before capture', async () => {
    vi.mocked(client.fetchPayment).mockResolvedValue({
      id: 'pay_rzp_unexpected',
      order_id: RAZORPAY_ORDER_ID,
      amount: 129900,
      currency: 'INR',
      status: 'authorized',
    });

    const result = await service.verifyAndSettle(ctx, ORDER_ID, validMetadata());

    expect(result).toMatchObject({ ok: false, errorCode: 'PROVIDER_PAYMENT_ID_MISMATCH' });
    expect(client.capturePayment).not.toHaveBeenCalled();
  });

  it('rejects a payment attached to a different Razorpay order before capture', async () => {
    vi.mocked(client.fetchPayment).mockResolvedValue({
      id: RAZORPAY_PAYMENT_ID,
      order_id: 'order_rzp_foreign',
      amount: 129900,
      currency: 'INR',
      status: 'authorized',
    });

    const result = await service.verifyAndSettle(ctx, ORDER_ID, validMetadata());

    expect(result).toMatchObject({ ok: false, errorCode: 'PAYMENT_ORDER_MISMATCH' });
    expect(client.capturePayment).not.toHaveBeenCalled();
  });

  it('rejects payment amount and currency mismatches before capture', async () => {
    vi.mocked(client.fetchPayment).mockResolvedValueOnce({
      id: RAZORPAY_PAYMENT_ID,
      order_id: RAZORPAY_ORDER_ID,
      amount: 100,
      currency: 'INR',
      status: 'authorized',
    });

    const amountResult = await service.verifyAndSettle(ctx, ORDER_ID, validMetadata());
    expect(amountResult).toMatchObject({ ok: false, errorCode: 'PAYMENT_AMOUNT_MISMATCH' });
    expect(client.capturePayment).not.toHaveBeenCalled();

    vi.mocked(client.fetchPayment).mockResolvedValueOnce({
      id: RAZORPAY_PAYMENT_ID,
      order_id: RAZORPAY_ORDER_ID,
      amount: 129900,
      currency: 'USD',
      status: 'authorized',
    });
    const currencyResult = await service.verifyAndSettle(ctx, ORDER_ID, validMetadata());
    expect(currencyResult).toMatchObject({ ok: false, errorCode: 'PAYMENT_CURRENCY_MISMATCH' });
    expect(client.capturePayment).not.toHaveBeenCalled();
  });

  it('captures an authorized payment only after all pre-capture bindings pass', async () => {
    vi.mocked(client.fetchPayment).mockResolvedValue({
      id: RAZORPAY_PAYMENT_ID,
      order_id: RAZORPAY_ORDER_ID,
      amount: 129900,
      currency: 'INR',
      status: 'authorized',
    });

    const result = await service.verifyAndSettle(ctx, ORDER_ID, validMetadata());

    expect(result).toMatchObject({ ok: true, providerStatus: 'captured' });
    expect(client.capturePayment).toHaveBeenCalledWith(
      'rzp_test_public',
      KEY_SECRET,
      {
        razorpayPaymentId: RAZORPAY_PAYMENT_ID,
        amountMinor: 129900,
        currency: 'INR',
      },
    );
  });

  it('rejects capture response with a different payment ID', async () => {
    vi.mocked(client.fetchPayment).mockResolvedValue({
      id: RAZORPAY_PAYMENT_ID,
      order_id: RAZORPAY_ORDER_ID,
      amount: 129900,
      currency: 'INR',
      status: 'authorized',
    });
    vi.mocked(client.capturePayment).mockResolvedValue({
      id: 'pay_rzp_unexpected',
      order_id: RAZORPAY_ORDER_ID,
      amount: 129900,
      currency: 'INR',
      status: 'captured',
      method: 'upi',
    });

    const result = await service.verifyAndSettle(ctx, ORDER_ID, validMetadata());

    expect(result).toMatchObject({ ok: false, errorCode: 'CAPTURE_PAYMENT_ID_MISMATCH' });
  });

  it('rejects provider states that do not settle even when identifiers and amounts match', async () => {
    vi.mocked(client.fetchPayment).mockResolvedValue({
      id: RAZORPAY_PAYMENT_ID,
      order_id: RAZORPAY_ORDER_ID,
      amount: 129900,
      currency: 'INR',
      status: 'failed',
    });

    const result = await service.verifyAndSettle(ctx, ORDER_ID, validMetadata());

    expect(result).toMatchObject({
      ok: false,
      errorCode: 'provider-status-not-settling',
    });
    expect(client.capturePayment).not.toHaveBeenCalled();
  });
});
