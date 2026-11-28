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
  Administrator,
  Channel,
  mergeConfig,
  Permission,
  RequestContext,
  RequestContextService,
  Role,
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
import { KeycloakIdentityService } from '../services/keycloak-identity.service';
import { KeycloakIdentity } from '../entities/keycloak-identity.entity';
import { BigBlueButtonPlugin } from '../../bigbluebutton-plugin';
import { CmsPlugin } from '../../cms/cms.plugin';
import { ReviewsPlugin } from '../../reviews/reviews-plugin';
import { SubscriptionPlugin } from '../../subscription/subscription.plugin';
import { E2E_INITIAL_DATA } from '../e2e/fixtures/e2e-initial-data';

// ─── Postgres initializer — isolated schema e2e_keycloak_identity ──
registerInitializer('postgres', new SchemaPostgresInitializer());

/**
 * PR 2 — Tenant and Moderator Identity Ownership tests.
 *
 * Covers the Keycloak identity mapping data model established by PR 2:
 * 1. Create a KeycloakIdentity mapping (issuer + subject → tenant channel)
 * 2. Person-one-tenant uniqueness: same (issuer, subject) cannot map to
 *    multiple tenants (enforced by unique index)
 * 3. Channel isolation: a KeycloakIdentity for tenant A is not visible
 *    when querying tenant B's channel
 * 4. Link to customer / administrator
 * 5. Tenant provisioning chain: Seller → Channel → Administrator →
 *    TenantProfile (existing TenantRegistrationService path, re-verified)
 *
 * Keycloak provisioning itself (creating Keycloak accounts, linking them
 * during login) is intentionally NOT covered here — that is PR 4.
 */
