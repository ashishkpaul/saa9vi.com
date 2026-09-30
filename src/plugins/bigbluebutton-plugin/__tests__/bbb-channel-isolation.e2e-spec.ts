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
 *   6. H2 — `createBbbCapacityGrant` / `deleteBbbOrganization` are platform-only:
 *      a tenant admin can neither mint capacity nor delete its own organization,
 *      while a platform operator still can.
 *   7. H3 — `bbbCapacityGrants` is channel-asserted (INV-029): a tenant admin can
 *      read only its own channel's grants.
 *   8. BUG-046 — `bbbMeetings` derives the tenant's organization set from
 *      ctx.channelId; cross-tenant organizationId/roomId arguments are rejected
 *      and the unrestricted listing stays platform-only. Also carries the
 *      A13/BUG-048 regression: MeetingCompletedEvent.organizationId is set.
 *   9. H1 — `updateBbbOrganization` allowlist (BUG-047): tenants may change only
 *      name/recordingEnabled; suspended + capacity limits are platform-only.
 *   10. BUG-050 — `createBbbOrganization` cannot target a foreign channel.
 *   11. S2 (Phase 4) — billing reads derive the org from the channel (D3),
 *       recordingUrl never crosses tenants, platform billing surfaces are
 *       platform-only, money is half-up via computeMonthChargePaise (D2/Q2).
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
import {
  EventBus,
  mergeConfig,
  RequestContext,
  TransactionalConnection,
} from '@vendure/core';
import { getSuperadminContext } from '@vendure/testing/lib/utils/get-superadmin-context';
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
import { verifyTenantAdminViaApi } from '../../tenant-plugin/e2e/fixtures/verify-tenant-admin';
import { BbbMeeting } from '../entities/bbb-meeting.entity';
import { BbbOrganization } from '../entities/bbb-organization.entity';
import { BbbRoom } from '../entities/bbb-room.entity';
import { BbbMeteredUsage } from '../entities/bbb-metered-usage.entity';
import { MeetingCompletedEvent } from '../events/bbb-events';
import { BbbMeetingService } from '../services/bbb-meeting.service';
import {
  DEFAULT_RATE_PLACEHOLDER_PAISE_PER_LEARNER_HOUR,
  MEETING_STATE,
} from '../constants';

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

// ─── BUG-046 / H1 / BUG-050 (S1) documents ─────────────────────────────────
// `bbbMeetings` is the channel-isolation read under test (BUG-046),
// `createBbbOrganization` the cross-channel write guard (BUG-050), and
// `bbbOrganizationAdminState` the allowlist read-back (BUG-047-H1).

const BBB_MEETINGS = gql`
  query BbbMeetings($organizationId: ID, $roomId: ID, $options: BbbMeetingListOptions) {
    bbbMeetings(organizationId: $organizationId, roomId: $roomId, options: $options) {
      items {
        id
        organization {
          id
        }
      }
      totalItems
    }
  }
`;

const CREATE_BBB_ORGANIZATION = gql`
  mutation CreateBbbOrganization($input: CreateBbbOrganizationInput!) {
    createBbbOrganization(input: $input) {
      id
      channelId
    }
  }
`;

const CREATE_BBB_ROOM = gql`
  mutation CreateBbbRoom($input: CreateBbbRoomInput!) {
    createBbbRoom(input: $input) {
      id
      name
    }
  }
`;

const BBB_ORGANIZATION_ADMIN_STATE = gql`
  query BbbOrganizationAdminState($id: ID!) {
    bbbOrganization(id: $id) {
      id
      name
      suspended
      recordingEnabled
      concurrentMeetingLimit
      maxParticipantsPerMeeting
      maxSessionsPerOrg
    }
  }
`;

// ─── S2 (Phase 4) billing read documents ───────────────────────────────────
// D3: no organizationId variable exists on the tenant queries — §11 proves the
// schema rejects one. SET_BBB_ORGANIZATION_BILLING is the platform-only H1
// mutation; BBB_BILLING_SUMMARY_WITH_ORG is the deliberate D3-violation probe.

const BBB_BILLING_SUMMARY = gql`
  query BbbBillingSummary($month: String) {
    bbbBillingSummary(month: $month) {
      month
      ratePaisePerHour
      totalLearnerMinutes
      totalChargePaise
      spendLimitPaise
      spendLimitReached
      byRoom {
        roomId
        roomName
        learnerMinutes
        chargePaise
      }
    }
  }
`;

const BBB_BILLING_SUMMARY_WITH_ORG = gql`
  query BbbBillingSummaryWithOrg($month: String, $organizationId: ID) {
    bbbBillingSummary(month: $month, organizationId: $organizationId) {
      month
    }
  }
`;

