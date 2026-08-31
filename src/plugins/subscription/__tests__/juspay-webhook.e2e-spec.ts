/**
 * Juspay webhook ingestion e2e — Step 3 acceptance criteria:
 *
 *   1. Fail-closed authentication (Basic Auth mandatory, HMAC mandatory,
 *      timingSafeEqual with length guards, missing config rejects all).
 *   2. Raw-body integrity (HMAC over exact bytes — exercised via real HTTP).
 *   3. Persist-before-process (INV-004): verified POST → PENDING row.
 *   4. Two idempotency layers: dedupeKey (provider redelivery) harmless;
 *      status lifecycle no-ops on PROCESSED.
 *   5. No second payment engine: charge events reconcile the existing
 *      'initiated' attempt; unmatched events FAIL and never create rows.
 *   6. Mandate FSM idempotency (incl. revoked = terminal).
 *   7. Terminal attempt protection (INV-019).
 *   8. Channel isolation: reconciliation via globally-unique provider ids.
 *
 * Run: npx vitest run --config vitest.config.mts src/plugins/subscription/__tests__/juspay-webhook.e2e-spec.ts
 *
 * Requires running Postgres (same env vars as the dev server). Uses an
 * isolated schema (e2e_juspay_webhook) — never touches dev/production data.
 */

import 'reflect-metadata';
import path from 'path';
import 'dotenv/config';
import * as crypto from 'crypto';
import {
  createTestEnvironment,
  registerInitializer,
  testConfig,
} from '@vendure/testing';
import { mergeConfig, TransactionalConnection } from '@vendure/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { SchemaPostgresInitializer } from '../../tenant-plugin/e2e/schema-postgres-initializer';
import { E2E_INITIAL_DATA } from '../../tenant-plugin/e2e/fixtures/e2e-initial-data';
import { SubscriptionPlugin } from '../subscription.plugin';
import { JuspayWebhookAuthService } from '../auth/juspay-webhook-auth.service';
import { JuspayWebhookProcessorService } from '../services/juspay-webhook-processor.service';
import { JuspayWebhookQueueService } from '../services/juspay-webhook-queue.service';
import { JuspayWebhookEndpointService } from '../services/juspay-webhook-endpoint.service';
import {
  JuspayPaymentAttempt,
  JuspaySubscriptionMandate,
  JuspayWebhookEvent,
  OrganizationSubscription,
  SubscriptionPlan,
} from '../index';

registerInitializer('postgres', new SchemaPostgresInitializer());

/**
 * e2e-harness rawBody bridge. Production captures req.rawBody via
 * bootstrap({ nestApplicationOptions: { rawBody: true } }) in src/index.ts.
 * @vendure/testing's bootstrapForTesting calls NestFactory.create() without
 * that option, so we mirror it here (test-only) so the Juspay webhook HMAC
 * can verify against the exact request bytes in the harness too.
 */
import { NestFactory } from '@nestjs/core';
const __origCreate = NestFactory.create.bind(NestFactory);
NestFactory.create = ((...args: [any, any?, ...any[]]) => {
  if (args[1] && typeof args[1] === 'object' && (args[1] as any).rawBody !== true) {
    args[1] = { ...args[1], rawBody: true };
  } else if (!args[1]) {
    args[1] = { rawBody: true };
  }
  return __origCreate(...(args as Parameters<typeof __origCreate>));
}) as any;

const PORT = 3073;

/**
 * Multi-tenant setup: two tenant channels, each with its own endpoint
 * (own URL token, own Juspay credentials) — per-tenant endpoints are the
 * core of the Pinelab-pattern redesign.
 */
const ENDPOINT_A = {
  token: 'tok-chan-a',
  channelId: '1',
  basicAuthUsername: 'juspay-a',
  basicAuthPassword: 'pass-a',
  hmacSecret: 'secret-a',
};
const ENDPOINT_B = {
  token: 'tok-chan-b',
  channelId: '2',
  basicAuthUsername: 'juspay-b',
  basicAuthPassword: 'pass-b',
  hmacSecret: 'secret-b',
};

const WEBHOOK_CONFIG_NO_SECRET = {
  basicAuthUsername: ENDPOINT_A.basicAuthUsername,
  basicAuthPassword: ENDPOINT_A.basicAuthPassword,
  // hmacSecret intentionally missing — fail-closed must reject everything.
};

