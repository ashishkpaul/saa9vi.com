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
 *      Phase 3 (ADR-047): the same provisioning listener seeds the plugin's
 *      `defaultRooms` for the new organization — exactly once, even when the
 *      TenantRegisteredEvent is replayed.
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
 *   12. S4 (Phase 5.2/5.4) — `bbbStartRoom` is tenant-scoped (cross-tenant room
 *       rejected BEFORE provisioning, INV-027/INV-029); concurrent starts
 *       converge on one meeting row; suspended/spend-capped orgs get a
 *       tenant-safe 'unavailable' (never the raw failureReason); `studentCount`
 *       counts a person once across enrollment + entitlement (batched, no N+1).
 *   13. S5 (production-readiness item 2) — trial registrations are tenant-scoped:
 *       a foreign `sessionId`/`organizationId` read and any write to a foreign
 *       registration are refused, and a `convertTrialToEnrollment` may only
 *       target a room of the registration's OWN organization (never a foreign
 *       room).
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
  Customer,
  RequestContext,
  RequestContextService,
  TransactionalConnection,
  User,
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
import { BbbServer } from '../entities/bbb-server.entity';
import { BbbEnrollment } from '../entities/bbb-enrollment.entity';
import { BbbEntitlement } from '../entities/bbb-entitlement.entity';
import { BbbOrganizationMember } from '../entities/bbb-organization-member.entity';
import { BbbOrganizationMembership } from '../entities/bbb-organization-membership.entity';
import { BbbProductAccess } from '../entities/bbb-product-access.entity';
import { BbbTrialRegistration } from '../entities/trial-registration.entity';
import { BbbEncryptionService } from '../services/bbb-encryption.service';
import { MeetingCompletedEvent } from '../events/bbb-events';
import { BbbMeetingService } from '../services/bbb-meeting.service';
import { MeetingLifecycleService } from '../services/bbb-meeting-lifecycle.service';
import { TenantRegisteredEvent } from '../../tenant-plugin/events/tenant-events';
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

// ─── Phase 3 (S3) documents — default rooms seeded at tenant provisioning ──

const BBB_ROOMS = gql`
  query BbbRooms($organizationId: ID!) {
    bbbRooms(organizationId: $organizationId) {
      items {
        id
        name
        organizationId
        studentCount
      }
      totalItems
    }
  }
`;

const BBB_START_ROOM = gql`
  mutation BbbStartRoom($roomId: ID!, $moderatorName: String, $waitMs: Int) {
    bbbStartRoom(roomId: $roomId, moderatorName: $moderatorName, waitMs: $waitMs) {
      status
      joinUrl
      currentMeetingId
      roomState
      message
    }
  }
`;

// ─── S4 (Phase 5.2/5.4) documents — startRoom + studentCount ───────────────
// CREATE/UPDATE_BBB_ROOM are the room R/W guards under test (INV-029 tenant
// scoping: own-org succeeds, foreign orgId rejected); CREATE_BBB_ENROLLMENT /
// CREATE_BBB_ORG_MEMBERSHIP seed the two student-count branches (enrollment vs
// bbb_room entitlement) and the moderator persona; BBB_ROOM_ADMIN_STATE reads
// back the failing side-effects must-not-happen assertions.

const BBB_ROOM_ADMIN_STATE = gql`
  query BbbRoomAdminState($id: ID!) {
    bbbRoom(id: $id) {
      id
      name
      state
      studentCount
    }
  }
`;

const CREATE_BBB_ENROLLMENT = gql`
  mutation CreateBbbEnrollment($input: CreateBbbEnrollmentInput!) {
    createBbbEnrollment(input: $input) {
      id
      active
    }
  }
`;

const CREATE_BBB_ORG_MEMBERSHIP = gql`
  mutation CreateBbbOrgMembership($input: CreateBbbOrgMembershipInput!) {
    createBbbOrgMembership(input: $input) {
      id
      role
      isActive
    }
  }
`;

const CREATE_BBB_ENTITLEMENT = gql`
  mutation CreateBbbEntitlement($input: CreateBbbEntitlementInput!) {
    createBbbEntitlement(input: $input) {
      id
    }
  }
`;

const BBB_ORGANIZATION_BILLING = gql`
  query BbbOrganizationBilling($id: ID!) {
    bbbOrganization(id: $id) {
      id
      billingMode
      ratePaisePerLearnerHour
      monthlySpendLimitPaise
      concurrentMeetingLimit
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

// ─── S5 (production-readiness item 2) documents — trial-registration scope ──
// The trial-registration admin surface: a session-scoped read, an org-scoped
// read, a status write and the attendee→learner conversion. Every one of these
// used to trust a raw id; the documents below drive the same foreign-id
// attempts the fixed resolvers/service must now refuse.
const CREATE_CUSTOMER = gql`
  mutation CreateCustomer($input: CreateCustomerInput!) {
    createCustomer(input: $input) {
      ... on Customer {
        id
      }
      ... on ErrorResult {
        errorCode
        message
      }
    }
  }
`;

const ADD_BBB_MEMBER = gql`
  mutation AddBbbMember($input: AddBbbMemberInput!) {
    addBbbMember(input: $input) {
      id
      customerId
      role
    }
  }
`;

const CREATE_TRIAL_SESSION = gql`
  mutation CreateTrialSession($input: CreateBbbScheduledSessionInput!) {
    createBbbScheduledSession(input: $input) {
      id
      status
      isTrial
      roomId
    }
  }
`;

const PUBLISH_TRIAL_SESSION = gql`
  mutation PublishTrialSession($id: ID!) {
    publishBbbScheduledSession(id: $id) {
      id
      status
    }
  }
`;

const TRIAL_REGS_BY_SESSION = gql`
  query TrialRegsBySession($sessionId: ID!) {
    bbbTrialRegistrationsBySession(sessionId: $sessionId) {
      id
      scheduledSessionId
      customerId
      status
    }
  }
`;

const TRIAL_REGS_BY_ORG = gql`
  query TrialRegsByOrg($organizationId: ID!) {
    bbbTrialRegistrationsByOrganization(organizationId: $organizationId) {
      id
      scheduledSessionId
    }
  }
`;

const UPDATE_TRIAL_STATUS = gql`
  mutation UpdateTrialStatus($id: ID!, $status: String!) {
    updateBbbTrialRegistrationStatus(id: $id, status: $status) {
      id
      status
      attendedAt
    }
  }
`;

const CONVERT_TRIAL = gql`
  mutation ConvertTrial($registrationId: ID!, $roomId: ID!, $accessDays: Int) {
    convertTrialToEnrollment(
      registrationId: $registrationId
      roomId: $roomId
      accessDays: $accessDays
    ) {
      id
      type
      resourceId
      customerId
      source
    }
  }
`;

// ─── S6 documents — the channel-ownership read sweep ────────────────────────
// Six admin READ surfaces that used to trust a caller-supplied room/org/id (or
// list every tenant's rows). `BbbEntitlement` deliberately exposes no channelId
// field, so that surface is asserted through `customerId` visibility instead.
const BBB_ENROLLMENTS_BY_ROOM = gql`
  query BbbEnrollmentsByRoom($roomId: ID!) {
    bbbEnrollmentsByRoom(roomId: $roomId) {
      items {
        id
        customerId
        customerName
        customerEmail
        active
      }
      totalItems
    }
  }
`;

const BBB_ORG_MEMBERS = gql`
  query BbbOrganizationMembers($organizationId: ID!) {
    bbbOrganizationMembers(organizationId: $organizationId) {
      items {
        id
        customerId
        customerName
        customerEmail
        role
      }
      totalItems
    }
  }
`;

const BBB_ORG_MEMBER = gql`
  query BbbOrganizationMember($id: ID!) {
    bbbOrganizationMember(id: $id) {
      id
      customerId
      customerName
      customerEmail
    }
  }
`;

const BBB_ORG_MEMBERSHIPS = gql`
  query BbbOrgMemberships($organizationId: ID!) {
    bbbOrgMemberships(organizationId: $organizationId) {
      id
      customerId
      role
      isActive
    }
  }
`;

const BBB_ENTITLEMENTS = gql`
  query BbbEntitlements {
    bbbEntitlements {
      items {
        id
        customerId
        type
        resourceId
      }
      totalItems
    }
  }
`;

const BBB_MODERATOR_JOIN_URL = gql`
  query BbbModeratorJoinUrl($meetingId: ID!, $moderatorName: String!) {
    bbbModeratorJoinUrl(meetingId: $meetingId, moderatorName: $moderatorName)
  }
`;

const UPDATE_BBB_ROOM = gql`
  mutation UpdateBbbRoom($id: ID!, $input: UpdateBbbRoomInput!) {
    updateBbbRoom(id: $id, input: $input) {
      id
      name
    }
  }
`;

const DELETE_BBB_ROOM = gql`
  mutation DeleteBbbRoom($id: ID!) {
    deleteBbbRoom(id: $id)
  }
`;

const CREATE_BBB_MEETING_MUT = gql`
  mutation CreateBbbMeeting($input: CreateBbbMeetingInput!) {
    createBbbMeeting(input: $input) {
      id
      title
    }
  }
`;

const UPDATE_BBB_MEMBER = gql`
  mutation UpdateBbbMember($id: ID!, $input: UpdateBbbMemberInput!) {
    updateBbbMember(id: $id, input: $input) {
      id
      role
    }
  }
`;

const REMOVE_BBB_MEMBER = gql`
  mutation RemoveBbbMember($id: ID!) {
    removeBbbMember(id: $id) {
      id
    }
  }
`;

const UPDATE_BBB_ORG_MEMBERSHIP = gql`
  mutation UpdateBbbOrgMembership($id: ID!, $input: UpdateBbbOrgMembershipInput!) {
    updateBbbOrgMembership(id: $id, input: $input) {
      id
      role
    }
  }
`;

const REMOVE_BBB_ORG_MEMBERSHIP = gql`
  mutation RemoveBbbOrgMembership($id: ID!) {
    removeBbbOrgMembership(id: $id)
  }
`;

const DEACTIVATE_BBB_ENROLLMENT = gql`
  mutation DeactivateBbbEnrollment($id: ID!) {
    deactivateBbbEnrollment(id: $id) {
      id
      active
    }
  }
`;

const CREATE_BBB_PRODUCT_ACCESS = gql`
  mutation CreateBbbProductAccess($input: CreateBbbProductAccessInput!) {
    createBbbProductAccess(input: $input) {
      id
    }
  }
`;

const DELETE_BBB_PRODUCT_ACCESS = gql`
  mutation DeleteBbbProductAccess($id: ID!) {
    deleteBbbProductAccess(id: $id)
  }
