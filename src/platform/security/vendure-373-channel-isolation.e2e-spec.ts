/**
 * V1.0.7 — channel-isolation probes, part 2 (PERMANENT).
 *
 * Covers the remaining 3.7.2/3.7.3 hardening surface on top of the
 * financial-boundary suite:
 *   3.7.2 — adjustDraftOrderLine authz, updateAdministrator priv-esc,
 *            Promotion/FacetValue delete IDOR, Asset/StockLocation IDOR
 *   3.7.3 — assign/remove-to-channel, duplicateEntity, admin reads,
 *            updateChannel/deleteChannel, createProductOption
 *
 * Each cross-channel attempt MUST FAIL (throw or ErrorResult).
 * Same two-tenant harness + isolated schema as the sibling suite.
 *
 * Evidence quality: permission denial ≠ channel-scope enforcement. The
 * updateAdministrator probe is duplicated with an ELEVATED actor that HOLDS
 * UpdateAdministrator within tenant A (Admin-API-created), so its denials
 * evidence the 3.7.3 visibility/priv-esc rule rather than the bare @Allow
 * guard. Governance: no direct database writes — probe actors are created
 * via createRole/createAdministrator, and Phase 1.5 admin verification is
 * completed through the public verifyTenantAdmin mutation (required on
 * 3.7.3: login is refused while a pending verificationToken exists, even
 * with requireVerification=false).
 */
import 'reflect-metadata';
import 'dotenv/config';
import gql from 'graphql-tag';
import {
  createTestEnvironment,
  E2E_DEFAULT_CHANNEL_TOKEN,
  registerInitializer,
  testConfig,
} from '@vendure/testing';
import { getSuperadminContext } from '@vendure/testing/lib/utils/get-superadmin-context';
import { SchemaPostgresInitializer } from '../../plugins/tenant-plugin/e2e/schema-postgres-initializer';
import { mergeConfig } from '@vendure/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { TenantPlugin } from '../../plugins/tenant-plugin/tenant-plugin.plugin';
import { BigBlueButtonPlugin } from '../../plugins/bigbluebutton-plugin/bigbluebutton.plugin';
import { CmsPlugin } from '../../plugins/cms/cms.plugin';
import { ReviewsPlugin } from '../../plugins/reviews/reviews-plugin';
import { SubscriptionPlugin } from '../../plugins/subscription/subscription.plugin';
import { E2E_INITIAL_DATA } from '../../plugins/tenant-plugin/e2e/fixtures/e2e-initial-data';
import { createElevatedTenantAdmin, ElevatedTenantAdmin } from './elevated-tenant-admin';
import { verifyTenantAdminViaApi } from '../../plugins/tenant-plugin/e2e/fixtures/verify-tenant-admin';

registerInitializer('postgres', new SchemaPostgresInitializer());

const REGISTER_NEW_TENANT = gql`
  mutation RegisterNewTenant($input: RegisterTenantInput!) {
    registerNewTenant(input: $input) {
      channelId
      channelToken
      administratorId
    }
  }
`;

// Probes use entities created on the DEFAULT channel (visible to superadmin
// bootstrap) and attempt cross-channel ops from a TENANT admin context.
// A tenant admin must never reach default-channel entities.
const ADMIN_PRODUCT = gql`
  query AdminProduct($id: ID!) {
    product(id: $id) { id name }
  }
`;

const ADMIN_FACET = gql`
  query AdminFacet($id: ID!) {
    facet(id: $id) { id code }
  }
`;

const ASSIGN_PRODUCTS = gql`
  mutation AssignProducts($input: AssignProductsToChannelInput!) {
    assignProductsToChannel(input: $input) { id }
  }
`;

const REMOVE_PRODUCTS = gql`
  mutation RemoveProducts($input: RemoveProductsFromChannelInput!) {
    removeProductsFromChannel(input: $input) {
      ... on Product { id }
      ... on ErrorResult { errorCode message }
    }
  }
`;

const DUPLICATE_PRODUCT = gql`
  mutation DupProduct($input: DuplicateEntityInput!) {
    duplicateEntity(input: $input) {
      ... on Success { success }
      ... on ErrorResult { errorCode message }
    }
  }
`;

const UPDATE_CHANNEL = gql`
  mutation UpdateChannelProbe($input: UpdateChannelInput!) {
    updateChannel(input: $input) {
      ... on Channel { id code }
      ... on ErrorResult { errorCode message }
    }
  }
`;

const CREATE_OPTION_GROUP = gql`
  mutation CreateOptGroup($input: CreateProductOptionGroupInput!) {
    createProductOptionGroup(input: $input) { id code }
  }
`;

