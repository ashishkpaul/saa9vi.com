import { Injectable } from '@nestjs/common';
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
  RequestContext,
  TransactionalConnection,
  UserInputError,
} from '@vendure/core';
import { BbbScheduledSession } from '../../bigbluebutton-plugin/entities/bbb-scheduled-session.entity';
import { TenantPaymentAccount } from '../../payments/entities/tenant-payment-account.entity';
import { TENANT_RAZORPAY_HANDLER_CODE } from '../../payments/constants';
import { CommercialEntitlementService } from '../../../platform/commercial/commercial-entitlement.service';
import { MarketplaceAttributionService } from './marketplace-attribution.service';

export interface MarketplaceCheckoutPaymentMethod {
  code: string;
  name: string;
  description?: string | null;
}

export interface MarketplaceSessionCheckoutResult {
  orderId: string;
  orderCode: string;
  orderState: string;
  tenantChannelId: string;
  tenantChannelToken: string;
  totalWithTax: number;
  currencyCode: string;
  eligiblePaymentMethods: MarketplaceCheckoutPaymentMethod[];
  marketplaceAttributionApplied: boolean;
}

/**
 * Marketplace-hosted checkout for a single publicly listed BBB session.
 *
 * Trust boundaries:
 * - sessionId is the only listing selector accepted from the browser;
 * - the persisted session -> organization -> Channel -> ProductVariant chain
 *   determines the seller and payee;
 * - RequestContext.copy(channel) switches the authenticated Shop request into
 *   that Channel without trusting browser-supplied Channel identifiers;
 * - CustomerService and ActiveOrderService enforce the target-Channel
 *   customer/cart context; the session active-order pointer is updated by
 *   Vendure's ActiveOrderService;
 * - marketplaceRef is optional provenance only and never selects a payee;
 * - only an eligible PaymentMethod whose handler is tenant-razorpay is returned.
 *
 * This intentionally supports only currently listed BbbScheduledSession
 * records with a valid ProductVariant mapping. It is not a generic product
 * checkout endpoint.
 */
@Injectable()
export class MarketplaceCheckoutService {
  constructor(
    private readonly connection: TransactionalConnection,
    private readonly activeOrderService: ActiveOrderService,
    private readonly orderService: OrderService,
    private readonly customerService: CustomerService,
    private readonly channelService: ChannelService,
    private readonly configService: ConfigService,
    private readonly commercialEntitlements: CommercialEntitlementService,
    private readonly attributionService: MarketplaceAttributionService,
  ) {}

