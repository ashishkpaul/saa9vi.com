/**
 * 3D.1b Step 9 — Convergence / recovery E2E (final 3D.1b gate).
 *
 * Infrastructure-gated (MARKETPLACE_E2E=true): real PostgreSQL + Redis/BullMQ
 * + Elasticsearch. Isolated Postgres schema `e2e_convergence` and isolated ES
 * index `e2e_convergence_sessions`.
 *
 * Proves the Path B convergence contract end-to-end using the real
 * MarketplaceIndexerService / MarketplaceBaselineService:
 *   1. Full converge: V41 docs -> bump V42 -> globalReindex(42) -> converged=N
 *   2. Missing ES doc for an eligible PG session counts as stale
 *   3. An ineligible session's ES doc never inflates total
 *   4. Supersession: baseline advances to V43 -> a queued V42 reindex aborts;
 *      V43 reindex converges to V43
 *   5. Successful refresh (refreshBaseline committed) -> reindex -> stale = 0
 *   Self-healing: re-running globalReindex(targetVersion) reaches stale = 0.
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
  RequestContext,
  TransactionalConnection,
} from '@vendure/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { In } from 'typeorm';
import { TenantPlugin } from '../../tenant-plugin/tenant-plugin.plugin';
import { BigBlueButtonPlugin } from '../../bigbluebutton-plugin';
import { CmsPlugin } from '../../cms/cms.plugin';
import { ReviewsPlugin } from '../../reviews/reviews-plugin';
import { MarketplaceIndexerPlugin } from '../marketplace-indexer.plugin';
import { E2E_INITIAL_DATA } from '../../tenant-plugin/e2e/fixtures/e2e-initial-data';
import { SchemaPostgresInitializer } from '../../tenant-plugin/e2e/schema-postgres-initializer';
import { BbbScheduledSession } from '../../bigbluebutton-plugin/entities/bbb-scheduled-session.entity';
import { MarketplaceIndexerService } from '../services/marketplace-indexer.service';
import { MarketplaceBaselineService } from '../services/marketplace-baseline.service';

// Schema + index isolation (set BEFORE plugin construction).
process.env.MARKETPLACE_SESSIONS_INDEX = 'e2e_convergence_sessions';
process.env.MARKETPLACE_INSTRUCTORS_INDEX = 'e2e_convergence_instructors';
const SESSIONS_INDEX = 'e2e_convergence_sessions';

registerInitializer('postgres', new SchemaPostgresInitializer());

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
  await tcp(pgPort, pgHost).catch((e: Error) => failures.push(`PostgreSQL: ${e.message}`));
  await tcp(redisPort, pgHost).catch((e: Error) => failures.push(`Redis: ${e.message}`));
  try {
    const es = new EsClient({
      node: esNode,
      ...(process.env.ELASTICSEARCH_PASSWORD
        ? {
            auth: {
              username: process.env.ELASTICSEARCH_USERNAME ?? 'elastic',
              password: process.env.ELASTICSEARCH_PASSWORD,
            },
          }
        : {}),
    });
    const ok = await es.ping();
    if (!ok) failures.push(`Elasticsearch: ping false`);
  } catch (e: any) {
    failures.push(`Elasticsearch: ${e.message}`);
  }
  if (failures.length) {
    throw new Error(`CONVERGENCE_E2E requires real infra — refusing to run with fallbacks:\n  - ${failures.join('\n  - ')}`);
  }
}

// ─── GraphQL fixtures ────────────────────────────────────────────────────────

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
    }
  }
`;

// ─── Async helpers ───────────────────────────────────────────────────────────

async function waitFor<T>(
  fn: () => Promise<T>,
  predicate: (v: T) => boolean,
  budgetMs = 20000,
  intervalMs = 600,
): Promise<T> {
  const deadline = Date.now() + budgetMs;
  let last = await fn();
  while (!predicate(last) && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, intervalMs));
    last = await fn();
  }
  return last;
}

// ─── Test environment ────────────────────────────────────────────────────────

const { server, adminClient, shopClient } = createTestEnvironment(
  mergeConfig(testConfig, {
    apiOptions: { port: 3081 },
    logger: new DefaultLogger({ level: LogLevel.Debug }),
    authOptions: { requireVerification: false },
    dbConnectionOptions: {
      type: 'postgres',
      host: process.env.DB_HOST ?? '127.0.0.1',
      port: Number(process.env.DB_PORT ?? 5435),
      database: process.env.DB_NAME ?? 'vendure',
      username: process.env.DB_USERNAME ?? 'vendure_user',
      password: process.env.DB_PASSWORD ?? '',
      schema: 'e2e_convergence',
      synchronize: true,
    },
    plugins: [TenantPlugin, BigBlueButtonPlugin, CmsPlugin, ReviewsPlugin, MarketplaceIndexerPlugin],
  }),
);

function esClient(): EsClient {
  return new EsClient({
    node: process.env.ELASTICSEARCH_NODE ?? 'http://localhost:9200',
    ...(process.env.ELASTICSEARCH_PASSWORD
      ? {
          auth: {
            username: process.env.ELASTICSEARCH_USERNAME ?? 'elastic',
            password: process.env.ELASTICSEARCH_PASSWORD,
          },
        }
      : {}),
  });
}

async function refreshIndex(es: EsClient): Promise<void> {
  await es.indices.refresh({ index: SESSIONS_INDEX });
}

/** Resolve the ES document _id for a session doc via its `id` field (client-side match, format-agnostic). */
async function findDocId(es: EsClient, sessionId: string | number): Promise<string | undefined> {
  const res = await es.search({ index: SESSIONS_INDEX, query: { match_all: {} }, size: 100 });
  const target = String(sessionId).replace(/^T_/, '');
  const hit = res.hits.hits.find((h) => String((h._source as any)?.id) === target);
  if (hit) return hit._id;
  // Fall back: encoded public id may differ from raw id (entityIdStrategy).
  const hit2 = res.hits.hits.find((h) => String((h._source as any)?.id).endsWith(target));
  return hit2?._id;
}