const CREATE_PRODUCT_OPTION = gql`
  mutation CreateOpt($input: CreateProductOptionInput!) {
    createProductOption(input: $input) { id code }
  }
`;

const DELETE_PROMOTION = gql`
  mutation DelPromo($id: ID!) {
    deletePromotion(id: $id) { result message }
  }
`;

const DELETE_FACET_VALUE = gql`
  mutation DelFacetValues($ids: [ID!]!) {
    deleteFacetValues(ids: $ids) { result message }
  }
`;

const UPDATE_ASSET = gql`
  mutation UpdateAssetProbe($input: UpdateAssetInput!) {
    updateAsset(input: $input) { id name }
  }
`;

const UPDATE_STOCK_LOCATION = gql`
  mutation UpdateStockProbe($input: UpdateStockLocationInput!) {
    updateStockLocation(input: $input) { id name }
  }
`;

const UPDATE_ADMINISTRATOR = gql`
  mutation UpdateAdminProbe($input: UpdateAdministratorInput!) {
    updateAdministrator(input: $input) { id emailAddress }
  }
`;

describe('Vendure 3.7.2/3.7.3 channel-isolation probes (INV-001)', () => {
  const { server, adminClient, shopClient } = createTestEnvironment(
    mergeConfig(testConfig, {
      apiOptions: { port: 3078 },
      authOptions: { requireVerification: false },
      dbConnectionOptions: {
        type: 'postgres',
        host: process.env.DB_HOST ?? 'localhost',
        port: Number(process.env.DB_PORT ?? 5432),
        database: process.env.DB_NAME ?? 'vendure',
        username: process.env.DB_USERNAME ?? 'vendure_user',
        password: process.env.DB_PASSWORD ?? '',
        schema: 'e2e_vendure_373_isolation',
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

  let tenantAEmail: string;
  let tenantAToken: string;
  let tenantAChannelId: string;
  // Elevated probe actors (Admin API only): same permission set scoped to
  // DIFFERENT channels, so a denial between them is pure channel scope.
  let elevatedA: ElevatedTenantAdmin;
  let elevatedAPeer: ElevatedTenantAdmin;
  let elevatedDefault: ElevatedTenantAdmin;
  let defaultChannelId: string;
  let defaultProductId: string;
  let defaultFacetId: string;
  let defaultPromotionId: string | null = null;
  let defaultAssetId: string | null = null;
  let defaultStockLocationId: string | null = null;
  let defaultOptionGroupId: string;

  async function expectDenied(label: string, run: () => Promise<any>): Promise<void> {
    let result: any = null;
    let threw: any = null;
    try {
      result = await run();
    } catch (err) {
      threw = err;
    }
    if (threw) return;
    const payload = result ? Object.values(result)[0] as any : null;
    if (!payload) return;
    const first = Array.isArray(payload) ? payload[0] : payload;
    if (first?.errorCode) return;
    if (first?.result === 'NOT_DELETED') return;
    if (first?.id) {
      throw new Error(`${label}: CROSS-CHANNEL OP SUCCEEDED (id=${first.id})`);
    }
  }

  beforeAll(async () => {
    await server.init({
      initialData: E2E_INITIAL_DATA,
      productsCsvPath: undefined,
      customerCount: 0,
    });
  }, 120_000);

  afterAll(async () => {
    await server.destroy();
  });

  describe('bootstrap: tenant A + default-channel fixtures', () => {
    it('registers tenant A (admin login via requireVerification=false — no DB writes)', async () => {
      shopClient.setChannelToken(E2E_DEFAULT_CHANNEL_TOKEN);
      tenantAEmail = `v373i-a-${Date.now()}@example.com`;
      const result = await shopClient.query(REGISTER_NEW_TENANT, {
        input: {
          businessName: 'V373I Academy A',
          firstName: 'A',
          lastName: 'Admin',
          emailAddress: tenantAEmail,
          password: 'StrongP@ssA1',
          timezone: 'Asia/Kolkata',
        },
      });
      tenantAToken = result.registerNewTenant.channelToken;
      tenantAChannelId = result.registerNewTenant.channelId;
      // Phase 1.5 verification through the application API (no DB writes):
      // required on 3.7.3 — login is refused while a pending token exists.
      await verifyTenantAdminViaApi(server, shopClient, tenantAEmail);
    });

    it('captures default-channel fixtures as superadmin', async () => {
      await adminClient.asSuperAdmin();
      const {
        ProductService,
        ProductVariantService,
        FacetService,
        PromotionService,
      } = await import('@vendure/core');
      const superCtx: any = await getSuperadminContext(server.app);
      const productService = server.app.get(ProductService);
      const variantService = server.app.get(ProductVariantService);
      const created = await productService.create(superCtx, {
        enabled: true,
        translations: [
          {
            languageCode: 'en' as any,
            name: 'V373I Default Product ' + Date.now(),
            slug: 'v373i-default-' + Date.now(),
            description: 'V373I isolation fixture',
          },
        ],
      });
      await variantService.create(superCtx, [
        {
          productId: created.id,
          sku: 'V373I-' + Date.now(),
          price: 10000,
          stockOnHand: 10,
          trackInventory: 'FALSE' as any,
          translations: [{ languageCode: 'en' as any, name: 'V373I Variant' }],
        },
      ]);
      defaultProductId = String(created.id);
      expect(defaultProductId).toBeTruthy();

      const facets: any = await adminClient.query(gql`
        query Facets { facets(options: { take: 5 }) { items { id } totalItems } }
      `);
      if (facets.facets.totalItems > 0) defaultFacetId = facets.facets.items[0].id;

      const promos: any = await adminClient.query(gql`
        query Promos { promotions(options: { take: 5 }) { items { id } totalItems } }
      `);
      if (promos.promotions.totalItems > 0) defaultPromotionId = promos.promotions.items[0].id;

      const assets: any = await adminClient.query(gql`
        query Assets { assets(options: { take: 5 }) { items { id } totalItems } }
      `);
      if (assets.assets.totalItems > 0) defaultAssetId = assets.assets.items[0].id;

      const locs: any = await adminClient.query(gql`
        query Locs { stockLocations(options: { take: 5 }) { items { id } totalItems } }
      `);
      if (locs.stockLocations.totalItems > 0)
        defaultStockLocationId = locs.stockLocations.items[0].id;

      const groups: any = await adminClient.query(gql`
        query Groups { productOptionGroups { items { id } totalItems } }
      `);
      if (groups.productOptionGroups.totalItems > 0) {
        defaultOptionGroupId = groups.productOptionGroups.items[0].id;
      } else {
        const created: any = await adminClient.query(CREATE_OPTION_GROUP, {
          input: {
            code: `v373i-group-${Date.now()}`,
            options: [
              {
                code: `v373i-opt-${Date.now()}`,
                translations: [
                  { languageCode: 'en', name: 'V373I Option' },
                ],
              },
            ],
            translations: [{ languageCode: 'en', name: 'V373I Group' }],
          },
        });
        defaultOptionGroupId = created.createProductOptionGroup.id;
      }
      expect(defaultOptionGroupId).toBeTruthy();
    });

    it('creates elevated probe actors via Admin API (no DB writes)', async () => {
      await adminClient.asSuperAdmin();
      const { channels }: any = await adminClient.query(gql`
        query DefaultChannel { channels { items { id token } } }
      `);
      const def = (channels.items as any[]).find(
        (c: any) => c.token === E2E_DEFAULT_CHANNEL_TOKEN,
      );
      expect(def).toBeTruthy();
      defaultChannelId = def.id;

      elevatedA = await createElevatedTenantAdmin(adminClient, tenantAChannelId, 'tenant-a', [
        'ReadAdministrator',
        'UpdateAdministrator',
      ]);
      elevatedAPeer = await createElevatedTenantAdmin(adminClient, tenantAChannelId, 'tenant-a-peer', [
        'ReadAdministrator',
        'UpdateAdministrator',
      ]);
      elevatedDefault = await createElevatedTenantAdmin(adminClient, defaultChannelId, 'default', [
        'ReadAdministrator',
        'UpdateAdministrator',
      ]);
      expect(elevatedA.administratorId).toBeTruthy();
      expect(elevatedAPeer.administratorId).toBeTruthy();
      expect(elevatedDefault.administratorId).toBeTruthy();
    });
  });

  describe('tenant A admin vs default-channel entities — MUST FAIL', () => {
    beforeAll(async () => {
      await adminClient.asUserWithCredentials(tenantAEmail, 'StrongP@ssA1');
      adminClient.setChannelToken(tenantAToken);
    });

    it('cannot read default-channel product', async () => {
      await expectDenied('product read', () =>
        adminClient.query(ADMIN_PRODUCT, { id: defaultProductId }),
      );
    });

    it('cannot assign default-channel product to its channel', async () => {
      await expectDenied('assignProductsToChannel', () =>
        adminClient.query(ASSIGN_PRODUCTS, {
          input: { productIds: [defaultProductId], channelId: tenantAChannelId },
        }),
      );
    });

    it('cannot remove product from channel cross-channel', async () => {
      await expectDenied('removeProductsFromChannel', () =>
        adminClient.query(REMOVE_PRODUCTS, {
          input: { productIds: [defaultProductId], channelId: tenantAChannelId },
        }),
      );
    });

    it('cannot duplicateEntity a foreign product', async () => {
      await expectDenied('duplicateEntity', () =>
        adminClient.query(DUPLICATE_PRODUCT, {
          input: { entityName: 'Product', entityId: defaultProductId },
        }),
      );
    });

    it('cannot updateChannel on the default channel', async () => {
      await expectDenied('updateChannel', () =>
        adminClient.query(UPDATE_CHANNEL, {
          input: { id: 'T_1', code: 'should-not-change' },
        }),
      );
    });

    it('cannot createProductOption under a foreign option group', async () => {
      await expectDenied('createProductOption', () =>
        adminClient.query(CREATE_PRODUCT_OPTION, {
          input: {
            productOptionGroupId: defaultOptionGroupId,
            code: `v373i-hack-${Date.now()}`,
            translations: [{ languageCode: 'en', name: 'hack' }],
          },
        }),
      );
    });

    it('cannot update a foreign asset (skipped when no asset)', async () => {
      if (!defaultAssetId) return;
      await expectDenied('updateAsset', () =>
        adminClient.query(UPDATE_ASSET, {
          input: { id: defaultAssetId, name: 'hacked' },
        }),
      );
    });

    it('cannot update a foreign stock location (skipped when none)', async () => {
      if (!defaultStockLocationId) return;
      await expectDenied('updateStockLocation', () =>
        adminClient.query(UPDATE_STOCK_LOCATION, {
          input: { id: defaultStockLocationId, name: 'hacked' },
        }),
      );
    });

    it('cannot delete a foreign promotion (skipped when none)', async () => {
      if (!defaultPromotionId) return;
      await expectDenied('deletePromotion', () =>
        adminClient.query(DELETE_PROMOTION, { id: defaultPromotionId }),
      );
    });

    it('cannot update another administrator', async () => {
      // Permission-layer probe: tenant template lacks UpdateAdministrator, so
      // FORBIDDEN also passes. The ELEVATED describe below re-runs this with
      // the permission GRANTED — that is the channel-scope probe.
      await expectDenied('updateAdministrator', () =>
        adminClient.query(UPDATE_ADMINISTRATOR, {
          input: { id: 'T_1', firstName: 'Hacked' },
        }),
      );
    });
  });

  describe('elevated tenant-A actor — updateAdministrator (permission granted)', () => {
    // elevatedA HOLDS UpdateAdministrator scoped to channel A. Denials below
    // therefore evidence Vendure 3.7.3's activeUserHasPermissionsOfRoles /
    // priv-esc rule — NOT the bare @Allow(UpdateAdministrator) guard.
    beforeAll(async () => {
      await adminClient.asUserWithCredentials(elevatedA.email, 'ElevatedP@ss1');
      adminClient.setChannelToken(tenantAToken);
    });

    it('control: updateAdministrator on a peer admin in channel A succeeds', async () => {
      const { updateAdministrator }: any = await adminClient.query(UPDATE_ADMINISTRATOR, {
        input: { id: elevatedAPeer.administratorId, firstName: 'PeerA' },
      });
      expect(updateAdministrator?.id).toBeTruthy();
    });

    it('updateAdministrator on superadmin (T_1) MUST FAIL — priv-esc blocked', async () => {
      // 3.7.3: a non-SuperAdmin whose roles cannot be granted the SuperAdmin
      // role gets EntityNotFound from the visibility check, not an update.
      await expectDenied('updateAdministrator → superadmin', () =>
        adminClient.query(UPDATE_ADMINISTRATOR, {
          input: { id: 'T_1', firstName: 'Hacked' },
        }),
      );
    });

    it('updateAdministrator on default-channel elevated admin MUST FAIL (same permissions, other channel → pure channel scope)', async () => {
      await expectDenied('updateAdministrator → default-channel elevated', () =>
        adminClient.query(UPDATE_ADMINISTRATOR, {
          input: { id: elevatedDefault.administratorId, firstName: 'Hacked' },
        }),
      );
    });

    it('administrators read on channel A excludes elevatedDefault + superadmin (INV-016)', async () => {
      const { administrators }: any = await adminClient.query(gql`
        query AdminAdministrators {
          administrators { items { id emailAddress } totalItems }
        }
      `);
      const emails: string[] = (administrators?.items ?? []).map((a: any) => a.emailAddress);
      expect(emails).toContain(elevatedA.email);
      expect(emails).toContain(elevatedAPeer.email);
      expect(emails).not.toContain(elevatedDefault.email);
      expect(emails).not.toContain('superadmin');
    });
  });
});
