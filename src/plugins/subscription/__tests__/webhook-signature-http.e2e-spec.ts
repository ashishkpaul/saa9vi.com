/**
 * ADR-044 acceptance — signed webhook delivery over HTTP (`x-razorpay-signature`).
 *
 * Why this suite exists
 * ---------------------
 * The sibling suites (`webhook-enqueue-failure-recovery`, `webhook-failure-path`,
 * `webhook-concurrent-idempotency`, `webhook-halted-state`) all call
 * `RazorpayWebhookController.handleWebhook(signature, eventId, payload, reqStub)`
 * **in-process**. That covers the controller's logic, but it structurally cannot
 * cover four things that decide whether a real Razorpay delivery is accepted:
 *
 *   1. Nest's route mapping (`@Controller('payments/razorpay')` +
 *      `@Post('webhook')`) — is the endpoint actually reachable at
 *      `POST /payments/razorpay/webhook`?
 *   2. `@Headers('x-razorpay-signature')` / `@Headers('x-razorpay-event-id')`
 *      binding — an in-process call passes arguments positionally, so a renamed
 *      or misspelled header would keep every sibling suite green while making
 *      production fail closed on every delivery.
 *   3. `rawBody` capture (`nestApplicationOptions.rawBody: true` in `src/index.ts`).
 *      HMAC-SHA256 is byte-exact: if the JSON body parser re-serialized the
 *      payload (key order, whitespace, unicode escaping), every authentic
 *      webhook would 401 in production and nothing else would notice.
 *   4. The HTTP status code Razorpay's retry policy keys on. The controller
 *      declares no `@HttpCode`, so a successful delivery is **201** — the value
 *      recorded in the C-1-A runtime evidence. A future `@HttpCode(200)` is not
 *      a regression, but a non-2xx is.
 *
 * ADR-044 decision 3 keeps `markCancelledFromWebhook()` as the
 * provider-confirmation bridge for provider-initiated cancellations, and
 * ADR-039's lifecycle is driven entirely by these deliveries — so "a correctly
 * signed POST is accepted, everything else is rejected 401 without side
 * effects" is an acceptance criterion of the local plan-change/cancellation
 * capability, not an implementation detail. INV-004 (persist-before-process)
 * is asserted here on the real ingress path rather than on a stubbed `req`.
 *
 * Run: DB_PORT=5432 npx vitest run --config vitest.config.mts \
 *        src/plugins/subscription/__tests__/webhook-signature-http.e2e-spec.ts
 */

import 'reflect-metadata';
import path from 'path';
import 'dotenv/config';
import crypto from 'crypto';
import {
  createTestEnvironment,
  registerInitializer,
  testConfig,
} from '@vendure/testing';
import { startOnFreePort } from '../../../test-utils/free-port';
import { mergeConfig, TransactionalConnection } from '@vendure/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NestFactory } from '@nestjs/core';

import { SchemaPostgresInitializer } from '../../tenant-plugin/e2e/schema-postgres-initializer';
import { E2E_INITIAL_DATA } from '../../tenant-plugin/e2e/fixtures/e2e-initial-data';
import { SubscriptionPlugin } from '../subscription.plugin';
import { ProviderWebhookEvent } from '../entities/provider-webhook-event.entity';
import { ProviderWebhookQueueService } from '../services/provider-webhook-queue.service';
import { RazorpayWebhookVerifier } from '../providers/razorpay/razorpay-webhook.verifier';

registerInitializer('postgres', new SchemaPostgresInitializer());

// Mirror production rawBody capture in the e2e harness. Without this the JSON
// parser does not populate `req.rawBody`, the controller throws "Raw body not
// available", and the signature path can never be exercised over HTTP.
// (`src/index.ts` passes the same flag via `nestApplicationOptions`.)
const __origCreate = NestFactory.create.bind(NestFactory);
(NestFactory as any).create = ((...args: [any, any?, ...any[]]) => {
  if (args[1] && typeof args[1] === 'object' && (args[1] as any).rawBody !== true) {
    args[1] = { ...args[1], rawBody: true };
  } else if (!args[1]) {
    args[1] = { rawBody: true };
  }
  return __origCreate(...(args as Parameters<typeof __origCreate>));
}) as any;

// Allocated by startOnFreePort() in beforeAll (test-utils/free-port).
let PORT = 0;
const WEBHOOK_SECRET = 'e2e-signature-http-secret';
// Rebuilt in beforeAll once PORT is allocated.
let WEBHOOK_PATH = '';

