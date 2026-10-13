/**
 * bigbluebutton-plugin e2e — tenant vs platform permission tiers
 *
 * Complements bbb-channel-isolation.e2e-spec.ts (which already pins the H2
 * capacity-grant / delete-organization denials). This suite pins what that one
 * does not:
 *
 *   1. A real tenant admin (registered through registerNewTenant) is refused at
 *      the PERMISSION layer on platform-only reads: `bbbServers` and
 *      `bbbPlatformBillingSummary`. A SuperAdmin positive control proves the
 *      denial is the tier, not a malformed document.
 *   2. Role drift guard: after provisioning, no role other than SuperAdmin holds
 *      `BBBAdmin` or `BBBPlatformInfrastructure` (those two make a caller a
 *      "platform caller" — see BbbChannelAccessService.isPlatformCaller).
 *   3. `bbbProductVariantSearch` is channel-scoped: a tenant admin must not see
 *      another channel's variants/SKUs/product names. Platform callers still
 *      see everything.
 *
 * Run:  npm run test:e2e:bbb-tiers
 *
 * Requires Postgres (same .env variables as the other e2e suites). Uses a
 * dedicated schema (e2e_bbb_tiers).
 */

import 'reflect-metadata';
import path from 'path';
import 'dotenv/config';
import gql from 'graphql-tag';
import {
  createTestEnvironment,
  E2E_DEFAULT_CHANNEL_TOKEN,
  registerInitializer,
  testConfig,
} from '@vendure/testing';
import { SUPER_ADMIN_ROLE_CODE } from '@vendure/common/lib/shared-constants';
import { mergeConfig, Role, TransactionalConnection } from '@vendure/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startOnFreePort } from '../../../test-utils/free-port';
import { getSuperadminContext } from '@vendure/testing/lib/utils/get-superadmin-context';
import { SchemaPostgresInitializer } from '../../tenant-plugin/e2e/schema-postgres-initializer';
import { TenantPlugin } from '../../tenant-plugin/tenant-plugin.plugin';
import { BigBlueButtonPlugin } from '../bigbluebutton.plugin';
import { CmsPlugin } from '../../cms/cms.plugin';
import { ReviewsPlugin } from '../../reviews/reviews-plugin';
import { SubscriptionPlugin } from '../../subscription/subscription.plugin';
import { E2E_INITIAL_DATA } from '../../tenant-plugin/e2e/fixtures/e2e-initial-data';
import { verifyTenantAdminViaApi } from '../../tenant-plugin/e2e/fixtures/verify-tenant-admin';
import {
  BbbAdminPermission,
  BbbManageRoomsPermission,
  BbbPlatformInfrastructurePermission,
} from '../constants';

registerInitializer('postgres', new SchemaPostgresInitializer());

// ─── GraphQL documents ─────────────────────────────────────────────────────

const REGISTER_NEW_TENANT = gql`
  mutation RegisterNewTenant($input: RegisterTenantInput!) {
    registerNewTenant(input: $input) {
      channelId
      channelToken
      administratorId
    }
  }
`;

const BBB_SERVERS = gql`
  query BbbServers {
    bbbServers {
      items {
        id
      }
      totalItems
    }
  }
`;

const BBB_PLATFORM_BILLING_SUMMARY = gql`
  query BbbPlatformBillingSummary($month: String) {
    bbbPlatformBillingSummary(month: $month) {
      totalLearnerMinutes
    }
  }
`;

const SEARCH_VARIANTS = gql`
  query BbbProductVariantSearch($term: String!) {
    bbbProductVariantSearch(term: $term) {
      id
      name
      sku
      productName
    }
  }
`;

/** Resolves to the rejection (or null on success) so denials can be asserted by reason. */
async function rejectionOf(promise: Promise<unknown>): Promise<any> {
  return promise.then(
    () => null,
    (e: unknown) => e,
  );
}

const TENANT_PASSWORD = 'StrongP@ss1';

