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

const CREATE_BBB_ORGANIZATION = gql`
  mutation CreateBbbOrganization($input: CreateBbbOrganizationInput!) {
    createBbbOrganization(input: $input) {
      id
      channelId
      slug
      name
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
      plugins: [TenantPlugin, BigBlueButtonPlugin],
    }),
  );

  // Shared state populated during tests
  let tenantAChannelId: string;
  let tenantAChannelToken: string;
  let tenantAAdminId: string;
  let tenantAEmail: string;

  let tenantBChannelId: string;
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
      tenantBChannelToken = channelToken;
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 2. Create a BbbOrganization for each tenant (SuperAdmin platform op)
  // ═══════════════════════════════════════════════════════════════════════

  describe('createBbbOrganization (SuperAdmin)', () => {
    beforeAll(() => {
      adminClient.asSuperAdmin();
      adminClient.setChannelToken('');
    });

    it('creates an organization for tenant A channel', async () => {
      const result = await adminClient.query(CREATE_BBB_ORGANIZATION, {
        input: {
          channelId: tenantAChannelId,
          slug: `academy-a-${Date.now()}`,
          name: 'Academy A',
        },
      });

      orgAId = result.createBbbOrganization.id;
      expect(orgAId).toBeTruthy();
      expect(result.createBbbOrganization.channelId).toBe(tenantAChannelId);
    });

    it('creates an organization for tenant B channel', async () => {
      const result = await adminClient.query(CREATE_BBB_ORGANIZATION, {
        input: {
          channelId: tenantBChannelId,
          slug: `academy-b-${Date.now()}`,
          name: 'Academy B',
        },
      });

      orgBId = result.createBbbOrganization.id;
      expect(orgBId).toBeTruthy();
      expect(result.createBbbOrganization.channelId).toBe(tenantBChannelId);
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
      expect(bbbOrganization.channelId).toBe(tenantAChannelId);
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
      expect(bbbOrganizations.items[0].channelId).toBe(tenantAChannelId);
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
