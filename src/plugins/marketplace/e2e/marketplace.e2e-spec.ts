/**
 * Marketplace projection e2e (Phase 3, Gate 1.5)
 *
 * Infrastructure-gated: MARKETPLACE_E2E=true makes this suite FAIL unless
 * PostgreSQL, Redis, and Elasticsearch are ALL reachable. There is no
 * pg-mem / in-memory fallback for the marketplace — `ensureIndicesExist()`
 * being non-fatal is correct for app startup but is not an acceptance
 * condition (phase3-audit.md Gate 1.5).
 *
 * Coverage (see phase3-audit.md §Gate 1.5):
 *   A. Projection pipeline: session create/update → event → queue → indexer → ES
 *   B. Public query: channel-free marketplaceSearch with redirect contract
 *      (channelToken + academySlug + customDomain) and subjectTags filtering
 *   C. Cross-channel discovery correctness: documents carry correct channel
 *      identity; cross-channel read is by design (ADR-020)
 *   D. F7 removal matrix: PUBLIC→PRIVATE, SCHEDULED→CANCELLED each REMOVE
 *      the ES document through the event path
 *   E. Review aggregate recalculation: an approved review changes the derived
 *      Bayesian rating in the marketplace document
 *   F. AdSpendLedger append-only at the service boundary (INV-010)
 *
 * Run:  MARKETPLACE_E2E=true npm run test:e2e:marketplace
 *
 * Uses isolated ES indices (e2e_marketplace_*) and an isolated Postgres
 * schema (e2e_marketplace) so neither dev nor live projections are touched.
 */

import 'reflect-metadata';
import path from 'path';
import 'dotenv/config';
import gql from 'graphql-tag';
import net from 'net';
import { Client as EsClient } from '@elastic/elasticsearch';
import {
  createTestEnvironment,
  E2E_DEFAULT_CHANNEL_TOKEN,
  registerInitializer,
  testConfig,
} from '@vendure/testing';
import {
  DefaultLogger,
  LogLevel,
  mergeConfig,
  ProductVariant,
} from '@vendure/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { In } from 'typeorm';

import { TenantPlugin } from '../../tenant-plugin/tenant-plugin.plugin';
import { BigBlueButtonPlugin } from '../../bigbluebutton-plugin';
import { SessionUpdatedEvent } from '../../bigbluebutton-plugin/events/bbb-events';
import { CmsPlugin } from '../../cms/cms.plugin';
import { ReviewsPlugin } from '../../reviews/reviews-plugin';
import { MarketplaceIndexerPlugin } from '../marketplace-indexer.plugin';
import { E2E_INITIAL_DATA } from '../../tenant-plugin/e2e/fixtures/e2e-initial-data';
import { SchemaPostgresInitializer } from '../../tenant-plugin/e2e/schema-postgres-initializer';
import { AdSpendLedger } from '../entities/ad-spend-ledger.entity';
import { BbbScheduledSession } from '../../bigbluebutton-plugin/entities/bbb-scheduled-session.entity';
import { ReviewApprovedEvent } from '../../reviews/events/review.events';
import { TransactionalConnection } from '@vendure/core';
import { AdSpendLedgerImmutableSubscriber } from '../ad-spend-ledger-immutable.subscriber';

// Schema-based isolation: creates e2e_marketplace with a clean slate per run
// (same pattern as the tenant-plugin e2e suite).
registerInitializer('postgres', new SchemaPostgresInitializer());

// ─── Infrastructure gate ─────────────────────────────────────────────────────

const MARKETPLACE_E2E = process.env.MARKETPLACE_E2E === 'true';