const { server, adminClient, shopClient } = createTestEnvironment(
  mergeConfig(testConfig, {
    apiOptions: { port: PORT },
    dbConnectionOptions: {
      type: 'postgres',
      host: process.env.DB_HOST ?? 'localhost',
      port: Number(process.env.DB_PORT ?? 5432),
      database: process.env.DB_NAME ?? 'vendure',
      username: process.env.DB_USERNAME ?? 'vendure_user',
      password: process.env.DB_PASSWORD ?? '',
      schema: 'e2e_webhook_signature_http',
      synchronize: true,
    },
    plugins: [SubscriptionPlugin.init({}) as any],
  }),
);

/** HMAC-SHA256 over the exact bytes we put on the wire — the Razorpay scheme. */
function sign(rawBody: string | Buffer, secret = WEBHOOK_SECRET): string {
  return crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
}

interface WebhookHttpResponse {
  status: number;
  json: { status?: string; message?: string };
}

async function postWebhook(
  rawBody: string,
  headers: Record<string, string>,
): Promise<WebhookHttpResponse> {
  const res = await fetch(WEBHOOK_PATH, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: rawBody,
  });
  let json: { status?: string; message?: string } = {};
  try {
    json = (await res.json()) as typeof json;
  } catch {
    // Non-JSON error bodies (e.g. Nest's default 401 payload) are fine — the
    // status code is what this suite asserts for the rejection cases.
  }
  return { status: res.status, json };
}