describe('Marketplace convergence / recovery (3D.1b Step 9)', () => {
  const d = MARKETPLACE_E2E ? describe : describe.skip;

  let tenantA: { channelId: string; channelToken: string; email: string };
  let indexer: MarketplaceIndexerService;
  let baseline: MarketplaceBaselineService;
  let ctx: RequestContext;
  let v1 = 0;
  let v2 = 0;
  // 3 eligible (PUBLIC + SCHEDULED) + 1 ineligible (PRIVATE)
  let eligibleIds: string[] = [];
  let ineligibleId = '';
  const es = esClient();

  beforeAll(async () => {
    await assertInfrastructure();

    await server.init({
      initialData: E2E_INITIAL_DATA,
      productsCsvPath: path.join(__dirname, '../../tenant-plugin/e2e/fixtures/e2e-products.csv'),
      customerCount: 2,
    });

    indexer = server.app.get(MarketplaceIndexerService);
    baseline = server.app.get(MarketplaceBaselineService);
    ctx = await baseline.createInternalContext();

    // Register tenant + org + trainer, then create 4 sessions at the entity
    // level (no event path needed: globalReindex reads the PG population).
    const emailA = `conv-a-${Date.now()}@example.com`;
    shopClient.setChannelToken(E2E_DEFAULT_CHANNEL_TOKEN);
    const resA = await shopClient.query(REGISTER_NEW_TENANT, {
      input: {
        businessName: 'E2E Convergence Academy',
        firstName: 'Con',
        lastName: 'Vergence',
        emailAddress: emailA,
        password: 'StrongP@ss1',
        contactEmail: 'conv@e2e.example.com',
        timezone: 'Asia/Kolkata',
      },
    });
    tenantA = {
      channelId: resA.registerNewTenant.channelId,
      channelToken: resA.registerNewTenant.channelToken,
      email: emailA,
    };

    adminClient.setChannelToken(tenantA.channelToken);
    await adminClient.asUserWithCredentials(tenantA.email, 'StrongP@ss1');
    const org = await adminClient.query(CREATE_ORG, {
      input: { channelId: tenantA.channelId, slug: 'e2e-convergence', name: 'E2E Convergence Org' },
    });
    const trainer = await adminClient.query(CREATE_CUSTOMER, {
      input: {
        firstName: 'Con',
        lastName: 'Trainer',
        emailAddress: `conv-trainer-${Date.now()}@example.com`,
      },
    });
    const member = await adminClient.query(ADD_MEMBER, {
      input: {
        organizationId: org.createBbbOrganization.id,
        customerId: trainer.createCustomer.id,
        role: 'org-admin',
      },
    });
    const trainerId = member.addBbbMember.customerId;

    const sessionIds: string[] = [];
    for (let i = 1; i <= 4; i++) {
      const s = await adminClient.query(CREATE_SESSION, {
        input: {
          organizationId: org.createBbbOrganization.id,
          title: `E2E Convergence Session ${i}`,
          startTime: new Date(Date.now() + 86400_000).toISOString(),
          endTime: new Date(Date.now() + 90000_000).toISOString(),
          trainerId,
          subjectTags: ['convergence'],
        },
      });
      sessionIds.push(s.createBbbScheduledSession.id);
    }

    // Sessions 1–3 eligible (PUBLIC + SCHEDULED); session 4 stays PRIVATE.
    const connection = server.app.get(TransactionalConnection);
    const sessionRepo = connection.rawConnection.getRepository(BbbScheduledSession);
    const toPk = (id: string) => parseInt(String(id).replace(/^T_/, ''), 10);
    await sessionRepo.update(
      { id: In(sessionIds.slice(0, 3).map(toPk)) },
      { visibility: 'PUBLIC' },
    );
    eligibleIds = sessionIds.slice(0, 3);
    ineligibleId = sessionIds[3];
  }, 180_000);

  afterAll(async () => {
    await server.destroy();
    try {
      await es.indices.delete({ index: 'e2e_convergence_*', ignore_unavailable: true });
    } catch {
      // cleanup is best-effort
    }
  });

  d('full convergence', () => {
    it('refresh commits V1, global reindex converges all eligible sessions (stale = 0)', async () => {
      const result = await baseline.refreshBaseline(ctx, 'gen-conv-1');
      expect(result.status).toBe('committed');
      v1 = result.baselineVersion;
      expect(v1).toBeGreaterThan(0);

      await indexer.globalReindex(v1, ctx);
      await refreshIndex(es);

      const report = await indexer.measureConvergence(v1, ctx);
      expect(report.total).toBe(3);
      expect(report.converged).toBe(3);
      expect(report.stale).toBe(0);

      for (const sid of eligibleIds) {
        const docId = await findDocId(es, sid);
        expect(docId).toBeDefined();
        const doc = await es.get({ index: SESSIONS_INDEX, id: docId! });
        expect((doc._source as any).baselineVersion).toBe(v1);
      }
    });
  });

  d('stale / missing / ineligible accounting', () => {
    it('a missing ES doc for an eligible PG session counts as stale and self-heals on re-run', async () => {
      // Intentionally de-converge: delete one eligible session's doc.
      const victim = eligibleIds[1];
      const docId = await findDocId(es, victim);
      expect(docId).toBeDefined();
      await es.delete({ index: SESSIONS_INDEX, id: docId! });
      await refreshIndex(es);

      let report = await indexer.measureConvergence(v1, ctx);
      expect(report).toEqual({ total: 3, converged: 2, stale: 1 });

      // Self-healing: re-running the same target version reaches stale = 0.
      await indexer.globalReindex(v1, ctx);
      await refreshIndex(es);
      report = await indexer.measureConvergence(v1, ctx);
      expect(report).toEqual({ total: 3, converged: 3, stale: 0 });
    });

    it('an ineligible session doc does not inflate total', async () => {
      // Plant an ES doc for the PRIVATE session directly (clone a real doc).
      const templateRes = await es.search({ index: SESSIONS_INDEX, size: 1 });
      const template = templateRes.hits.hits[0]?._source as any;
      expect(template).toBeDefined();
      await es.index({
        index: SESSIONS_INDEX,
        id: 'e2e-stray-ineligible',
        document: { ...template, id: ineligibleId, title: 'E2E Stray Ineligible' },
      });
      await refreshIndex(es);

      const report = await indexer.measureConvergence(v1, ctx);
      expect(report.total).toBe(3);
      expect(report.converged).toBe(3);

      await es.delete({ index: SESSIONS_INDEX, id: 'e2e-stray-ineligible' });
      await refreshIndex(es);
    });
  });

  d('supersession', () => {
    it('a stale target-version reindex aborts; the new version converges', async () => {
      const result = await baseline.refreshBaseline(ctx, 'gen-conv-2');
      expect(result.status).toBe('committed');
      v2 = result.baselineVersion;
      expect(v2).toBe(v1 + 1);

      // De-converge one doc, then attempt the now-stale V1 reindex.
      const victim = eligibleIds[2];
      const docId = await findDocId(es, victim);
      await es.delete({ index: SESSIONS_INDEX, id: docId! });
      await refreshIndex(es);

      await indexer.globalReindex(v1, ctx);
      await refreshIndex(es);

      // V1 is no longer authoritative: its reindex must not have written.
      // The two pre-existing V1 docs remain, but the deleted one was NOT repaired.
      const staleReport = await indexer.measureConvergence(v1, ctx);
      expect(staleReport.converged).toBe(2);
      expect(staleReport.total).toBe(3);

      // The new generation's reindex converges everything to V2.
      await indexer.globalReindex(v2, ctx);
      await refreshIndex(es);
      const report = await indexer.measureConvergence(v2, ctx);
      expect(report).toEqual({ total: 3, converged: 3, stale: 0 });
    });
  });
});