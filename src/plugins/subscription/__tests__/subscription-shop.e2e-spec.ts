/**
 * subscription-plugin e2e — Shop API commercial reads (plan §3.5, slice 8).
 *
 * Verifies the LOCKED slice-8 permission model end-to-end on real Postgres:
 *
 *   1. `availableSubscriptionPlans` — Permission.Public: the platform-global
 *      plan catalogue is readable with no session, on the default channel AND
 *      on a tenant channel (it carries no tenant state).
 *   2. `mySubscription` / `myLiveUsage` — Permission.Authenticated alone is
 *      NOT ownership:
 *      a. anonymous caller          → rejected by the @Allow gate;
 *      b. logged-in LEARNER (Customer on the tenant channel — the Customer
 *         role is assigned to every tenant channel by
 *         TenantRegistrationService) → rejected by the EXPLICIT ownership
 *         check (`TenantBusinessAccountService`), even though the same
 *         session happily serves `activeCustomer` in the same channel ctx;
 *      c. tenant business account (the channel-scoped Administrator created
 *         by registerNewTenant) → allowed. Authenticated on the **Admin API**,
 *         because this Vendure version's Shop `login` resolves users through
 *         the `customer` table (admin credentials yield
 *         INVALID_CREDENTIALS_ERROR there); the resulting session token is
 *         what the Shop surface validates — sessions are not api-type-scoped;
 *      d. platform SuperAdmin (SuperAdmin role is assigned to every tenant
 *         channel at registration) → allowed, same token shape.
 *   3. TENANT FROM `ctx.channelId` ONLY — no query takes a `channelId`
 *      argument (schema-level; asserted here by the provider-field probe).
 *   4. PROVIDER-INTERNALS BOUNDARY — `providerPlanId` et al. are not
 *      addressable on the Shop schema at all (GraphQL validation error).
 *   5. USAGE SEMANTICS — `myLiveUsage` reports the unbounded
 *      `internal_overhead` grant as ZERO allowance (BUG-036 positive `IN`
 *      filter: 'order' | 'subscription' only) and does surface a real
 *      'order'-source grant (100 granted − 30 consumed = 70 remaining).
 *
 * Run:  npx vitest run --config vitest.config.mts \
 *         src/plugins/subscription/__tests__/subscription-shop.e2e-spec.ts
 *
 * Requires a running Postgres instance (same .env as the dev server). The
 * initializer creates a dedicated test schema (e2e_subscription_shop) so it
 * never touches dev/production data.
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
  Customer,
  Logger,
  mergeConfig,
  NativeAuthenticationMethod,
  PasswordCipher,
  Role,
  TransactionalConnection,
  User,
} from '@vendure/core';
import { CUSTOMER_ROLE_CODE } from '@vendure/common/lib/shared-constants';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
// TypeORM's DeepPartial (not @vendure/common's): Repository.create/save overloads
// are declared against this one, and the two differ structurally (`| null`).
import type { DeepPartial } from 'typeorm';

import { TenantPlugin } from '../../tenant-plugin/tenant-plugin.plugin';
import { BigBlueButtonPlugin } from '../../bigbluebutton-plugin';
import { CmsPlugin } from '../../cms/cms.plugin';
import { ReviewsPlugin } from '../../reviews/reviews-plugin';
import { SubscriptionPlugin } from '../subscription.plugin';
import { OrganizationSubscription } from '../entities/organization-subscription.entity';
import { SubscriptionPlan } from '../entities/subscription-plan.entity';
import { BbbCapacityGrant } from '../../bigbluebutton-plugin/entities/bbb-capacity-grant.entity';
import { BbbOrganization } from '../../bigbluebutton-plugin/entities/bbb-organization.entity';
import { E2E_INITIAL_DATA } from '../../tenant-plugin/e2e/fixtures/e2e-initial-data';

// ─── Postgres initializer — uses the same DB as dev but an isolated schema ──
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

const AVAILABLE_PLANS = gql`
  query AvailableSubscriptionPlans {
    availableSubscriptionPlans {
      id
      name
      slug
      description
      monthlyPriceInPaise
      includedBbbMinutes
      maxStudents
      customDomainEnabled
      whitelabelEnabled
      marketplaceListingEnabled
    }
  }
`;

/** Intentionally names a provider internal — must fail GraphQL VALIDATION. */
const PROVIDER_FIELD_PROBE = gql`
  query ProviderFieldProbe {
    availableSubscriptionPlans {
      id
      providerPlanId
    }
  }
`;

