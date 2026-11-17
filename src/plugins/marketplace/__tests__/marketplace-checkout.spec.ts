import 'reflect-metadata';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ActiveOrderService,
  Channel,
  ChannelService,
  ConfigService,
  CustomerService,
  Order,
  OrderService,
  PaymentMethod,
  ProductVariant,
  TransactionalConnection,
} from '@vendure/core';
import { BbbScheduledSession } from '../../bigbluebutton-plugin/entities/bbb-scheduled-session.entity';
import { TenantPaymentAccount } from '../../payments/entities/tenant-payment-account.entity';
import { CommercialEntitlementService } from '../../../platform/commercial/commercial-entitlement.service';
import { MarketplaceAttributionService } from '../services/marketplace-attribution.service';
import { MarketplaceCheckoutService } from '../services/marketplace-checkout.service';

const tenantChannel = {
  id: 'channel-tenant-a',
  token: 'public-tenant-a-token',
  code: 'tenant-a',
  defaultLanguageCode: 'en',
  defaultCurrencyCode: 'INR',
} as any;
const defaultChannel = {
  id: 'channel-default',
  token: '__default_channel__',
  code: '__default_channel__',
} as any;
const sessionId = 'session-a-1';
const variantId = 'variant-a-1';
const userId = 'customer-user-a';
const ref = 'signed-marketplace-ref';

