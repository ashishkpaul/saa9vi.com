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
  NativeAuthenticationMethod,
  PasswordCipher,
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
    private readonly tenantProfileService: TenantProfileService,
    private readonly configService: ConfigService,
    private readonly requestContextService: RequestContextService,
    private readonly passwordCipher: PasswordCipher,
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
      // We use direct repository access to bypass the administratorService.create()
      // permission check (checkActiveUserCanGrantRoles) which validates that the
      // active user has the required permissions on the role's channels. Since the
      // role is scoped to the new channel (which the superadmin doesn't have access
      // to yet), the check would fail. Using repository access is safe here because
      // we're operating under the superAdminCtx.
      //
      // NOTE: This manual path duplicates framework internals (password hashing,
      // user.verified, event publishing, etc.). It was kept because the original
      // swap to administratorService.create()/roleService.create() with channelIds
      // failed due to Vendure's checkActiveUserCanGrantRoles validation — the
      // superadmin doesn't have access to the newly-created channel yet. If a
      // future Vendure upgrade changes what Administrator creation requires,
      // this code will need updating. The e2e test suite (27 tests) serves as
      // the safety net for any such refactor.
      Logger.debug(`About to create administrator with email: ${input.emailAddress}`, loggerCtx);
      let administrator;
      try {
        // Create User first (via repository to bypass permission checks).
        // Email verification (Phase 1.5): the user is created UNVERIFIED and
        // a verification token is set. The AccountRegistrationEvent is published
        // so the EmailPlugin sends the verification email. The admin cannot log
        // in until they click the verification link (mirrors the
        // registerCustomerAccount / verifyCustomerAccount pattern).
        const user = new User();
        user.identifier = input.emailAddress;
        user.verified = false;
        const savedUser = await this.connection.getRepository(superAdminCtx, User).save(user);
        Logger.debug(`User created with id: ${savedUser.id}`, loggerCtx);

        // Add native authentication method with password
        const hashedPassword = await this.passwordCipher.hash(input.password);
        const nativeAuthMethod = new NativeAuthenticationMethod({
          identifier: input.emailAddress,
          passwordHash: hashedPassword,
        });
        nativeAuthMethod.user = savedUser as any;
        await this.connection.getRepository(superAdminCtx, NativeAuthenticationMethod).save(nativeAuthMethod);
        Logger.debug('Native authentication method added', loggerCtx);

        // Assign role to user (via repository to bypass permission checks)
        const userRepo = this.connection.getRepository(superAdminCtx, User);
        const userWithRoles = await userRepo.findOne({
          where: { id: savedUser.id },
          relations: ['roles', 'authenticationMethods'],
        });
        if (userWithRoles && role) {
          userWithRoles.roles = [role];
          await userRepo.save(userWithRoles);
          Logger.debug('Role assigned to user', loggerCtx);
        }

        // Set verification token and publish AccountRegistrationEvent so the
        // EmailPlugin sends the verification email (Phase 1.5 blocker).
        const userWithAuth = await userRepo.findOne({
          where: { id: savedUser.id },
          relations: ['authenticationMethods'],
        });
        if (userWithAuth) {
          await this.userService.setVerificationToken(superAdminCtx, userWithAuth);
          this.eventBus.publish(new AccountRegistrationEvent(superAdminCtx, userWithAuth));
          Logger.debug('Verification token set and AccountRegistrationEvent published', loggerCtx);
        }

        // Create Administrator (via repository to bypass permission checks)
        const adminRepo = this.connection.getRepository(superAdminCtx, Administrator);
        administrator = adminRepo.create({
          firstName: input.firstName,
          lastName: input.lastName,
          emailAddress: input.emailAddress,
          user: savedUser,
        });
        administrator = await adminRepo.save(administrator);
        Logger.debug(`Administrator created with id: ${administrator?.id}`, loggerCtx);

      } catch (e: any) {
        Logger.debug(`Administrator creation failed: ${e?.message}`, loggerCtx);
        throw e;
      }

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
    const existing = await this.connection
      .getRepository(ctx, User)
      .findOne({ where: { identifier: emailAddress } });
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

    // PaymentMethods
    try {
      const { items: paymentMethods } = await this.paymentMethodService.findAll(ctx);
      if (paymentMethods.length > 0) {
        await this.paymentMethodService.assignPaymentMethodsToChannel(ctx, {
          channelId: newChannel.id,
          paymentMethodIds: paymentMethods.map((m) => m.id),
        });
        Logger.log(`Assigned ${paymentMethods.length} payment methods to channel ${newChannel.code}`, loggerCtx);
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
  }
}
