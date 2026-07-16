import { Injectable, Logger } from '@nestjs/common';
import {
  AdministratorService,
  Channel,
  ChannelService,
  ID,
  RequestContext,
  RequestContextService,
  RoleService,
  SellerService,
  TransactionalConnection,
  User,
  UserInputError,
} from '@vendure/core';
import { TenantRegistrationLog } from '../entities/tenant-registration-log.entity';
import { TenantProfileService } from './tenant-profile.service';
import { TENANT_ADMIN_ROLE_PERMISSIONS } from '../constants';

const loggerCtx = 'TenantRegistrationService';

export interface RegisterTenantInput {
  businessName: string;
  firstName: string;
  lastName: string;
  emailAddress: string;
  password: string;
  contactEmail?: string;
  timezone?: string;
}

export interface RegisterTenantResult {
  channelId: ID;
  channelToken: string;
  administratorId: ID;
}

/**
 * Orchestrates self-serve tenant/seller registration, callable from the Shop
 * API (see TenantShopResolver.registerNewTenant).
 *
 * Follows the pattern from Vendure's own multi-vendor marketplace guide
 * (https://docs.vendure.io/guides/how-to/multi-vendor-marketplaces/), adapted
 * to this platform's channel-per-tenant / Shopify-Kajabi model (DL-019 — NOT
 * the order-splitting multivendor-plugin model):
 *
 *   1. Seller        — the vendor/tenant record
 *   2. Channel        — the tenant's isolated storefront, linked to the Seller
 *   3. Role           — channel-scoped admin role (never SuperAdmin)
 *   4. Administrator  — the tenant's own dashboard login
 *   5. TenantProfile  — this plugin's own profile row for the new channel
 *
 * INV-004-style persist-first: the request is logged as PENDING before any
 * entity is created, mirroring CustomerDeletionService / BbbWebhookEvent, so
 * a crash mid-orchestration is auditable and recoverable rather than silently
 * losing the request.
 *
 * CAUTION — not yet safe to expose publicly:
 *   - No rate limiting. SEC-004 (rate limiting on public mutations) is listed
 *     in platform-adr.md as an outstanding Phase-1 blocker specifically
 *     because of endpoints like this one. Without it, an unauthenticated
 *     caller can mint unlimited Channels, Sellers and Administrators.
 *   - No email verification. Vendure's own multivendor-plugin guide flags
 *     this same gap in its example ("leaves out ... email verification").
 *     The Administrator is usable immediately on the password supplied in
 *     the mutation; consider gating activation behind a verify step before
 *     shipping this to production, the same way registerCustomerAccount /
 *     verifyCustomerAccount works on the Shop API today.
 */
@Injectable()
export class TenantRegistrationService {
  constructor(
    private readonly connection: TransactionalConnection,
    private readonly channelService: ChannelService,
    private readonly sellerService: SellerService,
    private readonly roleService: RoleService,
    private readonly administratorService: AdministratorService,
    private readonly requestContextService: RequestContextService,
    private readonly tenantProfileService: TenantProfileService,
  ) {}