async function assertInfrastructure(): Promise<void> {
  const pgHost = process.env.DB_HOST ?? '127.0.0.1';
  const pgPort = Number(process.env.DB_PORT ?? 5435);
  const redisPort = Number(process.env.REDIS_PORT ?? 6385);
  const esNode = process.env.ELASTICSEARCH_NODE ?? 'http://localhost:9200';

  const tcp = (port: number, host: string): Promise<void> =>
    new Promise((resolve, reject) => {
      const socket = net.connect({ port, host, timeout: 4000 });
      socket.once('connect', () => {
        socket.destroy();
        resolve();
      });
      socket.once('error', reject);
      socket.once('timeout', () => {
        socket.destroy();
        reject(new Error(`timeout connecting to ${host}:${port}`));
      });
    });

  const failures: string[] = [];
  await tcp(pgPort, pgHost).catch((e: Error) => failures.push(`PostgreSQL (${pgHost}:${pgPort}): ${e.message}`));
  await tcp(redisPort, pgHost).catch((e: Error) => failures.push(`Redis (${pgHost}:${redisPort}): ${e.message}`));
  try {
    const es = new EsClient({
      node: esNode,
      ...(process.env.ELASTICSEARCH_PASSWORD
        ? { auth: { username: 'elastic', password: process.env.ELASTICSEARCH_PASSWORD } }
        : {}),
    });
    const ping = await es.ping();
    if (!ping) failures.push(`Elasticsearch (${esNode}): ping returned false`);
  } catch (e: any) {
    failures.push(`Elasticsearch (${esNode}): ${e.message}`);
  }

  if (failures.length) {
    throw new Error(
      `MARKETPLACE_E2E requires real infrastructure — refusing to run with fallbacks:\n  - ${failures.join('\n  - ')}`,
    );
  }
}

// ─── Test indices (isolated from live projections) ──────────────────────────

// Set BEFORE plugin construction — the indexer and search resolver read
// these at construction time.
process.env.MARKETPLACE_SESSIONS_INDEX = 'e2e_marketplace_sessions';
process.env.MARKETPLACE_INSTRUCTORS_INDEX = 'e2e_marketplace_instructors';
const TEST_SESSIONS_INDEX = 'e2e_marketplace_sessions';

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

const CREATE_ORG = gql`
  mutation CreateOrg($input: CreateBbbOrganizationInput!) {
    createBbbOrganization(input: $input) {
      id
      slug
    }
  }
`;

const CREATE_SESSION = gql`
  mutation CreateSession($input: CreateBbbScheduledSessionInput!) {
    createBbbScheduledSession(input: $input) {
      id
      title
      subjectTags
      visibility
      status
    }
  }
`;

const UPDATE_SESSION = gql`
  mutation UpdateSession($id: ID!, $input: UpdateBbbScheduledSessionInput!) {
    updateBbbScheduledSession(id: $id, input: $input) {
      id
      visibility
      status
    }
  }
`;

const CANCEL_SESSION = gql`
  mutation CancelSession($id: ID!) {
    cancelBbbScheduledSession(id: $id) {
      id
      status
    }
  }
`;

const MARKETPLACE_SEARCH = gql`
  query MarketplaceSearch($input: MarketplaceSearchInput!) {
    marketplaceSearch(input: $input) {
      totalSessions
      sessions {
        id
        channelToken
        channelId
        title
        academyName
        academySlug
        customDomain
        subjectTags
        bayesianRating
        baselineVersion
        isSponsored
      }
    }
  }
`;

const MY_ORGS = gql`
  query Orgs {
    bbbOrganizations(options: { skip: 0, take: 10 }) {
      items {
        id
        slug
        name
      }
    }
  }
`;

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

const ADD_MEMBER = gql`
  mutation AddMember($input: AddBbbMemberInput!) {
    addBbbMember(input: $input) {
      id
      customerId
      role
    }
  }
`;

// ─── Async helpers ───────────────────────────────────────────────────────────

async function waitFor<T>(
  fn: () => Promise<T>,
  predicate: (v: T) => boolean,
  budgetMs = 15000,
  intervalMs = 500,
): Promise<T> {
  const deadline = Date.now() + budgetMs;
  let last = await fn();
  while (!predicate(last) && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, intervalMs));
    last = await fn();
  }
  return last;
}

async function searchSessions(query: string, subjectTags?: string[]): Promise<any[]> {
  const res: any = await shopClient.query(MARKETPLACE_SEARCH, {
    input: { query, ...(subjectTags ? { subjectTags } : {}) },
  });
  return res.marketplaceSearch.sessions;
}

// ─── Test environment ────────────────────────────────────────────────────────

