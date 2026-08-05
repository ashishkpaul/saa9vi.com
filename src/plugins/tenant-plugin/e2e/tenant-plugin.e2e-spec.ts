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
import { mergeConfig } from '@vendure/core';
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
} from 'vitest';

import { TenantPlugin } from '../tenant-plugin.plugin';
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

// ─── Test suite ───────────────────────────────────────────────────────────

describe('TenantPlugin', () => {
  const { server, adminClient, shopClient } = createTestEnvironment(
    mergeConfig(testConfig, {
      apiOptions: { port: 3070 },
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
      plugins: [TenantPlugin],
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
    it('tenant A admin only sees administrators in their own channel', async () => {
      adminClient.setChannelToken(tenantAChannelToken);
      await adminClient.asUserWithCredentials(tenantAEmail, 'StrongP@ss1');

      const { administrators } = await adminClient.query(ADMINISTRATORS);

      // The tenant admin must NOT see the global SuperAdmin account.
      // The only administrator visible is the tenant A admin themselves.
      expect(administrators.totalItems).toBe(1);
      expect(administrators.items[0].emailAddress).toBe(tenantAEmail);
    });

    it('tenant B admin only sees administrators in their own channel', async () => {
      adminClient.setChannelToken(tenantBChannelToken);
      await adminClient.asUserWithCredentials(tenantBEmail, 'StrongP@ss2');

      const { administrators } = await adminClient.query(ADMINISTRATORS);

      expect(administrators.totalItems).toBe(1);
      expect(administrators.items[0].emailAddress).toBe(tenantBEmail);
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

    it('tenant A admin only sees roles in their own channel', async () => {
      adminClient.setChannelToken(tenantAChannelToken);
      await adminClient.asUserWithCredentials(tenantAEmail, 'StrongP@ss1');

      const { roles } = await adminClient.query(ROLES);

      // Tenant A sees its own tenant-admin role (and any default roles
      // assigned to its channel), but NOT tenant B's role.
      const tenantBRole = roles.items.find((r: any) =>
        r.description?.includes('Sharma Academy'),
      );
      expect(tenantBRole).toBeUndefined();
    });
  });
});