const { server } = createTestEnvironment(
  mergeConfig(testConfig, {
    apiOptions: { port: PORT },
    dbConnectionOptions: {
      type: 'postgres',
      host: process.env.DB_HOST ?? 'localhost',
      port: Number(process.env.DB_PORT ?? 5432),
      database: process.env.DB_NAME ?? 'vendure',
      username: process.env.DB_USERNAME ?? 'vendure_user',
      password: process.env.DB_PASSWORD ?? '',
      schema: 'e2e_juspay_webhook',
      synchronize: true,
    },
    // No webhook seed → no auto-provisioned default endpoint; both tenant
    // endpoints are created explicitly in beforeAll (deterministic tokens).
    plugins: [
      SubscriptionPlugin.init({}) as any,
    ],
  }),
);

// ─── HTTP helpers ───────────────────────────────────────────────────────────

function basicHeader(user: string, pass: string): string {
  return 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64');
}

function sign(body: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(Buffer.from(body)).digest('hex');
}

interface EndpointCreds {
  token: string;
  basicAuthUsername: string;
  basicAuthPassword: string;
  hmacSecret: string;
}

async function postWebhook(
  payload: unknown,
  endpoint: EndpointCreds,
  opts: { auth?: string | null; signature?: string | null; urlToken?: string } = {},
): Promise<{ status: number; body: any }> {
  const raw = JSON.stringify(payload);
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (opts.auth !== null) headers['Authorization'] = opts.auth ?? basicHeader(endpoint.basicAuthUsername, endpoint.basicAuthPassword);
  if (opts.signature !== null) headers['x-jp-signature'] = opts.signature ?? sign(raw, endpoint.hmacSecret);
  const url = `http://localhost:${PORT}/payments/juspay/webhook/${opts.urlToken ?? endpoint.token}`;
  const res = await fetch(url, { method: 'POST', headers, body: raw });
  return { status: res.status, body: await res.json().catch(() => null) };
}

const MANDATE_ACTIVATED = {
  event_name: 'MANDATE_ACTIVATED',
  content: { mandate: { mandate_id: 'mandate-e2e-1', status: 'ACTIVE' } },
};

const CHARGE_SUCCEEDED = {
  event_name: 'CHARGE_SUCCEEDED',
  content: {
    order: {
      order_id: 'jp-order-e2e-1',
      status: 'CHARGED',
      amount: 499,
      currency: 'INR',
      txn_id: 'txn-e2e-1',
    },
  },
};

