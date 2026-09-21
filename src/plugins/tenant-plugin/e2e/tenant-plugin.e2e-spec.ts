/**
 * tenant-plugin e2e tests
 *
 * Covers the full tenant lifecycle described in platform-adr.md (DL-019,
 * TP-004, BUG-021) and platform-story.md:
 *
 *   1. registerNewTenant — public Shop API mutation
 *      • Creates Seller → Channel → Role → Administrator → TenantProfile
 *        in a single transaction (BUG-021 fix: no second RequestContext)
 *      • Returns { channelId, channelToken, administratorId }
 *      • Duplicate-email guard (UserInputError)
 *      • Empty businessName guard (UserInputError)
 *
 *   2. Tenant admin session (Admin API, channel-scoped role)
 *      • tenantProfile query returns the profile for the admin's channel
 *      • updateTenantProfile persists field changes
 *      • createTenantProfile rejected for a channel that already has one
 *
 *   3. InstructorProfile CRUD (Admin API, tenantProfilePermission)
 *      • create / read (list + single) / update / delete
 *      • Shop API publicRead: instructorProfiles, instructorProfile(slug)
 *      • Channel isolation: tenant A cannot see tenant B's instructors
 *
 *   4. MediaResource CRUD (Admin API, mediaResourcePermission)
 *      • create / read / update / delete
 *      • Shop API publicRead: mediaResources(ownerType, ownerId)
 *
 *   5. Permission enforcement
 *      • Unauthenticated admin calls to write mutations → FORBIDDEN
 *      • Tenant A admin cannot read/write tenant B's data
 *
 * Run:  npm run test:e2e:tenant
 *
 * Requires a running Postgres instance. Connection credentials are read from
 * the same .env variables used by the dev server (DB_HOST, DB_PORT, DB_NAME,
 * DB_USERNAME, DB_PASSWORD, DB_SCHEMA). The initializer creates a dedicated
 * test schema (e2e_tenant_plugin) so it never touches the dev/production data.
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
import { SchemaPostgresInitializer } from './schema-postgres-initializer';
import {
  Administrator,
  Asset,
  Channel,
  mergeConfig,
  NativeAuthenticationMethod,
  PasswordCipher,
  Permission,
  RequestContext,
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
import { TenantTheme } from '../entities/tenant-theme.entity';
import { TenantThemeService } from '../services/tenant-theme.service';
import { TenantCommercialEligibilityService } from '../services/tenant-commercial-eligibility.service';
import { SubscriptionPlugin } from '../../subscription/subscription.plugin';
import { SubscriptionPlan } from '../../subscription/entities/subscription-plan.entity';
import { OrganizationSubscription } from '../../subscription/entities/organization-subscription.entity';
// TypeORM's DeepPartial (not @vendure/common's): Repository.create/save overloads
// are declared against this one, and the two differ structurally (`| null`).
import type { DeepPartial } from 'typeorm';
import { BigBlueButtonPlugin } from '../../bigbluebutton-plugin';
import { CmsPlugin } from '../../cms/cms.plugin';
import { ReviewsPlugin } from '../../reviews/reviews-plugin';
import { E2E_INITIAL_DATA } from './fixtures/e2e-initial-data';

// ─── Postgres initializer — uses the same DB as dev but an isolated schema ──
// Uses SchemaPostgresInitializer instead of the default PostgresInitializer
// because the default requires CREATEDB privilege. Schema-based isolation
// only requires CREATE privilege on the database, which the DB owner has.
registerInitializer('postgres', new SchemaPostgresInitializer());

// ─── GraphQL fragments & documents ────────────────────────────────────────

const REGISTER_NEW_TENANT = gql`
  mutation RegisterNewTenant($input: RegisterTenantInput!) {
    registerNewTenant(input: $input) {
      channelId
      channelToken
      administratorId
    }
  }
`;

const SHOP_TENANT_PROFILE = gql`
  query ShopTenantProfile {
    tenantProfile {
      id
      channelId
      businessName
      contactEmail
      timezone
      onboardingComplete
    }
  }
`;

const SHOP_INSTRUCTOR_PROFILES = gql`
  query ShopInstructorProfiles($options: InstructorProfileListOptions) {
    instructorProfiles(options: $options) {
      items {
        id
        slug
        fullName
        isPublic
        isActive
      }
      totalItems
    }
  }
`;

const SHOP_INSTRUCTOR_PROFILE_BY_SLUG = gql`
  query ShopInstructorProfileBySlug($slug: String!) {
    instructorProfile(slug: $slug) {
      id
      slug
      fullName
      bio
    }
  }
`;

const SHOP_MEDIA_RESOURCES = gql`
  query ShopMediaResources($ownerType: String!, $ownerId: String!) {
    mediaResources(ownerType: $ownerType, ownerId: $ownerId) {
      id
      type
      url
      title
      isActive
    }
  }
`;

const ADMIN_TENANT_PROFILE = gql`
  query AdminTenantProfile($channelId: String) {
    tenantProfile(channelId: $channelId) {
      id
      channelId
      businessName
      contactEmail
      timezone
      tagline
      onboardingComplete
    }
  }
`;

const CREATE_TENANT_PROFILE = gql`
  mutation CreateTenantProfile($input: CreateTenantProfileInput!) {
    createTenantProfile(input: $input) {
      id
      channelId
      businessName
      contactEmail
    }
  }
`;

const UPDATE_TENANT_PROFILE = gql`
  mutation UpdateTenantProfile($input: UpdateTenantProfileInput!) {
    updateTenantProfile(input: $input) {
      id
      businessName
      tagline
      onboardingComplete
    }
  }
`;

const CREATE_INSTRUCTOR_PROFILE = gql`
  mutation CreateInstructorProfile($input: CreateInstructorProfileInput!) {
    createInstructorProfile(input: $input) {
      id
      slug
      fullName
      bio
      isPublic
      isActive
      channelId
    }
  }
`;

const UPDATE_INSTRUCTOR_PROFILE = gql`
  mutation UpdateInstructorProfile($input: UpdateInstructorProfileInput!) {
    updateInstructorProfile(input: $input) {
      id
      slug
      fullName
      bio
      isPublic
    }
  }
`;

const DELETE_INSTRUCTOR_PROFILE = gql`
  mutation DeleteInstructorProfile($id: ID!) {
    deleteInstructorProfile(id: $id)
  }
`;

const ADMIN_INSTRUCTOR_PROFILES = gql`
  query AdminInstructorProfiles($options: InstructorProfileListOptions) {
    instructorProfiles(options: $options) {
      items {
        id
        slug
        fullName
        channelId
      }
      totalItems
    }
  }
`;

const ADMIN_INSTRUCTOR_PROFILE = gql`
  query AdminInstructorProfile($id: ID!) {
    instructorProfile(id: $id) {
      id
      slug
      fullName
      channelId
    }
  }
`;

const CREATE_MEDIA_RESOURCE = gql`
  mutation CreateMediaResource($input: CreateMediaResourceInput!) {
    createMediaResource(input: $input) {
      id
      ownerType
      ownerId
      type
      url
      title
      isActive
      channelId
    }
  }
`;

const UPDATE_MEDIA_RESOURCE = gql`
  mutation UpdateMediaResource($input: UpdateMediaResourceInput!) {
    updateMediaResource(input: $input) {
      id
      title
      url
      isActive
    }
  }
`;

const DELETE_MEDIA_RESOURCE = gql`
  mutation DeleteMediaResource($id: ID!) {
    deleteMediaResource(id: $id)
  }
`;

const ADMIN_MEDIA_RESOURCES = gql`
  query AdminMediaResources($options: MediaResourceListOptions) {
    mediaResources(options: $options) {
      items {
        id
        ownerType
        ownerId
        type
        url
        title
      }
      totalItems
    }
  }
`;

const ADMINISTRATORS = gql`
  query Administrators {
    administrators {
      items {
        id
        emailAddress
        firstName
        lastName
        user {
          roles {
            channels {
              code
            }
          }
        }
      }
      totalItems
    }
  }
`;

const ROLES = gql`
  query Roles {
    roles {
      items {
        id
        code
        description
      }
      totalItems
    }
  }
`;

const ROLE = gql`
  query Role($id: ID!) {
    role(id: $id) {
      id
      code
      description
    }
  }
`;

const ROLE_WITH_PERMISSIONS = gql`
  query RoleWithPermissions($id: ID!) {
    role(id: $id) {
      id
      code
      description
      permissions
      channels {
        id
        code
      }
    }
  }
`;

const ADMINISTRATOR = gql`
  query Administrator($id: ID!) {
    administrator(id: $id) {
      id
      emailAddress
      firstName
      lastName
    }
  }
`;

// ─── CMS channel isolation (ADR-036 / BUG-031) ───────────────────────────

const CREATE_CMS_PAGE = gql`
  mutation CreateCmsPage($input: CreatePageInput!) {
    createPage(input: $input) {
      id
      slug
      title
      isPublished
    }
  }
`;

const ADMIN_CMS_PAGES = gql`
  query AdminCmsPages {
    cmsPages {
      items {
        id
        slug
        title
        channels {
          code
        }
      }
      totalItems
    }
  }
`;

const SHOP_CMS_PAGE = gql`
  query ShopCmsPage($slug: String!) {
    cmsPage(slug: $slug) {
      id
      slug
      title
    }
  }
`;

// ─── TenantTheme — ADR-043 L1 lifecycle ───────────────────────────────────
// Shared selection set so every theme assertion sees the same shape.
const THEME_FIELDS = `
  id
  channelId
  version
  status
  primaryColor
  secondaryColor
  accentColor
  backgroundColor
  textColor
  fontFamily
  logoAssetId
  displayName
`;

const CREATE_TENANT_THEME = gql`
  mutation CreateTenantTheme($input: TenantThemeInput!) {
    createTenantTheme(input: $input) {
      ${THEME_FIELDS}
    }
  }
`;

const UPDATE_TENANT_THEME = gql`
  mutation UpdateTenantTheme($id: ID!, $input: TenantThemeInput!) {
    updateTenantTheme(id: $id, input: $input) {
      ${THEME_FIELDS}
    }
  }
`;

const PUBLISH_TENANT_THEME = gql`
  mutation PublishTenantTheme($id: ID!) {
    publishTenantTheme(id: $id) {
      ${THEME_FIELDS}
    }
  }
`;

const ROLLBACK_TENANT_THEME = gql`
  mutation RollbackTenantTheme($id: ID!) {
    rollbackTenantTheme(id: $id) {
      ${THEME_FIELDS}
    }
  }
`;

const RESET_TENANT_THEME = gql`
  mutation ResetTenantTheme {
    resetTenantTheme
  }
`;

const ADMIN_TENANT_THEMES = gql`
  query AdminTenantThemes {
    tenantThemes {
      items {
        ${THEME_FIELDS}
      }
      totalItems
    }
  }
`;

const ADMIN_TENANT_THEME = gql`
  query AdminTenantTheme($id: ID!) {
    tenantTheme(id: $id) {
      ${THEME_FIELDS}
    }
  }
`;

const SHOP_MY_TENANT_THEME = gql`
  query ShopMyTenantTheme {
    myTenantTheme {
      ${THEME_FIELDS}
    }
  }
`;

/**
 * Vendure's ID scalar encodes ids with a type prefix (`T_2`), while the scalar
 * `channelId` / `logoAssetId` columns store the raw value (`2`). Normalise
 * before comparing GraphQL output against DB values.
 */