const BBB_METERED_MEETINGS = gql`
  query BbbMeteredMeetings($month: String, $skip: Int, $take: Int) {
    bbbMeteredMeetings(month: $month, skip: $skip, take: $take) {
      items {
        id
        title
        roomId
        roomName
        startedAt
        completedAt
        peakLearners
        peakModerators
        learnerMinutes
        chargePaise
        billingCapped
        recordingUrl
      }
      totalItems
    }
  }
`;

const BBB_PLATFORM_BILLING_SUMMARY = gql`
  query BbbPlatformBillingSummary($month: String) {
    bbbPlatformBillingSummary(month: $month) {
      month
      totalLearnerMinutes
      totalChargePaise
      byOrganization {
        organizationId
        organizationName
        learnerMinutes
        chargePaise
      }
    }
  }
`;

const SET_BBB_ORGANIZATION_BILLING = gql`
  mutation SetBbbOrganizationBilling(
    $organizationId: ID!
    $billingMode: String!
    $ratePaisePerLearnerHour: Int
    $monthlySpendLimitPaise: Int
    $suspended: Boolean!
  ) {
    setBbbOrganizationBilling(
      organizationId: $organizationId
      billingMode: $billingMode
      ratePaisePerLearnerHour: $ratePaisePerLearnerHour
      monthlySpendLimitPaise: $monthlySpendLimitPaise
      suspended: $suspended
    ) {
      id
      billingMode
      ratePaisePerLearnerHour
      monthlySpendLimitPaise
      suspended
    }
  }
`;

// ─── H2/H3 (SEC-008) documents ─────────────────────────────────────────────
// `createBbbCapacityGrant` is the H2 platform-only mutation; `bbbCapacityGrants`
// is the H3 channel-asserted read (BUG-047 sibling / BUG-049).

const CREATE_BBB_CAPACITY_GRANT = gql`
  mutation CreateBbbCapacityGrant($input: CreateBbbCapacityGrantInput!) {
    createBbbCapacityGrant(input: $input) {
      id
      grantedMinutes
      sourceType
    }
  }
`;

const BBB_CAPACITY_GRANTS = gql`
  query BbbCapacityGrants($organizationId: ID!) {
    bbbCapacityGrants(organizationId: $organizationId) {
      items {
        id
        grantedMinutes
        sourceType
      }
      totalItems
    }
  }
`;

/**
 * Awaits a rejection and returns the error itself, so a denial can be asserted
 * for its *reason* (`not currently authorized` = permission layer, `Forbidden` =
 * channel assert) instead of passing on any failure — e.g. a malformed document.
 */