describe('MarketplaceCheckoutService', () => {
  let service: MarketplaceCheckoutService;
  let ctx: any;
  let sessionRepo: { findOne: ReturnType<typeof vi.fn> };
  let channelRepo: { findOne: ReturnType<typeof vi.fn> };
  let variantRepo: { findOne: ReturnType<typeof vi.fn> };
  let accountRepo: { findOne: ReturnType<typeof vi.fn> };
  let orderRepo: { findOne: ReturnType<typeof vi.fn>; save: ReturnType<typeof vi.fn> };
  let paymentMethodRepo: { find: ReturnType<typeof vi.fn> };
  let activeOrderService: Pick<ActiveOrderService, 'getActiveOrder'>;
  let orderService: Pick<OrderService, 'addItemToOrder' | 'getEligiblePaymentMethods'>;
  let customerService: Pick<CustomerService, 'findOneByUserId'>;
  let channelService: Pick<ChannelService, 'getDefaultChannel'>;
  let configService: Pick<ConfigService, 'entityIdStrategy'>;
  let commercialEntitlements: Pick<CommercialEntitlementService, 'channelMarketplaceEligible'>;
  let attributionService: Pick<MarketplaceAttributionService, 'resolveRef'>;
  let order: any;
  let variant: any;
  let session: any;
  let rawRepositories: Map<unknown, unknown>;

  beforeEach(() => {
    session = {
      id: sessionId,
      channelId: tenantChannel.id,
      organization: { channelId: tenantChannel.id },
      productVariantId: variantId,
      title: 'Tenant A live class',
      visibility: 'PUBLIC',
      status: 'SCHEDULED',
      startTime: new Date(Date.now() + 60_000),
      endTime: new Date(Date.now() + 60 * 60_000),
    };
    variant = {
      id: variantId,
      channels: [defaultChannel, tenantChannel],
      product: {
        enabled: true,
        channels: [defaultChannel, tenantChannel],
        customFields: { bbbSessionId: sessionId },
      },
    };
    order = {
      id: 'order-a-1',
      code: 'ORDER-A-1',
      state: 'AddingItems',
      totalWithTax: 12500,
      currencyCode: 'INR',
      channels: [defaultChannel, tenantChannel],
      customer: { id: 'customer-a', user: { id: userId } },
      lines: [],
      surcharges: [],
      customFields: {},
    };

    sessionRepo = { findOne: vi.fn().mockResolvedValue(session) };
    channelRepo = { findOne: vi.fn().mockResolvedValue(tenantChannel) };
    variantRepo = { findOne: vi.fn().mockResolvedValue(variant) };
    accountRepo = {
      findOne: vi.fn().mockResolvedValue({
        channelId: tenantChannel.id,
        provider: 'razorpay',
        status: 'active',
        isEnabled: true,
        encryptedKeySecret: 'encrypted-secret',
      }),
    };
    orderRepo = {
      findOne: vi.fn().mockImplementation(async () => order),
      save: vi.fn().mockImplementation(async value => value),
    };
    paymentMethodRepo = {
      find: vi.fn().mockResolvedValue([
        {
          code: 'tenant-a-razorpay',
          enabled: true,
          handler: { code: 'tenant-razorpay' },
          channels: [defaultChannel, tenantChannel],
        },
        {
          code: 'platform-razorpay',
          enabled: true,
          handler: { code: 'razorpay' },
          channels: [defaultChannel, tenantChannel],
        },
      ]),
    };
    rawRepositories = new Map([
      [BbbScheduledSession, sessionRepo],
      [Channel, channelRepo],
      [ProductVariant, variantRepo],
      [TenantPaymentAccount, accountRepo],
    ]);

    const connection = {
      rawConnection: {
        getRepository: vi.fn((entity: unknown) => rawRepositories.get(entity)),
      },
      getRepository: vi.fn((_ctx: unknown, entity: unknown) =>
        entity === Order ? orderRepo : paymentMethodRepo,
      ),
    } as unknown as TransactionalConnection;

    ctx = {
      apiType: 'shop',
      activeUserId: userId,
      channelId: 'marketplace-channel',
      channel: { id: 'marketplace-channel', token: 'marketplace-token' },
      copy: vi.fn((channel: any) => ({
        ...ctx,
        channel,
        channelId: channel.id,
      })),
    };

    activeOrderService = {
      getActiveOrder: vi.fn().mockResolvedValue(order),
    } as unknown as Pick<ActiveOrderService, 'getActiveOrder'>;
    orderService = {
      addItemToOrder: vi.fn().mockImplementation(async () => {
        order.lines.push({
          id: 'line-a-1',
          productVariantId: variantId,
          productVariant: variant,
          quantity: 1,
        });
        return order;
      }),
      getEligiblePaymentMethods: vi.fn().mockResolvedValue([
        {
          code: 'tenant-a-razorpay',
          name: 'Tenant Razorpay',
          description: 'Pay the academy directly',
          isEligible: true,
        },
        {
          code: 'platform-razorpay',
          name: 'Platform Razorpay',
          isEligible: true,
        },
      ]),
    };
    customerService = {
      findOneByUserId: vi.fn().mockResolvedValue({ id: 'customer-a' }),
    } as unknown as Pick<CustomerService, 'findOneByUserId'>;
    channelService = {
      getDefaultChannel: vi.fn().mockResolvedValue(defaultChannel),
    };
    configService = {
      entityIdStrategy: {
        decodeId: vi.fn((id: string) => id),
      },
    } as unknown as Pick<ConfigService, 'entityIdStrategy'>;
    commercialEntitlements = {
      channelMarketplaceEligible: vi.fn().mockResolvedValue(true),
    };
    attributionService = {
      resolveRef: vi.fn().mockReturnValue({
        resourceType: 'session',
        resourceId: variantId,
        channelId: tenantChannel.id,
        issuedAt: Date.now(),
        expiresAt: Date.now() + 60_000,
        nonce: 'nonce-a',
      }),
    } as unknown as Pick<MarketplaceAttributionService, 'resolveRef'>;

    service = new MarketplaceCheckoutService(
      connection,
      activeOrderService as ActiveOrderService,
      orderService as OrderService,
      customerService as CustomerService,
      channelService as ChannelService,
      configService as ConfigService,
      commercialEntitlements as CommercialEntitlementService,
      attributionService as MarketplaceAttributionService,
    );
  });

  it('derives the tenant from the persisted session and returns only the eligible tenant Razorpay method', async () => {
    const result = await service.createSessionCheckout(ctx, sessionId, ref);
    const tenantCtx = vi.mocked(ctx.copy).mock.results[0].value;

    expect(ctx.copy).toHaveBeenCalledWith(tenantChannel);
    expect(customerService.findOneByUserId).toHaveBeenCalledWith(tenantCtx, userId, true);
    expect(activeOrderService.getActiveOrder).toHaveBeenCalledWith(tenantCtx, undefined, true);
    expect(orderService.addItemToOrder).toHaveBeenCalledWith(
      tenantCtx,
      order.id,
      variant.id,
      1,
    );
    expect(attributionService.resolveRef).toHaveBeenCalledWith(ref, tenantChannel.id);
    expect(orderRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        customFields: { paymentPurpose: 'tenant-client', marketplaceRef: ref },
      }),
    );
    expect(result).toMatchObject({
      orderId: order.id,
      orderCode: order.code,
      tenantChannelId: tenantChannel.id,
      tenantChannelToken: tenantChannel.token,
      totalWithTax: order.totalWithTax,
      currencyCode: 'INR',
      marketplaceAttributionApplied: true,
      eligiblePaymentMethods: [
        {
          code: 'tenant-a-razorpay',
          name: 'Tenant Razorpay',
          description: 'Pay the academy directly',
        },
      ],
    });
    expect(result.eligiblePaymentMethods.some(method => method.code === 'platform-razorpay')).toBe(false);
  });

  it('rejects guests and does not look up any listing or payment data', async () => {
    ctx.activeUserId = undefined;

    await expect(service.createSessionCheckout(ctx, sessionId)).rejects.toThrow(/Login/);
    expect(sessionRepo.findOne).not.toHaveBeenCalled();
    expect(activeOrderService.getActiveOrder).not.toHaveBeenCalled();
  });

  it('fails closed when the authenticated customer has no target-Channel Customer association', async () => {
    vi.mocked(customerService.findOneByUserId).mockResolvedValue(undefined);

    await expect(service.createSessionCheckout(ctx, sessionId)).rejects.toThrow(/not registered with this academy/);
    expect(activeOrderService.getActiveOrder).not.toHaveBeenCalled();
  });

  it('rejects sessions that are private, cancelled, finished or expired', async () => {
    session.visibility = 'PRIVATE';

    await expect(service.createSessionCheckout(ctx, sessionId)).rejects.toThrow(/no longer purchasable/);
    expect(activeOrderService.getActiveOrder).not.toHaveBeenCalled();
  });

  it('rejects a variant that is not assigned to the persisted owning Channel', async () => {
    variant.channels = [defaultChannel];

    await expect(service.createSessionCheckout(ctx, sessionId)).rejects.toThrow(/not assigned to its owning academy/);
    expect(activeOrderService.getActiveOrder).not.toHaveBeenCalled();
  });

  it('rejects a product that is not assigned to the persisted owning Channel', async () => {
    variant.product.channels = [defaultChannel];

    await expect(service.createSessionCheckout(ctx, sessionId)).rejects.toThrow(/not assigned to its owning academy/);
    expect(activeOrderService.getActiveOrder).not.toHaveBeenCalled();
  });

  it('rejects a platform-service cart before adding the marketplace product', async () => {
    order.customFields.paymentPurpose = 'platform-service';

    await expect(service.createSessionCheckout(ctx, sessionId)).rejects.toThrow(/platform-service cart/);
    expect(orderService.addItemToOrder).not.toHaveBeenCalled();
    expect(orderRepo.save).not.toHaveBeenCalled();
  });

  it('re-checks marketplace commercial eligibility at checkout time', async () => {
    vi.mocked(commercialEntitlements.channelMarketplaceEligible).mockResolvedValue(false);

    await expect(service.createSessionCheckout(ctx, sessionId)).rejects.toThrow(/not currently eligible/);
    expect(activeOrderService.getActiveOrder).not.toHaveBeenCalled();
  });

  it('rejects a variant shared across two non-default tenant Channels', async () => {
    variant.channels = [
      defaultChannel,
      tenantChannel,
      { id: 'channel-tenant-b', code: 'tenant-b' },
    ];

    await expect(service.createSessionCheckout(ctx, sessionId)).rejects.toThrow(/not assigned to its owning academy/);
    expect(activeOrderService.getActiveOrder).not.toHaveBeenCalled();
  });

  it('rejects a cart that contains another tenant Channel', async () => {
    const foreignChannel = { id: 'channel-tenant-b', code: 'tenant-b' };
    order.channels = [defaultChannel, tenantChannel, foreignChannel];

    await expect(service.createSessionCheckout(ctx, sessionId)).rejects.toThrow(/different academy/);
    expect(orderService.addItemToOrder).not.toHaveBeenCalled();
  });

  it('rejects checkout when the tenant Razorpay account is disabled', async () => {
    accountRepo.findOne.mockResolvedValue({
      channelId: tenantChannel.id,
      provider: 'razorpay',
      status: 'active',
      isEnabled: false,
      encryptedKeySecret: 'encrypted-secret',
    });

    await expect(service.createSessionCheckout(ctx, sessionId)).rejects.toThrow(/has not enabled/);
    expect(activeOrderService.getActiveOrder).not.toHaveBeenCalled();
  });

  it('does not apply an invalid or wrong-channel attribution reference, but allows direct checkout', async () => {
    vi.mocked(attributionService.resolveRef).mockReturnValue(null);

    const result = await service.createSessionCheckout(ctx, sessionId, 'invalid-ref');

    expect(result.marketplaceAttributionApplied).toBe(false);
    expect(orderRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        customFields: { paymentPurpose: 'tenant-client' },
      }),
    );
    expect(orderRepo.save.mock.calls[0][0].customFields.marketplaceRef).toBeUndefined();
    expect(result.eligiblePaymentMethods.map(method => method.code)).toEqual(['tenant-a-razorpay']);
  });

  it('does not increment the session line when the same session is already in the tenant cart', async () => {
    order.lines = [
      {
        id: 'line-existing',
        productVariantId: variantId,
        productVariant: variant,
        quantity: 1,
      },
    ];

    const result = await service.createSessionCheckout(ctx, sessionId);

    expect(orderService.addItemToOrder).not.toHaveBeenCalled();
    expect(result.totalWithTax).toBe(order.totalWithTax);
  });

  it('fails closed if only the platform Razorpay handler is eligible', async () => {
    vi.mocked(orderService.getEligiblePaymentMethods).mockResolvedValue([
      {
        code: 'platform-razorpay',
        name: 'Platform Razorpay',
        isEligible: true,
      },
    ] as any);

    paymentMethodRepo.find.mockResolvedValue([
      {
        code: 'platform-razorpay',
        enabled: true,
        handler: { code: 'razorpay' },
        channels: [defaultChannel, tenantChannel],
      },
    ]);

    await expect(service.createSessionCheckout(ctx, sessionId)).rejects.toThrow(/No eligible tenant Razorpay/);
  });
});