describe('Signed webhook delivery over HTTP (ADR-044 / INV-004)', () => {
  let connection: TransactionalConnection;
  let queueService: ProviderWebhookQueueService;
  const enqueueCalls: number[] = [];

  const makeBody = (eventId: string) => ({
    entity: 'event',
    event: 'subscription.cancelled',
    contains: ['subscription'],
    payload: {
      subscription: { entity: { id: 'sub_http_signature_test' } },
    },
    _probe: eventId,
  });

  beforeAll(async () => {
    // Must be set BEFORE boot (startOnFreePort → server.init()): the
    // RazorpayWebhookVerifier reads the secret in its constructor, which DI
    // runs during init.
    process.env.RAZORPAY_WEBHOOK_SECRET = WEBHOOK_SECRET;

    PORT = await startOnFreePort({ server, adminClient, shopClient }, {
      initialData: E2E_INITIAL_DATA,
      productsCsvPath: path.join(
        __dirname,
        '../../tenant-plugin/e2e/fixtures/e2e-products.csv',
      ),
      customerCount: 2,
    });
    WEBHOOK_PATH = `http://localhost:${PORT}/payments/razorpay/webhook`;

    connection = server.app.get(TransactionalConnection);
    queueService = server.app.get(ProviderWebhookQueueService);

    // Stub ONLY enqueueWebhookEvent. The in-memory test queue would otherwise
    // run the real processor, which the sibling suites already cover; what this
    // suite asserts is ingress acceptance plus the persist/enqueue hand-off.
    (queueService as any).enqueueWebhookEvent = async (eventId: number) => {
      enqueueCalls.push(eventId);
    };
  }, 30000);

  afterAll(async () => {
    await server.destroy();
  });

  it('accepts a correctly signed delivery: 201, inbox row persisted first (INV-004)', async () => {
    const eventId = 'http-signed-valid-001';
    const rawBody = JSON.stringify(makeBody(eventId));

    const res = await postWebhook(rawBody, {
      'x-razorpay-signature': sign(rawBody),
      'x-razorpay-event-id': eventId,
    });

    // Documented value: the controller declares no `@HttpCode`, so Nest's POST
    // default (201) applies — see the C-1-A runtime evidence.
    expect(res.status).toBe(201);
    expect(res.json).toEqual({ status: 'ok' });

    const repo = connection.rawConnection.getRepository(ProviderWebhookEvent);
    const persisted = await repo.findOne({ where: { providerEventId: eventId } });
    expect(persisted).toBeTruthy();
    expect(persisted!.processingStatus).toBe('pending');
    expect(persisted!.verifiedAt).toBeTruthy();
    expect(persisted!.processedAt).toBeNull();
    // Raw-body fidelity: the stored hash must be over the bytes we signed.
    expect(persisted!.payloadHash).toBe(
      crypto.createHash('sha256').update(rawBody).digest('hex'),
    );

    // Enqueue received the inbox id, never the payload — the INV-004 contract.
    expect(enqueueCalls).toEqual([persisted!.id]);
  });

  it('rejects a tampered body carrying the original signature (401) and writes nothing', async () => {
    const eventId = 'http-tampered-002';
    const rawBody = JSON.stringify(makeBody(eventId));
    const signature = sign(rawBody);
    const tampered = rawBody.replace('sub_http_signature_test', 'sub_attacker_supplied');

    const enqueuesBefore = enqueueCalls.length;
    const res = await postWebhook(tampered, {
      'x-razorpay-signature': signature,
      'x-razorpay-event-id': eventId,
    });

    expect(res.status).toBe(401);

    const repo = connection.rawConnection.getRepository(ProviderWebhookEvent);
    expect(await repo.findOne({ where: { providerEventId: eventId } })).toBeNull();
    expect(enqueueCalls.length).toBe(enqueuesBefore);
  });

  it('rejects a signature computed with a different secret (401)', async () => {
    const eventId = 'http-wrong-secret-003';
    const rawBody = JSON.stringify(makeBody(eventId));

    const res = await postWebhook(rawBody, {
      'x-razorpay-signature': sign(rawBody, 'not-the-configured-secret'),
      'x-razorpay-event-id': eventId,
    });

    expect(res.status).toBe(401);

    const repo = connection.rawConnection.getRepository(ProviderWebhookEvent);
    expect(await repo.findOne({ where: { providerEventId: eventId } })).toBeNull();
  });

  it('rejects a delivery with no signature header (401, fail-closed)', async () => {
    const eventId = 'http-no-signature-004';
    const rawBody = JSON.stringify(makeBody(eventId));

    const res = await postWebhook(rawBody, { 'x-razorpay-event-id': eventId });

    expect(res.status).toBe(401);

    const repo = connection.rawConnection.getRepository(ProviderWebhookEvent);
    expect(await repo.findOne({ where: { providerEventId: eventId } })).toBeNull();
  });

  /**
   * This case is the whole reason the suite goes over HTTP: it proves the
   * `@Headers('x-razorpay-event-id')` binding. An in-process call cannot fail
   * this way, so a header rename would otherwise stay invisible until
   * production — where every delivery would be rejected.
   */
  it('rejects a valid signature with a missing x-razorpay-event-id header (401)', async () => {
    const eventId = 'http-no-event-id-005';
    const rawBody = JSON.stringify(makeBody(eventId));

    const res = await postWebhook(rawBody, {
      'x-razorpay-signature': sign(rawBody),
    });

    expect(res.status).toBe(401);

    const repo = connection.rawConnection.getRepository(ProviderWebhookEvent);
    expect(await repo.findOne({ where: { providerEventId: eventId } })).toBeNull();
  });

  it('re-enqueues a pending duplicate (Razorpay retry) without a second inbox row', async () => {
    const eventId = 'http-duplicate-006';
    const rawBody = JSON.stringify(makeBody(eventId));
    const headers = {
      'x-razorpay-signature': sign(rawBody),
      'x-razorpay-event-id': eventId,
    };

    const first = await postWebhook(rawBody, headers);
    expect(first.status).toBe(201);

    const repo = connection.rawConnection.getRepository(ProviderWebhookEvent);
    const persisted = await repo.findOne({ where: { providerEventId: eventId } });
    expect(persisted).toBeTruthy();
    expect(enqueueCalls[enqueueCalls.length - 1]).toBe(persisted!.id);

    const enqueuesAfterFirst = enqueueCalls.length;
    const retry = await postWebhook(rawBody, headers);
    expect(retry.status).toBe(201);

    // UNIQUE(provider, providerEventId) held: still exactly one row ...
    const all = await repo.find({ where: { providerEventId: eventId } });
    expect(all.length).toBe(1);
    expect(all[0].processingStatus).toBe('pending');
    // ... and the pending duplicate was re-enqueued (V1.3 recovery path).
    expect(enqueueCalls.length).toBe(enqueuesAfterFirst + 1);
    expect(enqueueCalls[enqueueCalls.length - 1]).toBe(persisted!.id);
  });

  it('is fail-closed when the webhook secret is not configured', () => {
    const previous = process.env.RAZORPAY_WEBHOOK_SECRET;
    delete process.env.RAZORPAY_WEBHOOK_SECRET;
    try {
      // Constructed fresh so the constructor reads the now-absent env var.
      const unconfigured = new RazorpayWebhookVerifier({} as any);
      const rawBody = Buffer.from(JSON.stringify(makeBody('http-unconfigured-007')));
      expect(unconfigured.verify(rawBody, sign(rawBody))).toBe(false);
    } finally {
      process.env.RAZORPAY_WEBHOOK_SECRET = previous;
    }
  });

  it('exposes the route for POST only', async () => {
    const res = await fetch(WEBHOOK_PATH, { method: 'GET' });
    // Nest answers 404 (no handler for the method on a matched path) or 405
    // (method not allowed) — either way the ingress is not a readable surface.
    expect([404, 405]).toContain(res.status);
  });
});