function stripIdPrefix(value: string | null | undefined): string {
  return String(value ?? '').replace(/^T_/, '');
}

// ─── Test suite ───────────────────────────────────────────────────────────

describe('TenantPlugin', () => {
  const { server, adminClient, shopClient } = createTestEnvironment(
    mergeConfig(testConfig, {
      apiOptions: { port: 3070 },
      authOptions: {
        // BUG-033 root-cause fix: registerNewTenant creates admins with
        // user.verified=false (tenant-registration.service.ts), and testConfig
        // defaults authOptions.requireVerification=true, so tenant-channel
        // logins return a null CurrentUser ("Cannot return null for
        // non-nullable field CurrentUser.id"). Verification itself is covered
        // by unit tests; this suite needs authenticated tenant admins.
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
        // The PostgresInitializer creates and tears this schema down automatically.
        schema: 'e2e_tenant_plugin',
        synchronize: true,
      },
      // SubscriptionPlugin is loaded because ADR-043 §2 gates tenant theming on
      // the tenant's subscription entitlement (plan.whitelabelEnabled + status),
      // so organization_subscription / subscription_plan must exist in this
      // schema. TenantPlugin reads them through TransactionalConnection instead
      // of injecting SubscriptionService — which is why this is a test-schema
      // requirement rather than a plugin dependency of TenantPlugin.
      plugins: [
        TenantPlugin,
        BigBlueButtonPlugin,
        CmsPlugin,
        ReviewsPlugin,
        SubscriptionPlugin.init({}) as any,
      ],
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

  // Test-only admins with ReadAdministrator on their tenant channel, used to
  // exercise the channel-scoped administrator/role resolvers (INV-016,
  // BUG-025, BUG-026) WITHOUT broadening the production tenant-admin template.
  let readAdminEmail: string;
  let readAdminPassword: string;
  let readAdminBEmail: string;
  let readAdminBPassword: string;

  let instructorProfileId: string;
  let mediaResourceId: string;

  // ── Bootstrap ────────────────────────────────────────────────────────────

  beforeAll(async () => {
    await server.init({
      initialData: E2E_INITIAL_DATA,
      productsCsvPath: path.join(__dirname, 'fixtures/e2e-products.csv'),
      customerCount: 2,
    });
  }, 120_000);

  afterAll(async () => {
    await server.destroy();
  });

  // ── Helper: create a test-only admin with ReadAdministrator ─────────────
  // The production tenant-admin template deliberately does NOT include
  // ReadAdministrator (tenant admins should not manage administrators/roles).
  // To test the channel-scoping of the custom resolvers (INV-016, BUG-025,
  // BUG-026), we create a dedicated test-only role + admin scoped to the
  // tenant A channel that DOES have ReadAdministrator. This keeps the
  // production permission boundary intact while still exercising the resolver
  // channel filtering.
  async function createReadAdministratorTestAdmin(
    channelId: string,
    channelCode: string,
  ): Promise<{ email: string; password: string }> {
    const connection = server.app.get(TransactionalConnection);
    const passwordCipher = server.app.get(PasswordCipher);
    const email = `read-admin-${channelCode}-${Date.now()}@example.com`;
    const password = 'ReadAdminP@ss1';

    // 1. Create a channel-scoped role with ReadAdministrator.
    const role = new Role({
      code: `${channelCode}-read-admin`,
      description: `Test-only ReadAdministrator for ${channelCode}`,
      permissions: [Permission.Authenticated, Permission.ReadAdministrator],
    });
    const channel = await connection
      .getRepository(undefined, 'Channel')
      .findOneOrFail({ where: { id: channelId } });
    role.channels = [channel as any];
    const savedRole = await connection.getRepository(undefined, Role).save(role);

    // 2. Create a User + native auth method.
    const user = new User();
    user.identifier = email;
    user.verified = true;
    const savedUser = await connection.getRepository(undefined, User).save(user);

    const hashedPassword = await passwordCipher.hash(password);
    const nativeAuthMethod = new NativeAuthenticationMethod({
      identifier: email,
      passwordHash: hashedPassword,
    });
    nativeAuthMethod.user = savedUser as any;
    await connection
      .getRepository(undefined, NativeAuthenticationMethod)
      .save(nativeAuthMethod);

    // 3. Assign the role to the user.
    const userWithRoles = await connection.getRepository(undefined, User).findOne({
      where: { id: savedUser.id },
      relations: ['roles'],
    });
    if (userWithRoles) {
      userWithRoles.roles = [savedRole];
      await connection.getRepository(undefined, User).save(userWithRoles);
    }

    // 4. Create the Administrator.
    const admin = connection.getRepository(undefined, Administrator).create({
      firstName: 'Read',
      lastName: 'Admin',
      emailAddress: email,
      user: savedUser,
    });
    await connection.getRepository(undefined, Administrator).save(admin);

    return { email, password };
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 1. registerNewTenant — Shop API public mutation
  // ═══════════════════════════════════════════════════════════════════════

  describe('registerNewTenant', () => {
    beforeAll(() => {
      // registerNewTenant is a public Shop API mutation, but Vendure still
      // requires a channel token to route the request. Use the e2e default
      // channel token (set in testConfig.defaultChannelToken).
      shopClient.setChannelToken(E2E_DEFAULT_CHANNEL_TOKEN);
    });

    it('creates a Seller, Channel, Role, Administrator and TenantProfile in one transaction', async () => {
      tenantAEmail = `tenant-a-${Date.now()}@example.com`;

      const result = await shopClient.query(REGISTER_NEW_TENANT, {
        input: {
          businessName: 'Mehta Coaching',
          firstName: 'Anjali',
          lastName: 'Mehta',
          emailAddress: tenantAEmail,
          password: 'StrongP@ss1',
          contactEmail: 'hello@mehta.example.com',
          timezone: 'Asia/Kolkata',
        },
      });

      const { channelId, channelToken, administratorId } = result.registerNewTenant;
      expect(channelId).toBeTruthy();
      expect(channelToken).toMatch(/^tok_/);
      expect(administratorId).toBeTruthy();

      // Store the raw channel ID (strip Vendure's entity type prefix like "T_")
      // because channelId on TenantProfile is a @Column() storing the raw value,
      // not an @EntityId() which would encode it.
      tenantAChannelId = channelId.replace(/^T_/, '');
      tenantAChannelToken = channelToken;
      tenantAAdminId = administratorId;
    });

    it('registers a second independent tenant (tenant B)', async () => {
      tenantBEmail = `tenant-b-${Date.now()}@example.com`;

      const result = await shopClient.query(REGISTER_NEW_TENANT, {
        input: {
          businessName: 'Sharma Academy',
          firstName: 'Rahul',
          lastName: 'Sharma',
          emailAddress: tenantBEmail,
          password: 'StrongP@ss2',
          timezone: 'Asia/Kolkata',
        },
      });

      const { channelId, channelToken } = result.registerNewTenant;
      // channelId from GraphQL is Vendure-encoded (e.g. "T_3"), but tenantAChannelId
      // is stored as raw (e.g. "2"). Compare the raw values.
      expect(channelId.replace(/^T_/, '')).not.toEqual(tenantAChannelId);
      expect(channelToken).not.toEqual(tenantAChannelToken);

      // Store the raw channel ID (strip Vendure's entity type prefix like "T_")
      tenantBChannelId = channelId.replace(/^T_/, '');
      tenantBChannelToken = channelToken;
    });

    it('rejects a duplicate email address', async () => {
      const promise = shopClient.query(REGISTER_NEW_TENANT, {
        input: {
          businessName: 'Duplicate Co',
          firstName: 'X',
          lastName: 'Y',
          emailAddress: tenantAEmail, // already registered
          password: 'StrongP@ss3',
        },
      });

      await expect(promise).rejects.toThrow(
        'An account with these details could not be created',
      );
    });

    it('rejects an empty businessName', async () => {
      const promise = shopClient.query(REGISTER_NEW_TENANT, {
        input: {
          businessName: '   ', // whitespace only
          firstName: 'A',
          lastName: 'B',
          emailAddress: `blank-biz-${Date.now()}@example.com`,
          password: 'StrongP@ss4',
        },
      });

      await expect(promise).rejects.toThrow('businessName is required');
    });

    it('TenantProfile is visible on the Shop API via the tenant channel token', async () => {
      shopClient.setChannelToken(tenantAChannelToken);

      const { tenantProfile } = await shopClient.query(SHOP_TENANT_PROFILE);

      expect(tenantProfile).toMatchObject({
        channelId: tenantAChannelId,
        businessName: 'Mehta Coaching',
        contactEmail: 'hello@mehta.example.com',
        timezone: 'Asia/Kolkata',
        onboardingComplete: false,
      });
    });

    it('TenantProfile is null when queried on a different channel', async () => {
      shopClient.setChannelToken(tenantBChannelToken);

      // Tenant B has its own profile; tenant A's profile is not visible here
      const { tenantProfile } = await shopClient.query(SHOP_TENANT_PROFILE);
      expect(tenantProfile?.channelId).toEqual(tenantBChannelId);
      expect(tenantProfile?.channelId).not.toEqual(tenantAChannelId);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 2. TenantProfile Admin API (channel-scoped role)
  // ═══════════════════════════════════════════════════════════════════════

  describe('TenantProfile — Admin API', () => {
    beforeAll(async () => {
      // Log in as tenant A's own administrator on the Admin API
      adminClient.setChannelToken(tenantAChannelToken);
      await adminClient.asUserWithCredentials(tenantAEmail, 'StrongP@ss1');
    });

    it('tenantProfile query returns the profile for the current channel', async () => {
      const { tenantProfile } = await adminClient.query(ADMIN_TENANT_PROFILE);

      expect(tenantProfile).toMatchObject({
        channelId: tenantAChannelId,
        businessName: 'Mehta Coaching',
      });
    });

    it('updateTenantProfile persists tagline and onboardingComplete', async () => {
      const { tenantProfile: current } = await adminClient.query(
        ADMIN_TENANT_PROFILE,
      );

      const { updateTenantProfile } = await adminClient.query(
        UPDATE_TENANT_PROFILE,
        {
          input: {
            channelId: current.channelId,
            tagline: 'Learn with the best',
            onboardingComplete: true,
          },
        },
      );

      expect(updateTenantProfile).toMatchObject({
        tagline: 'Learn with the best',
        onboardingComplete: true,
      });
    });

    it('createTenantProfile rejects when a profile already exists for the channel', async () => {
      const promise = adminClient.query(CREATE_TENANT_PROFILE, {
        input: {
          channelId: tenantAChannelId,
          businessName: 'Duplicate Profile',
          contactEmail: 'dup@example.com',
        },
      });

      await expect(promise).rejects.toThrow(
        `TenantProfile already exists for channel ${tenantAChannelId}`,
      );
    });

    it('SuperAdmin can query tenantProfile for any channel via channelId arg', async () => {
      await adminClient.asSuperAdmin();
      adminClient.setChannelToken(''); // default channel

      const { tenantProfile } = await adminClient.query(ADMIN_TENANT_PROFILE, {
        channelId: tenantAChannelId,
      });

      expect(tenantProfile?.businessName).toBe('Mehta Coaching');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 3. InstructorProfile CRUD
  // ═══════════════════════════════════════════════════════════════════════

  describe('InstructorProfile', () => {
    let tenantACustomerId: string;

    beforeAll(async () => {
      // Log in as tenant A admin to get a customer ID for the instructor profile
      adminClient.setChannelToken(tenantAChannelToken);
      await adminClient.asUserWithCredentials(tenantAEmail, 'StrongP@ss1');

      // Use the tenant admin user's own ID as the customerId placeholder.
      // In a real test fixture this would be a registered Customer; here we
      // use the administratorId as a foreign-key stand-in since the entity
      // column is a plain string (no FK constraint enforced in SQLite).
      tenantACustomerId = tenantAAdminId;
    });

    it('createInstructorProfile creates a profile scoped to the current channel', async () => {
      const { createInstructorProfile } = await adminClient.query(
        CREATE_INSTRUCTOR_PROFILE,
        {
          input: {
            customerId: tenantACustomerId,
            slug: 'anjali-mehta',
            fullName: 'Anjali Mehta',
            bio: 'Expert in mathematics',
            isPublic: true,
            isActive: true,
            expertiseAreas: ['Mathematics', 'Physics'],
          },
        },
      );

      expect(createInstructorProfile).toMatchObject({
        slug: 'anjali-mehta',
        fullName: 'Anjali Mehta',
        isPublic: true,
        isActive: true,
        channelId: tenantAChannelId,
      });

      instructorProfileId = createInstructorProfile.id;
    });

    it('instructorProfiles list returns only this channel\'s profiles', async () => {
      const { instructorProfiles } = await adminClient.query(
        ADMIN_INSTRUCTOR_PROFILES,
      );

      expect(instructorProfiles.totalItems).toBeGreaterThanOrEqual(1);
      for (const item of instructorProfiles.items) {
        expect(item.channelId).toBe(tenantAChannelId);
      }
    });

    it('instructorProfile(id) returns the profile', async () => {
      const { instructorProfile } = await adminClient.query(
        ADMIN_INSTRUCTOR_PROFILE,
        { id: instructorProfileId },
      );

      expect(instructorProfile).toMatchObject({
        id: instructorProfileId,
        slug: 'anjali-mehta',
        channelId: tenantAChannelId,
      });
    });

    it('updateInstructorProfile persists bio and isPublic changes', async () => {
      const { updateInstructorProfile } = await adminClient.query(
        UPDATE_INSTRUCTOR_PROFILE,
        {
          input: {
            id: instructorProfileId,
            bio: 'Updated bio — specialist in IIT-JEE prep',
            isPublic: false,
          },
        },
      );

      expect(updateInstructorProfile).toMatchObject({
        bio: 'Updated bio — specialist in IIT-JEE prep',
        isPublic: false,
      });
    });

    it('Shop API instructorProfiles returns only public+active profiles', async () => {
      // The profile is now private (isPublic=false) — should not appear
      shopClient.setChannelToken(tenantAChannelToken);
      const { instructorProfiles } = await shopClient.query(
        SHOP_INSTRUCTOR_PROFILES,
      );

      const found = instructorProfiles.items.find(
        (p: any) => p.id === instructorProfileId,
      );
      expect(found).toBeUndefined();
    });

    it('Shop API instructorProfile(slug) returns null for a private profile', async () => {
      shopClient.setChannelToken(tenantAChannelToken);
      const { instructorProfile } = await shopClient.query(
        SHOP_INSTRUCTOR_PROFILE_BY_SLUG,
        { slug: 'anjali-mehta' },
      );
      expect(instructorProfile).toBeNull();
    });

    it('make profile public again and verify Shop API visibility', async () => {
      // Re-authenticate as admin (shopClient changes above don't affect adminClient)
      adminClient.setChannelToken(tenantAChannelToken);
      await adminClient.asUserWithCredentials(tenantAEmail, 'StrongP@ss1');

      await adminClient.query(UPDATE_INSTRUCTOR_PROFILE, {
        input: { id: instructorProfileId, isPublic: true },
      });

      shopClient.setChannelToken(tenantAChannelToken);
      const { instructorProfile } = await shopClient.query(
        SHOP_INSTRUCTOR_PROFILE_BY_SLUG,
        { slug: 'anjali-mehta' },
      );
      expect(instructorProfile).toMatchObject({ slug: 'anjali-mehta' });
    });

    it('channel isolation: tenant B admin cannot see tenant A instructors', async () => {
      adminClient.setChannelToken(tenantBChannelToken);
      await adminClient.asUserWithCredentials(tenantBEmail, 'StrongP@ss2');

      const { instructorProfiles } = await adminClient.query(
        ADMIN_INSTRUCTOR_PROFILES,
      );

      const leak = instructorProfiles.items.find(
        (p: any) => p.channelId === tenantAChannelId,
      );
      expect(leak).toBeUndefined();
    });

    it('deleteInstructorProfile removes the profile', async () => {
      // Switch back to tenant A
      adminClient.setChannelToken(tenantAChannelToken);
      await adminClient.asUserWithCredentials(tenantAEmail, 'StrongP@ss1');

      const { deleteInstructorProfile } = await adminClient.query(
        DELETE_INSTRUCTOR_PROFILE,
        { id: instructorProfileId },
      );
      expect(deleteInstructorProfile).toBe(true);

      // Verify it's gone
      const { instructorProfile } = await adminClient.query(
        ADMIN_INSTRUCTOR_PROFILE,
        { id: instructorProfileId },
      );
      expect(instructorProfile).toBeNull();
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 4. MediaResource CRUD
  // ═══════════════════════════════════════════════════════════════════════

  describe('MediaResource', () => {
    beforeAll(async () => {
      adminClient.setChannelToken(tenantAChannelToken);
      await adminClient.asUserWithCredentials(tenantAEmail, 'StrongP@ss1');
    });

    it('createMediaResource creates a resource scoped to the current channel', async () => {
      const { createMediaResource } = await adminClient.query(
        CREATE_MEDIA_RESOURCE,
        {
          input: {
            ownerType: 'instructor',
            ownerId: 'instructor-123',
            type: 'youtube',
            url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
            title: 'Intro to Calculus',
            isActive: true,
          },
        },
      );

      expect(createMediaResource).toMatchObject({
        ownerType: 'instructor',
        ownerId: 'instructor-123',
        type: 'youtube',
        title: 'Intro to Calculus',
        isActive: true,
        channelId: tenantAChannelId,
      });

      mediaResourceId = createMediaResource.id;
    });

    it('mediaResources list returns resources filtered by ownerType/ownerId', async () => {
      const { mediaResources } = await adminClient.query(
        ADMIN_MEDIA_RESOURCES,
        {
          options: { ownerType: 'instructor', ownerId: 'instructor-123' },
        },
      );

      expect(mediaResources.totalItems).toBeGreaterThanOrEqual(1);
      expect(
        mediaResources.items.every((r: any) => r.ownerType === 'instructor'),
      ).toBe(true);
    });

    it('updateMediaResource persists title changes', async () => {
      const { updateMediaResource } = await adminClient.query(
        UPDATE_MEDIA_RESOURCE,
        {
          input: {
            id: mediaResourceId,
            title: 'Intro to Calculus — Updated',
          },
        },
      );

      expect(updateMediaResource.title).toBe('Intro to Calculus — Updated');
    });

    it('Shop API mediaResources returns resources for the channel', async () => {
      shopClient.setChannelToken(tenantAChannelToken);
      const { mediaResources } = await shopClient.query(SHOP_MEDIA_RESOURCES, {
        ownerType: 'instructor',
        ownerId: 'instructor-123',
      });

      expect(mediaResources.length).toBeGreaterThanOrEqual(1);
      expect(mediaResources[0].title).toBe('Intro to Calculus — Updated');
    });

    it('deleteMediaResource removes the resource', async () => {
      adminClient.setChannelToken(tenantAChannelToken);
      await adminClient.asUserWithCredentials(tenantAEmail, 'StrongP@ss1');

      const { deleteMediaResource } = await adminClient.query(
        DELETE_MEDIA_RESOURCE,
        { id: mediaResourceId },
      );
      expect(deleteMediaResource).toBe(true);

      const { mediaResources } = await adminClient.query(ADMIN_MEDIA_RESOURCES, {
        options: { ownerType: 'instructor', ownerId: 'instructor-123' },
      });
      const found = mediaResources.items.find(
        (r: any) => r.id === mediaResourceId,
      );
      expect(found).toBeUndefined();
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 5. Permission enforcement
  // ═══════════════════════════════════════════════════════════════════════

  describe('Permission enforcement', () => {
    it('unauthenticated Admin API write → FORBIDDEN', async () => {
      // Log out (no credentials set)
      adminClient.setChannelToken('');
      // Don't call asSuperAdmin() or asUserWithCredentials() — anonymous
      const promise = adminClient.query(CREATE_TENANT_PROFILE, {
        input: {
          channelId: tenantAChannelId,
          businessName: 'Should Fail',
          contactEmail: 'fail@example.com',
        },
      });

      await expect(promise).rejects.toThrow();
    });

    it('tenant A admin cannot createTenantProfile on tenant B channel', async () => {
      adminClient.setChannelToken(tenantAChannelToken);
      await adminClient.asUserWithCredentials(tenantAEmail, 'StrongP@ss1');

      // Specify tenant B's channelId explicitly — service enforces channel
      // isolation via ctx.channelId and the TenantProfile already-exists check
      const promise = adminClient.query(CREATE_TENANT_PROFILE, {
        input: {
          channelId: tenantBChannelId,
          businessName: 'Hostile Takeover',
          contactEmail: 'attack@example.com',
        },
      });

      // Either FORBIDDEN (permission guard) or "already exists" (service guard)
      // — in both cases the operation must not succeed
      await expect(promise).rejects.toThrow();
    });

    it('tenant B admin cannot delete tenant A MediaResource', async () => {
      // Re-create a resource as tenant A
      adminClient.setChannelToken(tenantAChannelToken);
      await adminClient.asUserWithCredentials(tenantAEmail, 'StrongP@ss1');

      const { createMediaResource } = await adminClient.query(
        CREATE_MEDIA_RESOURCE,
        {
          input: {
            ownerType: 'article',
            ownerId: 'art-001',
            type: 'youtube',
            url: 'https://www.youtube.com/watch?v=test',
            title: 'Tenant A resource',
          },
        },
      );
      const aTempId = createMediaResource.id;

      // Now switch to tenant B and try to delete it
      adminClient.setChannelToken(tenantBChannelToken);
      await adminClient.asUserWithCredentials(tenantBEmail, 'StrongP@ss2');

      const promise = adminClient.query(DELETE_MEDIA_RESOURCE, {
        id: aTempId,
      });

      // Service layer throws EntityNotFoundError (resource not in tenant B's channel)
      await expect(promise).rejects.toThrow();
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 6. Administrator visibility (INV-016)
  // ═══════════════════════════════════════════════════════════════════════

  describe('Administrator visibility (INV-016)', () => {
    // The production tenant-admin template does NOT include ReadAdministrator,
    // so the channel-scoping of the custom `administrators` resolver is tested
    // with a dedicated test-only admin that has ReadAdministrator on tenant A's
    // channel. This keeps the production permission boundary intact.
    beforeAll(async () => {
      const channelCodeA = tenantAChannelToken.replace(/^tok_/, '');
      const credsA = await createReadAdministratorTestAdmin(
        tenantAChannelId,
        channelCodeA,
      );
      readAdminEmail = credsA.email;
      readAdminPassword = credsA.password;

      const channelCodeB = tenantBChannelToken.replace(/^tok_/, '');
      const credsB = await createReadAdministratorTestAdmin(
        tenantBChannelId,
        channelCodeB,
      );
      readAdminBEmail = credsB.email;
      readAdminBPassword = credsB.password;
    });

    it('tenant A read-admin only sees administrators in their own channel', async () => {
      adminClient.setChannelToken(tenantAChannelToken);
      await adminClient.asUserWithCredentials(readAdminEmail, readAdminPassword);

      const { administrators } = await adminClient.query(ADMINISTRATORS);

      // The read-admin must NOT see the global SuperAdmin account.
      // The only administrators visible are those in tenant A's channel:
      // the tenant A admin themselves + the read-admin.
      expect(administrators.totalItems).toBe(2);
      const emails = administrators.items.map((a: any) => a.emailAddress);
      expect(emails).toContain(tenantAEmail);
      expect(emails).toContain(readAdminEmail);
      expect(emails).not.toContain('superadmin');

      // BUG-030: the nested user.roles.channels relation must be populated
      // consistently with the direct `roles` query. Without loading
      // `user.roles.channels`, TypeORM returns `channels: []` even though the
      // role-channel join exists.
      const tenantAdmin = administrators.items.find(
        (a: any) => a.emailAddress === tenantAEmail,
      );
      const roleChannels = tenantAdmin.user.roles.flatMap((r: any) =>
        r.channels.map((c: any) => c.code),
      );
      expect(roleChannels.some((code: string) => code.startsWith('mehta-coaching'))).toBe(true);
    });

    it('tenant B read-admin only sees administrators in their own channel', async () => {
      adminClient.setChannelToken(tenantBChannelToken);
      await adminClient.asUserWithCredentials(readAdminBEmail, readAdminBPassword);

      const { administrators } = await adminClient.query(ADMINISTRATORS);

      // The read-admin must NOT see the global SuperAdmin account.
      // The only administrators visible are those in tenant B's channel:
      // the tenant B admin themselves + the read-admin.
      expect(administrators.totalItems).toBe(2);
      const emails = administrators.items.map((a: any) => a.emailAddress);
      expect(emails).toContain(tenantBEmail);
      expect(emails).toContain(readAdminBEmail);
      expect(emails).not.toContain('superadmin');
    });

    it('SuperAdmin sees all administrators', async () => {
      // Set the default channel token BEFORE logging in as SuperAdmin —
      // asSuperAdmin() performs a login that needs a valid channel token.
      adminClient.setChannelToken(E2E_DEFAULT_CHANNEL_TOKEN);
      await adminClient.asSuperAdmin();

      const { administrators } = await adminClient.query(ADMINISTRATORS);

      // SuperAdmin sees at least the global admin plus the two tenant admins
      expect(administrators.totalItems).toBeGreaterThanOrEqual(3);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 7. Role visibility (BUG-025)
  // ═══════════════════════════════════════════════════════════════════════

  describe('Role visibility (BUG-025)', () => {
    it('SuperAdmin sees all roles regardless of active channel', async () => {
      // Set the default channel token BEFORE logging in as SuperAdmin.
      adminClient.setChannelToken(E2E_DEFAULT_CHANNEL_TOKEN);
      await adminClient.asSuperAdmin();

      const { roles } = await adminClient.query(ROLES);

      // SuperAdmin sees the seeded defaults (super_admin, customer) plus the
      // tenant-created roles (one per registered tenant).
      expect(roles.totalItems).toBeGreaterThanOrEqual(4);
      // The tenant-created role must be present and resolvable by name.
      const tenantRole = roles.items.find((r: any) =>
        r.description?.includes('Tenant administrator'),
      );
      expect(tenantRole).toBeTruthy();
    });

    it('tenant A read-admin only sees roles in their own channel', async () => {
      adminClient.setChannelToken(tenantAChannelToken);
      await adminClient.asUserWithCredentials(readAdminEmail, readAdminPassword);

      const { roles } = await adminClient.query(ROLES);

      // Tenant A sees its own tenant-admin role (and any default roles
      // assigned to its channel), but NOT tenant B's role, and NOT the
      // global SuperAdmin role.
      const tenantBRole = roles.items.find((r: any) =>
        r.description?.includes('Sharma Academy'),
      );
      expect(tenantBRole).toBeUndefined();
      const superAdminRole = roles.items.find((r: any) =>
        r.code === '__super_admin_role__',
      );
      expect(superAdminRole).toBeUndefined();
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 8. Tenant admin role permissions & channel assignment (BUG-028/BUG-029)
  // ═══════════════════════════════════════════════════════════════════════

  describe('Tenant admin role permissions & channel assignment (BUG-028/BUG-029)', () => {
    it('newly provisioned tenant admin role has BBB, CMS, Reviews permissions', async () => {
      // Find the tenant A role as SuperAdmin.
      adminClient.setChannelToken(E2E_DEFAULT_CHANNEL_TOKEN);
      await adminClient.asSuperAdmin();

      const { roles } = await adminClient.query(ROLES);
      const tenantRole = roles.items.find(
        (r: any) => r.description?.includes('Mehta Coaching'),
      );
      expect(tenantRole).toBeTruthy();

      const { role } = await adminClient.query(ROLE_WITH_PERMISSIONS, {
        id: tenantRole.id,
      });

      const permissions: string[] = role.permissions;

      // BBB granular permissions (Phase B) — must be present.
      expect(permissions).toContain('BBBManageOrganizations');
      expect(permissions).toContain('BBBManageRooms');
      expect(permissions).toContain('BBBManageSessions');
      expect(permissions).toContain('BBBManageMeetings');
      expect(permissions).toContain('BBBManageEntitlements');
      expect(permissions).toContain('BBBManageMembers');

      // CMS CRUD permissions — must be present.
      expect(permissions).toContain('ReadCmsArticle');
      expect(permissions).toContain('CreateCmsArticle');
      expect(permissions).toContain('ReadCmsBanner');
      expect(permissions).toContain('CreateCmsBanner');
      expect(permissions).toContain('ReadCmsPage');
      expect(permissions).toContain('CreateCmsPage');

      // Reviews — must be present.
      expect(permissions).toContain('ReviewAdmin');

      // Tenant plugin CRUD permissions — must be present.
      expect(permissions).toContain('ReadTenantProfile');
      expect(permissions).toContain('ReadInstructorProfile');
      expect(permissions).toContain('ReadMediaResource');
    });

    it('tenant admin role does NOT include BBBPlatformInfrastructure (ADR-033)', async () => {
      adminClient.setChannelToken(E2E_DEFAULT_CHANNEL_TOKEN);
      await adminClient.asSuperAdmin();

      const { roles } = await adminClient.query(ROLES);
      const tenantRole = roles.items.find(
        (r: any) => r.description?.includes('Mehta Coaching'),
      );
      expect(tenantRole).toBeTruthy();

      const { role } = await adminClient.query(ROLE_WITH_PERMISSIONS, {
        id: tenantRole.id,
      });

      // BBBPlatformInfrastructure is Portal/SuperAdmin-only — must NOT be
      // granted to tenant admins (ADR-033, BUG-029).
      expect(role.permissions).not.toContain('BBBPlatformInfrastructure');
    });

    it('tenant admin role is scoped to the tenant channel only', async () => {
      adminClient.setChannelToken(E2E_DEFAULT_CHANNEL_TOKEN);
      await adminClient.asSuperAdmin();

      const { roles } = await adminClient.query(ROLES);
      const tenantRole = roles.items.find(
        (r: any) => r.description?.includes('Mehta Coaching'),
      );
      expect(tenantRole).toBeTruthy();

      const { role } = await adminClient.query(ROLE_WITH_PERMISSIONS, {
        id: tenantRole.id,
      });

      // The role must be assigned to exactly one tenant channel (INV-001:
      // Channel = Tenant). The channel code is generated as
      // `mehta-coaching-<random-suffix>`.
      const channelCodes = role.channels.map((c: any) => c.code);
      expect(channelCodes).toHaveLength(1);
      expect(channelCodes[0]).toMatch(/^mehta-coaching-/);
      // It must NOT be assigned to tenant B's channel.
      expect(channelCodes.some((code: string) => code.startsWith('sharma-academy'))).toBe(false);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 9. CMS channel isolation (ADR-036 / BUG-031)
  // ═══════════════════════════════════════════════════════════════════════

  describe('CMS channel isolation (ADR-036 / BUG-031)', () => {
    let tenantAPageSlug: string;
    let platformPageSlug: string;

    it('tenant A admin can create a CMS page scoped to their channel only', async () => {
      adminClient.setChannelToken(tenantAChannelToken);
      await adminClient.asUserWithCredentials(tenantAEmail, 'StrongP@ss1');

      tenantAPageSlug = `tenant-a-page-${Date.now()}`;
      const { createPage } = await adminClient.query(CREATE_CMS_PAGE, {
        input: {
          slug: tenantAPageSlug,
          title: 'Tenant A Page',
          isPublished: true,
        },
      });

      expect(createPage).toMatchObject({
        slug: tenantAPageSlug,
        title: 'Tenant A Page',
        isPublished: true,
      });
    });

    it('tenant A admin sees their own CMS page scoped to tenant channel only', async () => {
      adminClient.setChannelToken(tenantAChannelToken);
      await adminClient.asUserWithCredentials(tenantAEmail, 'StrongP@ss1');

      const { cmsPages } = await adminClient.query(ADMIN_CMS_PAGES);

      const found = cmsPages.items.find(
        (p: any) => p.slug === tenantAPageSlug,
      );
      expect(found).toBeTruthy();
      // ADR-036: tenant-created page must be on the tenant channel ONLY,
      // never the default channel (BUG-031).
      const channelCodes = found.channels.map((c: any) => c.code);
      expect(channelCodes).toHaveLength(1);
      expect(channelCodes[0]).toMatch(/^mehta-coaching-/);
      expect(channelCodes).not.toContain('__default_channel__');
    });

    it('tenant B admin cannot see tenant A CMS page (channel isolation)', async () => {
      adminClient.setChannelToken(tenantBChannelToken);
      await adminClient.asUserWithCredentials(tenantBEmail, 'StrongP@ss2');

      const { cmsPages } = await adminClient.query(ADMIN_CMS_PAGES);

      const leak = cmsPages.items.find(
        (p: any) => p.slug === tenantAPageSlug,
      );
      expect(leak).toBeUndefined();
    });

    it('Shop API cmsPage(slug) is channel-scoped', async () => {
      // Tenant A's storefront token can resolve the page.
      shopClient.setChannelToken(tenantAChannelToken);
      const { cmsPage: pageA } = await shopClient.query(SHOP_CMS_PAGE, {
        slug: tenantAPageSlug,
      });
      expect(pageA).toMatchObject({ slug: tenantAPageSlug });

      // Tenant B's storefront token cannot resolve tenant A's page.
      shopClient.setChannelToken(tenantBChannelToken);
      const { cmsPage: pageB } = await shopClient.query(SHOP_CMS_PAGE, {
        slug: tenantAPageSlug,
      });
      expect(pageB).toBeNull();
    });

    it('SuperAdmin can create a platform CMS page on the default channel', async () => {
      adminClient.setChannelToken(E2E_DEFAULT_CHANNEL_TOKEN);
      await adminClient.asSuperAdmin();

      platformPageSlug = `platform-page-${Date.now()}`;
      const { createPage } = await adminClient.query(CREATE_CMS_PAGE, {
        input: {
          slug: platformPageSlug,
          title: 'Platform Page',
          isPublished: true,
        },
      });

      expect(createPage).toMatchObject({
        slug: platformPageSlug,
        title: 'Platform Page',
        isPublished: true,
      });

      // ADR-036: platform page must be on the default channel ONLY.
      const { cmsPages } = await adminClient.query(ADMIN_CMS_PAGES);
      const found = cmsPages.items.find(
        (p: any) => p.slug === platformPageSlug,
      );
      expect(found).toBeTruthy();
      const channelCodes = found.channels.map((c: any) => c.code);
      expect(channelCodes).toEqual(['__default_channel__']);
    });

    it('tenant admin cannot bypass ADR-036 via channelIds input', async () => {
      adminClient.setChannelToken(tenantAChannelToken);
      await adminClient.asUserWithCredentials(tenantAEmail, 'StrongP@ss1');

      const bypassPageSlug = `bypass-test-${Date.now()}`;
      const { createPage } = await adminClient.query(CREATE_CMS_PAGE, {
        input: {
          slug: bypassPageSlug,
          title: 'Bypass Attempt Page',
          isPublished: true,
          channelIds: ['T_1'], // attempt to assign default channel
        },
      });

      expect(createPage).toMatchObject({
        slug: bypassPageSlug,
        title: 'Bypass Attempt Page',
      });

      // ADR-036: channelIds override is silently ignored for tenant admins.
      // The page must be on the tenant channel only, not the default channel.
      const { cmsPages } = await adminClient.query(ADMIN_CMS_PAGES);
      const found = cmsPages.items.find(
        (p: any) => p.slug === bypassPageSlug,
      );
      expect(found).toBeTruthy();
      const channelCodes = found.channels.map((c: any) => c.code);
      expect(channelCodes).not.toContain('__default_channel__');
      expect(channelCodes.some((code: string) => code.startsWith('mehta-coaching'))).toBe(true);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 10. Singular role & administrator visibility (BUG-026)
  // ═══════════════════════════════════════════════════════════════════════

  describe('Singular role & administrator visibility (BUG-026)', () => {
    it('SuperAdmin can fetch a tenant role by id directly', async () => {
      // First get the list to find a tenant role id.
      adminClient.setChannelToken(E2E_DEFAULT_CHANNEL_TOKEN);
      await adminClient.asSuperAdmin();

      const { roles } = await adminClient.query(ROLES);
      const tenantRole = roles.items.find(
        (r: any) => r.description?.includes('Tenant administrator'),
      );
      expect(tenantRole).toBeTruthy();

      // Now fetch it via the singular role(id) query.
      const { role } = await adminClient.query(ROLE, { id: tenantRole.id });
      expect(role).toBeTruthy();
      expect(role.id).toBe(tenantRole.id);
      expect(role.description).toContain('Tenant administrator');
    });

    it('tenant A read-admin gets null for tenant B role by id', async () => {
      // Get tenant B role id as SuperAdmin.
      adminClient.setChannelToken(E2E_DEFAULT_CHANNEL_TOKEN);
      await adminClient.asSuperAdmin();

      const { roles } = await adminClient.query(ROLES);
      const tenantBRole = roles.items.find(
        (r: any) => r.description?.includes('Sharma Academy'),
      );
      expect(tenantBRole).toBeTruthy();

      // Switch to tenant A read-admin and try to fetch tenant B's role by id.
      adminClient.setChannelToken(tenantAChannelToken);
      await adminClient.asUserWithCredentials(readAdminEmail, readAdminPassword);

      const { role } = await adminClient.query(ROLE, { id: tenantBRole.id });
      expect(role).toBeNull();
    });

    it('tenant A read-admin gets null for the SuperAdmin role by id', async () => {
      // Discover the SuperAdmin role id via the plural roles() query AS
      // SuperAdmin — its list branch has no exclusion (the INV-016 exclusion
      // applies only to the tenant branch), so __super_admin_role__ is visible
      // here without a raw repository lookup, and there's no circularity since
      // the queried branch differs from the one under test.
      adminClient.setChannelToken(E2E_DEFAULT_CHANNEL_TOKEN);
      await adminClient.asSuperAdmin();

      const { roles } = await adminClient.query(ROLES);
      const superAdminRole = roles.items.find(
        (r: any) => r.code === '__super_admin_role__',
      );
      expect(superAdminRole).toBeTruthy();

      // Switch to tenant A read-admin: the singular role(id) must NOT expose
      // the global SuperAdmin role (INV-016 — mirror of the plural roles guard).
      adminClient.setChannelToken(tenantAChannelToken);
      await adminClient.asUserWithCredentials(readAdminEmail, readAdminPassword);

      const { role } = await adminClient.query(ROLE, { id: superAdminRole.id });
      expect(role).toBeNull();
    });

    it('SuperAdmin can fetch a tenant administrator by id directly', async () => {
      // Get the list to find a tenant admin id.
      adminClient.setChannelToken(E2E_DEFAULT_CHANNEL_TOKEN);
      await adminClient.asSuperAdmin();

      const { administrators } = await adminClient.query(ADMINISTRATORS);
      const tenantAdmin = administrators.items.find(
        (a: any) => a.emailAddress === tenantAEmail,
      );
      expect(tenantAdmin).toBeTruthy();

      // Now fetch it via the singular administrator(id) query.
      const { administrator } = await adminClient.query(ADMINISTRATOR, {
        id: tenantAdmin.id,
      });
      expect(administrator).toBeTruthy();
      expect(administrator.emailAddress).toBe(tenantAEmail);
    });

    it('tenant A read-admin gets null for tenant B administrator by id', async () => {
      // Get tenant B admin id as SuperAdmin.
      adminClient.setChannelToken(E2E_DEFAULT_CHANNEL_TOKEN);
      await adminClient.asSuperAdmin();

      const { administrators } = await adminClient.query(ADMINISTRATORS);
      const tenantBAdmin = administrators.items.find(
        (a: any) => a.emailAddress === tenantBEmail,
      );
      expect(tenantBAdmin).toBeTruthy();

      // Switch to tenant A read-admin and try to fetch tenant B's admin by id.
      adminClient.setChannelToken(tenantAChannelToken);
      await adminClient.asUserWithCredentials(readAdminEmail, readAdminPassword);

      const { administrator } = await adminClient.query(ADMINISTRATOR, {
        id: tenantBAdmin.id,
      });
      expect(administrator).toBeNull();
    });
  });

  // ── TenantTheme — ADR-043 L1 lifecycle ──────────────────────────────────
  // Covers the A1 hardening: published versions are immutable, exactly one
  // ACTIVE theme per channel is arbitrated by PostgreSQL, version allocation is
  // race-safe, logo assets must belong to the channel, and INV-025 isolation.

  describe('TenantTheme — ADR-043 L1 lifecycle', () => {
    const tenantAPassword = 'StrongP@ss1';
    const tenantBPassword = 'StrongP@ss2';

    let v1Id: string;
    let v2Id: string;
    let tenantBThemeId: string;

    async function asTenantAdmin(email: string, password: string, token: string) {
      adminClient.setChannelToken(token);
      await adminClient.asUserWithCredentials(email, password);
    }

    // `stripIdPrefix` is defined at module scope (shared with the entitlement suite).

    /**
     * A RequestContext bound to a tenant channel, for direct service calls
     * outside the request cycle (the GraphQL path builds this automatically).
     * `RequestContext.channelId` is a getter derived from `_channel`, so the
     * channel must be supplied through the constructor — it cannot be assigned.
     */
    async function ctxForChannel(channelId: string): Promise<RequestContext> {
      const { connection } = rawRepos();
      const channel = await connection.rawConnection
        .getRepository(Channel)
        .findOne({ where: { id: Number(channelId) } });
      expect(channel).toBeTruthy();
      return new RequestContext({
        apiType: 'admin',
        channel: channel!,
        isAuthorized: true,
        authorizedAsOwnerOnly: false,
      });
    }

    function rawRepos() {
      const connection = server.app.get(TransactionalConnection);
      return {
        connection,
        theme: connection.rawConnection.getRepository(TenantTheme),
        asset: connection.rawConnection.getRepository(Asset),
      };
    }

    /**
     * Creates an Asset owned by `channelId`.
     *
     * Raw insert — avoids a multipart file upload. The literal is cast to
     * `DeepPartial<Asset>` rather than `any`: an `any` argument selects
     * Repository.create's ARRAY overload, typing the result as `Asset[]` and
     * breaking the declared return type (TS2740).
     */
    async function createAssetOwnedBy(channelId: string, label: string): Promise<Asset> {
      const { connection, asset } = rawRepos();
      const channel = await connection.rawConnection
        .getRepository(Channel)
        .findOne({ where: { id: Number(channelId) } });
      expect(channel).toBeTruthy();

      const draft = asset.create({
        name: label,
        type: 'IMAGE',
        mimeType: 'image/png',
        fileSize: 1024,
        source: `e2e/${label}.png`,
        preview: `e2e/${label}.png`,
        channels: [channel as Channel],
      } as DeepPartial<Asset>);
      return asset.save(draft);
    }

    const WL_ON_SLUG = 'e2e-whitelabel-on';
    const WL_OFF_SLUG = 'e2e-whitelabel-off';

    /**
     * TEST-ONLY FIXTURE SETUP (repository writes against the isolated
     * `e2e_tenant_plugin` schema) — deliberately not GraphQL. These tests prove
     * the entitlement decision function across subscription states/flags, which
     * production workflows cannot produce on demand. This is not an operational
     * data-mutation procedure.
     *
     * Drives the ADR-043 §2 entitlement deterministically: points the tenant's
     * subscription at a white-label (or non-white-label) plan and sets the
     * requested status from the local FSM.
     */
    async function setSubscription(
      channelId: string,
      status: string,
      whitelabelEnabled = true,
    ): Promise<void> {
      const { connection } = rawRepos();
      const planRepo = connection.rawConnection.getRepository(SubscriptionPlan);
      const subRepo = connection.rawConnection.getRepository(OrganizationSubscription);

      const slug = whitelabelEnabled ? WL_ON_SLUG : WL_OFF_SLUG;
      const existingPlan = await planRepo.findOne({ where: { slug } });
      const plan =
        existingPlan ??
        (await planRepo.save(
          planRepo.create({
            name: slug,
            slug,
            whitelabelEnabled,
          } as DeepPartial<SubscriptionPlan>),
        ));

      const existing = await subRepo.findOne({ where: { channelId } });
      if (existing) {
        existing.status = status as any;
        existing.plan = plan;
        await subRepo.save(existing);
        return;
      }
      await subRepo.save(
        subRepo.create({
          channelId,
          status,
          plan,
        } as DeepPartial<OrganizationSubscription>),
      );
    }

    /** Removes the tenant's subscription entirely (no-entitlement case). */
    async function clearSubscription(channelId: string): Promise<void> {
      const { connection } = rawRepos();
      await connection.rawConnection
        .getRepository(OrganizationSubscription)
        .delete({ channelId });
    }

    beforeAll(async () => {
      // ADR-043 §2: theming requires the white-label entitlement, so both
      // tenants start on an active subscription backed by a white-label plan.
      await setSubscription(tenantAChannelId, 'active', true);
      await setSubscription(tenantBChannelId, 'active', true);
    });

    it('creates a theme as a DRAFT and leaves the storefront on the platform default', async () => {
      await asTenantAdmin(tenantAEmail, tenantAPassword, tenantAChannelToken);

      const { createTenantTheme } = await adminClient.query(CREATE_TENANT_THEME, {
        input: {
          primaryColor: '#2563EB',
          backgroundColor: '#FFFFFF',
          textColor: '#111111',
          fontFamily: 'inter',
          displayName: 'Mehta Coaching',
        },
      });

      expect(createTenantTheme.status).toBe('draft');
      expect(createTenantTheme.version).toBe(1);
      expect(stripIdPrefix(createTenantTheme.channelId)).toBe(tenantAChannelId);
      v1Id = createTenantTheme.id;

      // Nothing published yet → Shop API reports no theme (platform default).
      shopClient.setChannelToken(tenantAChannelToken);
      const { myTenantTheme } = await shopClient.query(SHOP_MY_TENANT_THEME);
      expect(myTenantTheme).toBeNull();
    });

    it('edits a DRAFT in place', async () => {
      await asTenantAdmin(tenantAEmail, tenantAPassword, tenantAChannelToken);

      const { updateTenantTheme } = await adminClient.query(UPDATE_TENANT_THEME, {
        id: v1Id,
        input: { accentColor: '#F59E0B' },
      });

      expect(updateTenantTheme.status).toBe('draft');
      expect(updateTenantTheme.accentColor).toBe('#F59E0B');
      // Untouched fields survive a partial update.
      expect(updateTenantTheme.primaryColor).toBe('#2563EB');
    });

    it('rejects an invalid hex colour and a non-curated font', async () => {
      await asTenantAdmin(tenantAEmail, tenantAPassword, tenantAChannelToken);

      const badColour = adminClient.query(CREATE_TENANT_THEME, {
        input: { primaryColor: 'rgb(0,0,0)' },
      });
      await expect(badColour).rejects.toThrow(/hex colour/i);

      const badFont = adminClient.query(CREATE_TENANT_THEME, {
        input: { fontFamily: 'comic-sans' },
      });
      await expect(badFont).rejects.toThrow(/not in the allowed set/i);
    });

    it('publishes the draft and serves it on the public Shop API', async () => {
      await asTenantAdmin(tenantAEmail, tenantAPassword, tenantAChannelToken);

      const { publishTenantTheme } = await adminClient.query(PUBLISH_TENANT_THEME, {
        id: v1Id,
      });
      expect(publishTenantTheme.status).toBe('active');

      shopClient.setChannelToken(tenantAChannelToken);
      const { myTenantTheme } = await shopClient.query(SHOP_MY_TENANT_THEME);
      expect(myTenantTheme.status).toBe('active');
      expect(myTenantTheme.version).toBe(1);
      expect(myTenantTheme.primaryColor).toBe('#2563EB');
      expect(myTenantTheme.fontFamily).toBe('inter');
    });

    it('REJECTS editing an ACTIVE version (published versions are immutable)', async () => {
      await asTenantAdmin(tenantAEmail, tenantAPassword, tenantAChannelToken);

      const promise = adminClient.query(UPDATE_TENANT_THEME, {
        id: v1Id,
        input: { primaryColor: '#000000' },
      });

      await expect(promise).rejects.toThrow(/immutable/i);

      // The live values are untouched.
      shopClient.setChannelToken(tenantAChannelToken);
      const { myTenantTheme } = await shopClient.query(SHOP_MY_TENANT_THEME);
      expect(myTenantTheme.primaryColor).toBe('#2563EB');
    });

    it('archives the previous version when a new draft is published', async () => {
      await asTenantAdmin(tenantAEmail, tenantAPassword, tenantAChannelToken);

      const created = await adminClient.query(CREATE_TENANT_THEME, {
        input: { primaryColor: '#DC2626', displayName: 'Mehta Coaching (v2)' },
      });
      v2Id = created.createTenantTheme.id;
      expect(created.createTenantTheme.version).toBe(2);

      const { publishTenantTheme } = await adminClient.query(PUBLISH_TENANT_THEME, {
        id: v2Id,
      });
      expect(publishTenantTheme.status).toBe('active');

      const { tenantThemes } = await adminClient.query(ADMIN_TENANT_THEMES);
      const v1 = tenantThemes.items.find((t: any) => stripIdPrefix(t.id) === stripIdPrefix(v1Id));
      expect(v1.status).toBe('archived');
      // v1 keeps the values that were live — history is frozen.
      expect(v1.primaryColor).toBe('#2563EB');

      const v2 = tenantThemes.items.find((t: any) => stripIdPrefix(t.id) === stripIdPrefix(v2Id));
      expect(v2.status).toBe('active');
    });

    it('rolls back to the exact archived values', async () => {
      await asTenantAdmin(tenantAEmail, tenantAPassword, tenantAChannelToken);

      const { rollbackTenantTheme } = await adminClient.query(ROLLBACK_TENANT_THEME, {
        id: v1Id,
      });
      expect(rollbackTenantTheme.status).toBe('active');
      expect(rollbackTenantTheme.primaryColor).toBe('#2563EB');

      shopClient.setChannelToken(tenantAChannelToken);
      const { myTenantTheme } = await shopClient.query(SHOP_MY_TENANT_THEME);
      expect(myTenantTheme.version).toBe(1);
      expect(myTenantTheme.primaryColor).toBe('#2563EB');
    });

    it('clones an ACTIVE version into a new draft (edit-the-live-theme flow)', async () => {
      // createDraftFromVersion is the internal building block for "edit the
      // live theme" — deliberately not exposed on the Admin GraphQL API yet, so
      // it is exercised at the service boundary. v1 is ACTIVE at this point.
      const themeService = server.app.get(TenantThemeService);
      const ctx = await ctxForChannel(tenantAChannelId);

      // Direct service calls bypass the GraphQL ID scalar, so pass the RAW id
      // (v1Id came back encoded as `T_5`).
      const rawV1Id = stripIdPrefix(v1Id);
      const source = await themeService.findById(ctx, rawV1Id as any);
      expect(source?.status).toBe('active');

      const draft = await themeService.createDraftFromVersion(ctx, rawV1Id as any);
      expect(draft.status).toBe('draft');
      expect(draft.version).toBeGreaterThan(source!.version);
      // Values carry over, so editing the draft cannot silently reset branding.
      expect(draft.primaryColor).toBe(source!.primaryColor);
      expect(draft.fontFamily).toBe(source!.fontFamily);
      expect(draft.displayName).toBe(source!.displayName);

      // The published source version is untouched.
      const stillActive = await themeService.findById(ctx, rawV1Id as any);
      expect(stillActive?.status).toBe('active');
    });

    it('refuses to clone a draft (update it in place instead)', async () => {
      const themeService = server.app.get(TenantThemeService);
      const ctx = await ctxForChannel(tenantAChannelId);

      const draft = await themeService.createDraftFromVersion(
        ctx,
        stripIdPrefix(v1Id) as any,
      );
      const promise = themeService.createDraftFromVersion(ctx, draft.id as any);
      await expect(promise).rejects.toThrow(/already a draft/i);
    });

    it('cannot publish an archived version', async () => {
      await asTenantAdmin(tenantAEmail, tenantAPassword, tenantAChannelToken);

      const promise = adminClient.query(PUBLISH_TENANT_THEME, { id: v2Id });
      await expect(promise).rejects.toThrow(/archived/i);
    });

    it('enforces at most one ACTIVE theme per channel at the database level', async () => {
      const { theme } = rawRepos();

      // Bypass the service entirely: the partial unique index must reject this.
      const clash = theme.create({
        channelId: tenantAChannelId,
        version: 9999,
        status: 'active',
        primaryColor: '#00FF00',
      } as any);
      await expect(theme.save(clash)).rejects.toThrow(/duplicate key|23505/);

      const activeCount = await theme.count({
        where: { channelId: tenantAChannelId, status: 'active' },
      });
      expect(activeCount).toBe(1);
    });

    it('allocates distinct versions for concurrent drafts', async () => {
      await asTenantAdmin(tenantAEmail, tenantAPassword, tenantAChannelToken);

      const [a, b] = await Promise.all([
        adminClient.query(CREATE_TENANT_THEME, { input: { displayName: 'race-a' } }),
        adminClient.query(CREATE_TENANT_THEME, { input: { displayName: 'race-b' } }),
      ]);

      const versions = [a.createTenantTheme.version, b.createTenantTheme.version];
      expect(new Set(versions).size).toBe(2);
      expect(versions.every((v: number) => v > 0)).toBe(true);
    });

    it('rejects a logo asset owned by another channel and accepts its own', async () => {
      const otherTenantAsset = await createAssetOwnedBy(tenantBChannelId, 'tenant-b-logo');

      await asTenantAdmin(tenantAEmail, tenantAPassword, tenantAChannelToken);
      const rejected = adminClient.query(CREATE_TENANT_THEME, {
        input: { logoAssetId: String(otherTenantAsset.id) },
      });
      await expect(rejected).rejects.toThrow(/does not belong/i);

      const ownAsset = await createAssetOwnedBy(tenantAChannelId, 'tenant-a-logo');
      const accepted = await adminClient.query(CREATE_TENANT_THEME, {
        input: { logoAssetId: String(ownAsset.id) },
      });
      expect(stripIdPrefix(accepted.createTenantTheme.logoAssetId)).toBe(String(ownAsset.id));
    });

    it('rejects a non-existent logo asset', async () => {
      await asTenantAdmin(tenantAEmail, tenantAPassword, tenantAChannelToken);
      const promise = adminClient.query(CREATE_TENANT_THEME, {
        input: { logoAssetId: '99999999' },
      });
      await expect(promise).rejects.toThrow(/does not exist/i);
    });

    it('isolates themes per channel (INV-025)', async () => {
      // Tenant B creates and publishes its own theme.
      await asTenantAdmin(tenantBEmail, tenantBPassword, tenantBChannelToken);
      const created = await adminClient.query(CREATE_TENANT_THEME, {
        input: { primaryColor: '#7C3AED', displayName: 'Sharma Academy' },
      });
      tenantBThemeId = created.createTenantTheme.id;
      await adminClient.query(PUBLISH_TENANT_THEME, { id: tenantBThemeId });

      // Tenant A cannot read tenant B's theme by id...
      await asTenantAdmin(tenantAEmail, tenantAPassword, tenantAChannelToken);
      const { tenantTheme } = await adminClient.query(ADMIN_TENANT_THEME, {
        id: tenantBThemeId,
      });
      expect(tenantTheme).toBeNull();

      // ...its own list contains only its own themes...
      const { tenantThemes } = await adminClient.query(ADMIN_TENANT_THEMES);
      expect(
        tenantThemes.items.every((t: any) => stripIdPrefix(t.channelId) === tenantAChannelId),
      ).toBe(true);

      // ...and each storefront resolves its own channel's active theme.
      shopClient.setChannelToken(tenantAChannelToken);
      const tenantAView = await shopClient.query(SHOP_MY_TENANT_THEME);
      expect(tenantAView.myTenantTheme.primaryColor).toBe('#2563EB');

      shopClient.setChannelToken(tenantBChannelToken);
      const tenantBView = await shopClient.query(SHOP_MY_TENANT_THEME);
      expect(tenantBView.myTenantTheme.primaryColor).toBe('#7C3AED');
      expect(tenantBView.myTenantTheme.displayName).toBe('Sharma Academy');
    });

    it('resets to the platform default by archiving the active theme', async () => {
      await asTenantAdmin(tenantAEmail, tenantAPassword, tenantAChannelToken);

      const { resetTenantTheme } = await adminClient.query(RESET_TENANT_THEME);
      expect(resetTenantTheme).toBe(true);

      shopClient.setChannelToken(tenantAChannelToken);
      const { myTenantTheme } = await shopClient.query(SHOP_MY_TENANT_THEME);
      expect(myTenantTheme).toBeNull();

      // Reset archives rather than deletes, so rollback is still possible.
      const { tenantThemes } = await adminClient.query(ADMIN_TENANT_THEMES);
      expect(tenantThemes.items.some((t: any) => t.status === 'active')).toBe(false);

      const restored = await adminClient.query(ROLLBACK_TENANT_THEME, { id: v1Id });
      expect(restored.rollbackTenantTheme.status).toBe('active');
    });

    // ── ADR-043 §2 — white-label commercial entitlement ────────────────────
    // `whitelabelEnabled` controls whether tenant-specific branding is USABLE,
    // not merely whether it can be edited: losing the entitlement removes the
    // theme from the storefront (myTenantTheme → null) as well as blocking
    // create/update/publish/rollback/createDraftFromVersion. Only reset, which
    // removes branding, stays universally available.

    describe('white-label entitlement gate (ADR-043 §2)', () => {
      async function shopActiveTheme() {
        shopClient.setChannelToken(tenantAChannelToken);
        const { myTenantTheme } = await shopClient.query(SHOP_MY_TENANT_THEME);
        return myTenantTheme;
      }

      async function asTenantA() {
        await asTenantAdmin(tenantAEmail, tenantAPassword, tenantAChannelToken);
      }

      it('serves the active theme while entitled (active + whitelabelEnabled)', async () => {
        await setSubscription(tenantAChannelId, 'active', true);

        const theme = await shopActiveTheme();
        expect(theme).not.toBeNull();
        expect(theme.version).toBe(1);
        expect(theme.primaryColor).toBe('#2563EB');
      });

      it('keeps serving the theme during past_due (dunning must not strip branding)', async () => {
        await setSubscription(tenantAChannelId, 'past_due', true);
        expect(await shopActiveTheme()).not.toBeNull();
      });

      it('serves the theme while trialing', async () => {
        await setSubscription(tenantAChannelId, 'trialing', true);
        expect(await shopActiveTheme()).not.toBeNull();
      });

      it('denies pending_provider_auth: no theme served and no writes', async () => {
        await setSubscription(tenantAChannelId, 'pending_provider_auth', true);
        await asTenantA();

        expect(await shopActiveTheme()).toBeNull();

        // Every write/activation path is gated — note the entitlement check runs
        // BEFORE the lifecycle checks, so update on an ACTIVE theme reports the
        // entitlement error rather than 'immutable'.
        await expect(
          adminClient.query(CREATE_TENANT_THEME, { input: { displayName: 'nope' } }),
        ).rejects.toThrow(/not enabled/i);
        await expect(
          adminClient.query(UPDATE_TENANT_THEME, { id: v1Id, input: { accentColor: '#000000' } }),
        ).rejects.toThrow(/not enabled/i);
        await expect(
          adminClient.query(PUBLISH_TENANT_THEME, { id: v1Id }),
        ).rejects.toThrow(/not enabled/i);
        await expect(
          adminClient.query(ROLLBACK_TENANT_THEME, { id: v1Id }),
        ).rejects.toThrow(/not enabled/i);
      });

      it('denies cancelled: no theme, no writes, but reset stays available', async () => {
        await setSubscription(tenantAChannelId, 'cancelled', true);
        await asTenantA();

        expect(await shopActiveTheme()).toBeNull();
        await expect(
          adminClient.query(CREATE_TENANT_THEME, { input: { displayName: 'nope' } }),
        ).rejects.toThrow(/not enabled/i);
        // Rollback ACTIVATES branding → gated, so a lapsed tenant cannot
        // re-enable white-label theming by flipping between archived versions.
        await expect(
          adminClient.query(ROLLBACK_TENANT_THEME, { id: v1Id }),
        ).rejects.toThrow(/not enabled/i);

        // reset only REMOVES branding → always allowed.
        const { resetTenantTheme } = await adminClient.query(RESET_TENANT_THEME);
        expect(resetTenantTheme).toBe(true);
        expect(await shopActiveTheme()).toBeNull();
      });

      it('denies an active subscription whose plan has whitelabelEnabled=false', async () => {
        await setSubscription(tenantAChannelId, 'active', false);
        await asTenantA();

        expect(await shopActiveTheme()).toBeNull();
        await expect(
          adminClient.query(CREATE_TENANT_THEME, { input: { displayName: 'nope' } }),
        ).rejects.toThrow(/not enabled/i);

        const { resetTenantTheme } = await adminClient.query(RESET_TENANT_THEME);
        expect(resetTenantTheme).toBe(true);
      });

      it('denies a tenant with no subscription at all', async () => {
        await clearSubscription(tenantAChannelId);
        await asTenantA();

        expect(await shopActiveTheme()).toBeNull();
        await expect(
          adminClient.query(CREATE_TENANT_THEME, { input: { displayName: 'nope' } }),
        ).rejects.toThrow(/not enabled/i);

        const { resetTenantTheme } = await adminClient.query(RESET_TENANT_THEME);
        expect(resetTenantTheme).toBe(true);
      });

      it('gates createDraftFromVersion too (service boundary, no resolver)', async () => {
        // Still no subscription here; the internal clone seam must not be a way
        // around the entitlement boundary.
        const themeService = server.app.get(TenantThemeService);
        const ctx = await ctxForChannel(tenantAChannelId);

        await expect(
          themeService.createDraftFromVersion(ctx, stripIdPrefix(v1Id) as any),
        ).rejects.toThrow(/not enabled/i);
      });

      it('reduces the entitlement decision to one place (TenantCommercialEligibilityService)', async () => {
        const eligibility = server.app.get(TenantCommercialEligibilityService);
        const ctx = await ctxForChannel(tenantAChannelId);

        // no subscription (left over from the previous test)
        expect(await eligibility.canUseWhitelabel(ctx)).toBe(false);

        await setSubscription(tenantAChannelId, 'cancelled', true);
        expect(await eligibility.canUseWhitelabel(ctx)).toBe(false);

        await setSubscription(tenantAChannelId, 'pending_provider_auth', true);
        expect(await eligibility.canUseWhitelabel(ctx)).toBe(false);

        await setSubscription(tenantAChannelId, 'active', false);
        expect(await eligibility.canUseWhitelabel(ctx)).toBe(false);

        await setSubscription(tenantAChannelId, 'active', true);
        expect(await eligibility.canUseWhitelabel(ctx)).toBe(true);

        await setSubscription(tenantAChannelId, 'past_due', true);
        expect(await eligibility.canUseWhitelabel(ctx)).toBe(true);

        await setSubscription(tenantAChannelId, 'trialing', true);
        expect(await eligibility.canUseWhitelabel(ctx)).toBe(true);
      });

      it('restores theming once the entitlement returns (gate is reversible)', async () => {
        await setSubscription(tenantAChannelId, 'active', true);
        await asTenantA();

        // v1 was archived by the resets above; rollback is permitted again.
        const { rollbackTenantTheme } = await adminClient.query(ROLLBACK_TENANT_THEME, {
          id: v1Id,
        });
        expect(rollbackTenantTheme.status).toBe('active');

        const theme = await shopActiveTheme();
        expect(theme).not.toBeNull();
        expect(theme.primaryColor).toBe('#2563EB');
      });

      it('strips theming on a PLAN SWITCH while the subscription stays active (plan-derived, not cached)', async () => {
        // Same subscription row, same 'active' status — only the plan changes
        // from whitelabelEnabled=true to whitelabelEnabled=false. This proves
        // the entitlement is re-evaluated from SubscriptionPlan on every read,
        // not cached from subscription creation.
        await setSubscription(tenantAChannelId, 'active', false);
        await asTenantA();

        expect(await shopActiveTheme()).toBeNull();
        await expect(
          adminClient.query(CREATE_TENANT_THEME, { input: { displayName: 'nope' } }),
        ).rejects.toThrow(/not enabled/i);

        // Switching back restores the storefront theme without recreating it.
        await setSubscription(tenantAChannelId, 'active', true);
        const theme = await shopActiveTheme();
        expect(theme).not.toBeNull();
        expect(theme.primaryColor).toBe('#2563EB');
      });
    });
  });
});
