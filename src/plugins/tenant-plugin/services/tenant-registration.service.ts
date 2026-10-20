import { Injectable, Logger } from '@nestjs/common';
import {
  AccountRegistrationEvent,
  Administrator,
  AdministratorService,
  Channel,
  ChannelService,
  ConfigService,
  EventBus,
  ID,
  PaymentMethodService,
  RequestContext,
  RequestContextService,
  Role,
  RoleService,
  SellerService,
  ShippingMethodService,
  StockLocationService,
  TransactionalConnection,
  User,
  UserInputError,
  UserService,
  Zone,
} from '@vendure/core';
import { Repository } from 'typeorm';
import { TenantRegistrationLog } from '../entities/tenant-registration-log.entity';
import { TenantProfileService } from './tenant-profile.service';
import { TENANT_ADMIN_ROLE_PERMISSIONS } from '../constants';
import { RAZORPAY_HANDLER_CODE } from '../../payments/constants';

const loggerCtx = 'TenantRegistrationService';

/** Vendure's built-in customer role code — grants the Authenticated permission. */
const CUSTOMER_ROLE_CODE = '__customer_role__';

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
 * CAUTION — public-exposure readiness (corrected 2026-09-15 to match current code;
 * the original "no rate limiting / no email verification" claims are stale):
 *
 *   RESOLVED — Rate limiting: `rate-limiter.middleware.ts` applies
 *     `shopApiRateLimiter` to `registerNewTenant` (5/hour per IP) per
 *     SEC-003 (see docs/architecture/security.md).
 *
 *   RESOLVED — Email verification (Phase 1.5): the Administrator user is
 *     created UNVERIFIED with a verification token set, and
 *     AccountRegistrationEvent is published so the EmailPlugin sends the
 *     verification email; the admin cannot log in until the link is clicked
 *     (mirrors registerCustomerAccount / verifyCustomerAccount on the Shop API).
 *
 *   REMAINING — see docs/implementation/integration-gaps-worklist.md before
 *     treating self-serve onboarding as production-complete:
 *     - Storefront reachability: registration creates the Channel and
 *       TenantProfile, and TenantProfileService.create() seeds
 *       {tenantSlug}.{TENANT_PLATFORM_DOMAIN} → Channel.token through
 *       DomainChannelResolverService, so the platform hostname resolves from
 *       day one (B-2 IMPLEMENTED 2026-09-15, G2 acceptance passed). The
 *       authoritative hostname-contract record (B-1) remains open.
 *     - Production custom-domain routing via Caddy/TLS remains open (B-5/G10;
 *       roadmap "Tenant storefront onboarding" + "Custom domain routing" items).
 */
@Injectable()
export class TenantRegistrationService {
  constructor(
    private readonly connection: TransactionalConnection,
    private readonly channelService: ChannelService,
    private readonly sellerService: SellerService,
    private readonly roleService: RoleService,
    private readonly administratorService: AdministratorService,
    private readonly tenantProfileService: TenantProfileService,
    private readonly configService: ConfigService,
    private readonly requestContextService: RequestContextService,
    private readonly shippingMethodService: ShippingMethodService,
    private readonly paymentMethodService: PaymentMethodService,
    private readonly stockLocationService: StockLocationService,
    private readonly userService: UserService,
    private readonly eventBus: EventBus,
  ) {}