describe('BBB permission tiers (tenant vs platform)', () => {
  const { server, adminClient, shopClient } = createTestEnvironment(
    mergeConfig(testConfig, {
      apiOptions: { port: 0 },
      // registerNewTenant creates unverified admins; see BUG-033/BUG-037 notes
      // in bbb-channel-isolation.e2e-spec.ts.
      authOptions: { requireVerification: false },
      dbConnectionOptions: {
        type: 'postgres',
        host: process.env.DB_HOST ?? 'localhost',
        port: Number(process.env.DB_PORT ?? 5432),
        database: process.env.DB_NAME ?? 'vendure',
        username: process.env.DB_USERNAME ?? 'vendure_user',
        password: process.env.DB_PASSWORD ?? '',
        schema: 'e2e_bbb_tiers',
        synchronize: true,
      },
      // Same plugin set as the isolation suite: the tenant role template grants
      // CMS / Reviews permissions that must be registered by a loaded plugin.
      plugins: [
        TenantPlugin,
        BigBlueButtonPlugin,
        CmsPlugin,
        ReviewsPlugin,
        SubscriptionPlugin.init({}) as any,
      ],
    }),
  );

  let tenantAEmail: string;
  let tenantAChannelToken: string;

  async function asSuperAdminOnDefaultChannel() {
    await adminClient.asSuperAdmin();
    adminClient.setChannelToken(E2E_DEFAULT_CHANNEL_TOKEN);
  }

  async function asTenantAdmin() {
    // Log in first, then switch channel (see the helper notes in the isolation suite).
    await adminClient.asUserWithCredentials(tenantAEmail, TENANT_PASSWORD);
    adminClient.setChannelToken(tenantAChannelToken);
  }

  beforeAll(async () => {
    await startOnFreePort(
      { server, adminClient, shopClient },
      {
        initialData: E2E_INITIAL_DATA,
        productsCsvPath: path.join(
          __dirname,
          '../../tenant-plugin/e2e/fixtures/e2e-products.csv',
        ),
        customerCount: 2,
      },
    );

    shopClient.setChannelToken(E2E_DEFAULT_CHANNEL_TOKEN);
    tenantAEmail = `bbb-tiers-a-${Date.now()}@example.com`;
    const result = await shopClient.query(REGISTER_NEW_TENANT, {
      input: {
        businessName: 'BBB Tiers Academy',
        firstName: 'Tier',
        lastName: 'Admin',
        emailAddress: tenantAEmail,
        password: TENANT_PASSWORD,
        timezone: 'Asia/Kolkata',
      },
    });
    tenantAChannelToken = result.registerNewTenant.channelToken;
    await verifyTenantAdminViaApi(server, shopClient, tenantAEmail);
  }, 180_000);

  afterAll(async () => {
    await server.destroy();
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 1. Platform-only reads are refused to a tenant admin
  // ═══════════════════════════════════════════════════════════════════════

  describe('platform-only reads', () => {
    it('SuperAdmin can read both (positive control)', async () => {
      await asSuperAdminOnDefaultChannel();

      const servers: any = await adminClient.query(BBB_SERVERS);
      expect(servers.bbbServers.totalItems).toBeGreaterThanOrEqual(0);

      const summary: any = await adminClient.query(BBB_PLATFORM_BILLING_SUMMARY, {});
      expect(summary.bbbPlatformBillingSummary).toBeTruthy();
    });

    it('tenant admin is refused bbbServers at the permission layer', async () => {
      await asTenantAdmin();
      const error = await rejectionOf(adminClient.query(BBB_SERVERS));
      expect(error, 'bbbServers unexpectedly succeeded for a tenant admin').toBeTruthy();
      expect(String(error.message)).toMatch(/not currently authorized/i);
    });

    it('tenant admin is refused bbbPlatformBillingSummary at the permission layer', async () => {
      await asTenantAdmin();
      const error = await rejectionOf(
        adminClient.query(BBB_PLATFORM_BILLING_SUMMARY, {}),
      );
      expect(
        error,
        'bbbPlatformBillingSummary unexpectedly succeeded for a tenant admin',
      ).toBeTruthy();
      expect(String(error.message)).toMatch(/not currently authorized/i);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 2. Role drift guard — nobody but SuperAdmin holds a platform key
  // ═══════════════════════════════════════════════════════════════════════

  describe('role drift guard', () => {
    it('no role except SuperAdmin holds BBBAdmin or BBBPlatformInfrastructure', async () => {
      const connection = server.app.get(TransactionalConnection);
      const roles = await connection.rawConnection.getRepository(Role).find();

      const nonSuper = roles.filter(r => r.code !== SUPER_ADMIN_ROLE_CODE);
      // Guard against a vacuous pass: the registered tenant's admin role must exist
      // and carry the tenant granular set.
      expect(
        nonSuper.some(r =>
          (r.permissions as string[]).includes(BbbManageRoomsPermission.Permission),
        ),
        'expected at least one provisioned tenant role holding BBBManageRooms',
      ).toBe(true);

      const offenders = nonSuper
        .filter(r =>
          (r.permissions as string[]).some(
            p =>
              p === BbbAdminPermission.Permission ||
              p === BbbPlatformInfrastructurePermission.Permission,
          ),
        )
        .map(r => r.code);
      expect(offenders).toEqual([]);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 3. bbbProductVariantSearch is channel-scoped
  // ═══════════════════════════════════════════════════════════════════════

  describe('bbbProductVariantSearch channel scoping', () => {
    let leakedSku: string;

    it('creates a default-channel variant fixture (positive-control setup)', async () => {
      const { ProductService, ProductVariantService } = await import('@vendure/core');
      const superCtx: any = await getSuperadminContext(server.app);
      const productService = server.app.get(ProductService);
      const variantService = server.app.get(ProductVariantService);
      const stamp = Date.now();
      const created = await productService.create(superCtx, {
        enabled: true,
        translations: [
          {
            languageCode: 'en' as any,
            name: 'BBB Tiers Product ' + stamp,
            slug: 'bbb-tiers-product-' + stamp,
            description: 'BBB tiers channel-scoping fixture',
          },
        ],
      });
      await variantService.create(superCtx, [
        {
          productId: created.id,
          sku: 'BBBTIERS-' + stamp,
          price: 10000,
          stockOnHand: 10,
          trackInventory: 'FALSE' as any,
          translations: [{ languageCode: 'en' as any, name: 'BBB Tiers Variant' }],
        },
      ]);
      leakedSku = 'BBBTIERS-' + stamp;
      expect(leakedSku).toBeTruthy();
    });

    it('a platform caller sees variants of the default channel (positive control)', async () => {
      await asSuperAdminOnDefaultChannel();
      // Empty term matches every variant (LIKE '%%'), so no SKU is hard-coded.
      const res: any = await adminClient.query(SEARCH_VARIANTS, { term: '' });
      const rows = res.bbbProductVariantSearch as Array<{ sku: string }>;
      expect(
        rows.length,
        'expected at least the just-created fixture variant',
      ).toBeGreaterThan(0);
      expect(rows.map(r => r.sku)).toContain(leakedSku);
    });

    it("a tenant admin cannot find another channel's variant by its SKU", async () => {
      await asTenantAdmin();
      const res: any = await adminClient.query(SEARCH_VARIANTS, { term: leakedSku });
      const skus = (res.bbbProductVariantSearch as Array<{ sku: string }>).map(r => r.sku);
      expect(skus).not.toContain(leakedSku);
    });

    it('a tenant admin gets nothing for an empty term (no cross-tenant enumeration)', async () => {
      await asTenantAdmin();
      const res: any = await adminClient.query(SEARCH_VARIANTS, { term: '' });
      expect(res.bbbProductVariantSearch).toEqual([]);
    });
  });
});
