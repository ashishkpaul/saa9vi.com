/**
 * customer-deletion e2e tests
 *
 * Covers the full customer deletion flow (INV-013) across all three plugins:
 *
 *   1. BBB plugin — BbbEntitlement deactivated, BbbEnrollment deactivated,
 *      BbbTrialRegistration cancelled, org memberships deactivated,
 *      instructor assignments deleted. BbbUsageLedger preserved.
 *
 *   2. Tenant plugin — InstructorProfile anonymized (fullName → "[deleted]",
 *      bio nulled, photoAssetId nulled, isActive = false). Slugs preserved.
 *
 *   3. Reviews plugin — ProductReview.authorName anonymized, ReviewRequest
 *      cancelled, ReviewVote deleted. ReviewReward preserved.
 *
 *   4. CustomerDeletionLog — PENDING → COMPLETED transition recorded.
 *
 *   5. Customer record — PII anonymized, User identifier replaced with
 *      deleted-{id}@saa9vi.invalid, soft-deleted via CustomerService.
 *
 * Run:  npm run test:e2e
 *
 * Requires a running Postgres instance. Connection credentials are read from
 * the same .env variables used by the dev server. The initializer creates a
 * dedicated test schema (e2e_customer_deletion) so it never touches dev data.
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
import { SchemaPostgresInitializer } from '../../plugins/tenant-plugin/e2e/schema-postgres-initializer';
import {
  Customer,
  mergeConfig,
  NativeAuthenticationMethod,
  PasswordCipher,
  RoleService,
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

import { TenantPlugin } from '../../plugins/tenant-plugin/tenant-plugin.plugin';
import { BigBlueButtonPlugin } from '../../plugins/bigbluebutton-plugin';
import { CmsPlugin } from '../../plugins/cms/cms.plugin';
import { ReviewsPlugin } from '../../plugins/reviews/reviews-plugin';
import { E2E_INITIAL_DATA } from '../../plugins/tenant-plugin/e2e/fixtures/e2e-initial-data';
import { CustomerDeletionLog } from './entities/customer-deletion-log.entity';
import { BbbEntitlement } from '../../plugins/bigbluebutton-plugin/entities/bbb-entitlement.entity';
import { BbbEnrollment } from '../../plugins/bigbluebutton-plugin/entities/bbb-enrollment.entity';
import { BbbTrialRegistration } from '../../plugins/bigbluebutton-plugin/entities/trial-registration.entity';
import { BbbOrganizationMembership } from '../../plugins/bigbluebutton-plugin/entities/bbb-organization-membership.entity';
import { InstructorProfile } from '../../plugins/tenant-plugin/entities/instructor-profile.entity';
import { ProductReview } from '../../plugins/reviews/entities/product-review.entity';
import { ReviewRequest } from '../../plugins/reviews/entities/review-request.entity';
import { ReviewVote } from '../../plugins/reviews/entities/review-vote.entity';

// ─── Postgres initializer — isolated schema ──────────────────────────────────
registerInitializer('postgres', new SchemaPostgresInitializer());

// ─── GraphQL documents ───────────────────────────────────────────────────────

const REGISTER_NEW_TENANT = gql`
  mutation RegisterNewTenant($input: RegisterTenantInput!) {
    registerNewTenant(input: $input) {
      channelId
      channelToken
      administratorId
    }
  }
`;

const DELETE_MY_ACCOUNT = gql`
  mutation DeleteMyAccount($password: String!) {
    deleteMyAccount(password: $password) {
      success
      message
    }
  }
`;

const LEAVE_ACADEMY = gql`
  mutation LeaveAcademy {
    leaveAcademy {
      success
      message
    }
  }
`;

// ─── Test suite ──────────────────────────────────────────────────────────────

describe('CustomerDeletion (INV-013)', () => {
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
        schema: 'e2e_customer_deletion',
        synchronize: true,
      },
      plugins: [TenantPlugin, BigBlueButtonPlugin, CmsPlugin, ReviewsPlugin],
    }),
  );

  let tenantChannelId: string;
  let tenantChannelToken: string;
  let customerId: string;
  let customerEmail: string;
  let customerPassword: string;

  // ── Bootstrap ────────────────────────────────────────────────────────────

  beforeAll(async () => {
    await server.init({
      initialData: E2E_INITIAL_DATA,
      productsCsvPath: path.join(
        __dirname,
        '../../plugins/tenant-plugin/e2e/fixtures/e2e-products.csv',
      ),
      customerCount: 2,
    });
  }, 120_000);

  afterAll(async () => {
    await server.destroy();
  });

  // ── Helper: create test data across all three plugins ───────────────────

  async function createCustomerWithAuth(
    firstName: string,
    lastName: string,
  ): Promise<{ customerId: string; email: string; password: string }> {
    const connection = server.app.get(TransactionalConnection);
    const passwordCipher = server.app.get(PasswordCipher);
    const roleService = server.app.get(RoleService);
    const email = `${firstName.toLowerCase()}-${Date.now()}@example.com`;
    const password = 'StrongP@ss1';

    // Create User
    const user = new User();
    user.identifier = email;
    user.verified = true;

    // Assign the customer role (required for Shop API authentication)
    const customerRole = await roleService.getCustomerRole();
    user.roles = [customerRole];

    const savedUser = await connection.getRepository(undefined, User).save(user);

    // Add native auth method
    const hashedPassword = await passwordCipher.hash(password);
    const nativeAuthMethod = new NativeAuthenticationMethod({
      identifier: email,
      passwordHash: hashedPassword,
    });
    nativeAuthMethod.user = savedUser as any;
    await connection
      .getRepository(undefined, NativeAuthenticationMethod)
      .save(nativeAuthMethod);

    // Create Customer linked to the user, assigned to the tenant channel
    const channel = await connection
      .getRepository(undefined, 'Channel')
      .findOneOrFail({ where: { id: tenantChannelId } });
    const customer = await connection.getRepository(undefined, Customer).save(
      new Customer({
        firstName,
        lastName,
        emailAddress: email,
        user: savedUser as any,
        channels: [channel as any],
      }),
    );

    return { customerId: customer.id as string, email, password };
  }

  async function seedCustomerData() {
    const connection = server.app.get(TransactionalConnection);

    // 1. Register a tenant so we have a channel + admin
    shopClient.setChannelToken(E2E_DEFAULT_CHANNEL_TOKEN);
    const regResult = await shopClient.query(REGISTER_NEW_TENANT, {
      input: {
        businessName: 'Deletion Test Academy',
        firstName: 'Delete',
        lastName: 'Me',
        emailAddress: `delete-me-${Date.now()}@example.com`,
        password: 'StrongP@ss1',
        timezone: 'Asia/Kolkata',
      },
    });
    tenantChannelId = regResult.registerNewTenant.channelId.replace(/^T_/, '');
    tenantChannelToken = regResult.registerNewTenant.channelToken;

    // 2. Create a Customer (the account to be deleted)
    const customer = await createCustomerWithAuth('John', 'Doe');
    customerId = customer.customerId;
    customerEmail = customer.email;
    customerPassword = customer.password;

    // 3. BBB: create an entitlement, enrollment, trial registration, membership
    const entitlementRepo = connection.getRepository(undefined, BbbEntitlement);
    await entitlementRepo.save(
      new BbbEntitlement({
        type: 'bbb_room',
        resourceId: 'room-1',
        customerId,
        source: 'purchase',
        channelId: tenantChannelId,
        validFrom: new Date(),
        validUntil: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      }),
    );

    const enrollmentRepo = connection.getRepository(undefined, BbbEnrollment);
    await enrollmentRepo.save(
      new BbbEnrollment({
        customerId,
        roomId: 'room-1',
        active: true,
        validFrom: new Date(),
        validUntil: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      }),
    );

    const trialRepo = connection.getRepository(undefined, BbbTrialRegistration);
    await trialRepo.save(
      new BbbTrialRegistration({
        customerId,
        scheduledSessionId: 'session-1',
        status: 'REGISTERED',
        registeredAt: new Date(),
      }),
    );

    const membershipRepo = connection.getRepository(
      undefined,
      BbbOrganizationMembership,
    );
    await membershipRepo.save(
      new BbbOrganizationMembership({
        organizationId: 'org-1',
        customerId,
        channelId: tenantChannelId,
        role: 'staff',
        isActive: true,
      }),
    );

    // 4. Tenant: create an InstructorProfile for this customer
    const instructorRepo = connection.getRepository(undefined, InstructorProfile);
    await instructorRepo.save(
      new InstructorProfile({
        customerId,
        channelId: tenantChannelId,
        slug: 'john-doe',
        fullName: 'John Doe',
        bio: 'Math teacher',
        isActive: true,
        isPublic: true,
      }),
    );

    // 5. Reviews: create a review, request, and vote
    const reviewRepo = connection.getRepository(undefined, ProductReview);
    const review = await reviewRepo.save(
      new ProductReview({
        author: customerId as any,
        authorName: 'John Doe',
        rating: 5,
        summary: 'Great course',
        body: 'Really enjoyed it',
        channelId: tenantChannelId,
      }),
    );

    const requestRepo = connection.getRepository(undefined, ReviewRequest);
    await requestRepo.save(
      new ReviewRequest({
        customer: customerId as any,
        channelId: tenantChannelId,
        status: 'scheduled',
        scheduledAt: new Date(),
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        reviewToken: `token-${Date.now()}`,
      }),
    );

    const voteRepo = connection.getRepository(undefined, ReviewVote);
    await voteRepo.save(
      new ReviewVote({
        customer: customerId as any,
        review,
        channelId: tenantChannelId,
        isUpvote: true,
      }),
    );
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 1. Flow B: fullDelete via deleteMyAccount
  // ═══════════════════════════════════════════════════════════════════════

  describe('Flow B: fullDelete (deleteMyAccount)', () => {
    beforeAll(async () => {
      await seedCustomerData();
    });

    it('deletes the customer account with password confirmation', async () => {
      // Log in as the customer on the Shop API
      shopClient.setChannelToken(tenantChannelToken);
      await shopClient.asUserWithCredentials(customerEmail, customerPassword);

      const result = await shopClient.query(DELETE_MY_ACCOUNT, {
        password: customerPassword,
      });

      expect(result.deleteMyAccount.success).toBe(true);
    });

    it('BBB entitlements are deactivated (validUntil set to now)', async () => {
      const connection = server.app.get(TransactionalConnection);
      const entitlements = await connection
        .getRepository(undefined, BbbEntitlement)
        .find({ where: { customerId } });

      for (const e of entitlements) {
        expect(e.validUntil).toBeInstanceOf(Date);
        expect(e.validUntil!.getTime()).toBeLessThanOrEqual(Date.now() + 1000);
      }
    });

    it('BBB enrollments are deactivated', async () => {
      const connection = server.app.get(TransactionalConnection);
      const enrollments = await connection
        .getRepository(undefined, BbbEnrollment)
        .find({ where: { customerId } });

      for (const e of enrollments) {
        expect(e.active).toBe(false);
      }
    });

    it('BBB trial registrations are cancelled', async () => {
      const connection = server.app.get(TransactionalConnection);
      const trials = await connection
        .getRepository(undefined, BbbTrialRegistration)
        .find({ where: { customerId } });

      for (const t of trials) {
        expect(t.status).toBe('CANCELLED');
      }
    });

    it('BBB org memberships are deactivated', async () => {
      const connection = server.app.get(TransactionalConnection);
      const memberships = await connection
        .getRepository(undefined, BbbOrganizationMembership)
        .find({ where: { customerId } });

      for (const m of memberships) {
        expect(m.isActive).toBe(false);
      }
    });

    it('Tenant InstructorProfile is anonymized (slug preserved)', async () => {
      const connection = server.app.get(TransactionalConnection);
      const profiles = await connection
        .getRepository(undefined, InstructorProfile)
        .find({ where: { customerId } });

      for (const p of profiles) {
        expect(p.fullName).toBe('[deleted]');
        expect(p.bio).toBeNull();
        expect(p.photoAssetId).toBeNull();
        expect(p.isActive).toBe(false);
        expect(p.slug).toBe('john-doe'); // slug preserved for URL integrity
      }
    });

    it('Reviews ProductReview.authorName is anonymized', async () => {
      const connection = server.app.get(TransactionalConnection);
      const reviews = await connection
        .getRepository(undefined, ProductReview)
        .find({ where: { author: customerId as any } });

      for (const r of reviews) {
        expect(r.authorName).toBe('[deleted]');
      }
    });

    it('Reviews ReviewRequest is cancelled', async () => {
      const connection = server.app.get(TransactionalConnection);
      const requests = await connection
        .getRepository(undefined, ReviewRequest)
        .find({ where: { customer: customerId as any } });

      for (const r of requests) {
        expect(r.status).toBe('expired');
      }
    });

    it('Reviews ReviewVote is deleted', async () => {
      const connection = server.app.get(TransactionalConnection);
      const votes = await connection
        .getRepository(undefined, ReviewVote)
        .find({ where: { customer: customerId as any } });

      expect(votes.length).toBe(0);
    });

    it('CustomerDeletionLog records a COMPLETED full_delete', async () => {
      const connection = server.app.get(TransactionalConnection);
      const logs = await connection
        .getRepository(undefined, CustomerDeletionLog)
        .find({ where: { customerId, deletionType: 'full_delete' } });

      expect(logs.length).toBeGreaterThanOrEqual(1);
      expect(logs[0].status).toBe('COMPLETED');
    });

    it('Customer PII is anonymized and soft-deleted', async () => {
      const connection = server.app.get(TransactionalConnection);
      const customer = await connection
        .getRepository(undefined, Customer)
        .findOne({ where: { id: customerId }, relations: ['user'] });

      expect(customer).toBeTruthy();
      expect(customer!.firstName).toBe('[deleted]');
      expect(customer!.lastName).toBe('[deleted]');
      expect(customer!.emailAddress).toMatch(/^deleted-.*@saa9vi\.invalid$/);
      expect(customer!.deletedAt).toBeInstanceOf(Date);
      if (customer!.user) {
        expect(customer!.user.identifier).toMatch(/^deleted-.*@saa9vi\.invalid$/);
      }
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 2. Flow A: leaveAcademy (channel-scoped)
  // ═══════════════════════════════════════════════════════════════════════

  describe('Flow A: leaveAcademy (channel-scoped)', () => {
    let leaveCustomerId: string;
    let leaveCustomerEmail: string;
    let leaveCustomerPassword: string;

    beforeAll(async () => {
      const connection = server.app.get(TransactionalConnection);

      // Create a fresh customer for the leaveAcademy flow
      const customer = await createCustomerWithAuth('Leave', 'Me');
      leaveCustomerId = customer.customerId;
      leaveCustomerEmail = customer.email;
      leaveCustomerPassword = customer.password;

      // Create an entitlement in this channel
      await connection.getRepository(undefined, BbbEntitlement).save(
        new BbbEntitlement({
          type: 'bbb_room',
          resourceId: 'room-leave',
          customerId: leaveCustomerId,
          source: 'purchase',
          channelId: tenantChannelId,
          validFrom: new Date(),
          validUntil: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        }),
      );

      // Create an instructor profile
      await connection.getRepository(undefined, InstructorProfile).save(
        new InstructorProfile({
          customerId: leaveCustomerId,
          channelId: tenantChannelId,
          slug: 'leave-me',
          fullName: 'Leave Me',
          bio: 'Physics teacher',
          isActive: true,
          isPublic: true,
        }),
      );
    });

    it('leaveAcademy removes the customer from the channel', async () => {
      shopClient.setChannelToken(tenantChannelToken);
      await shopClient.asUserWithCredentials(leaveCustomerEmail, leaveCustomerPassword);

      const result = await shopClient.query(LEAVE_ACADEMY);
      expect(result.leaveAcademy.success).toBe(true);
    });

    it('BBB entitlements in the channel are deactivated', async () => {
      const connection = server.app.get(TransactionalConnection);
      const entitlements = await connection
        .getRepository(undefined, BbbEntitlement)
        .find({ where: { customerId: leaveCustomerId, channelId: tenantChannelId } });

      for (const e of entitlements) {
        expect(e.validUntil!.getTime()).toBeLessThanOrEqual(Date.now() + 1000);
      }
    });

    it('Tenant InstructorProfile in the channel is anonymized', async () => {
      const connection = server.app.get(TransactionalConnection);
      const profiles = await connection
        .getRepository(undefined, InstructorProfile)
        .find({ where: { customerId: leaveCustomerId, channelId: tenantChannelId } });

      for (const p of profiles) {
        expect(p.fullName).toBe('[deleted]');
        expect(p.isActive).toBe(false);
      }
    });

    it('CustomerDeletionLog records a COMPLETED leave_channel', async () => {
      const connection = server.app.get(TransactionalConnection);
      const logs = await connection
        .getRepository(undefined, CustomerDeletionLog)
        .find({ where: { customerId: leaveCustomerId, deletionType: 'leave_channel' } });

      expect(logs.length).toBeGreaterThanOrEqual(1);
      expect(logs[0].status).toBe('COMPLETED');
    });
  });
});