  async registerTenant(
    ctx: RequestContext,
    input: RegisterTenantInput,
  ): Promise<RegisterTenantResult> {
    const businessName = input.businessName.trim();
    if (!businessName) {
      throw new UserInputError('businessName is required');
    }

    const log = await this.createLog(input.businessName, input.emailAddress);

    try {
      await this.assertEmailNotTaken(ctx, input.emailAddress);

      // 1. Seller — the vendor record. Also what any future Phase-3
      //    marketplace order-split (should DL-019 ever be revisited) or
      //    Stream-3 advertising wallet would key off.
      const seller = await this.sellerService.create(ctx, {
        name: businessName,
      });

      // 2. Channel — the tenant's isolated storefront. Reuses the default
      //    channel's tax/shipping zone and currency as sane defaults; the
      //    tenant can change these later via updateChannel on the Admin API
      //    once they're logged in.
      const { code, token } = this.generateChannelCodeAndToken(businessName);
      const defaultChannel = await this.connection.getRepository(ctx, Channel).findOneOrFail({
        where: { id: (await this.channelService.getDefaultChannel(ctx)).id },
        relations: ['defaultTaxZone', 'defaultShippingZone'],
      });

      if (!defaultChannel.defaultTaxZone || !defaultChannel.defaultShippingZone) {
        // Fails loudly rather than creating a Channel that can never sell
        // anything — checkout requires both zones to be resolvable.
        throw new Error(
          'Default channel has no defaultTaxZone/defaultShippingZone configured; cannot provision a new tenant Channel',
        );
      }

      const channelResult = await this.channelService.create(ctx, {
        code,
        token,
        sellerId: seller.id,
        defaultLanguageCode: defaultChannel.defaultLanguageCode,
        pricesIncludeTax: defaultChannel.pricesIncludeTax,
        currencyCode: defaultChannel.defaultCurrencyCode,
        defaultCurrencyCode: defaultChannel.defaultCurrencyCode,
        defaultTaxZoneId: defaultChannel.defaultTaxZone.id,
        defaultShippingZoneId: defaultChannel.defaultShippingZone.id,
      });

      if (!('id' in channelResult)) {
        // The only ErrorResult createChannel can return today is
        // LanguageNotAvailableError; surfacing .message is enough for the
        // storefront to show a useful validation error.
        throw new UserInputError(channelResult.message);
      }
      const channel = channelResult;

      // From here on, operate with a RequestContext scoped to the NEW
      // channel. This matters: TenantProfileService.create() calls
      // channelService.assignToCurrentChannel(profile, ctx), which reads
      // ctx.channelId — not an explicit channelId argument — so without
      // this, the TenantProfile would silently be assigned to whatever
      // channel the public Shop API request context defaults to, not the
      // tenant's own new channel.
      const tenantCtx = await this.requestContextService.create({
        apiType: 'admin',
        channelOrToken: channel.token,
        languageCode: channel.defaultLanguageCode,
      });

      // 3. Role — channel-scoped, restricted to this one Channel. Never
      //    SuperAdmin — matches the Phase-3 ADR note: "Use Seller-scoped
      //    admin roles for per-academy dashboard access — no custom RBAC
      //    needed."
      const role = await this.roleService.create(tenantCtx, {
        code: `${code}-admin`,
        description: `Tenant administrator for ${businessName}`,
        permissions: TENANT_ADMIN_ROLE_PERMISSIONS,
        channelIds: [channel.id],
      });

      // 4. Administrator — the tenant's own dashboard login.
      const administrator = await this.administratorService.create(tenantCtx, {
        firstName: input.firstName,
        lastName: input.lastName,
        emailAddress: input.emailAddress,
        password: input.password,
        roleIds: [role.id],
      });

      // 5. TenantProfile — this plugin's existing profile row, created with
      //    tenantCtx (see note above) so it lands on the correct Channel.
      await this.tenantProfileService.create(tenantCtx, {
        channelId: channel.id as string,
        businessName,
        contactEmail: input.contactEmail ?? input.emailAddress,
        timezone: input.timezone ?? 'Asia/Kolkata',
      });

      await this.completeLog(log.id, channel);

      Logger.log(
        `Tenant registered: "${businessName}" -> channel ${channel.token} (admin ${administrator.emailAddress})`,
        loggerCtx,
      );

      return {
        channelId: channel.id,
        channelToken: channel.token,
        administratorId: administrator.id,
      };
    } catch (err: any) {
      await this.failLog(log.id, err.message);
      throw err;
    }
  }

  private async assertEmailNotTaken(ctx: RequestContext, emailAddress: string): Promise<void> {
    const existing = await this.connection
      .getRepository(ctx, User)
      .findOne({ where: { identifier: emailAddress } });
    if (existing) {
      // Deliberately generic — don't confirm/deny account existence for a
      // specific email beyond what's needed to unblock the registrant.
      throw new UserInputError('An account with these details could not be created');
    }
  }

  private generateChannelCodeAndToken(businessName: string): { code: string; token: string } {
    const base =
      businessName
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)/g, '')
        .slice(0, 40) || 'academy';
    const suffix = Math.random().toString(36).slice(2, 8);
    return {
      code: `${base}-${suffix}`,
      token: `tok_${base}_${suffix}`,
    };
  }

  // ─── Log helpers (INV-004 persist-first pattern) ──────────────────────────

  private async createLog(
    businessName: string,
    emailAddress: string,
  ): Promise<TenantRegistrationLog> {
    return this.connection.getRepository(TenantRegistrationLog).save(
      new TenantRegistrationLog({
        businessName,
        emailAddress,
        requestedAt: new Date(),
        status: 'PENDING',
      }),
    );
  }

  private async completeLog(logId: ID, channel: Channel): Promise<void> {
    await this.connection.getRepository(TenantRegistrationLog).update(logId, {
      status: 'COMPLETED',
      processedAt: new Date(),
      channelId: String(channel.id),
      channelToken: channel.token,
    });
  }

  private async failLog(logId: ID, errorMessage: string): Promise<void> {
    await this.connection.getRepository(TenantRegistrationLog).update(logId, {
      status: 'FAILED',
      processedAt: new Date(),
      errorMessage,
    });
  }
}