  async registerTenant(
    ctx: RequestContext,
    input: RegisterTenantInput,
  ): Promise<RegisterTenantResult> {
    Logger.debug(`registerTenant called for businessName="${input.businessName}" email="${input.emailAddress}"`, loggerCtx);
    const businessName = input.businessName.trim();
    if (!businessName) {
      throw new UserInputError('businessName is required');
    }

    // Use rawConnection for TenantRegistrationLog (no transaction needed)
    const logRepo = this.connection.rawConnection.getRepository(TenantRegistrationLog);
    const log = await logRepo.save(
      new TenantRegistrationLog({
        businessName,
        emailAddress: input.emailAddress,
        requestedAt: new Date(),
        status: 'PENDING',
      }),
    );
    Logger.debug(`Log created with id: ${log.id}`, loggerCtx);

    try {
      Logger.debug('Checking email not taken...', loggerCtx);
      await this.assertEmailNotTaken(ctx, input.emailAddress);
      Logger.debug('Email check passed, getting superadmin context...', loggerCtx);

      // Elevate to superadmin context for privileged operations.
      const superAdminCtx = await this.getSuperAdminContext(ctx);
      Logger.debug('Superadmin context obtained, creating seller...', loggerCtx);

      // 1. Seller — the vendor record.
      Logger.debug(`About to create seller with name: ${businessName}`, loggerCtx);
      let seller;
      try {
        seller = await this.sellerService.create(superAdminCtx, {
          name: businessName,
        });
        Logger.debug(`Seller created with id: ${seller?.id}`, loggerCtx);
      } catch (e: any) {
        Logger.debug(`Seller creation failed: ${e?.message}`, loggerCtx);
        throw e;
      }

      // 2. Channel — the tenant's isolated storefront.
      const { code, token } = this.generateChannelCodeAndToken(businessName);
      Logger.debug(`Generated channel code: ${code} token: ${token} sellerId: ${seller.id}`, loggerCtx);
      const defaultChannel = await this.connection.getRepository(superAdminCtx, Channel).findOneOrFail({
        where: { id: (await this.channelService.getDefaultChannel(superAdminCtx)).id },
        relations: ['defaultTaxZone', 'defaultShippingZone'],
      });

      let defaultTaxZoneId = defaultChannel.defaultTaxZone?.id;
      let defaultShippingZoneId = defaultChannel.defaultShippingZone?.id;

      if (!defaultTaxZoneId || !defaultShippingZoneId) {
        const zoneRepo = this.connection.getRepository(superAdminCtx, Zone);
        let defaultZone = await zoneRepo.findOne({ where: {} });
        if (!defaultZone) {
          defaultZone = await zoneRepo.save(new Zone({ name: 'Default Zone' }));
        }
        if (!defaultTaxZoneId) defaultTaxZoneId = defaultZone.id;
        if (!defaultShippingZoneId) defaultShippingZoneId = defaultZone.id;
      }

      Logger.debug(`About to create channel with sellerId: ${seller.id}`, loggerCtx);
      const channelResult = await this.channelService.create(superAdminCtx, {
        code,
        token,
        sellerId: seller.id,
        defaultLanguageCode: defaultChannel.defaultLanguageCode,
        pricesIncludeTax: defaultChannel.pricesIncludeTax,
        currencyCode: defaultChannel.defaultCurrencyCode,
        defaultCurrencyCode: defaultChannel.defaultCurrencyCode,
        defaultTaxZoneId,
        defaultShippingZoneId,
      });

      if (!('id' in channelResult)) {
        Logger.debug(`Channel creation failed: ${channelResult.message}`, loggerCtx);
        throw new UserInputError(channelResult.message);
      }
      const channel = channelResult;
      Logger.debug(`Channel created: code=${channel.code} id=${channel.id}`, loggerCtx);

      // Vendure 3.8: ChannelService.create() now assigns the SuperAdmin and
      // Customer roles to the new channel itself (assignDefaultRolesToChannel),
      // so the manual replication of ChannelResolver.createChannel()'s role
      // assignment previously done here is no longer needed. Those join rows
      // still matter for:
      //   1. AuthService builds CurrentUser.channels from role.channels, so the
      //      platform SuperAdmin's dashboard channel switcher must show this
      //      tenant channel (Settings → Channels still lists it, as that is an
      //      unfiltered list query).
      //   2. Cross-channel service calls scoped to this channel (e.g.
      //      assignStockLocationsToChannel during auto-provisioning below)
      //      require the SuperAdmin role to hold a join row for the channel.

      // 3. Role — channel-scoped, restricted to this one Channel.
      // Note: We create the role without channelIds first because the superadmin context
      // is bound to the default channel, and Vendure validates that the user has access
      // to any channels specified in channelIds. We'll assign channels afterward via repository.
      Logger.debug('About to create role (no channels)', loggerCtx);
      let role;
      try {
        role = await this.roleService.create(superAdminCtx, {
          code: `${code}-admin`,
          description: `Tenant administrator for ${businessName}`,
          permissions: TENANT_ADMIN_ROLE_PERMISSIONS,
        });
        Logger.debug(`Role created with id: ${role?.id}`, loggerCtx);
      } catch (e: any) {
        Logger.debug(`Role creation failed: ${e?.message}`, loggerCtx);
        throw e;
      }
      // Assign the channel to the role via direct repository access
      Logger.debug(`Assigning channel to role, channelId: ${channel.id}`, loggerCtx);
      await this.connection.getRepository(superAdminCtx, Role).findOneOrFail({
        where: { id: role.id },
        relations: ['channels'],
      }).then(roleEntity => {
        roleEntity.channels = [channel];
        return this.connection.getRepository(superAdminCtx, Role).save(roleEntity);
      });
      Logger.debug('Channel assigned to role', loggerCtx);

      // 4. Administrator — the tenant's own dashboard login.
      //
      // Framework path (Vendure 3.8): AdministratorService.create() performs the
      // duplicate-email check (with framework email normalization), password
      // hashing, NativeAuthenticationMethod persistence, Administrator
      // persistence and AdministratorEvent publishing — replacing the manual
      // repository-based creation that duplicated those framework internals.
      //
      // roleIds is deliberately EMPTY: RoleService.activeUserHasPermissionsOfRoles
      // passes vacuously for an empty role list, whereas passing the new tenant
      // role here would fail because the superAdminCtx does not yet hold access
      // to the role's (new) channel. The role is assigned below via the
      // established repository workaround (kept per the execution plan, Phase 1.4).
      //
      // Email verification (Phase 1.5 / BUG-033 / GHSA-wr5h-x3x6-4h23): Vendure's
      // UserService.createAdminUser() hardcodes verified=true, so the supported
      // UserService.setVerificationToken() call runs immediately afterwards —
      // it sets the verification token AND flips verified back to false — all
      // inside one transaction, so the unverified state is atomic with creation
      // (fail-closed: a crash rolls back the whole administrator). The
      // AccountRegistrationEvent is published only after commit, so a
      // rolled-back registration can never trigger a verification email. The
      // admin cannot log in until the link is clicked (login is refused while a
      // pending token exists, even with requireVerification=false — 3.7.3
      // GHSA-wr5h-x3x6-4h23 gate).
      Logger.debug(`About to create administrator with email: ${input.emailAddress}`, loggerCtx);
      let administrator: Administrator;
      try {
        administrator = await this.connection.withTransaction(superAdminCtx, async (txCtx) => {
          const created = await this.administratorService.create(txCtx, {
            firstName: input.firstName,
            lastName: input.lastName,
            emailAddress: input.emailAddress,
            password: input.password,
            roleIds: [],
          });
          // `created.user` carries authenticationMethods (set by
          // createAdminUser), which setVerificationToken requires via
          // getNativeAuthenticationMethod().
          await this.userService.setVerificationToken(txCtx, created.user);
          Logger.debug('Verification token set; user flipped to unverified', loggerCtx);
          // Kept workaround: the supported role-assignment paths validate that
          // the active user holds access to the role's channels, which the
          // superadmin does not for the brand-new tenant channel.
          if (role) {
            created.user.roles = [role];
            await this.connection.getRepository(txCtx, User).save(created.user);
            Logger.debug('Role assigned to user', loggerCtx);
          }
          return created;
        });
        Logger.debug(`Administrator created with id: ${administrator?.id}`, loggerCtx);
      } catch (e: any) {
        Logger.debug(`Administrator creation failed: ${e?.message}`, loggerCtx);
        throw e;
      }

      // Published after commit (see above) so the EmailPlugin only sends the
      // verification email for a fully persisted, unverified administrator.
      this.eventBus.publish(new AccountRegistrationEvent(superAdminCtx, administrator.user));
      Logger.debug('AccountRegistrationEvent published', loggerCtx);

      // 5. TenantProfile — channel assignment is done inside via assignToChannels.
      Logger.debug(`About to create TenantProfile for channel: ${channel.id}`, loggerCtx);
      try {
        await this.tenantProfileService.create(superAdminCtx, {
          channelId: channel.id,
          businessName,
          contactEmail: input.contactEmail ?? input.emailAddress,
          timezone: input.timezone ?? 'Asia/Kolkata',
        });
        Logger.debug('TenantProfile created', loggerCtx);
      } catch (e: any) {
        Logger.debug(`TenantProfile creation failed: ${e?.message}`, loggerCtx);
        throw e;
      }

      // 6. Auto-provision ShippingMethods, PaymentMethods, and StockLocations
      // from the default channel to the new tenant channel (BUG-024).
      // Without this, a freshly registered tenant has zero working payment
      // methods, shipping configurations, and stock locations — checkout
      // cannot complete.
      await this.autoProvisionChannelResources(superAdminCtx, channel, defaultChannel);

      await this.completeLog(logRepo, log.id, channel);

      Logger.log(
        `Tenant registered: "${businessName}" -> channel ${channel.token}`,
        loggerCtx,
      );

      return {
        channelId: channel.id,
        channelToken: channel.token,
        administratorId: administrator.id,
      };
    } catch (err: any) {
      await this.failLog(logRepo, log.id, err.message);
      throw err;
    }
  }