  async createSessionCheckout(
    ctx: RequestContext,
    sessionId: string,
    marketplaceRef?: string | null,
  ): Promise<MarketplaceSessionCheckoutResult> {
    if (ctx.apiType !== 'shop' || !ctx.activeUserId) {
      throw new UserInputError('Login to a tenant account before starting marketplace checkout');
    }

    const sessionRepo = this.connection.rawConnection.getRepository(BbbScheduledSession);
    const session = await sessionRepo.findOne({
      where: { id: this.decodeId(sessionId) as any },
      relations: ['organization'],
    });
    if (!session || !session.channelId || !session.productVariantId) {
      throw new UserInputError('This marketplace session is not available for checkout');
    }

    const now = Date.now();
    const endsAt = session.endTime instanceof Date
      ? session.endTime.getTime()
      : new Date(session.endTime).getTime();
    if (
      session.visibility !== 'PUBLIC' ||
      !['SCHEDULED', 'LIVE'].includes(session.status) ||
      !Number.isFinite(endsAt) ||
      endsAt <= now
    ) {
      throw new UserInputError('This marketplace session is no longer purchasable');
    }

    const owningChannelId = String(session.channelId);
    if (!session.organization || String(session.organization.channelId) !== owningChannelId) {
      throw new UserInputError('Marketplace session ownership could not be verified');
    }

    const channelRepo = this.connection.rawConnection.getRepository(Channel);
    const channel = await channelRepo.findOne({
      where: { id: this.decodeId(owningChannelId) as any },
    });
    const defaultChannel = await this.channelService.getDefaultChannel(ctx);
    if (!channel || String(channel.id) === String(defaultChannel.id) || channel.code === defaultChannel.code) {
      throw new UserInputError('Marketplace session does not belong to a tenant Channel');
    }

    // Re-check commercial entitlement at checkout; Elasticsearch may be stale
    // after the tenant's listing eligibility or subscription has changed.
    const commerciallyEligible = await this.commercialEntitlements.channelMarketplaceEligible(
      owningChannelId,
    );
    if (!commerciallyEligible) {
      throw new UserInputError('This academy is not currently eligible for marketplace checkout');
    }

    const variantRepo = this.connection.rawConnection.getRepository(ProductVariant);
    const variant = await variantRepo.findOne({
      where: { id: this.decodeId(session.productVariantId) as any },
      relations: ['channels', 'product'],
    });
    const variantInTenantChannel = (variant?.channels ?? []).some(
      candidate => String(candidate.id) === owningChannelId,
    );
    const linkedSessionId = (variant?.product?.customFields as { bbbSessionId?: string } | undefined)
      ?.bbbSessionId;
    if (
      !variant ||
      !variant.product ||
      variant.product.enabled === false ||
      !variantInTenantChannel ||
      String(variant.id) !== String(this.decodeId(session.productVariantId)) ||
      String(linkedSessionId ?? '') !== String(session.id)
    ) {
      throw new UserInputError('The session product is not assigned to its owning academy');
    }

    // Flow B gateway state is checked before creating or modifying the cart.
    // Only a non-secret account state is read; no credential is returned here.
    const account = await this.connection.rawConnection
      .getRepository(TenantPaymentAccount)
      .findOne({ where: { channelId: owningChannelId, provider: 'razorpay' } });
    if (
      !account ||
      account.status !== 'active' ||
      account.isEnabled !== true ||
      !account.encryptedKeySecret
    ) {
      throw new UserInputError('The academy has not enabled its tenant Razorpay checkout');
    }

    // The Customer must already be a member of the resolved tenant Channel.
    // TenantChannelAssignmentStrategy is not an authorization boundary and
    // checkout deliberately does not auto-create or auto-assign memberships.
    const tenantCtx = ctx.copy(channel);
    const customer = await this.customerService.findOneByUserId(
      tenantCtx,
      ctx.activeUserId,
      true,
    );
    if (!customer) {
      throw new UserInputError(
        'Your account is not registered with this academy. Complete its admission or account-linking process first',
      );
    }

    // Vendure's active-order strategy finds/creates the target-Channel order
    // and binds it to this authenticated session. This is required because
    // later Shop API addPaymentToOrder calls resolve the active order from the
    // session, not from a browser-supplied order ID.
    const activeOrder = await this.activeOrderService.getActiveOrder(
      tenantCtx,
      undefined,
      true,
    );

    const orderRepo = this.connection.getRepository(tenantCtx, Order);
    let order = await orderRepo.findOne({
      where: { id: activeOrder.id },
      relations: {
        channels: true,
        customer: { user: true },
        lines: { productVariant: { channels: true } },
        surcharges: true,
      },
    });
    if (!order) {
      throw new UserInputError('The tenant cart could not be loaded');
    }

    const orderCustomerUserId = order.customer?.user?.id;
    if (
      orderCustomerUserId == null ||
      String(orderCustomerUserId) !== String(ctx.activeUserId)
    ) {
      throw new UserInputError('The active cart does not belong to the authenticated customer');
    }

    // Vendure's OrderService assigns Orders to the default Channel as well as
    // the active tenant Channel. Permit that platform association, but reject
    // any second non-default tenant Channel.
    const nonDefaultOrderChannels = (order.channels ?? []).filter(
      assigned => String(assigned.id) !== String(defaultChannel.id),
    );
    if (
      nonDefaultOrderChannels.length !== 1 ||
      String(nonDefaultOrderChannels[0]?.id) !== owningChannelId
    ) {
      throw new UserInputError('The active cart belongs to a different academy');
    }

    // Defend against legacy or manually-corrupted multi-seller carts. Every
    // existing line must resolve to a variant assigned to this exact Channel.
    for (const line of order.lines ?? []) {
      const lineChannelMatch = (line.productVariant?.channels ?? []).some(
        assigned => String(assigned.id) === owningChannelId,
      );
      if (!lineChannelMatch || !line.productVariant) {
        throw new UserInputError('The active cart contains an item from another academy');
      }
    }

    const alreadyInCart = (order.lines ?? []).some(
      line => String(line.productVariantId) === String(variant.id),
    );
    if (!alreadyInCart) {
      const addResult = await this.orderService.addItemToOrder(
        tenantCtx,
        order.id,
        variant.id,
        1,
      );
      if ((addResult as any)?.errorCode) {
        throw new UserInputError(
          `Unable to add this session to the tenant cart: ${(addResult as any).message ?? (addResult as any).errorCode}`,
        );
      }
    }

    // Re-read after Vendure price/tax calculation. Never use the Elasticsearch
    // priceInPaise field as the checkout amount.
    order = await orderRepo.findOne({
      where: { id: activeOrder.id },
      relations: {
        channels: true,
        customer: { user: true },
        lines: { productVariant: { channels: true } },
        surcharges: true,
      },
    }) ?? order;

    order.customFields = order.customFields ?? {};
    const existingPaymentPurpose = order.customFields.paymentPurpose;
    if (existingPaymentPurpose === 'platform-service') {
      throw new UserInputError('A platform-service cart cannot be used for tenant-client checkout');
    }
    if (existingPaymentPurpose && existingPaymentPurpose !== 'tenant-client') {
      throw new UserInputError('The active cart has an unsupported payment purpose');
    }

    let orderNeedsSave = false;
    if (existingPaymentPurpose !== 'tenant-client') {
      // The Flow A / Flow B distinction is server-set. The browser cannot
      // choose paymentPurpose, and the platform razorpay handler requires
      // 'platform-service' while this marketplace route is tenant-client only.
      order.customFields.paymentPurpose = 'tenant-client';
      orderNeedsSave = true;
    }

    let marketplaceAttributionApplied = false;
    if (marketplaceRef) {
      const verified = this.attributionService.resolveRef(marketplaceRef, owningChannelId);
      if (
        verified &&
        verified.resourceType === 'session' &&
        verified.resourceId === String(session.productVariantId)
      ) {
        order.customFields.marketplaceRef = marketplaceRef;
        orderNeedsSave = true;
        marketplaceAttributionApplied = true;
      }
      // A bad/expired/wrong-resource reference is provenance failure, not a
      // payment failure. The customer may still purchase directly.
    }
    if (orderNeedsSave) {
      await orderRepo.save(order);
    }

    const [quotes, paymentMethods] = await Promise.all([
      this.orderService.getEligiblePaymentMethods(tenantCtx, order.id),
      this.connection.getRepository(tenantCtx, PaymentMethod).find({
        where: { enabled: true },
        relations: ['channels'],
      }),
    ]);

    const tenantRazorpayMethodCodes = new Set(
      paymentMethods
        .filter(method =>
          method.enabled === true &&
          (method.handler as { code?: string } | undefined)?.code === TENANT_RAZORPAY_HANDLER_CODE &&
          (method.channels ?? []).some(assigned => String(assigned.id) === owningChannelId),
        )
        .map(method => String(method.code)),
    );
    const eligiblePaymentMethods = quotes
      .filter(quote => quote.isEligible && tenantRazorpayMethodCodes.has(String(quote.code)))
      .map(quote => ({
        code: String(quote.code),
        name: quote.name,
        description: quote.description ?? null,
      }));

    if (!eligiblePaymentMethods.length) {
      throw new UserInputError(
        'No eligible tenant Razorpay PaymentMethod is assigned to this academy Channel',
      );
    }

    return {
      orderId: String(order.id),
      orderCode: order.code,
      orderState: order.state,
      tenantChannelId: owningChannelId,
      // A public Channel token is only the Shop API routing selector. Every
      // subsequent payment operation still re-validates order/customer/Channel
      // ownership and resolves credentials server-side.
      tenantChannelToken: channel.token,
      totalWithTax: order.totalWithTax,
      currencyCode: order.currencyCode,
      eligiblePaymentMethods,
      marketplaceAttributionApplied,
    };
  }

  private decodeId(id: string): string | number {
    const decoded = this.configService.entityIdStrategy.decodeId(String(id));
    return decoded === -1 ? String(id) : decoded;
  }
}
