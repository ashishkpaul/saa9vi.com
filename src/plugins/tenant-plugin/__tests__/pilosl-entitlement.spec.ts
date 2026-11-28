import 'reflect-metadata';
import 'dotenv/config';
import {
  createTestEnvironment,
  registerInitializer,
  testConfig,
} from '@vendure/testing';
import { startOnFreePort } from '../../../test-utils/free-port';
import { SchemaPostgresInitializer } from '../e2e/schema-postgres-initializer';
import {
  Channel,
  mergeConfig,
  Permission,
  RequestContext,
  RequestContextService,
  Role,
  SellerService,
  ChannelService,
  AdministratorService,
  RoleService,
  UserService,
  Zone,
  TransactionalConnection,
  User,
} from '@vendure/core';
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
} from 'vitest';

import { TenantPlugin } from '../tenant-plugin.plugin';
import { BigBlueButtonPlugin } from '../../bigbluebutton-plugin';
import { CmsPlugin } from '../../cms/cms.plugin';
import { ReviewsPlugin } from '../../reviews/reviews-plugin';
import { SubscriptionPlugin } from '../../subscription/subscription.plugin';
import { E2E_INITIAL_DATA } from '../e2e/fixtures/e2e-initial-data';

registerInitializer('postgres', new SchemaPostgresInitializer());

const TENANT_PILOS_ENTITLEMENT = `
  query TenantPiloslEntitlement($channelId: String!) {
    tenantPiloslEntitlement(channelId: $channelId) {
      tenantRef
      status
      plan
      version
      validUntil
    }
  }
`;

