/**
 * Enqueue-failure recovery test (V1 — production hardening):
 *
 * Failure mode: Razorpay delivers a webhook → signature verified → inbox
 * row persisted → BullMQ enqueue FAILS → controller throws (non-2xx) →
 * Razorpay retries → duplicate detected via UNIQUE(provider, providerEventId)
 * → controller must RE-ENQUEUE the pending event before returning 2xx.
 *
 * Without this recovery, the event would remain pending forever with no
 * active queue job ("persist ✅ / enqueue ❌ / retry → ok / never processed ❌").
 *
 * Run: DB_PORT=5432 npx vitest run --config vitest.config.mts src/plugins/subscription/__tests__/webhook-enqueue-failure-recovery.e2e-spec.ts
 */

import 'reflect-metadata';
import path from 'path';
import 'dotenv/config';
import {
  createTestEnvironment,
  registerInitializer,
  testConfig,
} from '@vendure/testing';
import { mergeConfig, TransactionalConnection, RequestContextService } from '@vendure/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NestFactory } from '@nestjs/core';
import crypto from 'crypto';

import { SchemaPostgresInitializer } from '../../tenant-plugin/e2e/schema-postgres-initializer';
import { E2E_INITIAL_DATA } from '../../tenant-plugin/e2e/fixtures/e2e-initial-data';
import { SubscriptionPlugin } from '../subscription.plugin';
import { ProviderWebhookEvent } from '../entities/provider-webhook-event.entity';
import { ProviderWebhookQueueService } from '../services/provider-webhook-queue.service';
import { RazorpayWebhookController } from '../providers/razorpay/razorpay-webhook.controller';
import { RazorpayWebhookVerifier } from '../providers/razorpay/razorpay-webhook.verifier';

registerInitializer('postgres', new SchemaPostgresInitializer());

// Mirror production rawBody capture in the e2e harness
const __origCreate = NestFactory.create.bind(NestFactory);
(NestFactory as any).create = ((...args: [any, any?, ...any[]]) => {
  if (args[1] && typeof args[1] === 'object' && (args[1] as any).rawBody !== true) {
    args[1] = { ...args[1], rawBody: true };
  } else if (!args[1]) {
    args[1] = { rawBody: true };
  }
  return __origCreate(...(args as Parameters<typeof __origCreate>));
}) as any;

const PORT = 3078;
const WEBHOOK_SECRET = 'e2e-recovery-webhook-secret';
const RECOVERY_EVENT_ID = 'test-enqueue-recovery-001';

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
      schema: 'e2e_webhook_recovery',
      synchronize: true,
    },
    plugins: [
      SubscriptionPlugin.init({}) as any,
    ],
  }),
);

describe('Webhook enqueue-failure recovery (V1)', () => {
  let connection: TransactionalConnection;
  let queueService: ProviderWebhookQueueService;
  let controller: RazorpayWebhookController;

  const payload = {
    entity: 'event',
    event: 'subscription.charged',
    subscription: { entity: { id: 'sub_recovery_test' } },
  };
  const rawBody = Buffer.from(JSON.stringify(payload));
  const signature = crypto.createHmac('sha256', WEBHOOK_SECRET).update(rawBody).digest('hex');
  const reqStub = { rawBody } as any;

  /** Queue stub state: records enqueue calls; can fail a chosen call. */
  let enqueueCalls: number[] = [];
  let failOnCall: number | null = null;

  beforeAll(async () => {
    process.env.RAZORPAY_WEBHOOK_SECRET = WEBHOOK_SECRET;
    await server.init({
      initialData: E2E_INITIAL_DATA,
      productsCsvPath: path.join(
        __dirname,
        '../../tenant-plugin/e2e/fixtures/e2e-products.csv',
      ),
      customerCount: 2,
    });
    connection = server.app.get(TransactionalConnection);
    queueService = server.app.get(ProviderWebhookQueueService);
    const requestContextService = server.app.get(RequestContextService);

    // Stub ONLY enqueueWebhookEvent — everything else is real.
    const realQueue = queueService.enqueueWebhookEvent.bind(queueService);
    (queueService as any).enqueueWebhookEvent = async (eventId: number) => {
      enqueueCalls.push(eventId);
      if (failOnCall !== null && enqueueCalls.length === failOnCall) {
        throw new Error('Simulated BullMQ enqueue failure');
      }
      // Never actually run the job in this test — the worker idempotency
      // path is covered by the other specs. Re-enqueue observability is
      // what we assert here.
    };
    void realQueue;

    controller = new RazorpayWebhookController(
      new RazorpayWebhookVerifier({} as any),
      queueService,
      requestContextService,
      connection,
    );
  }, 30000);

  afterAll(async () => {
    await server.destroy();
  });

  it('recovers a pending inbox event when the original enqueue failed', async () => {
    const eventRepo = connection.rawConnection.getRepository(ProviderWebhookEvent);

    // --- Delivery 1: persist succeeds, enqueue FAILS → non-2xx ---
    failOnCall = 1;

    await expect(
      controller.handleWebhook(signature, RECOVERY_EVENT_ID, payload, reqStub),
    ).rejects.toThrow('Simulated BullMQ enqueue failure');

    // Inbox row EXISTS (persist-first guarantee held)
    const persisted = await eventRepo.findOne({ where: { providerEventId: RECOVERY_EVENT_ID } });
    expect(persisted).toBeTruthy();
    expect(persisted!.processingStatus).toBe('pending');
    expect(persisted!.processedAt).toBeNull();
    expect(persisted!.failedAt).toBeNull();

    // --- Razorpay retry: same event ID, duplicate detected ---
    failOnCall = null; // enqueue works on the retry

    const result = await controller.handleWebhook(signature, RECOVERY_EVENT_ID, payload, reqStub);
    expect(result).toEqual({ status: 'ok' });

    // Recovery: the duplicate path re-enqueued the PENDING event
    expect(enqueueCalls.length).toBe(2);
    expect(enqueueCalls[1]).toBe(persisted!.id);

    // Still exactly ONE inbox row (UNIQUE(provider, providerEventId))
    const all = await eventRepo.find({ where: { providerEventId: RECOVERY_EVENT_ID } });
    expect(all.length).toBe(1);
  });

  it('does NOT re-enqueue terminal (failed/processed) events on duplicate delivery', async () => {
    const eventRepo = connection.rawConnection.getRepository(ProviderWebhookEvent);

    const event = await eventRepo.save(eventRepo.create({
      provider: 'razorpay',
      providerEventId: 'test-terminal-002',
      eventType: 'subscription.charged',
      payloadHash: 'recovery-terminal-hash',
      rawPayload: payload,
      verifiedAt: new Date(),
      processingStatus: 'processed',
      processedAt: new Date(),
      failedAt: null,
      attemptCount: 1,
      channelId: null,
    }));

    const callsBefore = enqueueCalls.length;

    const result = await controller.handleWebhook(signature, 'test-terminal-002', payload, reqStub);
    expect(result).toEqual({ status: 'ok' });

    // No new enqueue: already terminal
    expect(enqueueCalls.length).toBe(callsBefore);

    // Exactly one row still
    const all = await eventRepo.find({ where: { providerEventId: 'test-terminal-002' } });
    expect(all.length).toBe(1);
    expect(all[0].processingStatus).toBe('processed');
    void event;
  });
});

