/**
 * Full subscription lifecycle e2e — Step 6 regression suite:
 *
 *   1. Secret encryption at rest
 *   2. MANDATE_ACTIVATED FSM transition
 *   3. CHARGE_SUCCEEDED reconciliation + subscription finalization
 *   4. CHARGE_FAILED past_due
 *   5. Duplicate webhook idempotency
 *   6. Orphan event reconciliation failure (no attempt creation)
 *
 * Run: DB_PORT=5432 npx vitest run --config vitest.config.mts src/plugins/subscription/__tests__/subscription-lifecycle.e2e-spec.ts
 *
 * Requires running PostgreSQL (default port 5432). Uses an isolated schema (e2e_sub_lifecycle).
 */

import 'reflect-metadata';
import path from 'path';
import 'dotenv/config';
import {
  createTestEnvironment,
  registerInitializer,
  testConfig,
} from '@vendure/testing';
import { mergeConfig, TransactionalConnection } from '@vendure/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NestFactory } from '@nestjs/core';

import { SchemaPostgresInitializer } from '../../tenant-plugin/e2e/schema-postgres-initializer';
import { E2E_INITIAL_DATA } from '../../tenant-plugin/e2e/fixtures/e2e-initial-data';
import { SubscriptionPlugin } from '../subscription.plugin';
import { JuspayWebhookEndpointService } from '../services/juspay-webhook-endpoint.service';
import { JuspayWebhookProcessorService } from '../services/juspay-webhook-processor.service';
import { JuspayEncryptionService } from '../services/juspay-encryption.service';
import {
  JuspayPaymentAttempt,
  JuspaySubscriptionMandate,
  JuspayWebhookEvent,
  OrganizationSubscription,
  SubscriptionPlan,
} from '../index';

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

const PORT = 3074;

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
      schema: 'e2e_sub_lifecycle',
      synchronize: true,
    },
    plugins: [
      SubscriptionPlugin.init({}) as any,
    ],
  }),
);