describe('PR 5 — PILOS tenant-level entitlement API', () => {
  const { server, adminClient } = createTestEnvironment(
    mergeConfig(testConfig, {
      apiOptions: { port: 0 },
      authOptions: {
        requireVerification: false,
      },
      dbConnectionOptions: {
        type: 'postgres',
        host: process.env.DB_HOST ?? 'localhost',
        port: Number(process.env.DB_PORT ?? 5432),
        database: process.env.DB_NAME ?? 'vendure',
        username: process.env.DB_USERNAME ?? 'vendure_user',
        password: process.env.DB_PASSWORD ?? '',
        schema: 'e2e_pilos_entitlement',
        synchronize: true,
      },
      plugins: [
        TenantPlugin,
        BigBlueButtonPlugin,
        CmsPlugin,
        ReviewsPlugin,
        SubscriptionPlugin.init({}) as any,
      ],
    }),
  );

  let connection: TransactionalConnection;
  let tenantChannelId: string;

  beforeAll(async () => {
    await startOnFreePort({ server, adminClient }, {
      initialData: E2E_INITIAL_DATA,
      customerCount: 2,
    });

    connection = server.app.get(TransactionalConnection);

    const ctx = await getSuperAdminContext();
    tenantChannelId = await provisionTenant(ctx, 'Tenant A Alpha', 'tenant-a-alpha');
  }, 120_000);

  afterAll(async () => {
    await server.destroy();
  });

  async function getSuperAdminContext(): Promise<RequestContext> {
    const { superadminCredentials } = server.app.getConfig().authOptions;
    const superAdminUser = await connection.getRepository(User).findOne({
      where: { identifier: superadminCredentials.identifier },
    });
    if (!superAdminUser) {
      throw new Error('Could not find superadmin user');
    }
    return server.app.get(RequestContextService).create({
      apiType: 'admin',
      user: superAdminUser,
    });
  }
  async function provisionTenant(
    ctx: RequestContext,
    businessName: string,
    channelCode: string,
  ): Promise<string> {
    const sellerService = server.app.get(SellerService);
    const channelService = server.app.get(ChannelService);
    const roleService = server.app.get(RoleService);
    const userService = server.app.get(UserService);

    const seller = await sellerService.create(ctx, { name: businessName });

    const defaultChannel = await connection.getRepository(ctx, Channel).findOneOrFail({
      where: { id: (await channelService.getDefaultChannel(ctx)).id },
      relations: ['defaultTaxZone', 'defaultShippingZone'],
    });

    let defaultTaxZoneId = defaultChannel.defaultTaxZone?.id;
    let defaultShippingZoneId = defaultChannel.defaultShippingZone?.id;
    if (!defaultTaxZoneId || !defaultShippingZoneId) {
      const zoneRepo = connection.getRepository(ctx, Zone);
      let defaultZone = await zoneRepo.findOne({ where: {} });
      if (!defaultZone) {
        defaultZone = await zoneRepo.save(new Zone({ name: 'Default Zone' }));
      }
      if (!defaultTaxZoneId && defaultZone) defaultTaxZoneId = defaultZone.id;
      if (!defaultShippingZoneId && defaultZone)
        defaultShippingZoneId = defaultZone.id;
    }

    const channelResult = await ChannelService.create(ctx, {
      code: channelCode,
      token: `tok_${channelCode}_${Date.now().toString(36).slice(2, 8)}`,
      sellerId: seller.id,
      defaultLanguageCode: defaultChannel.defaultLanguageCode,
      pricesIncludeTax: defaultChannel.pricesIncludeTax,
      currencyCode: defaultChannel.defaultCurrencyCode,
      defaultCurrencyCode: defaultChannel.defaultCurrencyCode,
      defaultTaxZoneId,
      defaultShippingZoneId,
    });
    if (!('id' in channelResult)) {
      throw new Error(`Channel creation failed: ${channelResult.message}`);
    }
    const channel = channelResult;

    const role = await roleService.create(ctx, {
      code: `${channelCode}-admin`,
      description: `Tenant administrator for ${businessName}`,
      permissions: [Permission.Authenticated, Permission.ReadAdministrator],
    });
    const roleEntity = await connection.getRepository(ctx, Role).findOneOrFail({
      where: { id: role.id },
      relations: ['channels'],
    });
    roleEntity.channels = [channel];
    await connection.getRepository(ctx, Role).save(roleEntity);

    await connection.withTransaction(ctx, async (txCtx) => {
      const created = await AdministratorService.create(txCtx, {
        firstName: 'Owner',
        lastName: businessName,
        emailAddress: `owner-${channelCode}-${Date.now()}@example.com`,
        password: 'OwnerP@ss123',
        roleIds: [],
      });
      await userService.setVerificationToken(txCtx, created.user);
      if (role) {
        created.user.roles = [role];
        await connection.getRepository(txCtx, User).save(created.user);
      }
      return created;
    });

    return channel.id;
  }

  async function setSubscription(
    ctx: RequestContext,
    channelId: string,
    planSlug: string,
    status: 'active' | 'past_due' | 'cancelled' | 'pending_provider_auth',
    currentPeriodEnd: Date | null = null,
    marketplaceGraceUntil: Date | null = null,
    pilosAccessEnabled: boolean = true,
  ): Promise<void> {
    const repo = connection.getRepository(ctx, 'OrganizationSubscription');
    const planRepo = connection.getRepository(ctx, 'SubscriptionPlan');

    let plan = await planRepo.findOne({ where: { slug: planSlug } });
    if (!plan) {
      plan = await planRepo.save(
        planRepo.create({
          slug: planSlug,
          name: planSlug,
          monthlyPriceInPaise: 100000,
          pilosAccessEnabled,
        }),
      );
    }

    const existing = await repo.findOne({ where: { channelId } });
    if (existing) {
      existing.status = status as any;
      existing.plan = plan as any;
      existing.currentPeriodEnd = currentPeriodEnd;
      existing.marketplaceGraceUntil = marketplaceGraceUntil;
      existing.version = (existing.version || 1) + 1;
      await repo.save(existing);
    } else {
      await repo.save(
        repo.create({
          channelId,
          plan,
          status,
          currentPeriodEnd,
          marketplaceGraceUntil,
          version: 1,
        }),
      );
    }
  }

  // ── Tests ──
  it('returns MISSING when channel has no subscription', async () => {
    const ctx = await getSuperAdminContext();
    const { data } = await adminClient.query(TENANT_PILOS_ENTITLEMENT, {
      channelId: 'nonexistent-channel',
    });
    expect(data.tenantPiloslEntitlement).toMatchObject({
      tenantRef: 'nonexistent-channel',
      status: 'MISSING',
      plan: null,
      version: null,
      validUntil: null,
    });
  });

  it('returns ACTIVE for active subscription with pilosAccessEnabled plan', async () => {
    const ctx = await getSuperAdminContext();
    await setSubscription(ctx, tenantChannelId, 'starter-monthly', 'active', new Date('2026-12-27'));

    const { data } = await adminClient.query(TENANT_PILOS_ENTITLEMENT, {
      channelId: tenantChannelId,
    });
    expect(data.tenantPiloslEntitlement).toMatchObject({
      tenantRef: tenantChannelId,
      status: 'ACTIVE',
      plan: 'starter-monthly',
      version: 1,
    });
    expect(data.tenantPiloslEntitlement.validUntil).toBeDefined();
  });

  it('returns MISSING when plan does not have pilosAccessEnabled', async () => {
    const ctx = await getSuperAdminContext();
    await setSubscription(ctx, tenantChannelId, 'basic-monthly', 'active', new Date('2026-12-27'), null, false);

    const { data } = await adminClient.query(TENANT_PILOS_ENTITLEMENT, {
      channelId: tenantChannelId,
    });
    expect(data.tenantPiloslEntitlement).toMatchObject({
      tenantRef: tenantChannelId,
      status: 'MISSING',
      plan: 'basic-monthly',
      version: 2,
    });
  });

  it('returns ACTIVE for past_due inside grace window', async () => {
    const ctx = await getSuperAdminContext();
    await setSubscription(ctx, tenantChannelId, 'starter-monthly', 'past_due', new Date('2026-12-20'), new Date('2027-01-20'));

    const { data } = await adminClient.query(TENANT_PILOS_ENTITLEMENT, {
      channelId: tenantChannelId,
    });
    expect(data.tenantPiloslEntitlement).toMatchObject({
      tenantRef: tenantChannelId,
      status: 'ACTIVE',
      plan: 'starter-monthly',
    });
  });

  it('returns SUSPENDED for past_due past grace window', async () => {
    const ctx = await getSuperAdminContext();
    await setSubscription(ctx, tenantChannelId, 'starter-monthly', 'past_due', new Date('2026-12-20'), new Date('2026-12-10'));

    const { data } = await adminClient.query(TENANT_PILOS_ENTITLEMENT, {
      channelId: tenantChannelId,
    });
    expect(data.tenantPiloslEntitlement).toMatchObject({
      tenantRef: tenantChannelId,
      status: 'SUSPENDED',
      plan: 'starter-monthly',
    });
  });

  it('returns EXPIRED for cancelled subscription', async () => {
    const ctx = await getSuperAdminContext();
    await setSubscription(ctx, tenantChannelId, 'starter-monthly', 'cancelled', new Date('2026-12-20'));

    const { data } = await adminClient.query(TENANT_PILOS_ENTITLEMENT, {
      channelId: tenantChannelId,
    });
    expect(data.tenantPiloslEntitlement).toMatchObject({
      tenantRef: tenantChannelId,
      status: 'EXPIRED',
      plan: 'starter-monthly',
    });
  });
});