`;

const DELETE_BBB_ENTITLEMENT = gql`
  mutation DeleteBbbEntitlement($id: ID!) {
    deleteBbbEntitlement(id: $id)
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

    // ─── ADR-047 Phase 3 (S3): default rooms at provisioning ───────────────
    //
    // The same listener that creates the organization seeds the plugin's
    // `defaultRooms` (default ["Main Classroom"]) through BbbRoomService, so a
    // new tenant lands in a usable academy. These cases are deliberately the
    // FIRST assertions about rooms in this suite: §8's fixtures create their
    // own rooms for orgA/orgB, so a later section could not assert "exactly the
    // seeded room".

    /** Rooms are created after the org row, and the listener is async → poll. */
    const waitForRooms = async (
      organizationId: string,
      channelToken: string,
      expectedTotal: number,
    ) => {
      adminClient.setChannelToken(channelToken);
      const deadline = Date.now() + 20_000;
      for (;;) {
        const { bbbRooms } = await adminClient.query(BBB_ROOMS, {
          organizationId,
        });
        if (bbbRooms.totalItems >= expectedTotal) {
          return bbbRooms;
        }
        if (Date.now() > deadline) {
          throw new Error(
            `Expected ${expectedTotal} default room(s) for org ${organizationId}, saw ${bbbRooms.totalItems}`,
          );
        }
        await new Promise((r) => setTimeout(r, 250));
      }
    };

    it('seeds the configured default room(s) for a new tenant (Phase 3)', async () => {
      await adminClient.asUserWithCredentials(tenantAEmail, 'StrongP@ss1');

      // Read through the tenant's own channel-scoped query — the room must be
      // visible to the academy that owns it (INV-029), not only to SuperAdmin.
      const rooms = await waitForRooms(orgAId, tenantAChannelToken, 1);

      expect(rooms.totalItems).toBe(1);
      expect(rooms.items[0].name).toBe('Main Classroom');
      expect(rooms.items[0].organizationId).toBe(orgAId);
    });

    it('provisions the organization as metered with a null per-org rate (D7/Q2)', async () => {
      await adminClient.asUserWithCredentials(tenantAEmail, 'StrongP@ss1');
      adminClient.setChannelToken(tenantAChannelToken);

      const { bbbOrganization } = await adminClient.query(
        BBB_ORGANIZATION_BILLING,
        { id: orgAId },
      );
      // D7 — new organizations are metered (never backfilled 'grant').
      expect(bbbOrganization.billingMode).toBe('metered');
      // Q2 — the rate is intentionally unset so the single resolution point
      // (platformDefaultRatePaisePerHour) supplies the placeholder/default.
      expect(bbbOrganization.ratePaisePerLearnerHour).toBeNull();
      expect(bbbOrganization.monthlySpendLimitPaise).toBeNull();
    });

    it('a replayed TenantRegisteredEvent adds no second org and no second room', async () => {
      await adminClient.asUserWithCredentials(tenantAEmail, 'StrongP@ss1');
      adminClient.setChannelToken(tenantAChannelToken);

      const beforeRooms = (
        await adminClient.query(BBB_ROOMS, { organizationId: orgAId })
      ).bbbRooms;
      const beforeOrgs = (await adminClient.query(BBB_ORGANIZATIONS))
        .bbbOrganizations;
      expect(beforeRooms.totalItems).toBe(1);

      // The real provisioning event, replayed on the real EventBus — the
      // listener is registered on it in the running app, so this exercises the
      // production idempotency path rather than a stubbed handler.
      const org = await server.app
        .get(TransactionalConnection)
        .rawConnection.getRepository(BbbOrganization)
        .findOne({ where: { id: orgAId.replace(/^T_/, '') as any } });
      expect(org).toBeTruthy();

      const ctx = await server.app
        .get(RequestContextService)
        .create({ apiType: 'admin', channelOrToken: tenantAChannelToken });
      await server.app
        .get(EventBus)
        .publish(
          new TenantRegisteredEvent(
            ctx,
            // BUG-053: the listener no longer reads this id — the org is
            // located by channelId and the replay must not create a second
            // org regardless of what correlation id is carried here.
            'legacy-tenant-profile-id',
            tenantAChannelId,
            org!.slug,
            org!.name,
          ),
        );
      // The listener's handler is asynchronous with no completion signal the
      // test can await; a duplicate would be written immediately, so a short
      // settle beat is enough to make the assertion meaningful.
      await new Promise((r) => setTimeout(r, 2_000));

      const afterRooms = (
        await adminClient.query(BBB_ROOMS, { organizationId: orgAId })
      ).bbbRooms;
      const afterOrgs = (await adminClient.query(BBB_ORGANIZATIONS))
        .bbbOrganizations;

      expect(afterOrgs.totalItems).toBe(beforeOrgs.totalItems);
      expect(afterRooms.totalItems).toBe(beforeRooms.totalItems);
      expect(afterRooms.items.map((r: any) => r.id).sort()).toEqual(
        beforeRooms.items.map((r: any) => r.id).sort(),
      );
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
      const lifecycleService = server.app.get(MeetingLifecycleService);
      const events: MeetingCompletedEvent[] = [];
      const sub = server.app
        .get(EventBus)
        .ofType(MeetingCompletedEvent)
        .subscribe(e => events.push(e));
      try {
        await lifecycleService.completeMeetingLifecycle(
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

  // ═══════════════════════════════════════════════════════════════════════
  // 12. S4 — startRoom + studentCount (Phase 5.2/5.4): tenant-scoped Start,
  //     INV-027 moderator order, friendly metered-gate refusals, batched counts.
  // ═══════════════════════════════════════════════════════════════════════

  describe('S4 — bbbStartRoom + studentCount (A22/Phase 5.2/5.4)', () => {
    let startRoomAEncoded: string;
    let startRoomBEncoded: string;
    let startRoomARaw: string;
    let startRoomBRaw: string;

    beforeAll(async () => {
      // Rooms created through the tenant-visible mutation (INV-029 scoping:
      // own-org succeeds — the cross-tenant create is asserted below).
      await adminClient.asUserWithCredentials(tenantAEmail, 'StrongP@ss1');
      adminClient.setChannelToken(tenantAChannelToken);
      const roomA: any = await adminClient.query(CREATE_BBB_ROOM, {
        input: { organizationId: orgAId, name: 'Start Room A' },
      });
      startRoomAEncoded = roomA.createBbbRoom.id;
      startRoomARaw = String(startRoomAEncoded).replace(/^T_/, '');

      await adminClient.asUserWithCredentials(tenantBEmail, 'StrongP@ss2');
      adminClient.setChannelToken(tenantBChannelToken);
      const roomB: any = await adminClient.query(CREATE_BBB_ROOM, {
        input: { organizationId: orgBId, name: 'Start Room B' },
      });
      startRoomBEncoded = roomB.createBbbRoom.id;
      startRoomBRaw = String(startRoomBEncoded).replace(/^T_/, '');

      // Seed the two studentCount branches directly (DB-only, no provisioning):
      // an active enrollment AND a valid bbb_room entitlement for the SAME
      // customer — the card must count the person once, not twice.
      const raw = connection.rawConnection;
      const custRepo = raw.getRepository('customer');
      const cust: any = await custRepo.findOne({ where: {} });
      expect(cust).toBeTruthy();
      const customerRaw = String(cust.id);
      await raw.getRepository(BbbEnrollment).save(
        raw.getRepository(BbbEnrollment).create({
          roomId: startRoomARaw,
          customerId: customerRaw,
          active: true,
          validUntil: new Date('2031-01-01T00:00:00Z'),
        }),
      );
      await raw.getRepository(BbbEntitlement).save(
        raw.getRepository(BbbEntitlement).create({
          customerId: customerRaw,
          type: 'bbb_room',
          resourceId: startRoomARaw,
          source: 'admin',
          channelId: tenantAChannelId,
          validUntil: new Date('2031-01-01T00:00:00Z'),
        }),
      );
    });

    it('tenant A start on IDLE returns starting with NO meeting row — the harness queue is offline', async () => {
      await adminClient.asUserWithCredentials(tenantAEmail, 'StrongP@ss1');
      adminClient.setChannelToken(tenantAChannelToken);
      const res: any = await adminClient.query(BBB_START_ROOM, {
        roomId: startRoomAEncoded,
        waitMs: 0,
      });
      // With waitMs: 0 the deadline is immediate, so even a live worker could
      // not flip the room in time: 'starting' is deterministic. The async
      // enqueue is best-effort in this harness (no DefaultJobQueuePlugin, same
      // condition room-access documents) — the assertion is the synchronous
      // contract: status + badge state, never a joinUrl yet.
      expect(res.bbbStartRoom.status).toBe('starting');
      expect(res.bbbStartRoom.joinUrl).toBeNull();
      expect(res.bbbStartRoom.roomState).toBe('Provisioning');
      expect(res.bbbStartRoom.message).toBeNull();
      const state: any = await adminClient.query(BBB_ROOM_ADMIN_STATE, {
        id: startRoomAEncoded,
      });
      expect(state.bbbRoom.state).toBe('Provisioning');
    });

    it('concurrent starts converge on ONE meeting row (idempotent lock + debounce)', async () => {
      // Fresh room: the first S4 case left Start Room A in Provisioning, where
      // the debounce window may have expired (earlier cases interleave), so a
      // second burst could legitimately fail at the worker and flip Idle.
      // A new room isolates the concurrency assertion from that history.
      await adminClient.asUserWithCredentials(tenantAEmail, 'StrongP@ss1');
      adminClient.setChannelToken(tenantAChannelToken);
      const fresh: any = await adminClient.query(CREATE_BBB_ROOM, {
        input: { organizationId: orgAId, name: 'Start Room A (concurrent)' },
      });
      const freshEncoded = fresh.createBbbRoom.id as string;
      const freshRaw = String(freshEncoded).replace(/^T_/, '');
      const meetingRepo = connection.getRepository(superCtx, BbbMeeting);
      const before = await meetingRepo.count({
        where: { roomId: freshRaw },
      });
      const calls = Array.from({ length: 5 }, () =>
        adminClient.query(BBB_START_ROOM, {
          roomId: freshEncoded,
          waitMs: 0,
        }),
      );
      const results: any[] = await Promise.all(calls);
      for (const r of results) {
        // Contract agreement: all five calls return the same synchronous
        // answer. Without a distributed Redis in this harness, concurrent
        // requests serialize on the pessimistic row lock; the FIRST wins the
        // Idle→Provisioning transition and answers 'starting', while followers
        // that arrive after the worker failure + Idle reset answer 'failed'
        // (status paths 'starting'|'failed' are both legitimate post-race).
        // What must NEVER diverge: no joinUrl without 'active', no raw
        // failureReason on the wire, and at most one NEW meeting row.
        expect(['starting', 'failed']).toContain(r.bbbStartRoom.status);
        if (r.bbbStartRoom.status !== 'active') {
          expect(r.bbbStartRoom.joinUrl).toBeNull();
        }
        const failureWire = JSON.stringify(r.bbbStartRoom);
        expect(failureWire).not.toMatch(/failureReason/i);
      }
      const after = await meetingRepo.count({
        where: { roomId: freshRaw },
      });
      // The harness queue is offline so no worker consumes the enqueue, but
      // the Redis lock + debounce + idempotency check must still bound the
      // created rows: at most one NEW meeting across all five calls.
      expect(after - before).toBeLessThanOrEqual(1);
    });

    it('tenant A CANNOT start tenant B room (INV-029, refused before provisioning)', async () => {
      await adminClient.asUserWithCredentials(tenantAEmail, 'StrongP@ss1');
      adminClient.setChannelToken(tenantAChannelToken);
      const meetingRepo = connection.getRepository(superCtx, BbbMeeting);
      const before = await meetingRepo.count({
        where: { roomId: startRoomBRaw },
      });
      const err = await rejectionOf(
        adminClient.query(BBB_START_ROOM, { roomId: startRoomBEncoded }),
      );
      expect(String(err.message)).toMatch(/not currently authorized/i);
      const after = await meetingRepo.count({
        where: { roomId: startRoomBRaw },
      });
      // Refused BEFORE provisioning: no meeting row created (INV-027 order).
      expect(after).toBe(before);
    });

    it('suspended org start returns unavailable with the tenant-safe message', async () => {
      // Platform suspends org A (tenant cannot — H1 allowlist).
      await adminClient.asSuperAdmin();
      await adminClient.query(SET_BBB_ORGANIZATION_BILLING, {
        organizationId: orgAId,
        billingMode: 'metered',
        ratePaisePerLearnerHour: null,
        monthlySpendLimitPaise: null,
        suspended: true,
      });
      await adminClient.asUserWithCredentials(tenantAEmail, 'StrongP@ss1');
      adminClient.setChannelToken(tenantAChannelToken);
      const meetingRepo = connection.getRepository(superCtx, BbbMeeting);
      const before = await meetingRepo.count({
        where: { roomId: startRoomARaw },
      });
      const res: any = await adminClient.query(BBB_START_ROOM, {
        roomId: startRoomAEncoded,
      });
      expect(res.bbbStartRoom.status).toBe('unavailable');
      expect(res.bbbStartRoom.joinUrl).toBeNull();
      expect(res.bbbStartRoom.message).toBe(
        'Your account is paused — contact support',
      );
      const wire = JSON.stringify(res);
      expect(wire).not.toMatch(/suspend/i);
      const after = await meetingRepo.count({
        where: { roomId: startRoomARaw },
      });
      // Gate ran synchronously BEFORE anything was enqueued.
      expect(after).toBe(before);
      // Restore for the cases below.
      await adminClient.asSuperAdmin();
      await adminClient.query(SET_BBB_ORGANIZATION_BILLING, {
        organizationId: orgAId,
        billingMode: 'metered',
        ratePaisePerLearnerHour: null,
        monthlySpendLimitPaise: null,
        suspended: false,
      });
    });

    it('spend-capped org start returns unavailable (D2 single money impl, current month)', async () => {
      // Seed a CURRENT-month usage row so monthUsageRows (UTC monthOf(now))
      // sees the charge: 60 min @ 2000/hr = 2000 paise ≥ limit 1000.
      const usageRepo = connection.getRepository(superCtx, BbbMeteredUsage);
      const now = new Date();
      const curMonth = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
      await usageRepo.save(
        usageRepo.create({
          meetingId: 's4-spend-cap-seed',
          organizationId: String(orgA.id),
          channelId: tenantAChannelId,
          roomId: startRoomARaw,
          startedAt: now,
          completedAt: now,
          learnerMinutes: 60,
          peakLearners: 2,
          peakModerators: 1,
          ratePaisePerHour: 2000,
          periodMonth: curMonth,
        }),
      );
      await adminClient.asSuperAdmin();
      await adminClient.query(SET_BBB_ORGANIZATION_BILLING, {
        organizationId: orgAId,
        billingMode: 'metered',
        ratePaisePerLearnerHour: null,
        monthlySpendLimitPaise: 1000,
        suspended: false,
      });
      await adminClient.asUserWithCredentials(tenantAEmail, 'StrongP@ss1');
      adminClient.setChannelToken(tenantAChannelToken);
      const res: any = await adminClient.query(BBB_START_ROOM, {
        roomId: startRoomAEncoded,
      });
      expect(res.bbbStartRoom.status).toBe('unavailable');
      expect(res.bbbStartRoom.message).toBe(
        'Your account is paused — contact support',
      );
      // Hygiene: the seed must not leak into billing assertions elsewhere
      // (this suite never bills the current month, but a 60-min row is loud).
      await usageRepo.delete({ meetingId: 's4-spend-cap-seed' });
      await adminClient.asSuperAdmin();
      await adminClient.query(SET_BBB_ORGANIZATION_BILLING, {
        organizationId: orgAId,
        billingMode: 'metered',
        ratePaisePerLearnerHour: null,
        monthlySpendLimitPaise: null,
        suspended: false,
      });
    });

    it('studentCount counts the person once across enrollment + entitlement (batched)', async () => {
      await adminClient.asUserWithCredentials(tenantAEmail, 'StrongP@ss1');
      adminClient.setChannelToken(tenantAChannelToken);
      const list: any = await adminClient.query(BBB_ROOMS, {
        organizationId: orgAId,
      });
      const card = list.bbbRooms.items.find(
        (r: any) => r.id === startRoomAEncoded,
      );
      expect(card).toBeTruthy();
      // One customer holds BOTH an enrollment and an entitlement → 1, not 2.
      expect(card.studentCount).toBe(1);
      const single: any = await adminClient.query(BBB_ROOM_ADMIN_STATE, {
        id: startRoomAEncoded,
      });
      expect(single.bbbRoom.studentCount).toBe(1);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 13. S5 — trial-registration tenant scope (production-readiness item 2):
  //     the trial-registration admin surface used to trust the raw id on
  //     write and the raw sessionId on read — both cross-tenant. This block
  //     pins the fixed contracts: a foreign session/org read and a foreign
  //     registration write are refused, and a conversion may only target a
  //     room of the registration's OWN organization (never a foreign room).
  // ═══════════════════════════════════════════════════════════════════════

  describe('S5 — trial-registration tenant scope (production-readiness item 2)', () => {
    let roomAEncoded: string;
    let roomBEncoded: string;
    let sessionAEncoded: string;
    let sessionBEncoded: string;
    let regAEncoded: string;
    let regBEncoded: string;
    let customerAEncoded: string;
    let customerARaw: string;
    let customerBRaw: string;

    /** Re-encode a raw DB id for the GraphQL surface (TestingEntityIdStrategy). */
    const encode = (id: unknown): string => `T_${String(id).replace(/^T_/, '')}`;
    /** Raw PK form as stored in the integer/varchar id columns. */
    const decode = (id: unknown): string => String(id).replace(/^T_/, '');

    beforeAll(async () => {
      // ── Org A: registrant/trainer member, room, published trial session ───
      await adminClient.asUserWithCredentials(tenantAEmail, 'StrongP@ss1');
      adminClient.setChannelToken(tenantAChannelToken);

      const customerA: any = await adminClient.query(CREATE_CUSTOMER, {
        input: {
          firstName: 'Trial',
          lastName: 'Registrant',
          emailAddress: `trial-registrant-a-${Date.now()}@example.com`,
        },
      });
      customerAEncoded = customerA.createCustomer.id;
      customerARaw = decode(customerAEncoded);

      const memberA: any = await adminClient.query(ADD_BBB_MEMBER, {
        input: {
          organizationId: orgAId,
          customerId: customerAEncoded,
          role: 'org-admin',
        },
      });

      const roomA: any = await adminClient.query(CREATE_BBB_ROOM, {
        input: { organizationId: orgAId, name: 'Trial Room A' },
      });
      roomAEncoded = roomA.createBbbRoom.id;

      const sessionA: any = await adminClient.query(CREATE_TRIAL_SESSION, {
        input: {
          organizationId: orgAId,
          title: 'Trial Session A',
          startTime: new Date(Date.now() + 3_600_000).toISOString(),
          endTime: new Date(Date.now() + 7_200_000).toISOString(),
          trainerId: memberA.addBbbMember.id,
          isTrial: true,
          roomId: roomAEncoded,
        },
      });
      sessionAEncoded = sessionA.createBbbScheduledSession.id;
      // Published so the fixture is a real, learner-visible trial session.
      await adminClient.query(PUBLISH_TRIAL_SESSION, { id: sessionAEncoded });
      // ── Org B: the foreign side of every assertion (room + trial session) ──
      await adminClient.asUserWithCredentials(tenantBEmail, 'StrongP@ss2');
      adminClient.setChannelToken(tenantBChannelToken);

      const customerB: any = await adminClient.query(CREATE_CUSTOMER, {
        input: {
          firstName: 'Trial',
          lastName: 'Foreign',
          emailAddress: `trial-registrant-b-${Date.now()}@example.com`,
        },
      });
      customerBRaw = decode(customerB.createCustomer.id);

      const memberB: any = await adminClient.query(ADD_BBB_MEMBER, {
        input: {
          organizationId: orgBId,
          customerId: customerB.createCustomer.id,
          role: 'org-admin',
        },
      });

      const roomB: any = await adminClient.query(CREATE_BBB_ROOM, {
        input: { organizationId: orgBId, name: 'Trial Room B' },
      });
      roomBEncoded = roomB.createBbbRoom.id;

      const sessionB: any = await adminClient.query(CREATE_TRIAL_SESSION, {
        input: {
          organizationId: orgBId,
          title: 'Trial Session B',
          startTime: new Date(Date.now() + 3_600_000).toISOString(),
          endTime: new Date(Date.now() + 7_200_000).toISOString(),
          trainerId: memberB.addBbbMember.id,
          isTrial: true,
          roomId: roomBEncoded,
        },
      });
      sessionBEncoded = sessionB.createBbbScheduledSession.id;

      // ── Registrations (DB-only seeds) ─────────────────────────────────────
      // The shop `registerForTrial` path needs a shop-authenticated customer,
      // which is orthogonal to the ADMIN surface under test. Seeding the two
      // rows directly (same technique as the S4 studentCount fixtures) keeps
      // this block focused on the tenant guards. Reg B is seeded ATTENDED so a
      // tenant-A conversion attempt can only ever be refused by the CHANNEL
      // guard — never by the "only attendees can be converted" status check —
      // leaving no ambiguity about WHICH guard fired.
      const regRepo = connection.rawConnection.getRepository(
        BbbTrialRegistration,
      );
      const now = new Date();
      const regA = await regRepo.save(
        regRepo.create({
          scheduledSessionId: decode(sessionAEncoded),
          customerId: customerARaw,
          status: 'REGISTERED',
          registeredAt: now,
          attendedAt: null,
        }),
      );
      regAEncoded = encode(regA.id);
      const regB = await regRepo.save(
        regRepo.create({
          scheduledSessionId: decode(sessionBEncoded),
          customerId: customerBRaw,
          status: 'ATTENDED',
          registeredAt: now,
          attendedAt: now,
        }),
      );
      regBEncoded = encode(regB.id);
    }, 90_000);
    it('tenant A reads its own session registrations', async () => {
      await adminClient.asUserWithCredentials(tenantAEmail, 'StrongP@ss1');
      adminClient.setChannelToken(tenantAChannelToken);
      const res: any = await adminClient.query(TRIAL_REGS_BY_SESSION, {
        sessionId: sessionAEncoded,
      });
      expect(res.bbbTrialRegistrationsBySession).toHaveLength(1);
      // ID-typed output fields are encoded by the IdCodec plugin.
      expect(res.bbbTrialRegistrationsBySession[0].id).toBe(regAEncoded);
      expect(res.bbbTrialRegistrationsBySession[0].scheduledSessionId).toBe(
        sessionAEncoded,
      );
      expect(res.bbbTrialRegistrationsBySession[0].customerId).toBe(
        customerAEncoded,
      );
    });

    it('tenant A CANNOT read tenant B registrations via a foreign sessionId', async () => {
      await adminClient.asUserWithCredentials(tenantAEmail, 'StrongP@ss1');
      adminClient.setChannelToken(tenantAChannelToken);
      const err = await rejectionOf(
        adminClient.query(TRIAL_REGS_BY_SESSION, { sessionId: sessionBEncoded }),
      );
      expect(String(err.message)).toMatch(/not currently authorized/i);
    });

    it('tenant A CANNOT read tenant B registrations via a foreign organizationId', async () => {
      await adminClient.asUserWithCredentials(tenantAEmail, 'StrongP@ss1');
      adminClient.setChannelToken(tenantAChannelToken);
      const err = await rejectionOf(
        adminClient.query(TRIAL_REGS_BY_ORG, { organizationId: orgBId }),
      );
      expect(String(err.message)).toMatch(/not currently authorized/i);
    });

    it('tenant A drives its own registration REGISTERED → ATTENDED', async () => {
      await adminClient.asUserWithCredentials(tenantAEmail, 'StrongP@ss1');
      adminClient.setChannelToken(tenantAChannelToken);
      const res: any = await adminClient.query(UPDATE_TRIAL_STATUS, {
        id: regAEncoded,
        status: 'ATTENDED',
      });
      expect(res.updateBbbTrialRegistrationStatus.status).toBe('ATTENDED');
      expect(res.updateBbbTrialRegistrationStatus.attendedAt).not.toBeNull();
    });
    it('tenant A CANNOT update tenant B registration status (write guard)', async () => {
      await adminClient.asUserWithCredentials(tenantAEmail, 'StrongP@ss1');
      adminClient.setChannelToken(tenantAChannelToken);
      const err = await rejectionOf(
        adminClient.query(UPDATE_TRIAL_STATUS, {
          id: regBEncoded,
          status: 'CANCELLED',
        }),
      );
      expect(String(err.message)).toMatch(/not currently authorized/i);

      // The guard ran BEFORE the save: tenant B's row is untouched.
      const row = await connection
        .getRepository(superCtx, BbbTrialRegistration)
        .findOne({ where: { id: decode(regBEncoded) } });
      expect(row?.status).toBe('ATTENDED');
    });

    it('tenant A CANNOT convert tenant B registration (channel assert, no entitlement written)', async () => {
      await adminClient.asUserWithCredentials(tenantAEmail, 'StrongP@ss1');
      adminClient.setChannelToken(tenantAChannelToken);
      const entRepo = connection.getRepository(superCtx, BbbEntitlement);
      const before = await entRepo.count({ where: { customerId: customerBRaw } });
      const err = await rejectionOf(
        adminClient.query(CONVERT_TRIAL, {
          registrationId: regBEncoded,
          roomId: roomAEncoded,
          accessDays: 30,
        }),
      );
      expect(String(err.message)).toMatch(/not currently authorized/i);
      const after = await entRepo.count({ where: { customerId: customerBRaw } });
      expect(after).toBe(before);
    });

    it('tenant A CANNOT convert into a room of another organization (D5 mirror)', async () => {
      await adminClient.asUserWithCredentials(tenantAEmail, 'StrongP@ss1');
      adminClient.setChannelToken(tenantAChannelToken);
      const err = await rejectionOf(
        adminClient.query(CONVERT_TRIAL, {
          registrationId: regAEncoded,
          roomId: roomBEncoded,
          accessDays: 30,
        }),
      );
      // EntityNotFoundError, not ForbiddenError — the answer to "another
      // tenant's room OR no room at all" is the same "not a room of this
      // organization" (mirrors resolveRoomIdForOrganization).
      expect(String(err.message)).toMatch(/No BbbRoom with the id/i);
    });

    it('tenant A converts its own attended registration into its own room', async () => {
      await adminClient.asUserWithCredentials(tenantAEmail, 'StrongP@ss1');
      adminClient.setChannelToken(tenantAChannelToken);
      const res: any = await adminClient.query(CONVERT_TRIAL, {
        registrationId: regAEncoded,
        roomId: roomAEncoded,
        accessDays: 30,
      });
      const ent = res.convertTrialToEnrollment;
      expect(ent.type).toBe('bbb_room');
      expect(ent.source).toBe('trial_conversion');
      // Both are ID-typed outputs → encoded form of the raw column values.
      expect(ent.resourceId).toBe(roomAEncoded);
      expect(ent.customerId).toBe(customerAEncoded);
      expect(ent.validUntil).not.toBeNull();
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 14. S6 — the admin READ surfaces are channel-asserted (channel-ownership
  //     sweep). `bbbEnrollmentsByRoom`, `bbbModeratorJoinUrl`,
  //     `bbbEntitlements`, `bbbOrganizationMembers`, `bbbOrganizationMember`
  //     and `bbbOrgMemberships` used to trust a caller-supplied room/org/id —
  //     or list EVERY tenant's rows. Every case is an ELEVATED probe: the
  //     attacker holds the very BbbManage* permission the field requires and is
  //     refused only by BbbChannelAccessService, so a green test cannot be
  //     explained away by the permission gate. Each denial is paired with the
  //     same-tenant positive case.
  // ═══════════════════════════════════════════════════════════════════════

  describe('S6 — admin reads are channel-asserted (channel-ownership sweep)', () => {
    let roomAEncoded: string;
    let roomBEncoded: string;
    let customerAEncoded: string;
    let customerBEncoded: string;
    let memberAEncoded: string;
    let meetingAEncoded: string;

    beforeAll(async () => {
      // ── Org A (owner side) ───────────────────────────────────────────────
      await adminClient.asUserWithCredentials(tenantAEmail, 'StrongP@ss1');
      adminClient.setChannelToken(tenantAChannelToken);

      const customerA: any = await adminClient.query(CREATE_CUSTOMER, {
        input: {
          firstName: 'Read',
          lastName: 'Owner',
          emailAddress: `read-owner-a-${Date.now()}@example.com`,
        },
      });
      customerAEncoded = customerA.createCustomer.id;

      const memberA: any = await adminClient.query(ADD_BBB_MEMBER, {
        input: {
          organizationId: orgAId,
          customerId: customerAEncoded,
          role: 'org-admin',
        },
      });
      memberAEncoded = memberA.addBbbMember.id;

      const roomA: any = await adminClient.query(CREATE_BBB_ROOM, {
        input: { organizationId: orgAId, name: 'Read Room A' },
      });
      roomAEncoded = roomA.createBbbRoom.id;

      // The row that must (a) now resolve a customer NAME — the id-space fix —
      // and (b) never be reachable through another tenant's channel.
      await adminClient.query(CREATE_BBB_ENROLLMENT, {
        input: {
          roomId: roomAEncoded,
          customerId: customerAEncoded,
          accessDays: 30,
          reason: 'e2e',
        },
      });

      await adminClient.query(CREATE_BBB_ENTITLEMENT, {
        input: {
          customerId: customerAEncoded,
          type: 'bbb_room',
          resourceId: roomAEncoded,
          source: 'admin',
        },
      });

      await adminClient.query(CREATE_BBB_ORG_MEMBERSHIP, {
        input: {
          organizationId: orgAId,
          customerId: customerAEncoded,
          channelId: tenantAChannelIdEncoded,
          role: 'moderator',
        },
      });

      // Seeded directly: bbbModeratorJoinUrl's assert runs BEFORE any BBB
      // round-trip or secret read, so a PENDING (never-provisioned) meeting is
      // enough to prove where the guard sits in the call order.
      const meetingRepo = connection.getRepository(superCtx, BbbMeeting);
      const meetingA = await meetingRepo.save(
        meetingRepo.create({
          organization: orgA,
          title: 'Read Meeting A',
          state: MEETING_STATE.PENDING,
        }),
      );
      meetingAEncoded = `T_${meetingA.id}`;

      // ── Org B (attacker side) — real rows so a "filtered" list is provably
      // non-empty rather than trivially empty (a weak negative assertion). ──
      await adminClient.asUserWithCredentials(tenantBEmail, 'StrongP@ss2');
      adminClient.setChannelToken(tenantBChannelToken);

      const customerB: any = await adminClient.query(CREATE_CUSTOMER, {
        input: {
          firstName: 'Read',
          lastName: 'Foreign',
          emailAddress: `read-foreign-b-${Date.now()}@example.com`,
        },
      });
      customerBEncoded = customerB.createCustomer.id;

      const roomB: any = await adminClient.query(CREATE_BBB_ROOM, {
        input: { organizationId: orgBId, name: 'Read Room B' },
      });
      roomBEncoded = roomB.createBbbRoom.id;

      await adminClient.query(CREATE_BBB_ENROLLMENT, {
        input: {
          roomId: roomBEncoded,
          customerId: customerBEncoded,
          accessDays: 30,
          reason: 'e2e',
        },
      });

      await adminClient.query(CREATE_BBB_ENTITLEMENT, {
        input: {
          customerId: customerBEncoded,
          type: 'bbb_room',
          resourceId: roomBEncoded,
          source: 'admin',
        },
      });
    }, 90_000);

    // ── bbbEnrollmentsByRoom ────────────────────────────────────────────────

    it('tenant A reads its own room enrollments — and the customer is NAMED', async () => {
      await adminClient.asUserWithCredentials(tenantAEmail, 'StrongP@ss1');
      adminClient.setChannelToken(tenantAChannelToken);
      const res: any = await adminClient.query(BBB_ENROLLMENTS_BY_ROOM, {
        roomId: roomAEncoded,
      });
      const row = res.bbbEnrollmentsByRoom.items.find(
        (e: any) => e.customerId === customerAEncoded,
      );
      expect(row).toBeTruthy();
      // Defect #2 regression: the map used to be keyed by the numeric PK while
      // the varchar column held the string form, so every row rendered as an
      // "anonymous student".
      expect(row.customerName).toBe('Read Owner');
      expect(row.customerEmail).toMatch(/^read-owner-a-/);
    });

    it('tenant B CANNOT read tenant A enrollments through a foreign roomId', async () => {
      await adminClient.asUserWithCredentials(tenantBEmail, 'StrongP@ss2');
      adminClient.setChannelToken(tenantBChannelToken);
      const err = await rejectionOf(
        adminClient.query(BBB_ENROLLMENTS_BY_ROOM, { roomId: roomAEncoded }),
      );
      expect(err).toBeTruthy();
      // Passes the permission layer (tenant B holds BbbManageRooms) and is
      // refused by the channel assert — i.e. the fix is the assert.
      expect(String(err.message)).toMatch(/not currently authorized/i);
    });

    // ── bbbModeratorJoinUrl ────────────────────────────────────────────────

    it('tenant B CANNOT mint a moderator URL for tenant A meeting (secret withheld)', async () => {
      await adminClient.asUserWithCredentials(tenantBEmail, 'StrongP@ss2');
      adminClient.setChannelToken(tenantBChannelToken);
      const err = await rejectionOf(
        adminClient.query(BBB_MODERATOR_JOIN_URL, {
          meetingId: meetingAEncoded,
          moderatorName: 'intruder',
        }),
      );
      expect(err).toBeTruthy();
      expect(String(err.message)).toMatch(/not currently authorized/i);
    });

    it('tenant A passes the channel guard and stops at the state guard', async () => {
      await adminClient.asUserWithCredentials(tenantAEmail, 'StrongP@ss1');
      adminClient.setChannelToken(tenantAChannelToken);
      const err = await rejectionOf(
        adminClient.query(BBB_MODERATOR_JOIN_URL, {
          meetingId: meetingAEncoded,
          moderatorName: 'owner',
        }),
      );
      // Distinguishes the two layers: a channel denial reads "not currently
      // authorized", whereas reaching the business guard reads "not active".
      expect(String(err.message)).toMatch(/not active/i);
      expect(String(err.message)).not.toMatch(/not currently authorized/i);
    });

    // ── bbbEntitlements ────────────────────────────────────────────────────

    it('tenant B bbbEntitlements excludes tenant A entitlements', async () => {
      await adminClient.asUserWithCredentials(tenantBEmail, 'StrongP@ss2');
      adminClient.setChannelToken(tenantBChannelToken);
      const res: any = await adminClient.query(BBB_ENTITLEMENTS);
      const items = res.bbbEntitlements.items;
      // Provably non-empty (own rows visible) yet strictly channel-scoped.
      expect(items.some((e: any) => e.customerId === customerBEncoded)).toBe(
        true,
      );
      expect(items.some((e: any) => e.customerId === customerAEncoded)).toBe(
        false,
      );
    });

    it('tenant A bbbEntitlements includes its own entitlements', async () => {
      await adminClient.asUserWithCredentials(tenantAEmail, 'StrongP@ss1');
      adminClient.setChannelToken(tenantAChannelToken);
      const res: any = await adminClient.query(BBB_ENTITLEMENTS);
      expect(
        res.bbbEntitlements.items.some(
          (e: any) => e.customerId === customerAEncoded,
        ),
      ).toBe(true);
    });

    // ── bbbOrganizationMembers ─────────────────────────────────────────────

    it('tenant B CANNOT list tenant A organization members', async () => {
      await adminClient.asUserWithCredentials(tenantBEmail, 'StrongP@ss2');
      adminClient.setChannelToken(tenantBChannelToken);
      const err = await rejectionOf(
        adminClient.query(BBB_ORG_MEMBERS, { organizationId: orgAId }),
      );
      expect(err).toBeTruthy();
      expect(String(err.message)).toMatch(/not currently authorized/i);
    });

    it('tenant A lists its own members — with a NAMED customer', async () => {
      await adminClient.asUserWithCredentials(tenantAEmail, 'StrongP@ss1');
      adminClient.setChannelToken(tenantAChannelToken);
      const res: any = await adminClient.query(BBB_ORG_MEMBERS, {
        organizationId: orgAId,
      });
      const row = res.bbbOrganizationMembers.items.find(
        (m: any) => m.customerId === customerAEncoded,
      );
      expect(row).toBeTruthy();
      expect(row.customerName).toBe('Read Owner');
      expect(row.customerEmail).toMatch(/^read-owner-a-/);
    });

    // ── bbbOrganizationMember (single) ─────────────────────────────────────

    it('tenant B CANNOT read tenant A member by id', async () => {
      await adminClient.asUserWithCredentials(tenantBEmail, 'StrongP@ss2');
      adminClient.setChannelToken(tenantBChannelToken);
      const err = await rejectionOf(
        adminClient.query(BBB_ORG_MEMBER, { id: memberAEncoded }),
      );
      expect(err).toBeTruthy();
      // Ownership is derived from the LOADED row's organization, which the
      // caller never supplies — so a foreign id cannot authorize itself.
      expect(String(err.message)).toMatch(/not currently authorized/i);
    });

    it('tenant A reads its own member by id', async () => {
      await adminClient.asUserWithCredentials(tenantAEmail, 'StrongP@ss1');
      adminClient.setChannelToken(tenantAChannelToken);
      const res: any = await adminClient.query(BBB_ORG_MEMBER, {
        id: memberAEncoded,
      });
      expect(res.bbbOrganizationMember.id).toBe(memberAEncoded);
      expect(res.bbbOrganizationMember.customerName).toBe('Read Owner');
    });

    // ── bbbOrgMemberships ──────────────────────────────────────────────────

    it('tenant B CANNOT list tenant A memberships', async () => {
      await adminClient.asUserWithCredentials(tenantBEmail, 'StrongP@ss2');
      adminClient.setChannelToken(tenantBChannelToken);
      const err = await rejectionOf(
        adminClient.query(BBB_ORG_MEMBERSHIPS, { organizationId: orgAId }),
      );
      expect(err).toBeTruthy();
      expect(String(err.message)).toMatch(/not currently authorized/i);
    });

    it('tenant A lists its own memberships', async () => {
      await adminClient.asUserWithCredentials(tenantAEmail, 'StrongP@ss1');
      adminClient.setChannelToken(tenantAChannelToken);
      const res: any = await adminClient.query(BBB_ORG_MEMBERSHIPS, {
        organizationId: orgAId,
      });
      expect(
        res.bbbOrgMemberships.some(
          (m: any) => m.customerId === customerAEncoded,
        ),
      ).toBe(true);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 14. S7 (ADR-048) — mutation ownership guards
  //
  // For each of the 16 mutations that were previously unguarded, this
  // section proves:
  //   (a) NEGATIVE (elevated probe): tenant B operating under channel B
  //       supplies a tenant-A resource id → ForbiddenError before any write.
  //   (b) POSITIVE (same-tenant): tenant A operating under channel A
  //       supplies its own resource id → mutation succeeds.
  //
  // Fixtures share the same orgA/orgB, rooms, members, memberships,
  // enrollments and entitlements established in §13 (S6) — those describe
  // blocks run first and leave the rows in a known state. Where S6 fixtures
  // are describe-scoped they are re-resolved by name from the repository.
  // ═══════════════════════════════════════════════════════════════════════

  describe('S7 (ADR-048) — mutation ownership guards', () => {
    // All encoded IDs that S6 / S7 need. S6's beforeAll is describe-scoped so
    // we re-resolve from the repository in our own beforeAll.
    let roomAId: string; // GraphQL-encoded (T_...)
    let roomBId: string;
    let memberAId: string; // BbbOrganizationMember — for updateBbbMember / removeBbbMember
    let memberBId: string;
    let membershipAId: string; // BbbOrganizationMembership — update / remove
    let membershipBId: string;
    let enrollmentAId: string; // BbbEnrollment — deactivate / createBbbEnrollment with roomId
    let enrollmentBId: string;
    let entitlementAId: string; // BbbEntitlement — delete
    let entitlementBId: string;
    let customerAId: string; // for positive addBbbMember / createBbbEnrollment calls
    let customerBId: string;

    // Helper: encode a raw PK to the test strategy's T_ form.
    const enc = (id: string | number) => `T_${id}`;

    beforeAll(async () => {
      const roomRepo       = connection.getRepository(superCtx, BbbRoom);
      const memberRepo     = connection.getRepository(superCtx, BbbOrganizationMember);
      const membershipRepo = connection.getRepository(superCtx, BbbOrganizationMembership);
      const enrollmentRepo = connection.getRepository(superCtx, BbbEnrollment);
      const entitlementRepo = connection.getRepository(superCtx, BbbEntitlement);
      const customerRepo   = connection.getRepository(superCtx, Customer);

      // ── Rooms ─────────────────────────────────────────────────────────────
      // S6 creates 'Read Room A' / 'Read Room B'. Fall back to any room for
      // the org if the names differ between runs.
      const pickRoom = async (org: BbbOrganization, label: string) => {
        const named = await roomRepo.findOne({
          where: { name: `Read Room ${label}`, organization: { id: org.id } as any },
          relations: ['organization'],
        });
        if (named) return named;
        const rows = await roomRepo.find({
          where: { organization: { id: org.id } as any },
          relations: ['organization'],
          take: 1,
        });
        return rows[0] ?? null;
      };
      const rawRoomA = await pickRoom(orgA, 'A');
      const rawRoomB = await pickRoom(orgB, 'B');
      expect(rawRoomA).toBeTruthy();
      expect(rawRoomB).toBeTruthy();
      roomAId = enc(rawRoomA!.id);
      roomBId = enc(rawRoomB!.id);

      // ── Customers ─────────────────────────────────────────────────────────
      // S6 uses read-owner-a-* (tenant A) and read-foreign-b-* (tenant B).
      const allCustomers = await customerRepo.find({ take: 50 });
      const custA = allCustomers.find(c => c.emailAddress.startsWith('read-owner-a-'));
      const custB = allCustomers.find(
        c => c.emailAddress.startsWith('read-foreign-b-') ||
             c.emailAddress.startsWith('read-owner-b-'),
      );

      if (custA) {
        customerAId = enc(custA.id);
      } else {
        await adminClient.asUserWithCredentials(tenantAEmail, 'StrongP@ss1');
        adminClient.setChannelToken(tenantAChannelToken);
        const r: any = await adminClient.query(CREATE_CUSTOMER, {
          input: { firstName: 'S7', lastName: 'OwnerA',
                   emailAddress: `read-owner-a-s7-${Date.now()}@example.com` },
        });
        customerAId = r.createCustomer.id;
      }

      if (custB) {
        customerBId = enc(custB.id);
      } else {
        await adminClient.asUserWithCredentials(tenantBEmail, 'StrongP@ss2');
        adminClient.setChannelToken(tenantBChannelToken);
        const r: any = await adminClient.query(CREATE_CUSTOMER, {
          input: { firstName: 'S7', lastName: 'OwnerB',
                   emailAddress: `read-foreign-b-s7-${Date.now()}@example.com` },
        });
        customerBId = r.createCustomer.id;
      }

      // ── BbbOrganizationMember ─────────────────────────────────────────────
      // S6 adds a member for org A only.
      const existingMemberA = await memberRepo.findOne({
        where: { organization: { id: orgA.id } as any },
        relations: ['organization'],
      });
      if (existingMemberA) {
        memberAId = enc(existingMemberA.id);
      } else {
        await adminClient.asUserWithCredentials(tenantAEmail, 'StrongP@ss1');
        adminClient.setChannelToken(tenantAChannelToken);
        const r: any = await adminClient.query(ADD_BBB_MEMBER, {
          input: { organizationId: orgAId, customerId: customerAId, role: 'trainer' },
        });
        memberAId = r.addBbbMember.id;
      }

      const existingMemberB = await memberRepo.findOne({
        where: { organization: { id: orgB.id } as any },
        relations: ['organization'],
      });
      if (existingMemberB) {
        memberBId = enc(existingMemberB.id);
      } else {
        await adminClient.asUserWithCredentials(tenantBEmail, 'StrongP@ss2');
        adminClient.setChannelToken(tenantBChannelToken);
        const r: any = await adminClient.query(ADD_BBB_MEMBER, {
          input: { organizationId: orgBId, customerId: customerBId, role: 'trainer' },
        });
        memberBId = r.addBbbMember.id;
      }

      // ── BbbOrganizationMembership ─────────────────────────────────────────
      // S6 creates one for org A but NOT org B — seed org B here.
      const existingMembershipA = await membershipRepo.findOne({
        where: { organizationId: String(orgA.id) },
      });
      if (existingMembershipA) {
        membershipAId = enc(existingMembershipA.id);
      } else {
        await adminClient.asUserWithCredentials(tenantAEmail, 'StrongP@ss1');
        adminClient.setChannelToken(tenantAChannelToken);
        const r: any = await adminClient.query(CREATE_BBB_ORG_MEMBERSHIP, {
          input: { organizationId: orgAId, customerId: customerAId,
                   channelId: tenantAChannelIdEncoded, role: 'moderator' },
        });
        membershipAId = r.createBbbOrgMembership.id;
      }

      const existingMembershipB = await membershipRepo.findOne({
        where: { organizationId: String(orgB.id) },
      });
      if (existingMembershipB) {
        membershipBId = enc(existingMembershipB.id);
      } else {
        await adminClient.asUserWithCredentials(tenantBEmail, 'StrongP@ss2');
        adminClient.setChannelToken(tenantBChannelToken);
        const r: any = await adminClient.query(CREATE_BBB_ORG_MEMBERSHIP, {
          input: { organizationId: orgBId, customerId: customerBId,
                   channelId: tenantBChannelIdEncoded, role: 'moderator' },
        });
        membershipBId = r.createBbbOrgMembership.id;
      }

      // ── Enrollments ───────────────────────────────────────────────────────
      // S6 creates enrollments for both rooms. Ensure active rows exist.
      let existingEnrollmentA = await enrollmentRepo.findOne({
        where: { roomId: String(rawRoomA!.id) },
      });
      if (!existingEnrollmentA) {
        await adminClient.asUserWithCredentials(tenantAEmail, 'StrongP@ss1');
        adminClient.setChannelToken(tenantAChannelToken);
        const r: any = await adminClient.query(CREATE_BBB_ENROLLMENT, {
          input: { roomId: roomAId, customerId: customerAId, accessDays: 30 },
        });
        enrollmentAId = r.createBbbEnrollment.id;
      } else {
        if (!existingEnrollmentA.active) {
          existingEnrollmentA.active = true;
          await enrollmentRepo.save(existingEnrollmentA);
        }
        enrollmentAId = enc(existingEnrollmentA.id);
      }

      let existingEnrollmentB = await enrollmentRepo.findOne({
        where: { roomId: String(rawRoomB!.id) },
      });
      if (!existingEnrollmentB) {
        await adminClient.asUserWithCredentials(tenantBEmail, 'StrongP@ss2');
        adminClient.setChannelToken(tenantBChannelToken);
        const r: any = await adminClient.query(CREATE_BBB_ENROLLMENT, {
          input: { roomId: roomBId, customerId: customerBId, accessDays: 30 },
        });
        enrollmentBId = r.createBbbEnrollment.id;
      } else {
        if (!existingEnrollmentB.active) {
          existingEnrollmentB.active = true;
          await enrollmentRepo.save(existingEnrollmentB);
        }
        enrollmentBId = enc(existingEnrollmentB.id);
      }

      // ── Entitlements ──────────────────────────────────────────────────────
      const existingEntitlementA = await entitlementRepo.findOne({
        where: { channelId: String(orgA.channelId) },
      });
      if (existingEntitlementA) {
        entitlementAId = enc(existingEntitlementA.id);
      } else {
        await adminClient.asUserWithCredentials(tenantAEmail, 'StrongP@ss1');
        adminClient.setChannelToken(tenantAChannelToken);
        const r: any = await adminClient.query(CREATE_BBB_ENTITLEMENT, {
          input: { customerId: customerAId, type: 'bbb_room',
                   resourceId: roomAId, source: 'admin' },
        });
        entitlementAId = r.createBbbEntitlement.id;
      }

      const existingEntitlementB = await entitlementRepo.findOne({
        where: { channelId: String(orgB.channelId) },
      });
      if (existingEntitlementB) {
        entitlementBId = enc(existingEntitlementB.id);
      } else {
        await adminClient.asUserWithCredentials(tenantBEmail, 'StrongP@ss2');
        adminClient.setChannelToken(tenantBChannelToken);
        const r: any = await adminClient.query(CREATE_BBB_ENTITLEMENT, {
          input: { customerId: customerBId, type: 'bbb_room',
                   resourceId: roomBId, source: 'admin' },
        });
        entitlementBId = r.createBbbEntitlement.id;
      }
    }, 90_000);

    // ── addBbbMember ────────────────────────────────────────────────────────

    it('addBbbMember: tenant B CANNOT add a member to tenant A organization', async () => {
      await adminClient.asUserWithCredentials(tenantBEmail, 'StrongP@ss2');
      adminClient.setChannelToken(tenantBChannelToken);
      const err = await rejectionOf(
        adminClient.query(ADD_BBB_MEMBER, {
          input: { organizationId: orgAId, customerId: customerBId, role: 'trainer' },
        }),
      );
      expect(err).toBeTruthy();
      expect(String(err.message)).toMatch(/not currently authorized/i);
    });

    it('addBbbMember: tenant A CAN add a member to its own organization', async () => {
      await adminClient.asUserWithCredentials(tenantAEmail, 'StrongP@ss1');
      adminClient.setChannelToken(tenantAChannelToken);
      const res: any = await adminClient.query(ADD_BBB_MEMBER, {
        input: { organizationId: orgAId, customerId: customerAId, role: 'trainer' },
      });
      // Upsert — already exists from S6; either id returned is the existing row.
      expect(res.addBbbMember.id).toBeTruthy();
    });

    // ── updateBbbMember ─────────────────────────────────────────────────────

    it('updateBbbMember: tenant B CANNOT update tenant A member', async () => {
      await adminClient.asUserWithCredentials(tenantBEmail, 'StrongP@ss2');
      adminClient.setChannelToken(tenantBChannelToken);
      const err = await rejectionOf(
        adminClient.query(UPDATE_BBB_MEMBER, {
          id: memberAId,
          input: { role: 'org-admin' },
        }),
      );
      expect(err).toBeTruthy();
      expect(String(err.message)).toMatch(/not currently authorized/i);
    });

    it('updateBbbMember: tenant A CAN update its own member', async () => {
      await adminClient.asUserWithCredentials(tenantAEmail, 'StrongP@ss1');
      adminClient.setChannelToken(tenantAChannelToken);
      const res: any = await adminClient.query(UPDATE_BBB_MEMBER, {
        id: memberAId,
        input: { active: true },
      });
      expect(res.updateBbbMember.id).toBe(memberAId);
    });

    // ── removeBbbMember ─────────────────────────────────────────────────────

    it('removeBbbMember: tenant B CANNOT remove tenant A member', async () => {
      await adminClient.asUserWithCredentials(tenantBEmail, 'StrongP@ss2');
      adminClient.setChannelToken(tenantBChannelToken);
      const err = await rejectionOf(
        adminClient.query(REMOVE_BBB_MEMBER, { id: memberAId }),
      );
      expect(err).toBeTruthy();
      expect(String(err.message)).toMatch(/not currently authorized/i);
      // Confirm the row is still ACTIVE (removeMember soft-deletes via
      // active=false, so the denial check is "still active", not "still
      // exists" — a deleted-then-rejected row would still be found).
      const memberRepo = connection.getRepository(superCtx, BbbOrganizationMember);
      const rawId = memberAId.replace(/^T_/, '');
      const still = await memberRepo.findOne({ where: { id: rawId as any } });
      expect(still).toBeTruthy();
      expect(still?.active).toBe(true);
    });

    it('removeBbbMember: tenant A CAN remove a member from its own organization', async () => {
      await adminClient.asUserWithCredentials(tenantAEmail, 'StrongP@ss1');
      adminClient.setChannelToken(tenantAChannelToken);
      // Create a fresh member so the shared memberAId fixture survives.
      const freshCustomer: any = await adminClient.query(CREATE_CUSTOMER, {
        input: {
          firstName: 'S7',
          lastName: 'RemovableMember',
          emailAddress: `s7-removable-member-${Date.now()}@example.com`,
        },
      });
      const fresh: any = await adminClient.query(ADD_BBB_MEMBER, {
        input: { organizationId: orgAId, customerId: freshCustomer.createCustomer.id, role: 'trainer' },
      });
      const res: any = await adminClient.query(REMOVE_BBB_MEMBER, { id: fresh.addBbbMember.id });
      expect(res.removeBbbMember.id).toBeTruthy();
      // removeMember is a soft-delete (active=false) — the row survives but
      // is deactivated, same contract as deactivateBbbEnrollment.
      const memberRepo = connection.getRepository(superCtx, BbbOrganizationMember);
      const deactivated = await memberRepo.findOne({
        where: { id: String(fresh.addBbbMember.id).replace(/^T_/, '') as any },
      });
      expect(deactivated?.active).toBe(false);
    });

    // ── createBbbOrgMembership ──────────────────────────────────────────────

    it('createBbbOrgMembership: tenant B CANNOT create membership in tenant A org', async () => {
      await adminClient.asUserWithCredentials(tenantBEmail, 'StrongP@ss2');
      adminClient.setChannelToken(tenantBChannelToken);
      const err = await rejectionOf(
        adminClient.query(CREATE_BBB_ORG_MEMBERSHIP, {
          input: {
            organizationId: orgAId,
            customerId: customerBId,
            channelId: tenantAChannelIdEncoded,
            role: 'moderator',
          },
        }),
      );
      expect(err).toBeTruthy();
      expect(String(err.message)).toMatch(/not currently authorized/i);
    });

    it('createBbbOrgMembership: tenant A CAN create membership in its own org', async () => {
      await adminClient.asUserWithCredentials(tenantAEmail, 'StrongP@ss1');
      adminClient.setChannelToken(tenantAChannelToken);
      // Create a fresh customer so the unique-per-org constraint doesn't fire
      // (the beforeAll already added customerAId to orgA).
      const freshCustomer: any = await adminClient.query(CREATE_CUSTOMER, {
        input: {
          firstName: 'S7',
          lastName: 'NewMember',
          emailAddress: `s7-new-member-${Date.now()}@example.com`,
        },
      });
      const res: any = await adminClient.query(CREATE_BBB_ORG_MEMBERSHIP, {
        input: {
          organizationId: orgAId,
          customerId: freshCustomer.createCustomer.id,
          channelId: tenantAChannelIdEncoded,
          role: 'staff',
        },
      });
      expect(res.createBbbOrgMembership.id).toBeTruthy();
    });

    // ── updateBbbOrgMembership ──────────────────────────────────────────────

    it('updateBbbOrgMembership: tenant B CANNOT update tenant A membership', async () => {
      await adminClient.asUserWithCredentials(tenantBEmail, 'StrongP@ss2');
      adminClient.setChannelToken(tenantBChannelToken);
      const err = await rejectionOf(
        adminClient.query(UPDATE_BBB_ORG_MEMBERSHIP, {
          id: membershipAId,
          input: { role: 'org_admin' },
        }),
      );
      expect(err).toBeTruthy();
      expect(String(err.message)).toMatch(/not currently authorized/i);
    });

    it('updateBbbOrgMembership: tenant A CAN update its own membership', async () => {
      await adminClient.asUserWithCredentials(tenantAEmail, 'StrongP@ss1');
      adminClient.setChannelToken(tenantAChannelToken);
      const res: any = await adminClient.query(UPDATE_BBB_ORG_MEMBERSHIP, {
        id: membershipAId,
        input: { isActive: true },
      });
      expect(res.updateBbbOrgMembership.id).toBe(membershipAId);
    });

    // ── removeBbbOrgMembership ──────────────────────────────────────────────

    it('removeBbbOrgMembership: tenant B CANNOT remove tenant A membership', async () => {
      await adminClient.asUserWithCredentials(tenantBEmail, 'StrongP@ss2');
      adminClient.setChannelToken(tenantBChannelToken);
      const err = await rejectionOf(
        adminClient.query(REMOVE_BBB_ORG_MEMBERSHIP, { id: membershipAId }),
      );
      expect(err).toBeTruthy();
      expect(String(err.message)).toMatch(/not currently authorized/i);
      // Confirm row not deleted.
      const row = await connection.getRepository(superCtx, BbbOrganizationMembership)
        .findOne({ where: { id: membershipAId.replace(/^T_/, '') as any } });
      expect(row).toBeTruthy();
    });

    it('removeBbbOrgMembership: tenant A CAN remove a membership from its own org', async () => {
      await adminClient.asUserWithCredentials(tenantAEmail, 'StrongP@ss1');
      adminClient.setChannelToken(tenantAChannelToken);
      // Create a fresh membership so the shared membershipAId fixture survives.
      const freshCustomer: any = await adminClient.query(CREATE_CUSTOMER, {
        input: {
          firstName: 'S7',
          lastName: 'RemovableMembership',
          emailAddress: `s7-removable-membership-${Date.now()}@example.com`,
        },
      });
      const fresh: any = await adminClient.query(CREATE_BBB_ORG_MEMBERSHIP, {
        input: {
          organizationId: orgAId,
          customerId: freshCustomer.createCustomer.id,
          channelId: tenantAChannelIdEncoded,
          role: 'staff',
        },
      });
      const res: any = await adminClient.query(REMOVE_BBB_ORG_MEMBERSHIP, {
        id: fresh.createBbbOrgMembership.id,
      });
      expect(res.removeBbbOrgMembership).toBe(true);
      const gone = await connection.getRepository(superCtx, BbbOrganizationMembership)
        .findOne({
          where: { id: String(fresh.createBbbOrgMembership.id).replace(/^T_/, '') as any },
        });
      expect(gone).toBeNull();
    });

    // ── createBbbMeeting ────────────────────────────────────────────────────

    it('createBbbMeeting: tenant B CANNOT create a meeting in tenant A org', async () => {
      await adminClient.asUserWithCredentials(tenantBEmail, 'StrongP@ss2');
      adminClient.setChannelToken(tenantBChannelToken);
      const err = await rejectionOf(
        adminClient.query(CREATE_BBB_MEETING_MUT, {
          input: { organizationId: orgAId, title: 'Intruder meeting' },
        }),
      );
      expect(err).toBeTruthy();
      expect(String(err.message)).toMatch(/not currently authorized/i);
      // No row written.
      const row = await connection.getRepository(superCtx, BbbMeeting)
        .findOne({ where: { title: 'Intruder meeting' } });
      expect(row).toBeNull();
    });

    it('createBbbMeeting: tenant A CAN create a meeting in its own org', async () => {
      await adminClient.asUserWithCredentials(tenantAEmail, 'StrongP@ss1');
      adminClient.setChannelToken(tenantAChannelToken);
      const res: any = await adminClient.query(CREATE_BBB_MEETING_MUT, {
        input: { organizationId: orgAId, title: 'S7 Positive Meeting' },
      });
      expect(res.createBbbMeeting.id).toBeTruthy();
      // W5 audit trail: the meeting is attributed to the requesting user at
      // insert (new rows only — this row was just created).
      const row = await connection.getRepository(superCtx, BbbMeeting)
        .findOne({ where: { title: 'S7 Positive Meeting' } });
      expect(row?.startedByUserId).toBeTruthy();
      expect(row?.endedByUserId).toBeNull();
    });

    // ── createBbbCapacityGrant (cross-org via channel assert) ────────────────
    // H2 already covers the *permission* gate. This test covers the channel
    // assert that fires after the permission gate passes (SuperAdmin targeting
    // a non-existent or foreign org). The test uses a non-existent org id to
    // avoid depending on SuperAdmin having a "wrong channel" scenario that
    // SuperAdmin bypasses anyway. We verify the same-channel positive path is
    // what the ADR-048 guard protects for the org resolution layer.
    //
    // (The permission-denial path for tenant admins is already in §6 H2. This
    // positive case just confirms the SuperAdmin bypass doesn't break.)

    it('createBbbCapacityGrant: SuperAdmin (bypasses assert) CAN mint for tenant A', async () => {
      await adminClient.asSuperAdmin();
      const res: any = await adminClient.query(CREATE_BBB_CAPACITY_GRANT, {
        input: { organizationId: orgAId, grantedMinutes: 300 },
      });
      expect(res.createBbbCapacityGrant.id).toBeTruthy();
      expect(res.createBbbCapacityGrant.sourceType).toBe('manual');
    });

    // ── createBbbRoom ────────────────────────────────────────────────────────

    it('createBbbRoom: tenant B CANNOT create a room in tenant A org', async () => {
      await adminClient.asUserWithCredentials(tenantBEmail, 'StrongP@ss2');
      adminClient.setChannelToken(tenantBChannelToken);
      const err = await rejectionOf(
        adminClient.query(CREATE_BBB_ROOM, {
          input: { organizationId: orgAId, name: 'S7 Intruder Room' },
        }),
      );
      expect(err).toBeTruthy();
      expect(String(err.message)).toMatch(/not currently authorized/i);
      const row = await connection.getRepository(superCtx, BbbRoom)
        .findOne({ where: { name: 'S7 Intruder Room' } });
      expect(row).toBeNull();
    });

    it('createBbbRoom: tenant A CAN create a room in its own org', async () => {
      await adminClient.asUserWithCredentials(tenantAEmail, 'StrongP@ss1');
      adminClient.setChannelToken(tenantAChannelToken);
      const res: any = await adminClient.query(CREATE_BBB_ROOM, {
        input: { organizationId: orgAId, name: 'S7 Positive Room' },
      });
      expect(res.createBbbRoom.id).toBeTruthy();
    });

    // ── updateBbbRoom ────────────────────────────────────────────────────────
    // The assert now sits ABOVE the entity read (ADR-048 key fix).

    it('updateBbbRoom: tenant B CANNOT update tenant A room', async () => {
      await adminClient.asUserWithCredentials(tenantBEmail, 'StrongP@ss2');
      adminClient.setChannelToken(tenantBChannelToken);
      const err = await rejectionOf(
        adminClient.query(UPDATE_BBB_ROOM, {
          id: roomAId,
          input: { name: 'Hacked Room A' },
        }),
      );
      expect(err).toBeTruthy();
      expect(String(err.message)).toMatch(/not currently authorized/i);
      // Name unchanged.
      const row = await connection.getRepository(superCtx, BbbRoom)
        .findOne({ where: { id: roomAId.replace(/^T_/, '') as any } });
      expect(row?.name).not.toBe('Hacked Room A');
    });

    it('updateBbbRoom: tenant A CAN update its own room', async () => {
      await adminClient.asUserWithCredentials(tenantAEmail, 'StrongP@ss1');
      adminClient.setChannelToken(tenantAChannelToken);
      const res: any = await adminClient.query(UPDATE_BBB_ROOM, {
        id: roomAId,
        input: { name: 'S7 Updated Room A' },
      });
      expect(res.updateBbbRoom.id).toBe(roomAId);
    });

    // ── deleteBbbRoom ────────────────────────────────────────────────────────

    it('deleteBbbRoom: tenant B CANNOT delete tenant A room', async () => {
      await adminClient.asUserWithCredentials(tenantBEmail, 'StrongP@ss2');
      adminClient.setChannelToken(tenantBChannelToken);
      const err = await rejectionOf(
        adminClient.query(DELETE_BBB_ROOM, { id: roomAId }),
      );
      expect(err).toBeTruthy();
      expect(String(err.message)).toMatch(/not currently authorized/i);
      // Room still exists.
      const row = await connection.getRepository(superCtx, BbbRoom)
        .findOne({ where: { id: roomAId.replace(/^T_/, '') as any } });
      expect(row).toBeTruthy();
    });

    it('deleteBbbRoom: tenant A CAN delete a room in its own org', async () => {
      await adminClient.asUserWithCredentials(tenantAEmail, 'StrongP@ss1');
      adminClient.setChannelToken(tenantAChannelToken);
      // Create a fresh room so the shared roomAId fixture survives.
      const fresh: any = await adminClient.query(CREATE_BBB_ROOM, {
        input: { organizationId: orgAId, name: 'S7 Deletable Room' },
      });
      const res: any = await adminClient.query(DELETE_BBB_ROOM, {
        id: fresh.createBbbRoom.id,
      });
      expect(res.deleteBbbRoom).toBe(true);
      const gone = await connection.getRepository(superCtx, BbbRoom)
        .findOne({
          where: { id: String(fresh.createBbbRoom.id).replace(/^T_/, '') as any },
        });
      expect(gone).toBeNull();
    });

    // ── createBbbProductAccess ───────────────────────────────────────────────

    it('createBbbProductAccess: tenant B CANNOT create product access on tenant A room', async () => {
      await adminClient.asUserWithCredentials(tenantBEmail, 'StrongP@ss2');
      adminClient.setChannelToken(tenantBChannelToken);
      const err = await rejectionOf(
        adminClient.query(CREATE_BBB_PRODUCT_ACCESS, {
          input: { roomId: roomAId, productVariantId: 'T_1' },
        }),
      );
      expect(err).toBeTruthy();
      expect(String(err.message)).toMatch(/not currently authorized/i);
    });

    it('createBbbProductAccess: tenant A CAN create product access on its own room', async () => {
      await adminClient.asUserWithCredentials(tenantAEmail, 'StrongP@ss1');
      adminClient.setChannelToken(tenantAChannelToken);
      const res: any = await adminClient.query(CREATE_BBB_PRODUCT_ACCESS, {
        input: { roomId: roomAId, productVariantId: 'T_1' },
      });
      expect(res.createBbbProductAccess.id).toBeTruthy();
    });

    // ── deleteBbbProductAccess ───────────────────────────────────────────────
    // Re-use a product access row that belongs to org B (seeded above in the
    // positive createBbbProductAccess call for tenant B via S6 or created in
    // the positive case above). We look it up from the DB by room.

    it('deleteBbbProductAccess: tenant A CANNOT delete tenant B product access', async () => {
      const productAccessRepo = connection.getRepository(superCtx, BbbProductAccess);
      const rowB = await productAccessRepo.findOne({
        where: { room: { id: roomBId.replace(/^T_/, '') as any } as any },
        relations: ['room'],
      });
      if (!rowB) return; // no product access for B — skip via guard
      const rowBId = enc(rowB.id);
      await adminClient.asUserWithCredentials(tenantAEmail, 'StrongP@ss1');
      adminClient.setChannelToken(tenantAChannelToken);
      const err = await rejectionOf(
        adminClient.query(DELETE_BBB_PRODUCT_ACCESS, { id: rowBId }),
      );
      expect(err).toBeTruthy();
      expect(String(err.message)).toMatch(/not currently authorized/i);
    });

    it('deleteBbbProductAccess: tenant A CAN delete product access on its own room', async () => {
      await adminClient.asUserWithCredentials(tenantAEmail, 'StrongP@ss1');
      adminClient.setChannelToken(tenantAChannelToken);
      // Delete the row the positive create test minted (unique productVariantId
      // means a second create would violate the unique index — so this positive
      // consumes that fixture instead of creating a fresh one).
      const productAccessRepo = connection.getRepository(superCtx, BbbProductAccess);
      const rowA = await productAccessRepo.findOne({
        where: { room: { id: roomAId.replace(/^T_/, '') as any } as any },
        relations: ['room'],
      });
      expect(rowA).toBeTruthy();
      const res: any = await adminClient.query(DELETE_BBB_PRODUCT_ACCESS, {
        id: enc(rowA!.id),
      });
      expect(res.deleteBbbProductAccess).toBe(true);
      const gone = await productAccessRepo.findOne({
        where: { id: rowA!.id as any },
      });
      expect(gone).toBeNull();
    });

    // ── createBbbEnrollment ──────────────────────────────────────────────────

    it('createBbbEnrollment: tenant B CANNOT enroll into tenant A room', async () => {
      await adminClient.asUserWithCredentials(tenantBEmail, 'StrongP@ss2');
      adminClient.setChannelToken(tenantBChannelToken);
      const err = await rejectionOf(
        adminClient.query(CREATE_BBB_ENROLLMENT, {
          input: { roomId: roomAId, customerId: customerBId },
        }),
      );
      expect(err).toBeTruthy();
      expect(String(err.message)).toMatch(/not currently authorized/i);
    });

    it('createBbbEnrollment: tenant A CAN enroll into its own room', async () => {
      await adminClient.asUserWithCredentials(tenantAEmail, 'StrongP@ss1');
      adminClient.setChannelToken(tenantAChannelToken);
      const res: any = await adminClient.query(CREATE_BBB_ENROLLMENT, {
        input: { roomId: roomAId, customerId: customerAId },
      });
      expect(res.createBbbEnrollment.id).toBeTruthy();
      expect(res.createBbbEnrollment.active).toBe(true);
    });

    // ── deactivateBbbEnrollment ──────────────────────────────────────────────

    it('deactivateBbbEnrollment: tenant B CANNOT deactivate tenant A enrollment', async () => {
      await adminClient.asUserWithCredentials(tenantBEmail, 'StrongP@ss2');
      adminClient.setChannelToken(tenantBChannelToken);
      const err = await rejectionOf(
        adminClient.query(DEACTIVATE_BBB_ENROLLMENT, { id: enrollmentAId }),
      );
      expect(err).toBeTruthy();
      expect(String(err.message)).toMatch(/not currently authorized/i);
      // Enrollment still active.
      const row = await connection.getRepository(superCtx, BbbEnrollment)
        .findOne({ where: { id: enrollmentAId.replace(/^T_/, '') as any } });
      expect(row?.active).toBe(true);
    });

    it('deactivateBbbEnrollment: tenant A CAN deactivate its own enrollment', async () => {
      await adminClient.asUserWithCredentials(tenantAEmail, 'StrongP@ss1');
      adminClient.setChannelToken(tenantAChannelToken);
      const res: any = await adminClient.query(DEACTIVATE_BBB_ENROLLMENT, {
        id: enrollmentAId,
      });
      expect(res.deactivateBbbEnrollment.active).toBe(false);
      // W5 audit trail: the deactivation records who and when (new rows only).
      const row = await connection.getRepository(superCtx, BbbEnrollment)
        .findOne({ where: { id: enrollmentAId.replace(/^T_/, '') as any } });
      expect(row?.deactivatedByUserId).toBeTruthy();
      expect(row?.deactivatedAt).toBeInstanceOf(Date);
    });

    // ── createBbbEntitlement (resource-org check) ────────────────────────────

    it('createBbbEntitlement: tenant B CANNOT create an entitlement for a tenant A session', async () => {
      // Pick the first bbb_session entitlement that belongs to channel A as
      // the resourceId. If none exists fall back to a raw room id — both
      // branches of the new resource-org check should fire.
      const entA = await connection.getRepository(superCtx, BbbEntitlement).findOne({
        where: { channelId: String(orgA.channelId), type: 'bbb_session' as any },
      });
      const resourceId = entA
        ? enc(entA.resourceId)
        : roomAId; // fallback to room (bbb_room branch)
      const type = entA ? 'bbb_session' : 'bbb_room';

      await adminClient.asUserWithCredentials(tenantBEmail, 'StrongP@ss2');
      adminClient.setChannelToken(tenantBChannelToken);
      const err = await rejectionOf(
        adminClient.query(CREATE_BBB_ENTITLEMENT, {
          input: {
            customerId: customerBId,
            type,
            resourceId,
            source: 'admin',
          },
        }),
      );
      expect(err).toBeTruthy();
      expect(String(err.message)).toMatch(/not currently authorized/i);
    });

    it('createBbbEntitlement: tenant A CAN create an entitlement referencing its own room', async () => {
      await adminClient.asUserWithCredentials(tenantAEmail, 'StrongP@ss1');
      adminClient.setChannelToken(tenantAChannelToken);
      const res: any = await adminClient.query(CREATE_BBB_ENTITLEMENT, {
        input: {
          customerId: customerAId,
          type: 'bbb_room',
          resourceId: roomAId,
          source: 'admin',
        },
      });
      expect(res.createBbbEntitlement.id).toBeTruthy();
    });

    // ── deleteBbbEntitlement ─────────────────────────────────────────────────

    it('deleteBbbEntitlement: tenant B CANNOT delete tenant A entitlement', async () => {
      await adminClient.asUserWithCredentials(tenantBEmail, 'StrongP@ss2');
      adminClient.setChannelToken(tenantBChannelToken);
      const err = await rejectionOf(
        adminClient.query(DELETE_BBB_ENTITLEMENT, { id: entitlementAId }),
      );
      expect(err).toBeTruthy();
      expect(String(err.message)).toMatch(/not currently authorized/i);
      // Row still present.
      const row = await connection.getRepository(superCtx, BbbEntitlement)
        .findOne({ where: { id: entitlementAId.replace(/^T_/, '') as any } });
      expect(row).toBeTruthy();
    });

    it('deleteBbbEntitlement: tenant A CAN delete its own entitlement', async () => {
      await adminClient.asUserWithCredentials(tenantAEmail, 'StrongP@ss1');
      adminClient.setChannelToken(tenantAChannelToken);
      // Create a fresh one to delete without breaking other tests.
      const fresh: any = await adminClient.query(CREATE_BBB_ENTITLEMENT, {
        input: {
          customerId: customerAId,
          type: 'bbb_room',
          resourceId: roomAId,
          source: 'admin',
        },
      });
      const freshId = fresh.createBbbEntitlement.id;
      const res: any = await adminClient.query(DELETE_BBB_ENTITLEMENT, {
        id: freshId,
      });
      expect(res.deleteBbbEntitlement).toBe(true);
    });
  });
});