  private async getSuperAdminContext(ctx: RequestContext): Promise<RequestContext> {
    const { superadminCredentials } = this.configService.authOptions;
    const superAdminUser = await this.connection.getRepository(ctx, User).findOne({
      where: {
        identifier: superadminCredentials.identifier,
      },
      relations: ['roles', 'roles.channels'],
    });
    Logger.debug(`getSuperAdminContext - found user: ${superAdminUser?.identifier}`, loggerCtx);
    if (!superAdminUser) {
      throw new Error('Could not find superadmin user for tenant registration');
    }
    const superAdminCtx = await this.requestContextService.create({
      apiType: 'admin',
      user: superAdminUser,
    });
    Logger.debug(`getSuperAdminContext - created ctx, channelId: ${superAdminCtx?.channelId}`, loggerCtx);
    return superAdminCtx;
  }

  private async assertEmailNotTaken(ctx: RequestContext, emailAddress: string): Promise<void> {
    // Mirror Vendure's normalizeEmailAddress (trim + lowercase) so this
    // fail-fast check cannot miss a case-variant duplicate that
    // AdministratorService.create()'s checkForDuplicateEmailAddress would only
    // reject after the Seller/Channel were already provisioned.
    const identifier = emailAddress.trim().toLowerCase();
    const existing = await this.connection
      .getRepository(ctx, User)
      .findOne({ where: { identifier } });
    if (existing) {
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

  private async completeLog(
    logRepo: Repository<TenantRegistrationLog>,
    logId: ID,
    channel: Channel,
  ): Promise<void> {
    await logRepo.update(logId, {
      status: 'COMPLETED',
      processedAt: new Date(),
      channelId: String(channel.id),
      channelToken: channel.token,
    });
  }

  private async failLog(
    logRepo: Repository<TenantRegistrationLog>,
    logId: ID,
    errorMessage: string,
  ): Promise<void> {
    await logRepo.update(logId, {
      status: 'FAILED',
      processedAt: new Date(),
      errorMessage,
    });
  }

  /**
   * BUG-024: Auto-provision ShippingMethods, PaymentMethods, and StockLocations
   * from the default channel to the newly created tenant channel.
   *
   * Without this, a freshly registered tenant has zero working payment methods,
   * shipping configurations, and stock locations — checkout cannot complete.
   * We assign the default channel's existing methods/locations to the new
   * channel rather than creating new ones, so the platform admin controls the
   * configuration centrally and all tenants inherit it.
   */
  private async autoProvisionChannelResources(
    ctx: RequestContext,
    newChannel: Channel,
    defaultChannel: Channel,
  ): Promise<void> {
    // ShippingMethods
    try {
      const { items: shippingMethods } = await this.shippingMethodService.findAll(ctx);
      if (shippingMethods.length > 0) {
        await this.shippingMethodService.assignShippingMethodsToChannel(ctx, {
          channelId: newChannel.id,
          shippingMethodIds: shippingMethods.map((m) => m.id),
        });
        Logger.log(`Assigned ${shippingMethods.length} shipping methods to channel ${newChannel.code}`, loggerCtx);
      }
    } catch (e: any) {
      Logger.warn(`Failed to assign shipping methods to channel ${newChannel.code}: ${e.message}`, loggerCtx);
    }

    // PaymentMethods — Commit 1 hygiene: assign only the platform Razorpay
    // method(s); never copy a dummy/dev method onto a tenant channel.
    try {
      const { items: paymentMethods } = await this.paymentMethodService.findAll(ctx);
      const razorpayMethods = paymentMethods.filter(
        (m) => (m.handler as { code?: string })?.code === RAZORPAY_HANDLER_CODE,
      );
      const skipped = paymentMethods.length - razorpayMethods.length;
      if (skipped > 0) {
        Logger.warn(
          `Skipped ${skipped} non-Razorpay payment method(s) for channel ${newChannel.code} (Commit 1 hygiene)`,
          loggerCtx,
        );
      }
      if (razorpayMethods.length > 0) {
        await this.paymentMethodService.assignPaymentMethodsToChannel(ctx, {
          channelId: newChannel.id,
          paymentMethodIds: razorpayMethods.map((m) => m.id),
        });
        Logger.log(`Assigned ${razorpayMethods.length} Razorpay payment method(s) to channel ${newChannel.code}`, loggerCtx);
      } else {
        Logger.warn(
          `No Razorpay payment method to assign to channel ${newChannel.code} — checkout will fail until a platform admin creates one`,
          loggerCtx,
        );
      }
    } catch (e: any) {
      Logger.warn(`Failed to assign payment methods to channel ${newChannel.code}: ${e.message}`, loggerCtx);
    }

    // StockLocations
    try {
      const { items: stockLocations } = await this.stockLocationService.findAll(ctx);
      if (stockLocations.length > 0) {
        await this.stockLocationService.assignStockLocationsToChannel(ctx, {
          channelId: newChannel.id,
          stockLocationIds: stockLocations.map((l) => l.id),
        });
        Logger.log(`Assigned ${stockLocations.length} stock locations to channel ${newChannel.code}`, loggerCtx);
      }
    } catch (e: any) {
      Logger.warn(`Failed to assign stock locations to channel ${newChannel.code}: ${e.message}`, loggerCtx);
    }

    // Customer role
    //
    // Without this, the shared __customer_role__ (which grants the
    // "Authenticated" permission) is not scoped to the new tenant channel.
    // Customers who register/verify in that channel then fail every
    // permission-guarded Shop API operation (me, activeOrder, checkout)
    // with FORBIDDEN, because the permission guard resolves permissions
    // per active channel.
    try {
      const roleRepo = this.connection.getRepository(ctx, Role);
      const customerRole = await roleRepo.findOne({ where: { code: CUSTOMER_ROLE_CODE }, relations: ['channels'] });
      if (customerRole && !customerRole.channels.some((c) => c.id === newChannel.id)) {
        customerRole.channels = [...customerRole.channels, newChannel];
        await roleRepo.save(customerRole);
        Logger.log(`Assigned __customer_role__ to channel ${newChannel.code}`, loggerCtx);
      }
    } catch (e: any) {
      Logger.warn(`Failed to assign __customer_role__ to channel ${newChannel.code}: ${e.message}`, loggerCtx);
    }
  }
}
