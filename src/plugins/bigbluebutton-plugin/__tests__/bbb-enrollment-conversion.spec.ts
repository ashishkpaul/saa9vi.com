import 'reflect-metadata';
import 'dotenv/config';
import gql from 'graphql-tag';
import {
  createTestEnvironment,
  E2E_DEFAULT_CHANNEL_TOKEN,
  registerInitializer,
  testConfig,
} from '@vendure/testing';
import { startOnFreePort } from '../../../test-utils/free-port';
import { SchemaPostgresInitializer } from '../../tenant-plugin/e2e/schema-postgres-initializer';
import { mergeConfig } from '@vendure/core';
import { getSuperadminContext } from '@vendure/testing/lib/utils/get-superadmin-context';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { TenantPlugin } from '../../tenant-plugin/tenant-plugin.plugin';
import { BigBlueButtonPlugin } from '../bigbluebutton.plugin';
import { CmsPlugin } from '../../cms/cms.plugin';
import { ReviewsPlugin } from '../../reviews/reviews-plugin';
import { SubscriptionPlugin } from '../../subscription/subscription.plugin';
import { E2E_INITIAL_DATA } from '../../tenant-plugin/e2e/fixtures/e2e-initial-data';
import { verifyTenantAdminViaApi } from '../../tenant-plugin/e2e/fixtures/verify-tenant-admin';
import { LearningPlugin } from '../../learning-plugin/learning-plugin.plugin';

registerInitializer('postgres', new SchemaPostgresInitializer());

// Tenant registration
const REGISTER_NEW_TENANT = gql`
  mutation RegisterNewTenant($input: RegisterTenantInput!) {
    registerNewTenant(input: $input) {
      channelId
      channelToken
      administratorId
    }
  }
`;

const LOGIN = gql`
  mutation Login($emailAddress: String!, $password: String!) {
    login(username: $emailAddress, password: $password) {
      ... on CurrentUser { id identifier }
      ... on ErrorResult { errorCode message }
    }
  }
`;

// Customer registration
const REGISTER_CUSTOMER = gql`
  mutation RegisterCustomer($input: RegisterCustomerInput!) {
    registerCustomerAccount(input: $input) {
      ... on Success { success }
      ... on ErrorResult { errorCode message }
    }
  }
`;

const ACTIVE_CUSTOMER = gql`
  query ActiveCustomer {
    activeCustomer { id emailAddress }
  }
`;

// BBB operations
const CREATE_BBB_ORGANIZATION = gql`
  mutation CreateBbbOrganization($input: CreateBbbOrganizationInput!) {
    createBbbOrganization(input: $input) {
      id channelId slug name
    }
  }
`;

const CREATE_BBB_ROOM = gql`
  mutation CreateBbbRoom($input: CreateBbbRoomInput!) {
    createBbbRoom(input: $input) { id name state }
  }
`;

const CREATE_BBB_ENROLLMENT = gql`
  mutation CreateBbbEnrollment($input: CreateBbbEnrollmentInput!) {
    createBbbEnrollment(input: $input) {
      id roomId customerId active expiresAt source
    }
  }
`;

const CREATE_BBB_ENTITLEMENT = gql`
  mutation CreateBbbEntitlement($input: CreateBbbEntitlementInput!) {
    createBbbEntitlement(input: $input) {
      id type resourceId customerId source validFrom validUntil
    }
  }
`;

const CONVERT_BBB_ENROLLMENTS_TO_ENTITLEMENTS = gql`
  mutation ConvertBbbEnrollmentsToEntitlements {
    convertBbbEnrollmentsToEntitlements {
      converted skipped total
    }
  }
`;

const BBB_ORGANIZATIONS = gql`
  query BbbOrganizations {
    bbbOrganizations {
      items { id channelId slug name }
      totalItems
    }
  }
`;

const LIST_BBB_ENTITLEMENTS = gql`
  query BbbEntitlements {
    bbbEntitlements {
      items { id type resourceId customerId source validFrom validUntil }
      totalItems
    }
  }
`;

// Learner operations
const ADMIT_TENANT_LEARNER = gql`
  mutation AdmitTenantLearner($input: AdmitTenantLearnerInput!) {
    admitTenantLearner(input: $input) { id status }
  }
`;