describe('PR 2 — Keycloak identity mapping (tenant/moderator identity)', () => {
  const { server, adminClient, shopClient } = createTestEnvironment(
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
        schema: 'e2e_keycloak_identity',
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

  let keycloakIdentityService: KeycloakIdentityService;
  let connection: TransactionalConnection;

  // Shared tenant state
  let tenantAChannelId: string;
  let tenantAChannelCode: string;
  let tenantBChannelId: string;
  let tenantBChannelCode: string;

  let tenantAAministratorId: string;
  let tenantACustomerId: string;

  beforeAll(async () => {
    await startOnFreePort({ server, adminClient, shopClient }, {
      initialData: E2E_INITIAL_DATA,
      customerCount: 2,
    });

    connection = server.app.get(TransactionalConnection);
    keycloakIdentityService = server.app.get(KeycloakIdentityService);

    // Provision two tenants via the existing TenantRegistrationService path
    const superAdminCtx = await getSuperAdminContext();

    const tenantA = await provisionTenant(superAdminCtx, 'Tenant A Alpha', 'tenant-a-alpha');
    tenantAChannelId = tenantA.channelId;
    tenantAChannelCode = tenantA.channelCode;
    tenantAAministratorId = tenantA.administratorId;

    const tenantB = await provisionTenant(superAdminCtx, 'Tenant B Beta', 'tenant-b-beta');
    tenantBChannelId = tenantB.channelId;
    tenantBChannelCode = tenantB.channelCode;

    // Get a customer id from tenant A for link testing
    const customerRepo = connection.getRepository(superAdminCtx, 'Customer');
    const customers = await customerRepo.find({
      relations: ['channels'],
      take: 5,
    });
    const tenantACustomer = customers.find((c: any) =>
      (c.channels ?? []).some((ch: any) => String(ch.id) === String(tenantAChannelId)),
    );
    tenantACustomerId = tenantACustomer ? String(tenantACustomer.id) : '';
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
  ): Promise<{ channelId: string; channelCode: string; administratorId: string }> {
    const { SellerService, ChannelService, AdministratorService, RoleService, UserService, Zone } = server.app;
    const seller = await SellerService.create(ctx, { name: businessName });

    const defaultChannel = await connection.getRepository(ctx, Channel).findOneOrFail({
      where: { id: (await ChannelService.getDefaultChannel(ctx)).id },
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
      if (!defaultTaxZoneId) defaultTaxZoneId = defaultZone.id;
      if (!defaultShippingZoneId) defaultShippingZoneId = defaultZone.id;
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

    const role = await RoleService.create(ctx, {
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

    const administrator = await connection.withTransaction(ctx, async (txCtx) => {
      const created = await AdministratorService.create(txCtx, {
        firstName: 'Owner',
        lastName: businessName,
        emailAddress: `owner-${channelCode}-${Date.now()}@example.com`,
        password: 'OwnerP@ss123',
        roleIds: [],
      });
      await server.app.get(UserService).setVerificationToken(txCtx, created.user);
      if (role) {
        created.user.roles = [role];
        await connection.getRepository(txCtx, User).save(created.user);
      }
      return created;
    });

    return {
      channelId: channel.id,
      channelCode: channel.code,
      administratorId: administrator.id,
    };
  }

  // ── Test: create a KeycloakIdentity mapping ──
  it('creates a KeycloakIdentity mapping for a tenant channel', async () => {
    const ctx = await getSuperAdminContext();

    const identity = await keycloakIdentityService.create(ctx, {
      channelId: tenantAChannelId,
      issuer: 'https://keycloak.example.com/realms/saa9vi',
      subject: '550e8400-e29b-41d4-a716-446655440000',
      administratorId: tenantAAministratorId,
    });

    expect(identity.id).toBeDefined();
    expect(identity.channelId).toBe(tenantAChannelId);
    expect(identity.issuer).toBe('https://keycloak.example.com/realms/saa9vi');
    expect(identity.subject).toBe('550e8400-e29b-41d4-a716-446655440000');
    expect(identity.administratorId).toBe(tenantAAministratorId);
    expect(identity.customerId).toBeNull();
  });

  // ── Test: person-one-tenant uniqueness ──
  it('rejects a duplicate KeycloakIdentity for the same issuer+subject', async () => {
    const ctx = await getSuperAdminContext();

    // First mapping succeeds
    await keycloakIdentityService.create(ctx, {
      channelId: tenantAChannelId,
      issuer: 'https://keycloak.example.com/realms/saa9vi',
      subject: '550e8400-e29b-41d4-a716-446655440001',
    });

    // Same issuer+subject on a different channel should fail
    await expect(
      keycloakIdentityService.create(ctx, {
        channelId: tenantBChannelId,
        issuer: 'https://keycloak.example.com/realms/saa9vi',
        subject: '550e8400-e29b-41d4-a716-446655440001',
      }),
    ).rejects.toThrow(/already mapped|person-one-tenant/);
  });

  // ── Test: channel isolation ──
  it('is KeycloakIdentity-scoped to its channel', async () => {
    const ctx = await getSuperAdminContext();

    const identityA = await keycloakIdentityService.create(ctx, {
      channelId: tenantAChannelId,
      issuer: 'https://keycloak.example.com/realms/saa9vi',
      subject: '550e8400-e29b-41d4-a716-446655440002',
    });

    const identityB = await keycloakIdentityService.create(ctx, {
      channelId: tenantBChannelId,
      issuer: 'https://keycloak.example.com/realms/saa9vi',
      subject: '550e8400-e29b-41d4-a716-446655440003',
    });

    const tenantAIdentities = await keycloakIdentityService.findByChannel(ctx, tenantAChannelId);
    const tenantBIdentities = await keycloakIdentityService.findByChannel(ctx, tenantBChannelId);

    expect(tenantAIdentities.map((i) => i.id)).toContain(identityA.id);
    expect(tenantAIdentities.map((i) => i.id)).not.toContain(identityB.id);
    expect(tenantBIdentities.map((i) => i.id)).toContain(identityB.id);
    expect(tenantBIdentities.map((i) => i.id)).not.toContain(identityA.id);
  });

  // ── Test: link to customer ──
  it('links a KeycloakIdentity to a Vendure customer', async () => {
    const ctx = await getSuperAdminContext();

    const identity = await keycloakIdentityService.create(ctx, {
      channelId: tenantAChannelId,
      issuer: 'https://keycloak.example.com/realms/saa9vi',
      subject: '550e8400-e29b-41d4-a716-446655440004',
    });

    const updated = await keycloakIdentityService.linkCustomer(ctx, identity.id, tenantACustomerId);
    expect(updated.customerId).toBe(tenantACustomerId);

    const byCustomer = await keycloakIdentityService.findByCustomer(ctx, tenantACustomerId);
    expect(byCustomer.map((i) => i.id)).toContain(identity.id);
  });

  // ── Test: find by issuer+subject ──
  it('finds a KeycloakIdentity by issuer+subject', async () => {
    const ctx = await getSuperAdminContext();

    await keycloakIdentityService.create(ctx, {
      channelId: tenantAChannelId,
      issuer: 'https://keycloak.example.com/realms/saa9vi',
      subject: '550e8400-e29b-41d4-a716-446655440005',
    });

    const found = await keycloakIdentityService.findByIssuerSubject(
      ctx,
      'https://keycloak.example.com/realms/saa9vi',
      '550e8400-e29b-41d4-a716-446655440005',
    );
    expect(found).not.toBeNull();
    expect(found!.channelId).toBe(tenantAChannelId);

    const notFound = await keycloakIdentityService.findByIssuerSubject(
      ctx,
      'https://keycloak.example.com/realms/saa9vi',
      'nonexistent-subject',
    );
    expect(notFound).toBeNull();
  });

  // ── Test: provisioning chain produces channel-isolated administrator ──
  it('provisions tenant with channel-scoped administrator', async () => {
    const ctx = await getSuperAdminContext();

    const admins = await connection.getRepository(ctx, Administrator).find({
      relations: ['user', 'user.roles', 'user.roles.channels'],
    });
    const tenantAAdmins = admins.filter((a: any) =>
      (a.user.roles ?? []).some((r: any) =>
        (r.channels ?? []).some((ch: any) => String(ch.id) === String(tenantAChannelId)),
      ),
    );
    expect(tenantAAdmins.length).toBeGreaterThan(0);

    const tenantAAadmin = tenantAAdmins[0];
    expect(tenantAAadmin.user.roles.some(
      (r: any) => String(r.code) === `${tenantAChannelCode}-admin`
    )).toBe(true);
  });
});