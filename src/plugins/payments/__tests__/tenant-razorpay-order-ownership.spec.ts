import { NotFoundException } from '@nestjs/common';
import type { OrderService, RequestContext, TransactionalConnection } from '@vendure/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TenantPaymentAccountService } from '../services/tenant-payment-account.service';
import type { TenantRazorpayOrdersClient } from '../services/tenant-razorpay-orders.client';
import { TenantRazorpayService } from '../services/tenant-razorpay.service';

const CHANNEL_ID = 'channel-10';
const OWNER_USER_ID = 'user-101';
const OTHER_USER_ID = 'user-202';
const ORDER_ID = 'order-501';

function makeOrder(overrides: Record<string, unknown> = {}) {
  return {
    id: ORDER_ID,
    code: 'ORDER-501',
    state: 'ArrangingPayment',
    totalWithTax: 129900,
    currencyCode: 'INR',
    channels: [{ id: CHANNEL_ID }],
    customer: { user: { id: OWNER_USER_ID } },
    ...overrides,
  };
}

describe('TenantRazorpayService checkout order ownership (G-2)', () => {
  let ctx: RequestContext;
  let orderRepo: { findOne: ReturnType<typeof vi.fn> };
  let connection: Pick<TransactionalConnection, 'getRepository'>;
  let orderService: Pick<OrderService, 'getActiveOrderForUser'>;
  let accountService: Pick<
    TenantPaymentAccountService,
    'findByChannel' | 'getDecryptedCredentials'
  >;
  let client: Pick<TenantRazorpayOrdersClient, 'createOrder'>;
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
    connection = {
      getRepository: vi.fn().mockReturnValue(orderRepo),
    } as unknown as Pick<TransactionalConnection, 'getRepository'>;

    orderService = {
      getActiveOrderForUser: vi.fn().mockResolvedValue({ id: ORDER_ID }),
    } as unknown as Pick<OrderService, 'getActiveOrderForUser'>;

    accountService = {
      findByChannel: vi.fn().mockResolvedValue({
        status: 'active',
        isEnabled: true,
      }),
      getDecryptedCredentials: vi.fn().mockResolvedValue({
        keyId: 'rzp_test_public',
        keySecret: 'never-return-this-secret',
        webhookSecret: null,
        accountMode: 'test',
      }),
    } as unknown as Pick<
      TenantPaymentAccountService,
      'findByChannel' | 'getDecryptedCredentials'
    >;

    client = {
      createOrder: vi.fn().mockResolvedValue({
        id: 'order_rzp_123',
        amount: 129900,
        currency: 'INR',
      }),
    } as unknown as Pick<TenantRazorpayOrdersClient, 'createOrder'>;

    service = new TenantRazorpayService(
      connection as TransactionalConnection,
      orderService as OrderService,
      accountService as TenantPaymentAccountService,
      client as TenantRazorpayOrdersClient,
    );
  });

  it('rejects another customer’s order even when it belongs to the same tenant channel', async () => {
    orderRepo.findOne.mockResolvedValue(
      makeOrder({ customer: { user: { id: OTHER_USER_ID } } }),
    );

    await expect(
      service.createCheckoutOrder(ctx, ORDER_ID),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(accountService.findByChannel).not.toHaveBeenCalled();
    expect(accountService.getDecryptedCredentials).not.toHaveBeenCalled();
    expect(client.createOrder).not.toHaveBeenCalled();
  });

  it('fails closed when the order has no customer user to bind to the caller', async () => {
    orderRepo.findOne.mockResolvedValue(makeOrder({ customer: null }));

    await expect(
      service.createCheckoutOrder(ctx, ORDER_ID),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(client.createOrder).not.toHaveBeenCalled();
  });

  it('fails closed when the order customer has no linked user', async () => {
    orderRepo.findOne.mockResolvedValue(
      makeOrder({ customer: { user: null } }),
    );

    await expect(
      service.createCheckoutOrder(ctx, ORDER_ID),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(client.createOrder).not.toHaveBeenCalled();
  });

  it('requires the candidate order to belong to the active channel as well as the caller', async () => {
    orderRepo.findOne.mockResolvedValue(
      makeOrder({ channels: [{ id: 'channel-elsewhere' }] }),
    );

    await expect(
      service.createCheckoutOrder(ctx, ORDER_ID),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(client.createOrder).not.toHaveBeenCalled();
  });

  it('creates the provider order when the same-channel order belongs to the caller', async () => {
    const result = await service.createCheckoutOrder(ctx, ORDER_ID);

    expect(result).toEqual({
      razorpayOrderId: 'order_rzp_123',
      amountMinor: 129900,
      currency: 'INR',
      keyId: 'rzp_test_public',
    });
    expect(orderRepo.findOne).toHaveBeenLastCalledWith({
      where: { id: ORDER_ID },
      relations: { channels: true, customer: { user: true } },
    });
    expect(accountService.getDecryptedCredentials).toHaveBeenCalledWith(
      ctx,
      CHANNEL_ID,
    );
    expect(client.createOrder).toHaveBeenCalledTimes(1);
  });

  it('resolves the implicit active order for the authenticated user, then verifies ownership again', async () => {
    await service.createCheckoutOrder(ctx);

    expect(orderService.getActiveOrderForUser).toHaveBeenCalledWith(
      ctx,
      OWNER_USER_ID,
    );
    expect(orderRepo.findOne).toHaveBeenLastCalledWith({
      where: { id: ORDER_ID },
      relations: { channels: true, customer: { user: true } },
    });
    expect(client.createOrder).toHaveBeenCalledTimes(1);
  });

  it('does not select an arbitrary ArrangingPayment order when no active order exists for the caller', async () => {
    vi.mocked(orderService.getActiveOrderForUser).mockResolvedValue(undefined as never);

    await expect(
      service.createCheckoutOrder(ctx),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(orderRepo.findOne).not.toHaveBeenCalled();
    expect(client.createOrder).not.toHaveBeenCalled();
  });

  it('fails closed when the service is called without an authenticated user', async () => {
    ctx.activeUserId = undefined;

    await expect(
      service.createCheckoutOrder(ctx, ORDER_ID),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(orderRepo.findOne).not.toHaveBeenCalled();
    expect(orderService.getActiveOrderForUser).not.toHaveBeenCalled();
    expect(accountService.findByChannel).not.toHaveBeenCalled();
    expect(client.createOrder).not.toHaveBeenCalled();
  });
});