const { server, adminClient, shopClient } = createTestEnvironment(
  mergeConfig(testConfig, {
    apiOptions: { port: 3075 },
    // Verbose logging: the projection pipeline runs in background jobs whose
    // failures are otherwise invisible to the e2e assertions.
    logger: new DefaultLogger({ level: LogLevel.Debug }),
    authOptions: {
      // BUG-033 fix: registerNewTenant creates admins verified=false (email
      // verification flow), which cannot log in under testConfig's default
      // requireVerification=true. Verification itself is exercised by the
      // tenant-plugin suite; the marketplace suite needs authenticated
      // tenant admins to exercise the projection pipeline.
      requireVerification: false,
    },
    dbConnectionOptions: {
      type: 'postgres',
      host: process.env.DB_HOST ?? '127.0.0.1',
      port: Number(process.env.DB_PORT ?? 5435),
      database: process.env.DB_NAME ?? 'vendure',
      username: process.env.DB_USERNAME ?? 'vendure_user',
      password: process.env.DB_PASSWORD ?? '',
      schema: 'e2e_marketplace',
      synchronize: true,
      // INV-010 append-only enforcement must be active in the e2e env
      // for the ledger immutability test (layer F) to be meaningful.
      subscribers: [AdSpendLedgerImmutableSubscriber],
    },
    plugins: [TenantPlugin, BigBlueButtonPlugin, CmsPlugin, ReviewsPlugin, MarketplaceIndexerPlugin],
  }),
);

