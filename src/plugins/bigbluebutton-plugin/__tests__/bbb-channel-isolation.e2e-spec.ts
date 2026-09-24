/**
 * bigbluebutton-plugin e2e tests — Phase A: cross-tenant channel isolation
 *
 * Verifies the security boundary enforced by BbbChannelAccessService:
 *
 *   "A tenant administrator operating under channel X must never
 *    read or mutate BBB resources whose owning organization
 *    does not belong to channel X."
 *
 * Scenarios covered:
 *   1. Tenant A creates a BbbOrganization for its channel (via SuperAdmin).
 *   2. Tenant B creates a BbbOrganization for its channel (via SuperAdmin).
 *   3. Tenant A admin CAN read/update its own organization.
 *   4. Tenant A admin CANNOT read/update/delete tenant B's organization
 *      (ForbiddenError).
 *   5. Tenant A admin's bbbOrganizations list only returns channel A's org.
 *
 * Run:  npm run test:e2e:bbb-isolation
 *
 * Requires a running Postgres instance. Connection credentials are read from
 * the same .env variables used by the dev server (DB_HOST, DB_PORT, DB_NAME,
 * DB_USERNAME, DB_PASSWORD, DB_SCHEMA). The initializer creates a dedicated
 * test schema (e2e_bbb_isolation) so it never touches dev/production data.
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
import { SchemaPostgresInitializer } from '../../tenant-plugin/e2e/schema-postgres-initializer';
import { mergeConfig } from '@vendure/core';
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
} from 'vitest';

import { TenantPlugin } from '../../tenant-plugin/tenant-plugin.plugin';
import { BigBlueButtonPlugin } from '../bigbluebutton.plugin';
import { CmsPlugin } from '../../cms/cms.plugin';
import { ReviewsPlugin } from '../../reviews/reviews-plugin';
import { SubscriptionPlugin } from '../../subscription/subscription.plugin';
import { E2E_INITIAL_DATA } from '../../tenant-plugin/e2e/fixtures/e2e-initial-data';

// ─── Postgres initializer — isolated schema ────────────────────────────────
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

const BBB_ORGANIZATION = gql`
  query BbbOrganization($id: ID!) {
    bbbOrganization(id: $id) {
      id
      channelId
      slug
      name
    }
  }
`;

const BBB_ORGANIZATIONS = gql`
  query BbbOrganizations {
    bbbOrganizations {
      items {
        id
        channelId
        slug
        name
      }
      totalItems
    }
  }
`;

const UPDATE_BBB_ORGANIZATION = gql`
  mutation UpdateBbbOrganization($id: ID!, $input: UpdateBbbOrganizationInput!) {
    updateBbbOrganization(id: $id, input: $input) {
      id
      name
    }
  }
`;

const DELETE_BBB_ORGANIZATION = gql`
  mutation DeleteBbbOrganization($id: ID!) {
    deleteBbbOrganization(id: $id)
  }
`;

// ─── Test suite ───────────────────────────────────────────────────────────

describe('BBB Channel Isolation (Phase A)', () => {
  const { server, adminClient, shopClient } = createTestEnvironment(
    mergeConfig(testConfig, {
      apiOptions: { port: 3071 },
      authOptions: {
        // BUG-037 root-cause fix (same class as BUG-033): registerNewTenant
        // creates admins with user.verified=false, and testConfig defaults
        // authOptions.requireVerification=true, so tenant-channel logins return
        // a null CurrentUser ("Cannot return null for non-nullable field
        // CurrentUser.id"). This suite authenticates tenant admins via
        // asUserWithCredentials, so verification must be disabled here too.
        requireVerification: false,
      },
      dbConnectionOptions: {
        type: 'postgres',
        host: process.env.DB_HOST ?? 'localhost',
        port: Number(process.env.DB_PORT ?? 5432),
        database: process.env.DB_NAME ?? 'vendure',
        username: process.env.DB_USERNAME ?? 'vendure_user',
        password: process.env.DB_PASSWORD ?? '',
        // Isolated schema keeps test data fully separate from dev data.
        schema: 'e2e_bbb_isolation',
        synchronize: true,
      },
      plugins: [
        TenantPlugin,
        BigBlueButtonPlugin,
        // BUG-037: TENANT_ADMIN_ROLE_PERMISSIONS grants CMS (CreateCmsArticle,
        // …), Reviews ( REVIEW_ADMIN_PERMISSION) and relies on the subscription
        // tables (ADR-043 theming/entitlement gate reads them via
        // TransactionalConnection). Vendure rejects any permission that no
        // loaded plugin has registered — with only TenantPlugin +
        // BigBlueButtonPlugin, registerNewTenant failed with
        // 'The permission "CreateCmsArticle" may not be assigned', which
        // cascaded into every downstream case. This mirrors the plugin set of
        // the green tenant-plugin.e2e-spec.ts.
        CmsPlugin,
        ReviewsPlugin,
        SubscriptionPlugin.init({}) as any,
      ],
    }),
  );

  // Shared state populated during tests
  //
  // Two forms of each channel id are needed, because the API boundary encodes
  // ids (TestingEntityIdStrategy: `T_2`) while the BbbOrganization.channelId
  // *column* stores the decoded internal form (`2`) — the same distinction
  // marketplace.e2e-spec.ts documents. GraphQL assertions use the encoded form;
  // repository reads (and the tenant-plugin invariant) use the internal one.
  let tenantAChannelId: string;
  let tenantAChannelIdEncoded: string;
  let tenantAChannelToken: string;
  let tenantAAdminId: string;
  let tenantAEmail: string;

  let tenantBChannelId: string;
  let tenantBChannelIdEncoded: string;
  let tenantBChannelToken: string;
  let tenantBEmail: string;

  let orgAId: string;
  let orgBId: string;

  // ── Bootstrap ────────────────────────────────────────────────────────────

  beforeAll(async () => {
    await server.init({
      initialData: E2E_INITIAL_DATA,
      productsCsvPath: path.join(
        __dirname,
        '../../tenant-plugin/e2e/fixtures/e2e-products.csv',
      ),
      customerCount: 2,
    });
  }, 120_000);

  afterAll(async () => {
    await server.destroy();
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 1. Register two independent tenants
  // ═══════════════════════════════════════════════════════════════════════

  describe('registerNewTenant', () => {
    beforeAll(() => {
      shopClient.setChannelToken(E2E_DEFAULT_CHANNEL_TOKEN);
    });

    it('registers tenant A', async () => {
      tenantAEmail = `bbb-tenant-a-${Date.now()}@example.com`;

      const result = await shopClient.query(REGISTER_NEW_TENANT, {
        input: {
          businessName: 'BBB Academy A',
          firstName: 'A',
          lastName: 'Admin',
          emailAddress: tenantAEmail,
          password: 'StrongP@ss1',
          timezone: 'Asia/Kolkata',
        },
      });

      const { channelId, channelToken, administratorId } =
        result.registerNewTenant;
      expect(channelId).toBeTruthy();
      expect(channelToken).toMatch(/^tok_/);
      expect(administratorId).toBeTruthy();

      tenantAChannelId = channelId.replace(/^T_/, '');
      tenantAChannelIdEncoded = channelId;
      tenantAChannelToken = channelToken;
      tenantAAdminId = administratorId;
    });

    it('registers tenant B', async () => {
      tenantBEmail = `bbb-tenant-b-${Date.now()}@example.com`;

      const result = await shopClient.query(REGISTER_NEW_TENANT, {
        input: {
          businessName: 'BBB Academy B',
          firstName: 'B',
          lastName: 'Admin',
          emailAddress: tenantBEmail,
          password: 'StrongP@ss2',
          timezone: 'Asia/Kolkata',
        },
      });

      const { channelId, channelToken } = result.registerNewTenant;
      expect(channelId.replace(/^T_/, '')).not.toEqual(tenantAChannelId);
      expect(channelToken).not.toEqual(tenantAChannelToken);

      tenantBChannelId = channelId.replace(/^T_/, '');
      tenantBChannelIdEncoded = channelId;
      tenantBChannelToken = channelToken;
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 2. BbbOrganization provisioning — one org per tenant channel
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * BUG-037: this phase used to *create* the org with
   * `createBbbOrganization` as SuperAdmin, which could never pass:
   *
   *  - `beforeAll` called `adminClient.asSuperAdmin()` **without await**. That
   *    is a login round-trip (`createTestEnvironment` does not pre-authenticate
   *    the admin client), so the mutation raced the login, ran unauthenticated,
   *    and Vendure answered "You are not currently authorized to perform this
   *    action" (RequestContext.userHasPermissions() is false with no user).
   *  - it then called `setChannelToken('')`, leaving ctx.channelId unset, which
   *    makes its own call to userHasPermissions() return false unconditionally —
   *    so even an authenticated SuperAdmin failed every @Allow(...) check.
   *  - the org already existed by then anyway: BBB owns org provisioning via
   *    `BbbTenantProvisioningListener`, which creates it on TenantRegisteredEvent
   *    using a ctx scoped to the tenant channel — required, because
   *    `BbbOrganizationService.create()` calls `assignToCurrentChannel()`, so a
   *    default-channel ctx would mis-assign the org's channels manyToMany.
   *
   * This phase therefore asserts the real production path instead: each tenant
   * channel gets exactly one org, and it resolves the GraphQL ids the remaining
   * isolation phases operate on. The listener is asynchronous, so poll until the
   * row appears (same pattern as marketplace.e2e-spec.ts's `ensureOrg`).
   */
  describe('BbbOrganization provisioning (per tenant channel)', () => {
    const waitForChannelOrgId = async (
      channelIdEncoded: string,
      token: string,
    ) => {
      adminClient.setChannelToken(token);
      const deadline = Date.now() + 20_000;
      for (;;) {
        const { bbbOrganizations } = await adminClient.query(BBB_ORGANIZATIONS);
        if (bbbOrganizations.totalItems > 0) {
          // Exactly one org for this tenant, and it belongs to this channel.
          expect(bbbOrganizations.totalItems).toBe(1);
          expect(bbbOrganizations.items[0].channelId).toBe(channelIdEncoded);
          return bbbOrganizations.items[0].id as string;
        }
        if (Date.now() > deadline) {
          throw new Error(
            `No BbbOrganization provisioned for channel ${channelIdEncoded}`,
          );
        }
        await new Promise((r) => setTimeout(r, 250));
      }
    };

    it('provisions an organization for tenant A channel', async () => {
      await adminClient.asUserWithCredentials(tenantAEmail, 'StrongP@ss1');
      orgAId = await waitForChannelOrgId(
        tenantAChannelIdEncoded,
        tenantAChannelToken,
      );
      expect(orgAId).toBeTruthy();
    });

    it('provisions an organization for tenant B channel', async () => {
      await adminClient.asUserWithCredentials(tenantBEmail, 'StrongP@ss2');
      orgBId = await waitForChannelOrgId(
        tenantBChannelIdEncoded,
        tenantBChannelToken,
      );
      expect(orgBId).toBeTruthy();
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 3. Tenant A admin — own-org access (should succeed)
  // ═══════════════════════════════════════════════════════════════════════

  describe('Tenant A admin — own organization', () => {
    beforeAll(async () => {
      // Login as tenant A admin and switch to tenant A channel
      await adminClient.asUserWithCredentials(tenantAEmail, 'StrongP@ss1');
      adminClient.setChannelToken(tenantAChannelToken);
    });

    it('can read its own organization', async () => {
      const { bbbOrganization } = await adminClient.query(BBB_ORGANIZATION, {
        id: orgAId,
      });
      expect(bbbOrganization).toBeTruthy();
      expect(bbbOrganization.channelId).toBe(tenantAChannelIdEncoded);
    });

    it('can update its own organization', async () => {
      const result = await adminClient.query(UPDATE_BBB_ORGANIZATION, {
        id: orgAId,
        input: { name: 'Academy A (renamed)' },
      });
      expect(result.updateBbbOrganization.name).toBe('Academy A (renamed)');
    });

    it('bbbOrganizations list only returns channel A orgs', async () => {
      const { bbbOrganizations } = await adminClient.query(BBB_ORGANIZATIONS);
      expect(bbbOrganizations.totalItems).toBe(1);
      expect(bbbOrganizations.items[0].id).toBe(orgAId);
      expect(bbbOrganizations.items[0].channelId).toBe(tenantAChannelIdEncoded);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 4. Tenant A admin — tenant B org access (must be FORBIDDEN)
  // ═══════════════════════════════════════════════════════════════════════

  describe('Tenant A admin — tenant B organization (isolation)', () => {
    beforeAll(async () => {
      // Still logged in as tenant A admin on tenant A channel
      await adminClient.asUserWithCredentials(tenantAEmail, 'StrongP@ss1');
      adminClient.setChannelToken(tenantAChannelToken);
    });

    it('CANNOT read tenant B organization', async () => {
      const promise = adminClient.query(BBB_ORGANIZATION, { id: orgBId });
      await expect(promise).rejects.toThrow();
    });

    it('CANNOT update tenant B organization', async () => {
      const promise = adminClient.query(UPDATE_BBB_ORGANIZATION, {
        id: orgBId,
        input: { name: 'Hacked' },
      });
      await expect(promise).rejects.toThrow();
    });

    it('CANNOT delete tenant B organization', async () => {
      const promise = adminClient.query(DELETE_BBB_ORGANIZATION, {
        id: orgBId,
      });
      await expect(promise).rejects.toThrow();
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 5. Tenant B admin — tenant A org access (must be FORBIDDEN)
  // ═══════════════════════════════════════════════════════════════════════

  describe('Tenant B admin — tenant A organization (isolation)', () => {
    beforeAll(async () => {
      await adminClient.asUserWithCredentials(tenantBEmail, 'StrongP@ss2');
      adminClient.setChannelToken(tenantBChannelToken);
    });

    it('CANNOT read tenant A organization', async () => {
      const promise = adminClient.query(BBB_ORGANIZATION, { id: orgAId });
      await expect(promise).rejects.toThrow();
    });

    it('CANNOT update tenant A organization', async () => {
      const promise = adminClient.query(UPDATE_BBB_ORGANIZATION, {
        id: orgAId,
        input: { name: 'Hacked' },
      });
      await expect(promise).rejects.toThrow();
    });

    it('CANNOT delete tenant A organization', async () => {
      const promise = adminClient.query(DELETE_BBB_ORGANIZATION, {
        id: orgAId,
      });
      await expect(promise).rejects.toThrow();
    });
  });
});