const ACTIVATE_TENANT_LEARNER = gql`
  mutation ActivateTenantLearner($customerId: ID!) {
    activateTenantLearner(customerId: $customerId) { id status }
  }
`;

const DECODE = (id: unknown): string => String(id).replace(/^T_/, '');
const ENCODE = (id: unknown): string =>
  String(id).startsWith('T_') ? String(id) : `T_${id}`;

function fail(label: string, payload: unknown): never {
  throw new Error(`${label}: ${JSON.stringify(payload)}`);
}

async function registerAndLoginCustomer(
  shopClient: any,
  email: string,
  password: string,
): Promise<string> {
  const registerResult: any = await shopClient.query(REGISTER_CUSTOMER, {
    input: { emailAddress: email, password },
  });
  if (registerResult.registerCustomerAccount.errorCode) {
    fail('registerCustomerAccount', registerResult);
  }

  const loginResult: any = await shopClient.query(LOGIN, {
    emailAddress: email,
    password,
  });
  if (loginResult.login.errorCode) {
    fail('login', loginResult);
  }

  const customerResult: any = await shopClient.query(ACTIVE_CUSTOMER);
  if (!customerResult.activeCustomer?.id) {
    fail('activeCustomer', customerResult);
  }
  return DECODE(customerResult.activeCustomer.id);
}

async function admitAndActivateLearner(
  adminClient: any,
  customerId: string,
): Promise<void> {
  const admit: any = await adminClient.query(ADMIT_TENANT_LEARNER, {
    input: { customerId: ENCODE(customerId) },
  });
  if (!admit.admitTenantLearner?.id) fail('admitTenantLearner', admit);

  const act: any = await adminClient.query(ACTIVATE_TENANT_LEARNER, {
    customerId: ENCODE(customerId),
  });
  if (act.activateTenantLearner?.status !== 'ACTIVE') fail('activateTenantLearner', act);
}