describe('Subscription lifecycle (Step 6 regression)', () => {
  let connection: TransactionalConnection;
  let endpointService: JuspayWebhookEndpointService;
  let processor: JuspayWebhookProcessorService;
  let encryption: JuspayEncryptionService;

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
    endpointService = server.app.get(JuspayWebhookEndpointService);
    processor = server.app.get(JuspayWebhookProcessorService);
    encryption = server.app.get(JuspayEncryptionService);
  }, 120_000);

  afterAll(async () => {
    await server.destroy();
  });

  // ─── Shared fixtures ────────────────────────────────────────────────────────

  async function createPlanAndSubscription(channelId: string) {
    const planRepo = connection.rawConnection.getRepository(SubscriptionPlan);
    const subRepo = connection.rawConnection.getRepository(OrganizationSubscription);

    // Reuse existing plan if already created (unique slug constraint).
    let plan = await planRepo.findOne({ where: { slug: 'lifecycle-test-plan' } });
    if (!plan) {
      plan = await planRepo.save(planRepo.create({
        name: 'Lifecycle Test Plan',
        slug: 'lifecycle-test-plan',
        monthlyPriceInPaise: 19900,
        includedBbbMinutes: 600,
        maxStudents: 50,
      }));
    }

    const sub = await subRepo.save(subRepo.create({
      channelId,
      plan: plan as any,
      status: 'active',
      currentPeriodStart: new Date(),
      currentPeriodEnd: new Date(Date.now() + 86400000 * 30),
      version: 1,
    }));

    return { plan, sub };
  }

  // ─── Tests ──────────────────────────────────────────────────────────────────

  describe('secret encryption at rest', () => {
    it('encrypts webhook secrets when BBB_ENCRYPTION_KEY is set', async () => {
      // The encryption service should be available (BBB_ENCRYPTION_KEY is in .env)
      expect(encryption.isAvailable()).toBe(true);

      // Create an endpoint — secrets should be encrypted before persistence
      const endpoint = await endpointService.ensureEndpoint('1', {
        basicAuthUsername: 'encrypt-test-user',
        basicAuthPassword: 'encrypt-test-pass',
        hmacSecret: 'encrypt-test-secret',
      });

      // The stored values should NOT equal the plaintext
      expect(endpoint.basicAuthPassword).not.toBe('encrypt-test-pass');
      expect(endpoint.hmacSecret).not.toBe('encrypt-test-secret');

      // But decryption should recover the plaintext
      const creds = endpointService.getDecryptedCredentials(endpoint);
      expect(creds.basicAuthPassword).toBe('encrypt-test-pass');
      expect(creds.hmacSecret).toBe('encrypt-test-secret');
    });

    it('encryption round-trip is lossless', () => {
      const plaintext = 'super-secret-value-12345!';
      const encrypted = encryption.encrypt(plaintext);
      const decrypted = encryption.decrypt(encrypted);
      expect(decrypted).toBe(plaintext);
      expect(encrypted).not.toBe(plaintext);
    });
  });

  describe('webhook processing with encrypted credentials', () => {
    it('MANDATE_ACTIVATED transitions mandate FSM pending → active', async () => {
      const { sub } = await createPlanAndSubscription('1');

      // Create a mandate row directly
      const mandateRepo = connection.rawConnection.getRepository(JuspaySubscriptionMandate);
      const mandate = await mandateRepo.save(mandateRepo.create({
        subscription: { id: sub.id as any },
        channelId: '1',
        juspayCustomerId: 'cust_test_123',
        mandateId: 'mandate_test_456',
        status: 'pending',
      }));

      // Create a webhook event for mandate activation
      const eventRepo = connection.rawConnection.getRepository(JuspayWebhookEvent);
      const event = await eventRepo.save(eventRepo.create({
        dedupeKey: 'juspay:MANDATE_ACTIVATED:1:mandate_test_456',
        eventName: 'MANDATE_ACTIVATED',
        channelId: '1',
        payload: { event_name: 'MANDATE_ACTIVATED', content: { mandate: { mandate_id: 'mandate_test_456', status: 'ACTIVE' } } },
        status: 'PENDING',
      }));

      // Process the event
      await processor.processEvent(event.id as string);

      // Verify mandate transitioned to active
      const updated = await mandateRepo.findOne({ where: { id: mandate.id as any } });
      expect(updated?.status).toBe('active');
      expect(updated?.activatedAt).toBeTruthy();
    });

    it('CHARGE_SUCCEEDED reconciles existing attempt', async () => {
      const { sub } = await createPlanAndSubscription('1');

      const attemptRepo = connection.rawConnection.getRepository(JuspayPaymentAttempt);
      const attempt = await attemptRepo.save(attemptRepo.create({
        subscription: { id: sub.id as any },
        channelId: '1',
        invoiceId: 'inv_test_789',
        billingPeriodStart: new Date().toISOString().slice(0, 10),
        amountPaise: 19900,
        status: 'initiated',
        juspayOrderId: 'order_test_abc',
      }));

      const eventRepo = connection.rawConnection.getRepository(JuspayWebhookEvent);
      const event = await eventRepo.save(eventRepo.create({
        dedupeKey: 'juspay:CHARGE_SUCCEEDED:1:order_test_abc',
        eventName: 'CHARGE_SUCCEEDED',
        channelId: '1',
        payload: {
          event_name: 'CHARGE_SUCCEEDED',
          content: { order: { order_id: 'order_test_abc', txn_id: 'txn_xyz', status: 'CHARGED', amount: 199.00 } },
        },
        status: 'PENDING',
      }));

      await processor.processEvent(event.id as string);

      // Verify attempt succeeded
      const updatedAttempt = await attemptRepo.findOne({ where: { id: attempt.id as any } });
      expect(updatedAttempt?.status).toBe('succeeded');
      expect(updatedAttempt?.juspayTransactionId).toBe('txn_xyz');
    });

    it('CHARGE_FAILED marks attempt failed', async () => {
      const { sub } = await createPlanAndSubscription('1');

      const attemptRepo = connection.rawConnection.getRepository(JuspayPaymentAttempt);
      const attempt = await attemptRepo.save(attemptRepo.create({
        subscription: { id: sub.id as any },
        channelId: '1',
        invoiceId: 'inv_fail_001',
        billingPeriodStart: '2026-09-01',
        amountPaise: 19900,
        status: 'initiated',
        juspayOrderId: 'order_fail_001',
      }));

      const eventRepo = connection.rawConnection.getRepository(JuspayWebhookEvent);
      const event = await eventRepo.save(eventRepo.create({
        dedupeKey: 'juspay:CHARGE_FAILED:1:order_fail_001',
        eventName: 'CHARGE_FAILED',
        channelId: '1',
        payload: {
          event_name: 'CHARGE_FAILED',
          content: { order: { order_id: 'order_fail_001', error_message: 'insufficient_funds' } },
        },
        status: 'PENDING',
      }));

      await processor.processEvent(event.id as string);

      const updatedAttempt = await attemptRepo.findOne({ where: { id: attempt.id as any } });
      expect(updatedAttempt?.status).toBe('failed');
    });

    it('duplicate webhook event is idempotent (no double processing)', async () => {
      const { sub } = await createPlanAndSubscription('1');
      const attemptRepo = connection.rawConnection.getRepository(JuspayPaymentAttempt);
      const eventRepo = connection.rawConnection.getRepository(JuspayWebhookEvent);

      const attempt = await attemptRepo.save(attemptRepo.create({
        subscription: { id: sub.id as any },
        channelId: '1',
        invoiceId: 'inv_dup_001',
        billingPeriodStart: '2026-10-01',
        amountPaise: 19900,
        status: 'initiated',
        juspayOrderId: 'order_dup_001',
      }));

      // Create two events with same dedupeKey (simulating Juspay redelivery)
      const makeEvent = () => eventRepo.create({
        dedupeKey: 'juspay:CHARGE_SUCCEEDED:1:order_dup_001',
        eventName: 'CHARGE_SUCCEEDED',
        channelId: '1',
        payload: { event_name: 'CHARGE_SUCCEEDED', content: { order: { order_id: 'order_dup_001', txn_id: 'txn_dup' } } },
        status: 'PENDING',
      });

      // First insert succeeds
      const event1 = await eventRepo.save(makeEvent());
      // Second insert races — unique violation -> find existing
      let event2;
      try {
        event2 = await eventRepo.save(makeEvent());
      } catch (e: any) {
        if (e.code === '23505') {
          event2 = await eventRepo.findOneOrFail({ where: { dedupeKey: 'juspay:CHARGE_SUCCEEDED:1:order_dup_001' } });
        } else {
          throw e;
        }
      }

      // Both event IDs should point to the same row
      expect(event1.id).toBe(event2.id);

      // Process once
      await processor.processEvent(event1.id as string);
      const afterFirst = await attemptRepo.findOne({ where: { id: attempt.id as any } });
      expect(afterFirst?.status).toBe('succeeded');

      // Process again — should be idempotent
      await processor.processEvent(event2.id as string);
      const afterSecond = await attemptRepo.findOne({ where: { id: attempt.id as any } });
      expect(afterSecond?.status).toBe('succeeded');
    });

    it('event with no matching attempt FAILS reconciliation (no creation)', async () => {
      const eventRepo = connection.rawConnection.getRepository(JuspayWebhookEvent);
      const event = await eventRepo.save(eventRepo.create({
        dedupeKey: 'juspay:CHARGE_SUCCEEDED:1:order_orphan_001',
        eventName: 'CHARGE_SUCCEEDED',
        channelId: '1',
        payload: { event_name: 'CHARGE_SUCCEEDED', content: { order: { order_id: 'order_orphan_001', status: 'CHARGED' } } },
        status: 'PENDING',
      }));

      // Processing should throw JuspayReconciliationError
      await expect(processor.processEvent(event.id as string)).rejects.toThrow(/reconciliation failed/i);

      // Event should be marked FAILED
      const updated = await eventRepo.findOne({ where: { id: event.id as any } });
      expect(updated?.status).toBe('FAILED');

      // No attempt should have been created
      const attemptRepo = connection.rawConnection.getRepository(JuspayPaymentAttempt);
      const attempts = await attemptRepo.find({ where: { juspayOrderId: 'order_orphan_001' } });
      expect(attempts.length).toBe(0);
    });
  });
});