describe('MarketplaceIndexerPlugin (Gate 1.5)', () => {
  const d = MARKETPLACE_E2E ? describe : describe.skip;

  let tenantA: { channelId: string; channelToken: string; email: string; adminId: string };
  let tenantB: { channelId: string; channelToken: string; email: string; adminId: string };
  let orgAId: string;
  let orgBId: string;
  let sessionA1Id: string; // PUBLIC + SCHEDULED, python tag (stable)
  let sessionA2Id: string; // PUBLIC + SCHEDULED, neet tag (transition tests)
  let sessionB1Id: string; // PUBLIC + SCHEDULED (cross-channel discovery)

  beforeAll(async () => {
    // Gate 1.5 acceptance rule: fail hard, never fall back.
    await assertInfrastructure();

    await server.init({
      initialData: E2E_INITIAL_DATA,
      productsCsvPath: path.join(__dirname, '../../tenant-plugin/e2e/fixtures/e2e-products.csv'),
      customerCount: 2,
    });

    const emailA = `mkt-a-${Date.now()}@example.com`;
    const emailB = `mkt-b-${Date.now()}@example.com`;

    // 3D.1b Steps 1–4: seed the authoritative Bayesian baseline in the
    // Settings Store. Indexing is fail-closed — without a baseline the job
    // rejects — so the suite must establish one (this is what the Step 5
    // scheduled refresh task will do in production).
    const { SettingsStoreService, RequestContextService } = await import('@vendure/core');
    const settingsStore = server.app.get(SettingsStoreService);
    const seedCtx = await server.app.get(RequestContextService).create({ apiType: 'admin' });
    // Settings Store requires JsonCompatible object values — primitives are
    // rejected, so each field is stored as { v }.
    await settingsStore.set(seedCtx, 'marketplace.bayesianGlobalMean', { v: 4.2 });
    await settingsStore.set(seedCtx, 'marketplace.bayesianBaselineVersion', { v: 1 });
    await settingsStore.set(seedCtx, 'marketplace.bayesianGlobalMeanComputedAt', { v: new Date().toISOString() });

    // Public mutations still require a channel token for routing (same as
    // the tenant-plugin e2e suite).
    shopClient.setChannelToken(E2E_DEFAULT_CHANNEL_TOKEN);

    const resA = await shopClient.query(REGISTER_NEW_TENANT, {
      input: {
        businessName: 'E2E Academy A',
        firstName: 'Ada',
        lastName: 'Academy',
        emailAddress: emailA,
        password: 'StrongP@ss1',
        contactEmail: 'a@e2e.example.com',
        timezone: 'Asia/Kolkata',
      },
    });
    const resB = await shopClient.query(REGISTER_NEW_TENANT, {
      input: {
        businessName: 'E2E Academy B',
        firstName: 'Bob',
        lastName: 'Academy',
        emailAddress: emailB,
        password: 'StrongP@ss2',
        contactEmail: 'b@e2e.example.com',
        timezone: 'Asia/Kolkata',
      },
    });

    tenantA = {
      channelId: resA.registerNewTenant.channelId,
      channelToken: resA.registerNewTenant.channelToken,
      email: emailA,
      adminId: resA.registerNewTenant.administratorId,
    };
    tenantB = {
      channelId: resB.registerNewTenant.channelId,
      channelToken: resB.registerNewTenant.channelToken,
      email: emailB,
      adminId: resB.registerNewTenant.administratorId,
    };

    // Tenant A: org + two sessions (one stable, one for transition tests)
    adminClient.setChannelToken(tenantA.channelToken);
    await adminClient.asUserWithCredentials(emailA, 'StrongP@ss1');
    const orgA = await adminClient.query(CREATE_ORG, {
      input: { channelId: tenantA.channelId, slug: 'e2e-academy-a', name: 'E2E Academy A Org' },
    });
    orgAId = orgA.createBbbOrganization.id;

    // Sessions require a trainer: create a customer + org membership, then
    // pass the customerId as trainerId (the service resolves either).
    const trainerA = await adminClient.query(CREATE_CUSTOMER, {
      input: { firstName: 'Ada', lastName: 'Trainer', emailAddress: `trainer-a-${Date.now()}@example.com` },
    });
    const memberA = await adminClient.query(ADD_MEMBER, {
      input: { organizationId: orgAId, customerId: trainerA.createCustomer.id, role: 'org-admin' },
    });

    const s1 = await adminClient.query(CREATE_SESSION, {
      input: {
        organizationId: orgAId,
        title: 'E2E Python Bootcamp A1',
        startTime: new Date(Date.now() + 86400_000).toISOString(),
        endTime: new Date(Date.now() + 90000_000).toISOString(),
        trainerId: memberA.addBbbMember.customerId,
        subjectTags: ['python'],
      },
    });
    sessionA1Id = s1.createBbbScheduledSession.id;

    const s2 = await adminClient.query(CREATE_SESSION, {
      input: {
        organizationId: orgAId,
        title: 'E2E NEET Crash Course A2',
        startTime: new Date(Date.now() + 86400_000).toISOString(),
        endTime: new Date(Date.now() + 90000_000).toISOString(),
        trainerId: memberA.addBbbMember.customerId,
        subjectTags: ['neet'],
      },
    });
    sessionA2Id = s2.createBbbScheduledSession.id;

    // Tenant B: org + one session
    adminClient.setChannelToken(tenantB.channelToken);
    await adminClient.asUserWithCredentials(emailB, 'StrongP@ss2');
    const orgB = await adminClient.query(CREATE_ORG, {
      input: { channelId: tenantB.channelId, slug: 'e2e-academy-b', name: 'E2E Academy B Org' },
    });
    orgBId = orgB.createBbbOrganization.id;

    const trainerB = await adminClient.query(CREATE_CUSTOMER, {
      input: { firstName: 'Bob', lastName: 'Trainer', emailAddress: `trainer-b-${Date.now()}@example.com` },
    });
    const memberB = await adminClient.query(ADD_MEMBER, {
      input: { organizationId: orgBId, customerId: trainerB.createCustomer.id, role: 'org-admin' },
    });

    const s3 = await adminClient.query(CREATE_SESSION, {
      input: {
        organizationId: orgBId,
        title: 'E2E JEE Physics B1',
        startTime: new Date(Date.now() + 86400_000).toISOString(),
        endTime: new Date(Date.now() + 90000_000).toISOString(),
        trainerId: memberB.addBbbMember.customerId,
        subjectTags: ['jee'],
      },
    });
    sessionB1Id = s3.createBbbScheduledSession.id;

    // Sessions default to visibility=PRIVATE (F7 safe-by-default). The
    // marketplace projection only indexes PUBLIC sessions, so publish the
    // fixtures directly at the entity level before the pipeline tests run.
    const connection = server.app.get(TransactionalConnection);
    const sessionRepo = connection.rawConnection.getRepository(BbbScheduledSession);
    const toPk = (id: string) => parseInt(String(id).replace(/^T_/, ''), 10);
    await sessionRepo.update(
      { id: In([toPk(sessionA1Id), toPk(sessionA2Id), toPk(sessionB1Id)]) },
      { visibility: 'PUBLIC' },
    );
    // Publish events for the visibility change so the projection indexes them
    // through the same guarded path as any other update.
    const { EventBus } = await import('@vendure/core');
    const eventBus = server.app.get(EventBus);
    for (const sid of [sessionA1Id, sessionA2Id, sessionB1Id]) {
      eventBus.publish(new SessionUpdatedEvent(String(toPk(sid)), null));
    }
  }, 180_000);

  afterAll(async () => {
    await server.destroy();
    try {
      const es = new EsClient({
        node: process.env.ELASTICSEARCH_NODE ?? 'http://localhost:9200',
        ...(process.env.ELASTICSEARCH_PASSWORD
          ? { auth: { username: 'elastic', password: process.env.ELASTICSEARCH_PASSWORD } }
          : {}),
      });
      await es.indices.delete({ index: 'e2e_marketplace_*', ignore_unavailable: true });
    } catch {
      // cleanup is best-effort
    }
  });

  // ─── Layer A + B: pipeline + public query + redirect contract ────────────

  d('projection pipeline + public query', () => {
    it('indexes a created public session; channel-free marketplaceSearch returns the full redirect contract', async () => {
      const hits = await waitFor(
        () => searchSessions('Python Bootcamp'),
        (hits) => hits.some((s: any) => s.id === sessionA1Id),
      );

      const doc = hits.find((s: any) => s.id === sessionA1Id)!;
      expect(doc).toBeDefined();
      // Redirect contract (BUG-023 + F3): complete tenant routing without
      // the storefront reconstructing tenant identity.
      expect(doc.channelToken).toBe(tenantA.channelToken);
      expect(doc.academySlug).toBe('e2e-academy-a');
      expect(doc.customDomain).toBeNull();
      expect(doc.academyName).toBe('E2E Academy A');
    });

    it('filters by subjectTags and excludes non-matching sessions (F4)', async () => {
      const python = await waitFor(
        () => searchSessions('E2E', ['python']),
        (hits) => hits.some((s: any) => s.id === sessionA1Id),
      );
      const pythonIds = python.map((s: any) => s.id);
      expect(pythonIds).toContain(sessionA1Id);
      expect(pythonIds).not.toContain(sessionB1Id);

      const jee = await searchSessions('E2E', ['jee']);
      const jeeIds = jee.map((s: any) => s.id);
      expect(jeeIds).toContain(sessionB1Id);
      expect(jeeIds).not.toContain(sessionA1Id);
    });

    it('returns cross-channel results with correct per-document channel identity (ADR-020, layer C)', async () => {
      const hits = await waitFor(
        () => searchSessions('E2E'),
        (hits) =>
          hits.some((s: any) => s.id === sessionA1Id) && hits.some((s: any) => s.id === sessionB1Id),
      );

      const docA = hits.find((s: any) => s.id === sessionA1Id)!;
      const docB = hits.find((s: any) => s.id === sessionB1Id)!;
      // Cross-channel discovery is by design; isolation means each document
      // carries its OWN correct channel identity — not mutual invisibility.
      expect(docA.channelToken).toBe(tenantA.channelToken);
      expect(docA.academySlug).toBe('e2e-academy-a');
      expect(docB.channelToken).toBe(tenantB.channelToken);
      expect(docB.academySlug).toBe('e2e-academy-b');
    });
  });

  // ─── Layer D: F7 removal matrix through the event path ───────────────────

  d('F7 removal matrix (event-path regressions)', () => {
    it('PUBLIC → PRIVATE removes the ES document', async () => {
      adminClient.setChannelToken(tenantA.channelToken);
      await adminClient.asUserWithCredentials(tenantA.email, 'StrongP@ss1');
      await adminClient.query(UPDATE_SESSION, {
        id: sessionA2Id,
        input: { visibility: 'PRIVATE' },
      });

      const hits = await waitFor(
        () => searchSessions('E2E'),
        (hits) => !hits.some((s: any) => s.id === sessionA2Id),
      );
      expect(hits.some((s: any) => s.id === sessionA2Id)).toBe(false);
    });

    it('SCHEDULED → CANCELLED removes the ES document', async () => {
      adminClient.setChannelToken(tenantA.channelToken);
      await adminClient.asUserWithCredentials(tenantA.email, 'StrongP@ss1');
      await adminClient.query(CANCEL_SESSION, { id: sessionA2Id });

      const hits = await waitFor(
        () => searchSessions('E2E'),
        (hits) => !hits.some((s: any) => s.id === sessionA2Id),
      );
      expect(hits.some((s: any) => s.id === sessionA2Id)).toBe(false);
    });
  });

  // ─── Layer E: review aggregate recalculation (not just reindexing) ───────

  d('review aggregate recalculation', () => {
    it('an approved review changes the derived Bayesian rating in the marketplace document', async () => {
      // 1. Link a product variant to session A1 (the marketplace contract
      //    reads the variant for price + rating).
      const connection = server.app.get(TransactionalConnection);
      const variantRepo = connection.rawConnection.getRepository(ProductVariant);
      let variant = await variantRepo.findOne({ where: {}, relations: ['product'] });
      if (!variant) {
        // Fixture seeding may not have produced catalog rows in this schema;
        // create the minimal product + variant needed for rating linkage.
        const { Product } = await import('@vendure/core');
        const productRepo = connection.rawConnection.getRepository(Product);
        const product = await productRepo.save(
          productRepo.create({ name: 'E2E Rating Product', slug: `e2e-rating-${Date.now()}` } as any),
        );
        variant = (await variantRepo.save(
          variantRepo.create({ product: product as any, name: 'E2E Rating Variant', sku: `E2E-RATING-${Date.now()}`, price: 100000 } as any),
        )) as unknown as NonNullable<typeof variant>;
      }
      expect(variant).toBeDefined();
      const sessionRepo = connection.rawConnection.getRepository(BbbScheduledSession);
      // sessionA1Id is the GraphQL-facing id (e.g. "T_1"); decode to the raw
      // integer PK before querying the entity directly via TypeORM.
      const session = await sessionRepo.findOneOrFail({
        where: { id: parseInt(String(sessionA1Id).replace(/^T_/, ''), 10) as any },
      });
      session.productVariantId = String(variant!.id);
      await sessionRepo.save(session);

      // 2. Rating before any review exists (0 for a variant with no reviews).
      const before = await waitFor(
        () => searchSessions('Python Bootcamp'),
        (hits) => hits.some((s: any) => s.id === sessionA1Id),
      );
      const ratingBefore = before.find((s: any) => s.id === sessionA1Id)!.bayesianRating;

      // 3. Insert an approved 5-star review for the variant's product and
      //    publish ReviewApprovedEvent — the same aggregate-affecting
      //    transition the marketplace listener subscribes to. The document
      //    must change because the DERIVED aggregate changed — proving
      //    recalculation rather than stale reindexing.
      const { EventBus } = await import('@vendure/core');
      const reviewRepo = connection.rawConnection.getRepository('ProductReview' as any);
      const savedReview = await reviewRepo.save(
        reviewRepo.create({
          channelId: tenantA.channelId,
          // ProductReview.product / productVariant are ManyToOne relations —
          // the FKs must be set via the relation, not scalar id properties.
          product: { id: variant!.productId } as any,
          productVariant: { id: variant!.id } as any,
          summary: 'E2E review',
          body: 'Great session',
          rating: 5,
          authorName: 'E2E Reviewer',
          state: 'approved',
        }),
      );

      const eventBus = server.app.get(EventBus);
      eventBus.publish(new ReviewApprovedEvent(String(savedReview.id), String(variant!.productId)));

      // 4. The derived bayesianRating must exceed its pre-review value.
      const after = await waitFor(
        () => searchSessions('Python Bootcamp'),
        (hits) => {
          const doc = hits.find((s: any) => s.id === sessionA1Id);
          return !!doc && doc.bayesianRating > ratingBefore;
        },
        20000,
      );
      const docAfter = after.find((s: any) => s.id === sessionA1Id)!;
      expect(docAfter.bayesianRating).toBeGreaterThan(ratingBefore);
      // 3D.1b: every indexed document must carry the baselineVersion of the
      // frozen {G,V} snapshot used for the Bayesian calculation.
      expect(docAfter.baselineVersion).toBe(1);
    });
  });

  // ─── Layer F: AdSpendLedger append-only at the service boundary ──────────

  d('AdSpendLedger immutability (INV-010)', () => {
    it('rejects UPDATE and DELETE on ledger rows from any code path', async () => {
      const connection = server.app.get(TransactionalConnection);
      const ledgerRepo = connection.rawConnection.getRepository(AdSpendLedger);

      // INSERT allowed (append)
      const row = await ledgerRepo.save(
        ledgerRepo.create({
          campaignId: 'e2e-campaign-1',
          eventType: 'click',
          amountInPaise: 5000,
          occurredAt: new Date(),
        }),
      );

      const loaded = await ledgerRepo.findOneOrFail({ where: { id: row.id } });
      expect(loaded.amountInPaise).toBe(5000);

      // UPDATE rejected
      loaded.amountInPaise = 9999;
      await expect(ledgerRepo.save(loaded)).rejects.toThrow(/INV-010 violation/);

      // Historical row unchanged
      const afterUpdate = await ledgerRepo.findOneOrFail({ where: { id: row.id } });
      expect(afterUpdate.amountInPaise).toBe(5000);

      // DELETE rejected; row still present
      await expect(ledgerRepo.remove(afterUpdate)).rejects.toThrow(/INV-010 violation/);
      const afterDelete = await ledgerRepo.findOneOrFail({ where: { id: row.id } });
      expect(afterDelete.id).toBe(row.id);
    });
  });
});