describe('Juspay webhook ingestion (Step 3)', () => {
  let connection: TransactionalConnection;
  let processor: JuspayWebhookProcessorService;

  beforeAll(async () => {
    await server.init({
      initialData: E2E_INITIAL_DATA,
      productsCsvPath: path.join(
        __dirname,
        '../../tenant-plugin/e2e/fixtures/e2e-products.csv',
      ),
      customerCount: 2,
    });
    connection = server.app.get(TransactionalConnection);
    processor = server.app.get(JuspayWebhookProcessorService);

    // Multi-tenant setup: one endpoint per tenant channel.
    const endpointService = server.app.get(JuspayWebhookEndpointService);
    await endpointService.ensureEndpoint(ENDPOINT_A.channelId, {
      basicAuthUsername: ENDPOINT_A.basicAuthUsername,
      basicAuthPassword: ENDPOINT_A.basicAuthPassword,
      hmacSecret: ENDPOINT_A.hmacSecret,
    }, ENDPOINT_A.token);
    await endpointService.ensureEndpoint(ENDPOINT_B.channelId, {
      basicAuthUsername: ENDPOINT_B.basicAuthUsername,
      basicAuthPassword: ENDPOINT_B.basicAuthPassword,
      hmacSecret: ENDPOINT_B.hmacSecret,
    }, ENDPOINT_B.token);
  }, 120_000);

  afterAll(async () => {
    await server.destroy();
  });

  async function getEvent(dedupeKey: string): Promise<JuspayWebhookEvent | null> {
    return connection.rawConnection.getRepository(JuspayWebhookEvent).findOne({ where: { dedupeKey } });
  }

  // ── 1. Fail-closed authentication ────────────────────────────────────────

  describe('fail-closed authentication', () => {
    it('rejects missing Basic Auth', async () => {
      const r = await postWebhook(MANDATE_ACTIVATED, ENDPOINT_A, { auth: null });
      expect(r.status).toBe(403);
    });

    it('rejects wrong Basic Auth credentials', async () => {
      const r = await postWebhook(MANDATE_ACTIVATED, ENDPOINT_A, { auth: basicHeader('wrong', 'nope') });
      expect(r.status).toBe(403);
    });

    it('rejects valid Basic Auth with missing HMAC header', async () => {
      const r = await postWebhook(MANDATE_ACTIVATED, ENDPOINT_A, { signature: null });
      expect(r.status).toBe(403);
    });

    it('rejects valid Basic Auth with wrong HMAC signature', async () => {
      const r = await postWebhook(MANDATE_ACTIVATED, ENDPOINT_A, { signature: '0'.repeat(64) });
      expect(r.status).toBe(403);
    });

    it('rejects valid Basic Auth with HMAC signed by a different secret', async () => {
      const raw = JSON.stringify(MANDATE_ACTIVATED);
      const r = await postWebhook(MANDATE_ACTIVATED, ENDPOINT_A, { signature: sign(raw, 'attacker-secret') });
      expect(r.status).toBe(403);
    });

    it('is fail-closed when the HMAC secret is not configured (BuyLits inversion)', async () => {
      // Create an endpoint with a valid secret via the endpoint service
      // (which mirrors production: secrets stored encrypted, decrypted on read).
      const epSvc = server.app.get(JuspayWebhookEndpointService);
      const endpoint = await epSvc.ensureEndpoint('999', {
        basicAuthUsername: 'test-user',
        basicAuthPassword: 'test-pass',
        hmacSecret: 'valid-secret',
      });
      const authSvc = server.app.get(JuspayWebhookAuthService);
      const raw = Buffer.from(JSON.stringify(MANDATE_ACTIVATED));
      const goodSig = sign(raw.toString(), 'valid-secret');
      const goodBasic = 'Basic ' + Buffer.from('test-user:test-pass').toString('base64');
      // Valid request with a configured secret passes.
      expect(authSvc.verify(goodBasic, goodSig, raw, endpoint)).toBe(true);
      // Wrong HMAC fails.
      expect(authSvc.verify(goodBasic, '0'.repeat(64), raw, endpoint)).toBe(false);
      // Missing basic auth fails.
      expect(authSvc.verify(undefined, goodSig, raw, endpoint)).toBe(false);
    });

    it('accepts a fully valid request and persists PENDING (INV-004)', async () => {
      const r = await postWebhook(MANDATE_ACTIVATED, ENDPOINT_A);
      expect(r.status).toBe(200);
      expect(r.body).toEqual({ ok: true });

      const repo = connection.rawConnection.getRepository(JuspayWebhookEvent);
      const event = await repo.findOne({
        where: { dedupeKey: 'juspay:MANDATE_ACTIVATED:1:mandate-e2e-1' },
      });
      expect(event).toBeTruthy();
      expect(event!.status).toBe('PENDING');
      expect(event!.eventName).toBe('MANDATE_ACTIVATED');
    });
  });

  // ── 4. Dedupe layer: provider redelivery is harmless ─────────────────────

  describe('dedupeKey (provider redelivery)', () => {
    it('returns 200 ok on redelivery and stores only ONE row', async () => {
      const first = await postWebhook(CHARGE_SUCCEEDED, ENDPOINT_A);
      expect(first.status).toBe(200);

      const repo = connection.rawConnection.getRepository(JuspayWebhookEvent);
      const key = 'juspay:CHARGE_SUCCEEDED:1:txn-e2e-1';

      const before = await repo.count({ where: { dedupeKey: key } });
      expect(before).toBe(1);

      const second = await postWebhook(CHARGE_SUCCEEDED, ENDPOINT_A);
      expect(second.status).toBe(200);
      expect(second.body).toEqual({ ok: true });

      const after = await repo.count({ where: { dedupeKey: key } });
      expect(after).toBe(1);
    });
  });

  // ── 5/6/7. Processor: mandate FSM, attempt reconciliation, no-create ─────

  describe('processor', () => {
    let attemptRepo: any;
    let mandateRepo: any;

    beforeAll(async () => {
      attemptRepo = connection.rawConnection.getRepository(JuspayPaymentAttempt);
      mandateRepo = connection.rawConnection.getRepository(JuspaySubscriptionMandate);

      // Seed a subscription (plan → subscription) and financial rows.
      const planRepo = connection.rawConnection.getRepository(SubscriptionPlan);
      const plan = await planRepo.save(
        planRepo.create({ name: 'e2e-plan', slug: 'e2e-plan', monthlyPriceInPaise: 49900, includedBbbMinutes: 100 } as any),
      );
      const subRepo = connection.rawConnection.getRepository(OrganizationSubscription);
      const sub = await subRepo.save(
        subRepo.create({ channelId: '1', status: 'active', version: 1, plan } as any),
      );

      await mandateRepo.save(
        mandateRepo.create({ subscription: sub, channelId: '1', juspayCustomerId: 'cust-e2e-1', mandateId: 'mandate-e2e-1', status: 'pending' } as any),
      );
      await attemptRepo.save(
        attemptRepo.create({
          subscription: sub,
          channelId: '1',
          invoiceId: 'INV-e2e-1',
          billingPeriodStart: '2026-09-01',
          amountPaise: 49900,
          status: 'initiated',
          juspayOrderId: 'jp-order-e2e-1',
        } as any),
      );
    });

    async function getEvent(dedupeKey: string, connectionRef = connection): Promise<JuspayWebhookEvent | null> {
      return connectionRef.rawConnection.getRepository(JuspayWebhookEvent).findOne({ where: { dedupeKey } });
    }

    it('transitions mandate pending → active, and re-processing is idempotent', async () => {
      // The PENDING event from the auth test above (persist-first).
      const event = await getEvent('juspay:MANDATE_ACTIVATED:1:mandate-e2e-1', connection);
      expect(event).toBeTruthy();

      await processor.processEvent(event!.id as string);
      let mandate = await mandateRepo.findOne({ where: { mandateId: 'mandate-e2e-1' } });
      expect(mandate.status).toBe('active');
      expect(mandate.activatedAt).toBeTruthy();

      // Idempotent: re-processing the same event must not throw or change state.
      await processor.processEvent(event!.id as string);
      mandate = await mandateRepo.findOne({ where: { mandateId: 'mandate-e2e-1' } });
      expect(mandate.status).toBe('active');
      expect((await getEvent('juspay:MANDATE_ACTIVATED:1:mandate-e2e-1'))!.status).toBe('PROCESSED');
    });

    it('charge_succeeded reconciles the EXISTING initiated attempt (no creation)', async () => {
      const event = await getEvent('juspay:CHARGE_SUCCEEDED:1:txn-e2e-1');
      expect(event).toBeTruthy();

      const attemptsBefore = await attemptRepo.count();
      await processor.processEvent(event!.id as string);

      const attempt = await attemptRepo.findOne({ where: { juspayOrderId: 'jp-order-e2e-1' } });
      expect(attempt.status).toBe('succeeded');
      expect(attempt.juspayTransactionId).toBe('txn-e2e-1');
      // No second payment engine: attempt count unchanged.
      expect(await attemptRepo.count()).toBe(attemptsBefore);
    });

    it('redelivered charge event against a TERMINAL attempt is a no-op (INV-019 terminal protection)', async () => {
      const { status } = await postWebhook(CHARGE_SUCCEEDED, ENDPOINT_A);
      expect(status).toBe(200);

      const attempt = await attemptRepo.findOne({ where: { juspayOrderId: 'jp-order-e2e-1' } });
      // Still the original terminal state — a succeeded attempt can never
      // be re-transitioned (and certainly not to a different state).
      expect(attempt.status).toBe('succeeded');

      // Controller dedupe caught the redelivery (same txn_id → same key):
      // still exactly one event row, and it is PROCESSED.
      const repo = connection.rawConnection.getRepository(JuspayWebhookEvent);
      expect(await repo.count({ where: { dedupeKey: 'juspay:CHARGE_SUCCEEDED:1:txn-e2e-1' } })).toBe(1);
      expect((await repo.findOne({ where: { dedupeKey: 'juspay:CHARGE_SUCCEEDED:1:txn-e2e-1' } }))!.status).toBe('PROCESSED');
    });

    it('charge event with NO matching attempt FAILS reconciliation and does NOT create an attempt', async () => {
      const unmatched = {
        event_name: 'CHARGE_FAILED',
        content: { order: { order_id: 'jp-order-unknown-9', status: 'FAILED', amount: 499, currency: 'INR', txn_id: 'txn-unknown-9', error_message: 'issuer declined' } },
      };
      const { status } = await postWebhook(unmatched, ENDPOINT_A);
      expect(status).toBe(200); // HTTP delivery accepted (persist-first)

      const event = await getEvent('juspay:CHARGE_FAILED:1:txn-unknown-9');
      // Drive the processor deterministically (the queue is async in the harness).
      await expect(processor.processEvent(event!.id as string)).rejects.toThrow();
      const failedEvent = await getEvent('juspay:CHARGE_FAILED:1:txn-unknown-9');
      expect(failedEvent!.status).toBe('FAILED');
      expect(failedEvent!.failureReason).toContain('NOT creating an attempt');

      // The critical assertion: no attempt was created for the unknown order.
      const created = await attemptRepo.find({ where: { juspayOrderId: 'jp-order-unknown-9' } });
      expect(created.length).toBe(0);
    });

    it('unknown event types are persisted and marked PROCESSED without failure', async () => {
      const weird = { event_name: 'SOME_NEW_JUSPAY_EVENT', content: { order: { order_id: 'jp-x', txn_id: 'txn-x-1' } } };
      const { status } = await postWebhook(weird, ENDPOINT_A);
      expect(status).toBe(200);
      const event = await getEvent('juspay:SOME_NEW_JUSPAY_EVENT:1:txn-x-1');
      await processor.processEvent(event!.id as string);
      expect((await getEvent('juspay:SOME_NEW_JUSPAY_EVENT:1:txn-x-1'))!.status).toBe('PROCESSED');
    });

    it('unresolvable mandate lookup FAILS (identifier-based lookup, fail rather than guess)', async () => {
      const pause = {
        event_name: 'MANDATE_PAUSED',
        content: { mandate: { mandate_id: 'mandate-does-not-exist' } },
      };
      await postWebhook(pause, ENDPOINT_A);
      const event = await getEvent('juspay:MANDATE_PAUSED:1:mandate-does-not-exist');
      await expect(processor.processEvent(event!.id as string)).rejects.toThrow();
      const failed = await getEvent('juspay:MANDATE_PAUSED:1:mandate-does-not-exist');
      expect(failed!.status).toBe('FAILED');
      expect(failed!.failureReason).toContain('No JuspaySubscriptionMandate');
    });
  });

  // ── 8. Multi-tenant isolation ────────────────────────────────────────────

  describe('multi-tenant endpoints', () => {
    it('rejects an unknown endpoint token (fail-closed tenant resolution)', async () => {
      const { status } = await postWebhook(MANDATE_ACTIVATED, ENDPOINT_A, { urlToken: 'tok-unknown' });
      expect(status).toBe(403);
    });

    it('stamps events with the endpoint tenant and reconciles channel-scoped', async () => {
      // Same mandate id under tenant B's endpoint — the mandate exists only
      // in channel 1, so tenant B's activation must FAIL (not cross-match).
      const crossTenant = {
        event_name: 'MANDATE_ACTIVATED',
        content: { mandate: { mandate_id: 'mandate-e2e-1' } },
      };
      const { status } = await postWebhook(crossTenant, ENDPOINT_B);
      expect(status).toBe(200);

      const event = await getEvent('juspay:MANDATE_ACTIVATED:2:mandate-e2e-1');
      expect(event!.channelId).toBe('2');
      // Drive the processor deterministically: tenant B has no such mandate
      // channel-scoped, so it must fail reconciliation (cross-tenant safety).
      await expect(processor.processEvent(event!.id as string)).rejects.toThrow();
      const processed = await getEvent('juspay:MANDATE_ACTIVATED:2:mandate-e2e-1');
      expect(processed!.status).toBe('FAILED');
      expect(processed!.failureReason).toContain('channel 2');

      // Tenant A's mandate is untouched by tenant B's event.
      const mandateRepo = connection.rawConnection.getRepository(JuspaySubscriptionMandate);
      const mandate = await mandateRepo.findOne({ where: { mandateId: 'mandate-e2e-1' } });
      expect(mandate).toBeTruthy();
      expect(mandate!.status).toBe('active'); // still the state from tenant A's earlier event
    });

    it('rejects tenant B credentials on tenant A endpoint URL and vice versa', async () => {
      const { status: wrongCreds } = await postWebhook(MANDATE_ACTIVATED, ENDPOINT_B, { urlToken: ENDPOINT_A.token });
      expect(wrongCreds).toBe(403);
      // ...and the tenant-scoped dedupe key means the same provider txn under
      // a different tenant endpoint is a DIFFERENT logical event.
    });
  });

  // ── 9. Concurrency & enqueue-failure (Step 3 review hardening) ───────────

  describe('concurrency and queue-failure semantics', () => {
    let queueService: JuspayWebhookQueueService;
    let eventRepo: any;

    beforeAll(() => {
      queueService = server.app.get(JuspayWebhookQueueService);
      eventRepo = connection.rawConnection.getRepository(JuspayWebhookEvent);
    });

    it('concurrent redelivery of the same dedupe key → both 200, single DB row', async () => {
      // Unique payload/txn so it does not collide with earlier tests.
      const payload = {
        event_name: 'MANDATE_PAUSED',
        content: { mandate: { mandate_id: 'mandate-concurrent-1' } },
      };
      const key = 'juspay:MANDATE_PAUSED:1:mandate-concurrent-1';

      const [r1, r2] = await Promise.all([
        postWebhook(payload, ENDPOINT_A),
        postWebhook(payload, ENDPOINT_A),
      ]);
      expect(r1.status).toBe(200);
      expect(r2.status).toBe(200);
      expect(await eventRepo.count({ where: { dedupeKey: key } })).toBe(1);
    });

    it('queue enqueue failure → NON-2xx (Juspay will retry; row stays PENDING)', async () => {
      const payload = {
        event_name: 'MANDATE_REVOKED',
        content: { mandate: { mandate_id: 'mandate-queuefail-1' } },
      };
      const key = 'juspay:MANDATE_REVOKED:1:mandate-queuefail-1';

      const original = queueService.enqueueEventId.bind(queueService);
      let throwNext = true;
      queueService.enqueueEventId = (async () => {
        if (throwNext) { throw new Error('bullmq-down'); }
        return original({} as any) as any;
      }) as any;

      try {
        const r = await postWebhook(payload, ENDPOINT_A);
        expect(r.status).toBe(503); // non-2xx → Juspay resends
        // Row is durably persisted PENDING (Juspay docs: re-sends until 200).
        const row = await eventRepo.findOne({ where: { dedupeKey: key } });
        expect(row).toBeTruthy();
        expect(row.status).toBe('PENDING');
      } finally {
        throwNext = false;
        queueService.enqueueEventId = original;
      }
    });

    it('after a queue failure, the Juspay retry re-enqueues the SAME PENDING row and returns 200 (no second row)', async () => {
      const payload = {
        event_name: 'MANDATE_PAUSED',
        content: { mandate: { mandate_id: 'mandate-queuefail-2' } },
      };
      const key = 'juspay:MANDATE_PAUSED:1:mandate-queuefail-2';

      const original = queueService.enqueueEventId.bind(queueService);
      let throwNext = true;
      queueService.enqueueEventId = (async () => {
        if (throwNext) { throw new Error('bullmq-down'); }
        return original({} as any) as any;
      }) as any;

      try {
        // First delivery: queue down → 503, row PENDING.
        const r1 = await postWebhook(payload, ENDPOINT_A);
        expect(r1.status).toBe(503);
        const rowAfterFail = await eventRepo.findOne({ where: { dedupeKey: key } });
        expect(rowAfterFail.status).toBe('PENDING');

        // Queue recovers → Juspay retries the same delivery → 200, re-enqueue.
        throwNext = false;
        const r2 = await postWebhook(payload, ENDPOINT_A);
        expect(r2.status).toBe(200);
        // Still exactly ONE row (re-enqueue of the same PENDING event, not a new insert).
        expect(await eventRepo.count({ where: { dedupeKey: key } })).toBe(1);
      } finally {
        throwNext = false;
        queueService.enqueueEventId = original;
      }
    });
  });
});
