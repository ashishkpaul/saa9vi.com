import 'reflect-metadata';
import type {
  JobQueueService,
  OrderService,
  RequestContext,
  RequestContextService,
  TransactionalConnection,
} from '@vendure/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TENANT_RAZORPAY_HANDLER_CODE } from '../constants';
import { TenantPaymentWebhookEvent } from '../entities/tenant-payment-webhook-event.entity';
import { computeCheckoutSignature } from '../razorpay-checkout.policy';
import type { TenantPaymentAccountService } from '../services/tenant-payment-account.service';
import type { TenantRazorpayOrdersClient } from '../services/tenant-razorpay-orders.client';
import { TenantPaymentWebhookQueueService } from '../services/tenant-payment-webhook-queue.service';

const CHANNEL_ID = 'channel-tenant-11';
const CHANNEL_TOKEN = 'tenant-public-token-11';
const ORDER_ID = 'order-tenant-501';
const ORDER_CODE = 'ORDER-TENANT-501';
const PROVIDER_ORDER_ID = 'order_rzp_tenant_501';
const PROVIDER_PAYMENT_ID = 'pay_rzp_tenant_501';
const KEY_SECRET = 'tenant-key-secret';

const channel = { id: CHANNEL_ID, token: CHANNEL_TOKEN } as any;

function makeOrder(overrides: Record<string, unknown> = {}) {
  return {
    id: ORDER_ID,
    code: ORDER_CODE,
    state: 'ArrangingPayment',
    totalWithTax: 129900,
    currencyCode: 'INR',
    channels: [{ id: CHANNEL_ID }],
    customFields: { paymentPurpose: 'tenant-client' },
    ...overrides,
  };
}

function makeEvent(overrides: Record<string, unknown> = {}) {
  return {
    id: 91,
    channels: [channel],
    provider: 'razorpay',
    providerEventId: 'evt_tenant_501',
    dedupeKey: 'dedupe-key-tenant-501',
    eventType: 'payment.captured',
    payloadHash: 'a'.repeat(64),
    rawPayload: {
      entity: 'event',
      event: 'payment.captured',
      payload: {
        payment: {
          entity: {
            id: PROVIDER_PAYMENT_ID,
            order_id: PROVIDER_ORDER_ID,
          },
        },
      },
    },
    verifiedAt: new Date(),
    processingStatus: 'pending',
    attemptCount: 0,
    processedAt: null,
    failedAt: null,
    errorMessage: null,
    vendureOrderCode: ORDER_CODE,
    ...overrides,
  };
}