const MY_SUBSCRIPTION = gql`
  query MySubscription {
    mySubscription {
      plan {
        id
        name
        slug
        monthlyPriceInPaise
        includedBbbMinutes
        maxStudents
        customDomainEnabled
        whitelabelEnabled
        marketplaceListingEnabled
      }
      status
      currentPeriodStart
      currentPeriodEnd
      cancelAtPeriodEnd
      cancelledAt
      marketplaceEligible
    }
  }
`;

const MY_LIVE_USAGE = gql`
  query MyLiveUsage {
    myLiveUsage {
      periodStart
      periodEnd
      includedMinutes
      consumedMinutes
      remainingMinutes
      isUnbounded
    }
  }
`;

/**
 * Control query: same client, same channel token, same identity. If this
 * serves the learner, the session is authenticated in this exact context —
 * so a subsequent Forbidden on mySubscription is attributable to the
 * ownership check, not to the @Allow gate.
 */
const ACTIVE_CUSTOMER = gql`
  query ShopActiveCustomer {
    activeCustomer {
      id
      emailAddress
    }
  }
`;

// ─── Test suite ────────────────────────────────────────────────────────────

describe('SubscriptionPlugin — Shop API commercial reads (slice 8)', () => {
  const { server, adminClient, shopClient } = createTestEnvironment(
    mergeConfig(testConfig, {
      apiOptions: { port: 3085 },
      authOptions: {
        // Same BUG-033/BUG-037 class as the sibling suites: registerNewTenant
        // creates admins with user.verified=false while testConfig defaults
        // requireVerification=true, which would make tenant-channel logins
        // return a null CurrentUser. This suite authenticates both the tenant
        // admin and the learner via asUserWithCredentials.
        requireVerification: false,
      },
      dbConnectionOptions: {
        type: 'postgres',
        host: process.env.DB_HOST ?? 'localhost',
        port: Number(process.env.DB_PORT ?? 5432),
        database: process.env.DB_NAME ?? 'vendure',
        username: process.env.DB_USERNAME ?? 'vendure_user',
        password: process.env.DB_PASSWORD ?? '',
        // Isolated schema: never touches dev/production data.
        schema: 'e2e_subscription_shop',
        synchronize: true,
      },
      // Plugin set mirrors the green BBB/tenant suites: TenantPlugin owns
      // registerNewTenant, BBB supplies the grant entities myLiveUsage reads,
      // Cms/Reviews are hard plugin dependencies of TenantPlugin, and
      // SubscriptionPlugin is the subject under test.
      plugins: [
        TenantPlugin,
        BigBlueButtonPlugin,
        CmsPlugin,
        ReviewsPlugin,
        SubscriptionPlugin.init({}) as any,
      ],
    }),
  );

  const FREE_PLAN_SLUG = 'free-basic'; // DEFAULT_FREE_PLAN_SLUG
  const tenantAPassword = 'StrongP@ss1';
  const learnerPassword = 'LearnerP@ss1';

  let tenantAChannelId: string; // decoded (DB form)
  let tenantAChannelToken: string;
  let tenantAEmail: string;
  let learnerEmail: string;

  const rawConnection = () => server.app.get(TransactionalConnection).rawConnection;

  /**
   * Event listeners (FreePlanProvisioningListener,
   * BbbTenantProvisioningListener) run on TenantRegisteredEvent; poll briefly
   * so assertions below never race the listener instead of testing it.
   */
  async function waitFor<T>(
    probe: () => Promise<T | null | undefined>,
    label: string,
  ): Promise<T> {
    const deadline = Date.now() + 15_000;
    for (;;) {
      const value = await probe();
      if (value) {
        return value as T;
      }
      if (Date.now() > deadline) {
        throw new Error(`Timed out waiting for ${label}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }

  /**
   * Asserts a query is denied AND that the OWNERSHIP layer denied it: only
   * `TenantBusinessAccountService.assertBusinessAccount` logs
   * 'Denied commercial read' — the @Allow guard throws before any
   * resolver/service code runs. Used to prove learner denials come from
   * ownership, not from authentication.
   */
  async function expectOwnershipDenial(query: typeof MY_SUBSCRIPTION): Promise<void> {
    const debugSpy = vi.spyOn(Logger, 'debug');
    try {
      await expect(shopClient.query(query)).rejects.toThrow(
        /not currently authorized|permission/i,
      );
      expect(
        debugSpy.mock.calls.some((call) =>
          String(call[0]).includes('Denied commercial read'),
        ),
        'expected the ownership check to be the layer that denied (the @Allow guard never reaches service code)',
      ).toBe(true);
    } finally {
      debugSpy.mockRestore();
    }
  }

  beforeAll(async () => {
    await server.init({
      initialData: E2E_INITIAL_DATA,
      productsCsvPath: path.join(
        __dirname,
        '../../tenant-plugin/e2e/fixtures/e2e-products.csv',
      ),
      customerCount: 2,
    });

    // The free plan must exist BEFORE registration: FreePlanProvisioningListener
    // is fail-soft (ADR-044 §4) and silently provisions nothing when the plan
    // row is missing. Provider-free by contract: providerPlanId stays NULL.
    const planRepo = rawConnection().getRepository(SubscriptionPlan);
    if (!(await planRepo.findOne({ where: { slug: FREE_PLAN_SLUG } }))) {
      await planRepo.save(
        planRepo.create({
          name: 'Free Basic',
          slug: FREE_PLAN_SLUG,
          description: 'Provider-free free tier',
          monthlyPriceInPaise: 0,
          includedBbbMinutes: 300,
          maxStudents: 50,
          customDomainEnabled: false,
          whitelabelEnabled: false,
          marketplaceListingEnabled: false,
        } as DeepPartial<SubscriptionPlan>),
      );
    }

    // Public mutation on the default channel (no auth required).
    shopClient.setChannelToken(E2E_DEFAULT_CHANNEL_TOKEN);
    tenantAEmail = `shop-tenant-a-${Date.now()}@example.com`;
    const result = await shopClient.query(REGISTER_NEW_TENANT, {
      input: {
        businessName: 'Shop API Academy A',
        firstName: 'A',
        lastName: 'Admin',
        emailAddress: tenantAEmail,
        password: tenantAPassword,
        timezone: 'Asia/Kolkata',
      },
    });
    const { channelId, channelToken } = result.registerNewTenant;
    expect(channelToken).toMatch(/^tok_/);
    // GraphQL ids arrive encoded (T_<id>); DB rows use the decoded form.
    tenantAChannelId = channelId.replace(/^T_/, '');
    tenantAChannelToken = channelToken;

    // Listener outcomes this suite asserts against (non-vacuous by construction):
    await waitFor(
      () =>
        rawConnection()
          .getRepository(OrganizationSubscription)
          .findOne({ where: { channelId: tenantAChannelId } }),
      'Free Basic OrganizationSubscription (FreePlanProvisioningListener)',
    );
    const organization = await waitFor(
      () =>
        rawConnection()
          .getRepository(BbbOrganization)
          .findOne({ where: { channelId: tenantAChannelId } }),
      'BbbOrganization (BbbTenantProvisioningListener)',
    );
    await waitFor(
      () =>
        rawConnection()
          .getRepository(BbbCapacityGrant)
          .findOne({
            where: {
              // Relation-based predicate: `organizationId` is the implicit FK
              // column, not a declared property on the entity's TS type.
              organization: { id: organization.id },
              sourceType: 'internal_overhead',
            },
          }),
      'auto-created internal_overhead capacity grant',
    );

    // ── The learner: a Customer whose account lives on TENANT A's channel ──
    // (the exact identity that satisfies @Allow(Authenticated) on the academy
    // hostname via the channel-assigned Customer role). Created directly
    // through the repositories — the same proven pattern the tenant-plugin
    // suite uses for its test-only administrators.
    const connection = server.app.get(TransactionalConnection);
    const passwordCipher = server.app.get(PasswordCipher);
    const channel = await connection
      .getRepository(undefined, 'Channel')
      .findOneOrFail({ where: { id: tenantAChannelId } });

    learnerEmail = `shop-learner-${Date.now()}@example.com`;
    const user = new User();
    user.identifier = learnerEmail;
    user.verified = true;
    const savedUser = await connection.getRepository(undefined, User).save(user);

    const nativeAuthMethod = new NativeAuthenticationMethod({
      identifier: learnerEmail,
      passwordHash: await passwordCipher.hash(learnerPassword),
    });
    nativeAuthMethod.user = savedUser as any;
    await connection
      .getRepository(undefined, NativeAuthenticationMethod)
      .save(nativeAuthMethod);

    const customer = connection.getRepository(undefined, Customer).create({
      firstName: 'Learn',
      lastName: 'Er',
      emailAddress: learnerEmail,
    } as DeepPartial<Customer>);
    customer.user = savedUser as any;
    customer.channels = [channel as any];
    await connection.getRepository(undefined, Customer).save(customer);

    // The Customer role is what real learners carry (TenantRegistrationService
    // assigns it to every tenant channel). Without it the user's
    // channelPermissions are EMPTY, so the @Allow(Authenticated) gate itself
    // would deny (the activeCustomer control would still pass via the
    // Owner-only path) and the ownership check would never run — the denial
    // tests below would prove nothing about ownership.
    const customerRole = await connection
      .getRepository(undefined, Role)
      .findOneOrFail({ where: { code: CUSTOMER_ROLE_CODE } });
    const userWithRoles = await connection.getRepository(undefined, User).findOne({
      where: { id: savedUser.id },
      relations: ['roles'],
    });
    if (userWithRoles) {
      userWithRoles.roles = [customerRole];
      await connection.getRepository(undefined, User).save(userWithRoles);
    }
  }, 120_000);

  afterAll(async () => {
    await server.destroy();
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Phase 1 — availableSubscriptionPlans: Permission.Public
  // (runs first: the client is still anonymous here)
  // ═══════════════════════════════════════════════════════════════════════

  describe('availableSubscriptionPlans is Public', () => {
    it('serves the platform catalogue with no session on the default channel', async () => {
      shopClient.setChannelToken(E2E_DEFAULT_CHANNEL_TOKEN);
      const result = await shopClient.query(AVAILABLE_PLANS);

      const plans = result.availableSubscriptionPlans;
      expect(Array.isArray(plans)).toBe(true);
      expect(plans.map((p: { slug: string }) => p.slug)).toContain(FREE_PLAN_SLUG);

      // Whitelist projection: no provider/billing internals anywhere in the
      // payload (they are not even addressable — see the probe test below).
      const payload = JSON.stringify(result);
      expect(payload).not.toContain('providerPlanId');
      expect(payload).not.toContain('providerStatus');
      expect(payload).not.toContain('billingCustomerId');
    });

    it('serves the same catalogue anonymously on the tenant channel', async () => {
      // Public means public on every hostname: the catalogue is
      // platform-global and carries no tenant state.
      shopClient.setChannelToken(tenantAChannelToken);
      const result = await shopClient.query(AVAILABLE_PLANS);
      expect(
        result.availableSubscriptionPlans.map((p: { slug: string }) => p.slug),
      ).toContain(FREE_PLAN_SLUG);
    });

    it('rejects provider-internal fields at GraphQL VALIDATION (schema boundary)', async () => {
      // Fails before any resolver runs → proves the field does not exist on
      // the Shop schema, not merely that it resolves to null.
      await expect(shopClient.query(PROVIDER_FIELD_PROBE)).rejects.toThrow(
        /Cannot query field "providerPlanId"/,
      );
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Phase 2 — anonymous callers: rejected by the @Allow gate
  // ═══════════════════════════════════════════════════════════════════════

  describe('mySubscription / myLiveUsage reject anonymous callers', () => {
    it('mySubscription → Forbidden with no session', async () => {
      shopClient.setChannelToken(tenantAChannelToken);
      await expect(shopClient.query(MY_SUBSCRIPTION)).rejects.toThrow(
        /not currently authorized/i,
      );
    });

    it('myLiveUsage → Forbidden with no session', async () => {
      shopClient.setChannelToken(tenantAChannelToken);
      await expect(shopClient.query(MY_LIVE_USAGE)).rejects.toThrow(
        /not currently authorized/i,
      );
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Phase 3 — learner (Customer on the tenant channel): ownership denies
  //
  // This is the crux of the locked model: the learner PASSES the
  // @Allow(Authenticated) gate (proved by the activeCustomer control) yet is
  // still denied, because TenantBusinessAccountService requires an
  // Administrator whose role is assigned to ctx.channelId.
  // ═══════════════════════════════════════════════════════════════════════

  describe('learner sessions are authenticated but not business accounts', () => {
    beforeAll(async () => {
      const login = await shopClient.asUserWithCredentials(
        learnerEmail,
        learnerPassword,
      );
      // A failed login returns an ErrorResult payload WITHOUT an auth token —
      // silent, and would make every denial below vacuous (guard denies an
      // anonymous caller). Fail loudly instead.
      expect(login?.id, `learner login failed: ${JSON.stringify(login)}`).toBeTruthy();
      // Login auto-selects the customer's single channel, but set it
      // explicitly so the assertion context is unambiguous.
      shopClient.setChannelToken(tenantAChannelToken);
    });

    it('control: the learner session IS authenticated on this channel', async () => {
      const result = await shopClient.query(ACTIVE_CUSTOMER);
      expect(result.activeCustomer?.emailAddress).toBe(learnerEmail);
    });

    it('mySubscription → Forbidden for the learner (ownership, not auth)', async () => {
      shopClient.setChannelToken(tenantAChannelToken);
      await expectOwnershipDenial(MY_SUBSCRIPTION);
    });

    it('myLiveUsage → Forbidden for the learner (ownership, not auth)', async () => {
      shopClient.setChannelToken(tenantAChannelToken);
      await expectOwnershipDenial(MY_LIVE_USAGE);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Phase 4 — tenant business account (the channel-scoped Administrator):
  // allowed, and the reads carry exact, policy-derived semantics
  // ═══════════════════════════════════════════════════════════════════════

  describe('tenant business account reads its own commercial state', () => {
    beforeAll(async () => {
      // Administrators CANNOT log into the Shop API in this Vendure version:
      // UserService.getUserByEmailAddress() INNER JOINs the `customer` table
      // when ctx.apiType === 'shop', so admin credentials yield
      // INVALID_CREDENTIALS_ERROR there. The business account therefore
      // authenticates on the Admin API, and its session token is accepted by
      // the Shop API (sessions are not api-type-scoped) — the production shape
      // for a tenant dashboard performing shop-side reads.
      const login = await adminClient.asUserWithCredentials(
        tenantAEmail,
        tenantAPassword,
      );
      expect(login?.id, `tenant admin login failed: ${JSON.stringify(login)}`).toBeTruthy();
      shopClient.setAuthToken(adminClient.getAuthToken());
      shopClient.setChannelToken(tenantAChannelToken);
    });

    it('mySubscription returns the provider-free Free Basic subscription', async () => {
      shopClient.setChannelToken(tenantAChannelToken);
      const result = await shopClient.query(MY_SUBSCRIPTION);
      const subscription = result.mySubscription;

      expect(subscription).not.toBeNull();
      expect(subscription.plan.slug).toBe(FREE_PLAN_SLUG);
      expect(subscription.status).toBe('active');
      // plan §0.19 F-7: provider-free rows MUST keep the period NULL so the
      // paid renewal scan never discovers them.
      expect(subscription.currentPeriodStart).toBeNull();
      expect(subscription.currentPeriodEnd).toBeNull();
      expect(subscription.cancelAtPeriodEnd).toBe(false);
      expect(subscription.cancelledAt).toBeNull();
      // ADR-042/INV-024 via the SHARED platform policy (not a second
      // evaluator): marketplaceListingEnabled=false on Free Basic → false.
      expect(subscription.marketplaceEligible).toBe(false);

      const payload = JSON.stringify(result);
      expect(payload).not.toContain('providerPlanId');
      expect(payload).not.toContain('providerStatus');
      expect(payload).not.toContain('dunningRetryCount');
    });

    it('myLiveUsage reports ZERO despite an existing unbounded internal_overhead grant', async () => {
      // Non-vacuous: the org really does carry an unbounded grant right now
      // (asserted in beforeAll). BUG-036 semantics — the read shares the
      // provisioning gate's positive IN filter ('order' | 'subscription'), so
      // ops headroom is never customer allowance, and isUnbounded therefore
      // reflects ONLY selectable grants.
      const organization = await rawConnection()
        .getRepository(BbbOrganization)
        .findOneOrFail({ where: { channelId: tenantAChannelId } });
      const overhead = await rawConnection()
        .getRepository(BbbCapacityGrant)
        .findOne({
          where: {
            // Relation-based predicate: `organizationId` is the implicit FK
            // column, not a declared property on the entity's TS type.
            organization: { id: organization.id },
            sourceType: 'internal_overhead',
          },
        });
      expect(overhead).not.toBeNull();
      expect(overhead!.isUnbounded).toBe(true);

      shopClient.setChannelToken(tenantAChannelToken);
      const result = await shopClient.query(MY_LIVE_USAGE);
      expect(result.myLiveUsage).toEqual({
        periodStart: null, // provider-free subscription → NULL period (F-7)
        periodEnd: null,
        includedMinutes: 0,
        consumedMinutes: 0,
        remainingMinutes: 0,
        isUnbounded: false, // NOT unbounded: the unbounded grant is excluded
      });
    });

    it('myLiveUsage surfaces a tenant-selectable order grant (100 − 30 = 70)', async () => {
      const organization = await rawConnection()
        .getRepository(BbbOrganization)
        .findOneOrFail({ where: { channelId: tenantAChannelId } });
      await rawConnection().getRepository(BbbCapacityGrant).save(
        rawConnection().getRepository(BbbCapacityGrant).create({
          organization,
          sourceType: 'order',
          grantedMinutes: 100,
          consumedMinutes: 30,
          exhausted: false,
          isUnbounded: false,
          validFrom: new Date(Date.now() - 60 * 60 * 1000),
          validUntil: new Date(Date.now() + 60 * 60 * 1000),
        } as DeepPartial<BbbCapacityGrant>),
      );

      shopClient.setChannelToken(tenantAChannelToken);
      const result = await shopClient.query(MY_LIVE_USAGE);
      expect(result.myLiveUsage).toMatchObject({
        includedMinutes: 100,
        consumedMinutes: 30,
        remainingMinutes: 70,
        isUnbounded: false, // overhead grant still excluded from the rollup
      });
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Phase 5 — platform staff retain access
  //
  // TenantRegistrationService assigns the SuperAdmin role to every tenant
  // channel at registration, so Portal staff pass the ownership check too —
  // mirroring what the Admin API already allows them to see.
  // ═══════════════════════════════════════════════════════════════════════

  describe('platform SuperAdmin retains access on the tenant channel', () => {
    it('mySubscription succeeds for SuperAdmin scoped to the tenant channel', async () => {
      // Same as the tenant-admin phase: authenticate on the Admin API (the
      // Shop API rejects administrator credentials by design — see the phase-4
      // comment), then present the session token to the Shop API scoped to the
      // tenant channel. BUG-037 lesson: never leave the client with an empty
      // channel token, or ctx.channelId is unset and every ownership check
      // fails closed.
      adminClient.setChannelToken(E2E_DEFAULT_CHANNEL_TOKEN);
      await adminClient.asSuperAdmin();
      shopClient.setAuthToken(adminClient.getAuthToken());
      shopClient.setChannelToken(tenantAChannelToken);

      const result = await shopClient.query(MY_SUBSCRIPTION);
      expect(result.mySubscription?.plan.slug).toBe(FREE_PLAN_SLUG);
      expect(result.mySubscription?.status).toBe('active');
    });
  });
});