async function rejectionOf(promise: Promise<unknown>): Promise<any> {
  return promise.then(
    () => null,
    (e: unknown) => e,
  );
}

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

  // S1 (§8–§10) shared fixtures/helpers — assigned in §8's beforeAll.
  let connection: TransactionalConnection;
  let superCtx: RequestContext;
  let orgA: BbbOrganization;
  let orgB: BbbOrganization;

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

      // 3.7.3 login gate (GHSA-wr5h-x3x6-4h23): complete Phase 1.5
      // verification through the application API before any admin login.
      await verifyTenantAdminViaApi(server, shopClient, tenantAEmail);
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

      // 3.7.3 login gate — verify tenant B's admin too (see tenant A above).
      await verifyTenantAdminViaApi(server, shopClient, tenantBEmail);
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

  // ═══════════════════════════════════════════════════════════════════════
  // 6. H2 — capacity governance is platform-only (SEC-008 / BUG-047 sibling)
  //    A tenant admin must not be able to mint capacity grants or delete its
  //    own organization; the platform tier still must. The tenant boundary is
  //    the permission (BBBPlatformInfrastructure), never a tenant-role edit.
  // ═══════════════════════════════════════════════════════════════════════

  describe('H2 — capacity governance is platform-only', () => {
    beforeAll(async () => {
      await adminClient.asUserWithCredentials(tenantAEmail, 'StrongP@ss1');
      adminClient.setChannelToken(tenantAChannelToken);
    });

    it('tenant A admin CANNOT mint a capacity grant, and no row is written', async () => {
      // Own-channel read is legitimate (H3), so it is also the "nothing was
      // written" probe: the rejected mutation must not have created a row.
      const before: any = await adminClient.query(BBB_CAPACITY_GRANTS, {
        organizationId: orgAId,
      });

      const mintError = await rejectionOf(
        adminClient.query(CREATE_BBB_CAPACITY_GRANT, {
          input: { organizationId: orgAId, grantedMinutes: 60_000 },
        }),
      );
      // The permission layer must be what refuses: the tenant admin role holds
      // BbbManageOrganizations but not BBBPlatformInfrastructure.
      expect(mintError).toBeTruthy();
      expect(String(mintError.message)).toMatch(/not currently authorized/i);

      const after: any = await adminClient.query(BBB_CAPACITY_GRANTS, {
        organizationId: orgAId,
      });
      expect(after.bbbCapacityGrants.totalItems).toBe(
        before.bbbCapacityGrants.totalItems,
      );
      expect(
        after.bbbCapacityGrants.items.some(
          (g: any) => g.grantedMinutes === 60_000,
        ),
      ).toBe(false);
    });

    it('tenant A admin CANNOT delete its own organization', async () => {
      const deleteError = await rejectionOf(
        adminClient.query(DELETE_BBB_ORGANIZATION, {
          id: orgAId,
        }),
      );
      expect(deleteError).toBeTruthy();
      // Denied at the permission layer (BBBPlatformInfrastructure), not by the
      // service channel assert — the tenant *owns* this org.
      expect(String(deleteError.message)).toMatch(/not currently authorized/i);

      // Rejection must be a gate, not a partial delete: the org is still there
      // and still readable by its own tenant.
      const { bbbOrganization } = await adminClient.query(BBB_ORGANIZATION, {
        id: orgAId,
      });
      expect(bbbOrganization.id).toBe(orgAId);
    });

    it('platform operator CAN mint the grant, and tenant A can then read it', async () => {
      await adminClient.asSuperAdmin();
      const created: any = await adminClient.query(CREATE_BBB_CAPACITY_GRANT, {
        input: { organizationId: orgAId, grantedMinutes: 60_000 },
      });
      expect(created.createBbbCapacityGrant.grantedMinutes).toBe(60_000);
      // BUG-044: a platform override stays distinguishable from a purchase.
      expect(created.createBbbCapacityGrant.sourceType).toBe('manual');

      // The platform write is visible to the owning tenant on its own channel
      // (the legitimate H3 path) — proving the retarget gated the actor, not the
      // data.
      await adminClient.asUserWithCredentials(tenantAEmail, 'StrongP@ss1');
      adminClient.setChannelToken(tenantAChannelToken);
      const listed: any = await adminClient.query(BBB_CAPACITY_GRANTS, {
        organizationId: orgAId,
      });
      const manual = listed.bbbCapacityGrants.items.find(
        (g: any) => g.id === created.createBbbCapacityGrant.id,
      );
      expect(manual).toBeTruthy();
      expect(manual.sourceType).toBe('manual');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 7. H3 — grant reads are channel-asserted (BUG-049 / INV-029)
  // ═══════════════════════════════════════════════════════════════════════

  describe('H3 — bbbCapacityGrants is channel-asserted', () => {
    beforeAll(async () => {
      await adminClient.asUserWithCredentials(tenantBEmail, 'StrongP@ss2');
      adminClient.setChannelToken(tenantBChannelToken);
    });

    it('tenant B admin CANNOT read tenant A grants (cross-tenant read closed)', async () => {
      const readError = await rejectionOf(
        adminClient.query(BBB_CAPACITY_GRANTS, {
          organizationId: orgAId,
        }),
      );
      expect(readError).toBeTruthy();
      // Unlike the H2 denials, this one passes the permission layer (tenant B
      // also holds BbbManageOrganizations) and is refused by the channel assert
      // in BbbChannelAccessService — i.e. the fix is the assert, not the gate.
      // Vendure's ForbiddenError i18n message is "You are not currently
      // authorized to perform this action" (error.forbidden), so match that
      // rather than the literal word "forbidden".
      expect(String(readError.message)).toMatch(/not currently authorized/i);
    });

    it('tenant B admin CAN still read its own grants', async () => {
      const { bbbCapacityGrants } = await adminClient.query(
        BBB_CAPACITY_GRANTS,
        { organizationId: orgBId },
      );
      // Own-channel reads stay legitimate: the org auto-provisions exactly one
      // unbounded `internal_overhead` grant (FEAT-002).
      expect(bbbCapacityGrants.totalItems).toBeGreaterThanOrEqual(1);
      expect(
        bbbCapacityGrants.items.some(
          (g: any) => g.sourceType === 'internal_overhead',
        ),
      ).toBe(true);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 8. BUG-046 — bbbMeetings derives tenant scope from ctx.channelId
  //    (INV-029), plus the A13/BUG-048 regression assertion.
  // ═══════════════════════════════════════════════════════════════════════

  describe('BUG-046 — bbbMeetings channel scope (INV-029)', () => {
    let meetingA: BbbMeeting;
    let meetingB: BbbMeeting;
    let roomAEncoded: string;
    let roomBEncoded: string;

    beforeAll(async () => {
      connection = server.app.get(TransactionalConnection);
      superCtx = await getSuperadminContext(server.app);
      const orgRepo = connection.getRepository(superCtx, BbbOrganization);
      orgA = (await orgRepo.findOne({
        where: { channelId: tenantAChannelId },
      }))!;
      orgB = (await orgRepo.findOne({
        where: { channelId: tenantBChannelId },
      }))!;
      expect(orgA).toBeTruthy();
      expect(orgB).toBeTruthy();

      // Rooms via the tenant-visible mutation — DB-only, no provisioning.
      await adminClient.asUserWithCredentials(tenantAEmail, 'StrongP@ss1');
      adminClient.setChannelToken(tenantAChannelToken);
      const roomA: any = await adminClient.query(CREATE_BBB_ROOM, {
        input: { organizationId: orgAId, name: 'Iso Room A' },
      });
      roomAEncoded = roomA.createBbbRoom.id;

      await adminClient.asUserWithCredentials(tenantBEmail, 'StrongP@ss2');
      adminClient.setChannelToken(tenantBChannelToken);
      const roomB: any = await adminClient.query(CREATE_BBB_ROOM, {
        input: { organizationId: orgBId, name: 'Iso Room B' },
      });
      roomBEncoded = roomB.createBbbRoom.id;

      // Fixture meetings inserted directly — no BBB API / queue involvement.
      // Room PKs come from the repository (raw, strategy-independent): a
      // T_-encoded GraphQL id must never reach a column — the completion path
      // treats meeting.roomId as a raw room PK.
      const roomRepo = connection.getRepository(superCtx, BbbRoom);
      const rawRoomA = await roomRepo.findOne({ where: { name: 'Iso Room A' } });
      const rawRoomB = await roomRepo.findOne({ where: { name: 'Iso Room B' } });
      expect(rawRoomA).toBeTruthy();
      expect(rawRoomB).toBeTruthy();

      const meetingRepo = connection.getRepository(superCtx, BbbMeeting);
      meetingA = await meetingRepo.save(
        meetingRepo.create({
          title: 'Iso meeting A',
          state: MEETING_STATE.ACTIVE,
          organization: orgA,
          roomId: String(rawRoomA!.id),
          provisionedAt: new Date(),
        }),
      );
      meetingB = await meetingRepo.save(
        meetingRepo.create({
          title: 'Iso meeting B',
          state: MEETING_STATE.ACTIVE,
          organization: orgB,
          roomId: String(rawRoomB!.id),
          provisionedAt: new Date(),
        }),
      );
    });

    it('tenant A with no arguments reads ONLY tenant A meetings', async () => {
      await adminClient.asUserWithCredentials(tenantAEmail, 'StrongP@ss1');
      adminClient.setChannelToken(tenantAChannelToken);
      const { bbbMeetings } = await adminClient.query(BBB_MEETINGS);
      expect(bbbMeetings.totalItems).toBeGreaterThanOrEqual(1);
      expect(
        bbbMeetings.items.every((m: any) => m.organization.id === orgAId),
      ).toBe(true);
      expect(
        bbbMeetings.items.some((m: any) => m.organization.id === orgBId),
      ).toBe(false);
    });

    it('tenant A with its own organizationId still reads its meetings', async () => {
      const { bbbMeetings } = await adminClient.query(BBB_MEETINGS, {
        organizationId: orgAId,
      });
      expect(bbbMeetings.totalItems).toBeGreaterThanOrEqual(1);
      expect(
        bbbMeetings.items.every((m: any) => m.organization.id === orgAId),
      ).toBe(true);
    });

    it('tenant A CANNOT read tenant B meetings via organizationId', async () => {
      const err = await rejectionOf(
        adminClient.query(BBB_MEETINGS, { organizationId: orgBId }),
      );
      expect(String(err.message)).toMatch(/not currently authorized/i);
    });

    it('tenant A CANNOT read tenant B meetings via roomId', async () => {
      const err = await rejectionOf(
        adminClient.query(BBB_MEETINGS, { roomId: roomBEncoded }),
      );
      expect(String(err.message)).toMatch(/not currently authorized/i);
    });

    it('tenant A with its own roomId reads only its own room meetings', async () => {
      const { bbbMeetings } = await adminClient.query(BBB_MEETINGS, {
        roomId: roomAEncoded,
      });
      expect(bbbMeetings.totalItems).toBeGreaterThanOrEqual(1);
      expect(
        bbbMeetings.items.every((m: any) => m.organization.id === orgAId),
      ).toBe(true);
    });

    it('platform (SuperAdmin) still lists meetings across tenants', async () => {
      await adminClient.asSuperAdmin();
      const { bbbMeetings } = await adminClient.query(BBB_MEETINGS);
      const orgIds = bbbMeetings.items.map((m: any) => m.organization.id);
      expect(orgIds).toContain(orgAId);
      expect(orgIds).toContain(orgBId);
    });

    it('A13 regression: MeetingCompletedEvent carries the organization id (BUG-048)', async () => {
      const meetingService = server.app.get(BbbMeetingService);
      const events: MeetingCompletedEvent[] = [];
      const sub = server.app
        .get(EventBus)
        .ofType(MeetingCompletedEvent)
        .subscribe(e => events.push(e));
      try {
        await meetingService.completeMeetingLifecycle(
          superCtx,
          meetingA.id as string,
          { source: 'manual' },
        );
      } finally {
        sub.unsubscribe();
      }
      expect(events).toHaveLength(1);
      expect(String(events[0].organizationId)).toBe(String(orgA.id));
      expect(String(events[0].organizationId)).not.toBe('undefined');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 9. H1 — organization update allowlist (BUG-047): tenants may change only
  //    name/recordingEnabled; suspended + capacity limits are platform-only.
  // ═══════════════════════════════════════════════════════════════════════

  describe('H1 — organization update allowlist (BUG-047)', () => {
    let beforeState: any;

    beforeAll(async () => {
      await adminClient.asUserWithCredentials(tenantAEmail, 'StrongP@ss1');
      adminClient.setChannelToken(tenantAChannelToken);
      const state: any = await adminClient.query(BBB_ORGANIZATION_ADMIN_STATE, {
        id: orgAId,
      });
      beforeState = state.bbbOrganization;
    });

    it('tenant A CAN still change name and recordingEnabled', async () => {
      const res: any = await adminClient.query(UPDATE_BBB_ORGANIZATION, {
        id: orgAId,
        input: { name: 'Academy A (renamed)', recordingEnabled: true },
      });
      expect(res.updateBbbOrganization.name).toBe('Academy A (renamed)');
    });

    const platformOnly: Array<[string, Record<string, unknown>]> = [
      ['suspended', { suspended: true }],
      ['maxSessionsPerOrg', { maxSessionsPerOrg: 7 }],
      ['concurrentMeetingLimit', { concurrentMeetingLimit: 9 }],
      ['maxParticipantsPerMeeting', { maxParticipantsPerMeeting: 99 }],
    ];
    for (const [label, input] of platformOnly) {
      it(`tenant A CANNOT set ${label} on its own org`, async () => {
        const err = await rejectionOf(
          adminClient.query(UPDATE_BBB_ORGANIZATION, { id: orgAId, input }),
        );
        // The allowlist rejects loudly at the service layer (ForbiddenError),
        // not the permission gate — the tenant owns this org.
        expect(String(err.message)).toMatch(/not currently authorized/i);
      });
    }

    it('the rejected writes left no partial state', async () => {
      const state: any = await adminClient.query(BBB_ORGANIZATION_ADMIN_STATE, {
        id: orgAId,
      });
      expect(state.bbbOrganization.suspended).toBe(beforeState.suspended);
      expect(state.bbbOrganization.maxSessionsPerOrg).toBe(
        beforeState.maxSessionsPerOrg,
      );
      expect(state.bbbOrganization.concurrentMeetingLimit).toBe(
        beforeState.concurrentMeetingLimit,
      );
      expect(state.bbbOrganization.maxParticipantsPerMeeting).toBe(
        beforeState.maxParticipantsPerMeeting,
      );
      // The allowlisted write from the positive case did stick.
      expect(state.bbbOrganization.recordingEnabled).toBe(true);
    });

    it('platform (SuperAdmin) CAN still set suspended', async () => {
      await adminClient.asSuperAdmin();
      const res: any = await adminClient.query(UPDATE_BBB_ORGANIZATION, {
        id: orgAId,
        input: { suspended: true },
      });
      expect(res.updateBbbOrganization.id).toBe(orgAId);
      const set: any = await adminClient.query(BBB_ORGANIZATION_ADMIN_STATE, {
        id: orgAId,
      });
      expect(set.bbbOrganization.suspended).toBe(true);

      await adminClient.query(UPDATE_BBB_ORGANIZATION, {
        id: orgAId,
        input: { suspended: false },
      });
      const restored: any = await adminClient.query(
        BBB_ORGANIZATION_ADMIN_STATE,
        { id: orgAId },
      );
      expect(restored.bbbOrganization.suspended).toBe(false);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 10. BUG-050 — createBbbOrganization cannot target a foreign channel
  //     (INV-001: Channel=Tenant).
  // ═══════════════════════════════════════════════════════════════════════

  describe('BUG-050 — createBbbOrganization cannot target a foreign channel', () => {
    beforeAll(async () => {
      await adminClient.asUserWithCredentials(tenantAEmail, 'StrongP@ss1');
      adminClient.setChannelToken(tenantAChannelToken);
    });

    it('tenant A CANNOT create an organization on tenant B channel', async () => {
      const err = await rejectionOf(
        adminClient.query(CREATE_BBB_ORGANIZATION, {
          input: {
            channelId: tenantBChannelIdEncoded,
            slug: 'foreign-org-attempt',
            name: 'Foreign Org',
          },
        }),
      );
      expect(String(err.message)).toMatch(/not currently authorized/i);

      // Nothing landed on channel B: exactly the provisioned org remains.
      const count = await connection
        .getRepository(superCtx, BbbOrganization)
        .count({ where: { channelId: tenantBChannelId } });
      expect(count).toBe(1);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 11. S2 — billing read API (D3/INV-029): tenant billing reads derive the
  //     org from the channel, recordingUrl never crosses tenants, platform
  //     billing surfaces are platform-only, money is half-up via D2/Q2.
  // ═══════════════════════════════════════════════════════════════════════

  describe('S2 — billing reads, recordingUrl isolation, platform-only billing (D2/D3)', () => {
    const SEED_MONTH = '2030-01';
    const EMPTY_MONTH = '2030-02';
    const REC_A = 'https://playback.a.example/iso-a';
    const REC_B = 'https://playback.b.example/iso-b';
    let meetingA: BbbMeeting;
    let meetingB: BbbMeeting;

    beforeAll(async () => {
      // §8's fixture vars are describe-scoped — re-resolve by their unique names.
      const meetingRepo = connection.getRepository(superCtx, BbbMeeting);
      const roomRepo = connection.getRepository(superCtx, BbbRoom);
      meetingA = (await meetingRepo.findOne({
        where: { title: 'Iso meeting A' },
      }))!;
      meetingB = (await meetingRepo.findOne({
        where: { title: 'Iso meeting B' },
      }))!;
      const roomA = (await roomRepo.findOne({ where: { name: 'Iso Room A' } }))!;
      const roomB = (await roomRepo.findOne({ where: { name: 'Iso Room B' } }))!;
      expect(meetingA).toBeTruthy();
      expect(meetingB).toBeTruthy();
      expect(roomA).toBeTruthy();
      expect(roomB).toBeTruthy();

      // recordingUrl is populated by the rap-publish-ended webhook in
      // production; seed it directly to prove the isolation boundary (Q2 add).
      await meetingRepo.update(String(meetingA.id), { recordingUrl: REC_A });
      await meetingRepo.update(String(meetingB.id), { recordingUrl: REC_B });

      const usageRepo = connection.getRepository(superCtx, BbbMeteredUsage);
      // Upsert, not insert: §8's A13 completion already wrote a zero-minute
      // usage row for meetingA (metered orgs bill on completion), and the
      // unique meetingId index forbids a second row — reseed that row instead.
      const seed = async (row: any) => {
        const existing = await usageRepo.findOne({
          where: { meetingId: row.meetingId },
        });
        if (existing) {
          await usageRepo.save(Object.assign(existing, row));
        } else {
          await usageRepo.save(usageRepo.create(row));
        }
      };
      // Tenant A — 90 min @ 2000 paise/hr (room-linked) + 1 min @ 90 paise/hr
      // (roomless): Σ = 180090, /60 = 3001.5 → half-up 3002 (D2 end-to-end).
      await seed({
        meetingId: String(meetingA.id),
        organizationId: String(orgA.id),
        channelId: String(orgA.channelId),
        roomId: String(roomA.id),
        startedAt: new Date('2030-01-10T10:00:00Z'),
        completedAt: new Date('2030-01-10T11:30:00Z'),
        learnerMinutes: 90,
        peakLearners: 5,
        peakModerators: 1,
        ratePaisePerHour: 2000,
        periodMonth: SEED_MONTH,
      });
      // Summary-only row (no bbb_meeting row): counted in money, never listed.
      await seed({
        meetingId: 'iso-synthetic-a2',
        organizationId: String(orgA.id),
        channelId: String(orgA.channelId),
        startedAt: new Date('2030-01-11T10:00:00Z'),
        completedAt: new Date('2030-01-11T10:01:00Z'),
        learnerMinutes: 1,
        peakLearners: 0,
        peakModerators: 0,
        ratePaisePerHour: 90,
        periodMonth: SEED_MONTH,
      });
      // Tenant B — 60 min @ 1000 paise/hr (the cross-tenant read must never see it).
      await seed({
        meetingId: String(meetingB.id),
        organizationId: String(orgB.id),
        channelId: String(orgB.channelId),
        roomId: String(roomB.id),
        startedAt: new Date('2030-01-12T10:00:00Z'),
        completedAt: new Date('2030-01-12T11:00:00Z'),
        learnerMinutes: 60,
        peakLearners: 4,
        peakModerators: 1,
        ratePaisePerHour: 1000,
        periodMonth: SEED_MONTH,
      });
    });

    it('tenant A summary derives the org from the channel and rounds half-up once (D3/D2)', async () => {
      await adminClient.asUserWithCredentials(tenantAEmail, 'StrongP@ss1');
      adminClient.setChannelToken(tenantAChannelToken);
      const { bbbBillingSummary } = await adminClient.query(BBB_BILLING_SUMMARY, {
        month: SEED_MONTH,
      });
      expect(bbbBillingSummary.month).toBe(SEED_MONTH);
      expect(bbbBillingSummary.totalLearnerMinutes).toBe(91);
      // (90×2000 + 1×90) / 60 = 3001.5 → 3002 — the ONE rounding pass (D2/Q2).
      expect(bbbBillingSummary.totalChargePaise).toBe(3002);
      // No per-org override and no plugin option in this suite → placeholder.
      expect(bbbBillingSummary.ratePaisePerHour).toBe(
        DEFAULT_RATE_PLACEHOLDER_PAISE_PER_LEARNER_HOUR,
      );
      expect(bbbBillingSummary.spendLimitPaise).toBeNull();
      expect(bbbBillingSummary.spendLimitReached).toBe(false);
      expect(bbbBillingSummary.byRoom).toHaveLength(2);
      const roomRow = bbbBillingSummary.byRoom.find((r: any) => r.roomId);
      const roomless = bbbBillingSummary.byRoom.find((r: any) => r.roomId === null);
      expect(roomRow.roomName).toBe('Iso Room A');
      expect(roomRow.learnerMinutes).toBe(90);
      expect(roomRow.chargePaise).toBe(3000);
      expect(roomless.learnerMinutes).toBe(1);
      expect(roomless.chargePaise).toBe(2); // 1.5 → 2, half-up
    });

    it('tenant A metered history exposes recordingUrl — and NEVER tenant B\'s (isolation)', async () => {
      const res = await adminClient.query(BBB_METERED_MEETINGS, { month: SEED_MONTH });
      const { bbbMeteredMeetings } = res;
      // The summary-only synthetic row is counted in money but never listed.
      expect(bbbMeteredMeetings.totalItems).toBe(1);
      const [row] = bbbMeteredMeetings.items;
      expect(row.title).toBe('Iso meeting A');
      expect(row.recordingUrl).toBe(REC_A);
      expect(row.roomName).toBe('Iso Room A');
      expect(row.learnerMinutes).toBe(90);
      expect(row.chargePaise).toBe(3000);
      const wire = JSON.stringify(res);
      expect(wire).not.toContain(REC_B);
      expect(wire).not.toContain('Iso meeting B');
    });

    it('an empty month returns zeros — not an error', async () => {
      const { bbbBillingSummary } = await adminClient.query(BBB_BILLING_SUMMARY, {
        month: EMPTY_MONTH,
      });
      expect(bbbBillingSummary.totalLearnerMinutes).toBe(0);
      expect(bbbBillingSummary.totalChargePaise).toBe(0);
      expect(bbbBillingSummary.byRoom).toHaveLength(0);
      const { bbbMeteredMeetings } = await adminClient.query(BBB_METERED_MEETINGS, {
        month: EMPTY_MONTH,
      });
      expect(bbbMeteredMeetings.totalItems).toBe(0);
      expect(bbbMeteredMeetings.items).toHaveLength(0);
    });

    it('D3: the tenant billing summary accepts NO organizationId argument', async () => {
      const err = await rejectionOf(
        adminClient.query(BBB_BILLING_SUMMARY_WITH_ORG, {
          month: SEED_MONTH,
          organizationId: orgBId,
        }),
      );
      expect(String(err.message)).toMatch(/Unknown argument "organizationId"/);
    });

    it('tenant A CANNOT read the platform billing roll-up', async () => {
      const err = await rejectionOf(
        adminClient.query(BBB_PLATFORM_BILLING_SUMMARY, { month: SEED_MONTH }),
      );
      expect(String(err.message)).toMatch(/not currently authorized/i);
    });

    it('tenant A CANNOT call setBbbOrganizationBilling (H1 gate)', async () => {
      const err = await rejectionOf(
        adminClient.query(SET_BBB_ORGANIZATION_BILLING, {
          organizationId: orgAId,
          billingMode: 'metered',
          ratePaisePerLearnerHour: 1,
          monthlySpendLimitPaise: 1,
          suspended: false,
        }),
      );
      expect(String(err.message)).toMatch(/not currently authorized/i);
    });

    it('platform CAN set rate + spend limit; the tenant summary reflects them', async () => {
      await adminClient.asSuperAdmin();
      const set: any = await adminClient.query(SET_BBB_ORGANIZATION_BILLING, {
        organizationId: orgAId,
        billingMode: 'metered',
        ratePaisePerLearnerHour: 1500,
        monthlySpendLimitPaise: 500_000,
        suspended: false,
      });
      expect(set.setBbbOrganizationBilling.billingMode).toBe('metered');
      expect(set.setBbbOrganizationBilling.ratePaisePerLearnerHour).toBe(1500);
      expect(set.setBbbOrganizationBilling.monthlySpendLimitPaise).toBe(500_000);

      await adminClient.asUserWithCredentials(tenantAEmail, 'StrongP@ss1');
      adminClient.setChannelToken(tenantAChannelToken);
      const summary: any = (
        await adminClient.query(BBB_BILLING_SUMMARY, { month: SEED_MONTH })
      ).bbbBillingSummary;
      expect(summary.ratePaisePerHour).toBe(1500);
      expect(summary.spendLimitPaise).toBe(500_000);
      expect(summary.spendLimitReached).toBe(false); // 3002 < 500000

      // Flip the ceiling below the charge — the guard flag must flip with it.
      await adminClient.asSuperAdmin();
      await adminClient.query(SET_BBB_ORGANIZATION_BILLING, {
        organizationId: orgAId,
        billingMode: 'metered',
        ratePaisePerLearnerHour: 1500,
        monthlySpendLimitPaise: 1000,
        suspended: false,
      });
      await adminClient.asUserWithCredentials(tenantAEmail, 'StrongP@ss1');
      adminClient.setChannelToken(tenantAChannelToken);
      const reached: any = (
        await adminClient.query(BBB_BILLING_SUMMARY, { month: SEED_MONTH })
      ).bbbBillingSummary;
      expect(reached.spendLimitPaise).toBe(1000);
      expect(reached.spendLimitReached).toBe(true);
    });

    it('an invalid billingMode is rejected (validation, not a silent write)', async () => {
      await adminClient.asSuperAdmin();
      const err = await rejectionOf(
        adminClient.query(SET_BBB_ORGANIZATION_BILLING, {
          organizationId: orgAId,
          billingMode: 'bogus',
          suspended: false,
        }),
      );
      expect(String(err.message)).toMatch(/billingMode must be/);
    });

    it('clearing rate/limit (null) restores the placeholder default + unlimited', async () => {
      await adminClient.asSuperAdmin();
      await adminClient.query(SET_BBB_ORGANIZATION_BILLING, {
        organizationId: orgAId,
        billingMode: 'metered',
        ratePaisePerLearnerHour: null,
        monthlySpendLimitPaise: null,
        suspended: false,
      });
      await adminClient.asUserWithCredentials(tenantAEmail, 'StrongP@ss1');
      adminClient.setChannelToken(tenantAChannelToken);
      const summary: any = (
        await adminClient.query(BBB_BILLING_SUMMARY, { month: SEED_MONTH })
      ).bbbBillingSummary;
      expect(summary.ratePaisePerHour).toBe(
        DEFAULT_RATE_PLACEHOLDER_PAISE_PER_LEARNER_HOUR,
      );
      expect(summary.spendLimitPaise).toBeNull();
      expect(summary.spendLimitReached).toBe(false);
    });

    it('platform roll-up aggregates both tenants with one half-up pass (D2)', async () => {
      await adminClient.asSuperAdmin();
      const { bbbPlatformBillingSummary } = await adminClient.query(
        BBB_PLATFORM_BILLING_SUMMARY,
        { month: SEED_MONTH },
      );
      expect(bbbPlatformBillingSummary.totalLearnerMinutes).toBe(151);
      // (180090 + 60000) / 60 = 4001.5 → 4002 — one rounding pass across tenants.
      expect(bbbPlatformBillingSummary.totalChargePaise).toBe(4002);
      const rows = bbbPlatformBillingSummary.byOrganization;
      expect(rows).toHaveLength(2);
      expect(rows[0].organizationId).toBe(orgAId);
      expect(rows[0].learnerMinutes).toBe(91);
      expect(rows[0].chargePaise).toBe(3002);
      expect(rows[1].organizationId).toBe(orgBId);
      expect(rows[1].chargePaise).toBe(1000);
    });
  });
});