describe('TenantPaymentWebhookQueueService (G-3 recovery)', () => {
  let ctx: RequestContext;
  let event: ReturnType<typeof makeEvent>;
  let rawEventRepo: { findOne: ReturnType<typeof vi.fn> };
  let eventRepo: { findOne: ReturnType<typeof vi.fn>; save: ReturnType<typeof vi.fn> };
  let orderRepo: { findOne: ReturnType<typeof vi.fn> };
  let paymentRepo: { findOne: ReturnType<typeof vi.fn> };
  let connection: Pick<TransactionalConnection, 'getRepository' | 'rawConnection'>;
  let requestContextService: Pick<RequestContextService, 'create'>;
  let orderService: Pick<OrderService, 'addPaymentToOrder'>;
  let accountService: Pick<TenantPaymentAccountService, 'getWebhookSettlementCredentials'>;
  let client: Pick<TenantRazorpayOrdersClient, 'fetchOrder' | 'fetchPayment'>;
  let service: TenantPaymentWebhookQueueService;

  beforeEach(() => {
    ctx = {
      channelId: CHANNEL_ID,
      apiType: 'admin',
    } as RequestContext;

    event = makeEvent();
    rawEventRepo = {
      findOne: vi.fn().mockResolvedValue(event),
    };
    eventRepo = {
      findOne: vi.fn().mockResolvedValue(event),
      save: vi.fn().mockImplementation(async (value) => value),
    };
    orderRepo = {
      findOne: vi.fn().mockResolvedValue(makeOrder()),
    };
    paymentRepo = {
      findOne: vi.fn().mockResolvedValue(null),
    };
    connection = {
      getRepository: vi.fn((_ctx: RequestContext, entity: unknown) =>
        entity === 'Order' ? orderRepo : eventRepo,
      ),
      rawConnection: {
        getRepository: vi.fn((entity: unknown) =>
          entity === TenantPaymentWebhookEvent ? rawEventRepo : paymentRepo,
        ),
      },
    } as unknown as Pick<TransactionalConnection, 'getRepository' | 'rawConnection'>;

    requestContextService = {
      create: vi.fn().mockResolvedValue(ctx),
    } as unknown as Pick<RequestContextService, 'create'>;

    orderService = {
      addPaymentToOrder: vi.fn().mockImplementation(async (_ctx, _orderId, input) => ({
        ...makeOrder(),
        state: 'PaymentSettled',
        receivedPaymentMethod: input.method,
      })),
    } as unknown as Pick<OrderService, 'addPaymentToOrder'>;

    accountService = {
      getWebhookSettlementCredentials: vi.fn().mockResolvedValue({
        keyId: 'rzp_tenant_public',
        keySecret: KEY_SECRET,
      }),
    } as unknown as Pick<TenantPaymentAccountService, 'getWebhookSettlementCredentials'>;

    client = {
      fetchOrder: vi.fn().mockResolvedValue({
        id: PROVIDER_ORDER_ID,
        amount: 129900,
        currency: 'INR',
        receipt: ORDER_CODE,
        status: 'paid',
        notes: { vendureOrderCode: ORDER_CODE },
      }),
      fetchPayment: vi.fn().mockResolvedValue({
        id: PROVIDER_PAYMENT_ID,
        order_id: PROVIDER_ORDER_ID,
        amount: 129900,
        currency: 'INR',
        status: 'captured',
        method: 'upi',
      }),
    } as unknown as Pick<TenantRazorpayOrdersClient, 'fetchOrder' | 'fetchPayment'>;

    service = new TenantPaymentWebhookQueueService(
      {} as JobQueueService,
      connection as TransactionalConnection,
      requestContextService as RequestContextService,
      orderService as OrderService,
      accountService as TenantPaymentAccountService,
      client as TenantRazorpayOrdersClient,
    );
  });

  it('re-reads Razorpay truth and settles the owning tenant order through its handler', async () => {
    await service.processWebhookEvent(91);

    expect(requestContextService.create).toHaveBeenCalledWith({
      apiType: 'admin',
      channelOrToken: CHANNEL_TOKEN,
    });
    expect(accountService.getWebhookSettlementCredentials).toHaveBeenCalledWith(
      ctx,
      CHANNEL_ID,
    );
    expect(client.fetchOrder).toHaveBeenCalledWith(
      'rzp_tenant_public',
      KEY_SECRET,
      PROVIDER_ORDER_ID,
    );
    expect(client.fetchPayment).toHaveBeenCalledWith(
      'rzp_tenant_public',
      KEY_SECRET,
      PROVIDER_PAYMENT_ID,
    );

    const paymentInput = vi.mocked(orderService.addPaymentToOrder).mock.calls[0][2];
    expect(orderService.addPaymentToOrder).toHaveBeenCalledWith(
      ctx,
      ORDER_ID,
      expect.objectContaining({
        method: TENANT_RAZORPAY_HANDLER_CODE,
        metadata: expect.objectContaining({
          razorpay_order_id: PROVIDER_ORDER_ID,
          razorpay_payment_id: PROVIDER_PAYMENT_ID,
          razorpay_signature: computeCheckoutSignature(
            PROVIDER_ORDER_ID,
            PROVIDER_PAYMENT_ID,
            KEY_SECRET,
          ),
        }),
      }),
    );
    expect(paymentInput.method).toBe(TENANT_RAZORPAY_HANDLER_CODE);
    expect(event.processingStatus).toBe('processed');
    expect(event.processedAt).toBeInstanceOf(Date);
    expect(eventRepo.save).toHaveBeenCalled();
  });

  it('records non-settlement event types but never calls Razorpay or creates a Payment', async () => {
    event.eventType = 'payment.failed';

    await service.processWebhookEvent(91);

    expect(event.processingStatus).toBe('ignored');
    expect(accountService.getWebhookSettlementCredentials).not.toHaveBeenCalled();
    expect(client.fetchOrder).not.toHaveBeenCalled();
    expect(orderService.addPaymentToOrder).not.toHaveBeenCalled();
  });

  it('treats a payment already recorded against the same order as a harmless replay', async () => {
    paymentRepo.findOne.mockResolvedValue({
      id: 'vendure-payment-1',
      order: { id: ORDER_ID },
    });

    await service.processWebhookEvent(91);

    expect(event.processingStatus).toBe('ignored');
    expect(orderService.addPaymentToOrder).not.toHaveBeenCalled();
  });

  it('does not attach a provider payment already recorded against another order', async () => {
    paymentRepo.findOne.mockResolvedValue({
      id: 'vendure-payment-elsewhere',
      order: { id: 'order-foreign' },
    });

    await service.processWebhookEvent(91);

    expect(event.processingStatus).toBe('ignored');
    expect(orderService.addPaymentToOrder).not.toHaveBeenCalled();
  });

  it('ignores a captured payment when the order is no longer payable and has no matching Payment', async () => {
    orderRepo.findOne.mockResolvedValue(makeOrder({ state: 'PaymentSettled' }));

    await service.processWebhookEvent(91);

    expect(event.processingStatus).toBe('ignored');
    expect(orderService.addPaymentToOrder).not.toHaveBeenCalled();
  });

  it('rejects provider amount/currency/status mismatches and leaves the event retryable', async () => {
    vi.mocked(client.fetchPayment).mockResolvedValue({
      id: PROVIDER_PAYMENT_ID,
      order_id: PROVIDER_ORDER_ID,
      amount: 100,
      currency: 'INR',
      status: 'captured',
    });

    await expect(service.processWebhookEvent(91)).rejects.toThrow(
      'Tenant Razorpay payment failed provider binding',
    );

    expect(event.processingStatus).toBe('pending');
    expect(event.attemptCount).toBe(1);
    expect(event.errorMessage).toContain('amount-mismatch');
    expect(orderService.addPaymentToOrder).not.toHaveBeenCalled();
  });

  it('marks an event failed only after the bounded third failed attempt', async () => {
    vi.mocked(client.fetchOrder).mockRejectedValue(new Error('provider timeout'));

    await expect(service.processWebhookEvent(91)).rejects.toThrow('provider timeout');
    expect(event.processingStatus).toBe('pending');
    expect(event.attemptCount).toBe(1);

    await expect(service.processWebhookEvent(91)).rejects.toThrow('provider timeout');
    expect(event.processingStatus).toBe('pending');
    expect(event.attemptCount).toBe(2);

    await expect(service.processWebhookEvent(91)).rejects.toThrow('provider timeout');
    expect(event.processingStatus).toBe('failed');
    expect(event.attemptCount).toBe(3);
    expect(event.failedAt).toBeInstanceOf(Date);
  });

  it('does not load a webhook event that is not present in the durable inbox', async () => {
    rawEventRepo.findOne.mockResolvedValue(null);

    await service.processWebhookEvent(91);

    expect(requestContextService.create).not.toHaveBeenCalled();
    expect(orderService.addPaymentToOrder).not.toHaveBeenCalled();
  });
});