describe('C-18 enrollment → entitlement conversion', () => {
  const { server, adminClient, shopClient } = createTestEnvironment(
    mergeConfig(testConfig, {
      apiOptions: { port: 0 },
      authOptions: { requireVerification: false },
      dbConnectionOptions: {
        type: 'postgres',
        host: process.env.DB_HOST ?? 'localhost',
        port: Number(process.env.DB_PORT ?? 5432),
        database: process.env.DB_NAME ?? 'vendure',
        username: process.env.DB_USERNAME ?? 'vendure_user',
        password: process.env.DB_PASSWORD ?? '',
        schema: 'e2e_bbb_c18_conversion',
        synchronize: true,
      },
      plugins: [
        TenantPlugin,
        BigBlueButtonPlugin,
        CmsPlugin,
        ReviewsPlugin,
        SubscriptionPlugin.init({}) as any,
        LearningPlugin,
      ],
    }),
  );

  let channelId = '';
  let orgId = '';
  let roomId = '';
  let room2Id = '';

  beforeAll(async () => {
    await startOnFreePort({ server, adminClient, shopClient }, {
      initialData: E2E_INITIAL_DATA,
      customerCount: 0,
    });

    await adminClient.asSuperAdmin();
    shopClient.setChannelToken(E2E_DEFAULT_CHANNEL_TOKEN);

    const ctx = await getSuperadminContext(server.app);
    channelId = String(ctx.channelId);

    // Create organization
    const org: any = await adminClient.query(CREATE_BBB_ORGANIZATION, {
      input: {
        channelId,
        slug: `c18-org-${Date.now()}`,
        name: 'C18 Test Org',
        concurrentMeetingLimit: 5,
      },
    });
    if (!org.createBbbOrganization?.id) fail('createBbbOrganization', org);
    orgId = DECODE(org.createBbbOrganization.id);

    // Create first room
    const room: any = await adminClient.query(CREATE_BBB_ROOM, {
      input: {
        organizationId: ENCODE(orgId),
        name: 'C18 Test Room',
        slug: `c18-room-${Date.now()}`,
      },
    });
    if (!room.createBbbRoom?.id) fail('createBbbRoom', room);
    roomId = DECODE(room.createBbbRoom.id);

    // Create second room for duplicate testing
    const room2: any = await adminClient.query(CREATE_BBB_ROOM, {
      input: {
        organizationId: ENCODE(orgId),
        name: 'C18 Test Room 2',
        slug: `c18-room-2-${Date.now()}`,
      },
    });
    if (!room2.createBbbRoom?.id) fail('createBbbRoom2', room2);
    room2Id = DECODE(room2.createBbbRoom.id);
  });

  afterAll(async () => {
    await server.destroy();
  });

  it('C18-1: converts an active legacy enrollment — entitlement created', async () => {
    // Register and activate a customer
    const customerId = await registerAndLoginCustomer(
      shopClient,
      `c18-customer-${Date.now()}@example.com`,
      'C18Test123',
    );
    await admitAndActivateLearner(adminClient, customerId);

    // Create a legacy enrollment via GraphQL
    const enrollmentResult: any = await adminClient.query(CREATE_BBB_ENROLLMENT, {
      input: {
        roomId: ENCODE(roomId),
        customerId: ENCODE(customerId),
        reason: 'C-18 test enrollment',
      },
    });
    expect(enrollmentResult.createBbbEnrollment).toBeDefined();
    const enrollmentId = DECODE(enrollmentResult.createBbbEnrollment.id);

    // Check initial entitlement count
    const initialEntitlements: any = await adminClient.query(LIST_BBB_ENTITLEMENTS);
    const initialCount = initialEntitlements.bbbEntitlements.totalItems;

    // Run conversion
    const result: any = await adminClient.query(CONVERT_BBB_ENROLLMENTS_TO_ENTITLEMENTS);
    expect(result.convertBbbEnrollmentsToEntitlements).toBeDefined();
    const { converted, skipped, total } = result.convertBbbEnrollmentsToEntitlements;
    
    // Should convert at least 1 enrollment
    expect(converted).toBeGreaterThanOrEqual(1);
    expect(skipped).toBe(0);
    expect(total).toBeGreaterThanOrEqual(1);

    // Check final entitlement count increased
    const finalEntitlements: any = await adminClient.query(LIST_BBB_ENTITLEMENTS);
    expect(finalEntitlements.bbbEntitlements.totalItems).toBeGreaterThan(initialCount);

    // Verify the specific entitlement was created
    const matchingEntitlement = finalEntitlements.bbbEntitlements.items.find(
      (item: any) => 
        item.customerId === ENCODE(customerId) && 
        item.type === 'bbb_room' &&
        DECODE(item.resourceId) === roomId
    );
    expect(matchingEntitlement).toBeDefined();
    expect(matchingEntitlement.source).toBe('admin');
  });

  it('C18-2: repeat conversion — no duplicate entitlement created', async () => {
    // Register and activate a customer
    const customerId = await registerAndLoginCustomer(
      shopClient,
      `c18-customer-repeat-${Date.now()}@example.com`,
      'C18Test123',
    );
    await admitAndActivateLearner(adminClient, customerId);

    // Create enrollment
    const enrollmentResult: any = await adminClient.query(CREATE_BBB_ENROLLMENT, {
      input: {
        roomId: ENCODE(room2Id),
        customerId: ENCODE(customerId),
        reason: 'C-18 repeat test enrollment',
      },
    });
    expect(enrollmentResult.createBbbEnrollment).toBeDefined();

    // First conversion
    const firstResult: any = await adminClient.query(CONVERT_BBB_ENROLLMENTS_TO_ENTITLEMENTS);
    const firstConverted = firstResult.convertBbbEnrollmentsToEntitlements.converted;
    expect(firstConverted).toBeGreaterThanOrEqual(1);

    // Check entitlement count after first conversion
    const entitlementsAfterFirst: any = await adminClient.query(LIST_BBB_ENTITLEMENTS);
    const countAfterFirst = entitlementsAfterFirst.bbbEntitlements.totalItems;

    // Second conversion (should not create duplicates)
    const secondResult: any = await adminClient.query(CONVERT_BBB_ENROLLMENTS_TO_ENTITLEMENTS);
    const { converted: secondConverted, skipped: secondSkipped } = secondResult.convertBbbEnrollmentsToEntitlements;
    
    // Should skip (not convert) because entitlement already exists
    expect(secondConverted).toBe(0);
    expect(secondSkipped).toBeGreaterThanOrEqual(1);

    // Entitlement count should not increase
    const entitlementsAfterSecond: any = await adminClient.query(LIST_BBB_ENTITLEMENTS);
    expect(entitlementsAfterSecond.bbbEntitlements.totalItems).toBe(countAfterFirst);
  });

  it('C18-3: existing matching live entitlement — conversion skipped (assert converted=0, skipped=total)', async () => {
    // Register and activate a fresh customer
    const customerId = await registerAndLoginCustomer(
      shopClient,
      `c18-customer-existing-${Date.now()}@example.com`,
      'C18Test123',
    );
    await admitAndActivateLearner(adminClient, customerId);

    // Create an entitlement first
    const entitlementResult: any = await adminClient.query(CREATE_BBB_ENTITLEMENT, {
      input: {
        type: 'bbb_room',
        resourceId: ENCODE(roomId),
        customerId: ENCODE(customerId),
        validFrom: null,
        validUntil: null,
      },
    });
    expect(entitlementResult.createBbbEntitlement).toBeDefined();
    expect(entitlementResult.createBbbEntitlement.customerId).toBe(ENCODE(customerId));

    // Check initial entitlement count
    const initialEntitlements: any = await adminClient.query(LIST_BBB_ENTITLEMENTS);
    const initialCount = initialEntitlements.bbbEntitlements.totalItems;

    // Create a matching enrollment
    const enrollmentResult: any = await adminClient.query(CREATE_BBB_ENROLLMENT, {
      input: {
        roomId: ENCODE(roomId),
        customerId: ENCODE(customerId),
        reason: 'C-18 enrollment matching existing entitlement',
      },
    });
    expect(enrollmentResult.createBbbEnrollment).toBeDefined();

    // Run conversion — should skip because entitlement already exists
    const result: any = await adminClient.query(CONVERT_BBB_ENROLLMENTS_TO_ENTITLEMENTS);
    const { converted, skipped, total } = result.convertBbbEnrollmentsToEntitlements;
    
    // Strong assertion: converted must be 0, skipped must equal total
    expect(converted).toBe(0);
    expect(skipped).toBeGreaterThanOrEqual(1);
    expect(total).toBeGreaterThanOrEqual(1);
    expect(skipped).toBe(total); // All enrollments should be skipped

    // Entitlement count should not increase
    const finalEntitlements: any = await adminClient.query(LIST_BBB_ENTITLEMENTS);
    expect(finalEntitlements.bbbEntitlements.totalItems).toBe(initialCount);
  });

  it('C18-4: tenant-admin scoping — only converts own channel enrollments', async () => {
    // Create two tenant channels with admins
    const tenantAEmail = `c18-tenant-a-${Date.now()}@example.com`;
    const tenantBEmail = `c18-tenant-b-${Date.now()}@example.com`;

    // Register tenant A
    const tenantAResult: any = await shopClient.query(REGISTER_NEW_TENANT, {
      input: {
        businessName: 'C18 Tenant A',
        firstName: 'A',
        lastName: 'Admin',
        emailAddress: tenantAEmail,
        password: 'StrongP@ss1',
        timezone: 'Asia/Kolkata',
      },
    });
    const { channelId: channelAId, channelToken: channelAToken } = tenantAResult.registerNewTenant;
    expect(channelAId).toBeTruthy();
    expect(channelAToken).toMatch(/^tok_/);

    // Register tenant B
    const tenantBResult: any = await shopClient.query(REGISTER_NEW_TENANT, {
      input: {
        businessName: 'C18 Tenant B',
        firstName: 'B',
        lastName: 'Admin',
        emailAddress: tenantBEmail,
        password: 'StrongP@ss2',
        timezone: 'Asia/Kolkata',
      },
    });
    const { channelId: channelBId, channelToken: channelBToken } = tenantBResult.registerNewTenant;
    expect(channelBId).toBeTruthy();
    expect(channelBToken).toMatch(/^tok_/);
    expect(channelBId).not.toBe(channelAId);

    // 3.7.3 login gate: complete verification for both tenant admins
    await verifyTenantAdminViaApi(server, shopClient, tenantAEmail);
    await verifyTenantAdminViaApi(server, shopClient, tenantBEmail);

    // Wait for organizations to be auto-provisioned by BbbTenantProvisioningListener
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
          return DECODE(bbbOrganizations.items[0].id);
        }
        if (Date.now() > deadline) {
          throw new Error(
            `No BbbOrganization provisioned for channel ${channelIdEncoded}`,
          );
        }
        await new Promise((r) => setTimeout(r, 250));
      }
    };

    // Get organization IDs (auto-provisioned)
    let orgAId: string;
    let orgBId: string;
    
    // Switch to tenant A admin context to get their org
    adminClient.setChannelToken(channelAToken);
    await adminClient.asUserWithCredentials(tenantAEmail, 'StrongP@ss1');
    orgAId = await waitForChannelOrgId(channelAId, channelAToken);

    // Switch to tenant B admin context to get their org
    adminClient.setChannelToken(channelBToken);
    await adminClient.asUserWithCredentials(tenantBEmail, 'StrongP@ss2');
    orgBId = await waitForChannelOrgId(channelBId, channelBToken);

    // Switch back to superadmin to create rooms
    await adminClient.asSuperAdmin();
    adminClient.setChannelToken(channelAToken); // Use tenant A's channel token for room creation

    // Create a room in tenant A's organization (using tenant A's channel context)
    adminClient.setChannelToken(channelAToken);
    const roomAResult: any = await adminClient.query(CREATE_BBB_ROOM, {
      input: {
        organizationId: ENCODE(orgAId),
        name: 'C18 Tenant A Room',
        slug: `c18-room-a-${Date.now()}`,
      },
    });
    expect(roomAResult.createBbbRoom).toBeDefined();
    const roomAId = DECODE(roomAResult.createBbbRoom.id);

    // Create a room in tenant B's organization (using tenant B's channel context)
    adminClient.setChannelToken(channelBToken);
    const roomBResult: any = await adminClient.query(CREATE_BBB_ROOM, {
      input: {
        organizationId: ENCODE(orgBId),
        name: 'C18 Tenant B Room',
        slug: `c18-room-b-${Date.now()}`,
      },
    });
    expect(roomBResult.createBbbRoom).toBeDefined();
    const roomBId = DECODE(roomBResult.createBbbRoom.id);

    // Login as tenant A admin
    adminClient.setChannelToken(channelAToken);
    const loginAResult: any = await adminClient.query(LOGIN, {
      emailAddress: tenantAEmail,
      password: 'StrongP@ss1',
    });
    expect(loginAResult.login.errorCode).toBeUndefined();

    // Create a customer and enrollment for tenant A
    shopClient.setChannelToken(channelAToken);
    const customerAId = await registerAndLoginCustomer(
      shopClient,
      `c18-tenant-a-customer-${Date.now()}@example.com`,
      'C18Test123',
    );
    await admitAndActivateLearner(adminClient, customerAId);

    const enrollmentAResult: any = await adminClient.query(CREATE_BBB_ENROLLMENT, {
      input: {
        roomId: ENCODE(roomAId),
        customerId: ENCODE(customerAId),
        reason: 'C-18 tenant A enrollment',
      },
    });
    expect(enrollmentAResult.createBbbEnrollment).toBeDefined();

    // Login as tenant B admin
    adminClient.setChannelToken(channelBToken);
    const loginBResult: any = await adminClient.query(LOGIN, {
      emailAddress: tenantBEmail,
      password: 'StrongP@ss2',
    });
    expect(loginBResult.login.errorCode).toBeUndefined();

    // Create a customer and enrollment for tenant B
    shopClient.setChannelToken(channelBToken);
    const customerBId = await registerAndLoginCustomer(
      shopClient,
      `c18-tenant-b-customer-${Date.now()}@example.com`,
      'C18Test123',
    );
    await admitAndActivateLearner(adminClient, customerBId);

    const enrollmentBResult: any = await adminClient.query(CREATE_BBB_ENROLLMENT, {
      input: {
        roomId: ENCODE(roomBId),
        customerId: ENCODE(customerBId),
        reason: 'C-18 tenant B enrollment',
      },
    });
    expect(enrollmentBResult.createBbbEnrollment).toBeDefined();

    // Switch back to tenant A admin and run conversion
    adminClient.setChannelToken(channelAToken);
    shopClient.setChannelToken(channelAToken);
    await adminClient.query(LOGIN, {
      emailAddress: tenantAEmail,
      password: 'StrongP@ss1',
    });

    // Get initial entitlement count for tenant A
    const initialEntitlementsA: any = await adminClient.query(LIST_BBB_ENTITLEMENTS);
    const initialCountA = initialEntitlementsA.bbbEntitlements.totalItems;

    // Tenant A runs conversion
    const conversionAResult: any = await adminClient.query(CONVERT_BBB_ENROLLMENTS_TO_ENTITLEMENTS);
    const { converted: aConverted, skipped: aSkipped, total: aTotal } = conversionAResult.convertBbbEnrollmentsToEntitlements;

    // Tenant A should only convert tenant A's enrollment
    expect(aConverted).toBeGreaterThanOrEqual(1); // At least A's enrollment
    // Should skip B's enrollment and any leftover enrollments from previous tests
    expect(aSkipped).toBeGreaterThanOrEqual(1); // Must skip at least B's enrollment
    expect(aTotal).toBe(aConverted + aSkipped); // Basic consistency check

    // Check tenant A's entitlement list after conversion
    const entitlementsAfterA: any = await adminClient.query(LIST_BBB_ENTITLEMENTS);
    expect(entitlementsAfterA.bbbEntitlements.totalItems).toBeGreaterThan(initialCountA);
    
    // Verify tenant A only sees its own entitlement (channel stamping check)
    const tenantAEntitlement = entitlementsAfterA.bbbEntitlements.items.find(
      (item: any) => DECODE(item.customerId) === customerAId
    );
    expect(tenantAEntitlement).toBeDefined();

    // Tenant A should NOT see tenant B's customer (channel isolation)
    const tenantBEntitlementInA = entitlementsAfterA.bbbEntitlements.items.find(
      (item: any) => DECODE(item.customerId) === customerBId
    );
    expect(tenantBEntitlementInA).toBeUndefined();

    // Switch to tenant B admin
    adminClient.setChannelToken(channelBToken);
    shopClient.setChannelToken(channelBToken);
    await adminClient.query(LOGIN, {
      emailAddress: tenantBEmail,
      password: 'StrongP@ss2',
    });

    // Get initial entitlement count for tenant B
    const initialEntitlementsB: any = await adminClient.query(LIST_BBB_ENTITLEMENTS);
    const initialCountB = initialEntitlementsB.bbbEntitlements.totalItems;

    // Tenant B runs conversion
    const conversionBResult: any = await adminClient.query(CONVERT_BBB_ENROLLMENTS_TO_ENTITLEMENTS);
    const { converted: bConverted, skipped: bSkipped, total: bTotal } = conversionBResult.convertBbbEnrollmentsToEntitlements;

    // Tenant B should only convert tenant B's enrollment
    expect(bConverted).toBeGreaterThanOrEqual(1); // At least B's enrollment
    // Should skip A's enrollment (already converted) and any leftover enrollments
    expect(bSkipped).toBeGreaterThanOrEqual(1); // Must skip at least A's enrollment
    expect(bTotal).toBe(bConverted + bSkipped); // Basic consistency check

    // Check tenant B's entitlement list after conversion
    const entitlementsAfterB: any = await adminClient.query(LIST_BBB_ENTITLEMENTS);
    expect(entitlementsAfterB.bbbEntitlements.totalItems).toBeGreaterThan(initialCountB);
    
    // Verify tenant B only sees its own entitlement (channel stamping check)
    const tenantBEntitlementFinal = entitlementsAfterB.bbbEntitlements.items.find(
      (item: any) => DECODE(item.customerId) === customerBId
    );
    expect(tenantBEntitlementFinal).toBeDefined();

    // Tenant B should NOT see tenant A's customer (channel isolation)
    const tenantAEntitlementFinal = entitlementsAfterB.bbbEntitlements.items.find(
      (item: any) => DECODE(item.customerId) === customerAId
    );
    expect(tenantAEntitlementFinal).toBeUndefined();
  });
});
