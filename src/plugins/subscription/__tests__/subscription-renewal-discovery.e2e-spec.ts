/**
 * Subscription renewal discovery scan — double-charge window closure.
 *
 * Verifies processRenewals() excludes subscriptions that have an in-flight
 * ("initiated") JuspayPaymentAttempt within the charge abandonment timeout
 * window, preventing the 10-minute scheduled task from re-firing a charge
 * while the webhook for the first attempt is still outstanding.
 *
 * Run: npx vitest run --config vitest.config.mts src/plugins/subscription/__tests__/subscription-renewal-discovery.e2e-spec.ts
 * Requires running Postgres (same env vars as the dev server).
 */

import 'reflect-metadata';
import path from 'path';
import 'dotenv/config';
import { createTestEnvironment, registerInitializer, testConfig } from '@vendure/testing';
import { mergeConfig, TransactionalConnection } from '@vendure/core';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { SchemaPostgresInitializer } from '../../tenant-plugin/e2e/schema-postgres-initializer';
import { E2E_INITIAL_DATA } from '../../tenant-plugin/e2e/fixtures/e2e-initial-data';
import { SubscriptionPlugin } from '../subscription.plugin';
import { SubscriptionRenewalService } from '../services/subscription-renewal.service';
import { SubscriptionRenewalQueueService } from '../services/subscription-renewal-queue.service';
import { JuspayPaymentAttempt, OrganizationSubscription, SubscriptionPlan } from '../index';

registerInitializer('postgres', new SchemaPostgresInitializer());

const { server } = createTestEnvironment(
  mergeConfig(testConfig, {
    apiOptions: { port: 3075 },
    dbConnectionOptions: {
      type: 'postgres',
      host: process.env.DB_HOST ?? 'localhost',
      port: Number(process.env.DB_PORT ?? 5432),
      database: process.env.DB_NAME ?? 'vendure',
      username: process.env.DB_USERNAME ?? 'vendure_user',
      password: process.env.DB_PASSWORD ?? '',
      schema: 'e2e_renewal_discovery',
      synchronize: true,
    },
    plugins: [SubscriptionPlugin.init({}) as any],
  }),
);

describe('Subscription renewal discovery (Step 4)', () => {
  let connection: TransactionalConnection;
  let renewalService: SubscriptionRenewalService;
  let queueService: SubscriptionRenewalQueueService;
  let subRepo: any;
  let planRepo: any;
  let attemptRepo: any;

  beforeAll(async () => {
    await server.init({
      initialData: E2E_INITIAL_DATA,
      productsCsvPath: path.join(
        __dirname,
        '../../tenant-plugin/e2e/fixtures/e2e-products.csv',
      ),
      customerCount: 1,
    });
    connection = server.app.get(TransactionalConnection);
    renewalService = server.app.get(SubscriptionRenewalService);
    queueService = server.app.get(SubscriptionRenewalQueueService);
    subRepo = connection.rawConnection.getRepository(OrganizationSubscription);
    planRepo = connection.rawConnection.getRepository(SubscriptionPlan);
    attemptRepo = connection.rawConnection.getRepository(JuspayPaymentAttempt);
  }, 120_000);

  afterAll(async () => {
    await server.destroy();
  });

  // ─── Helpers ─────────────────────────────────────────────────────────────

  async function seedSubscription(opts: {
    channelId: string;
    status?: 'active' | 'trialing' | 'past_due';
    periodEndOffsetSec?: number;
  }): Promise<OrganizationSubscription> {
    const plan = await planRepo.save(
      planRepo.create({
        name: `plan-${opts.channelId}`,
        slug: `plan-${opts.channelId}`,
        monthlyPriceInPaise: 49900,
        includedBbbMinutes: 100,
      } as any),
    );
    const now = new Date();
    const periodEnd = new Date(now.getTime() + (opts.periodEndOffsetSec ?? -1));
    return subRepo.save(
      subRepo.create({
        channelId: opts.channelId,
        status: opts.status ?? 'active',
        version: 1,
        currentPeriodStart: new Date(),
        currentPeriodEnd: periodEnd,
        plan,
      } as any),
    );
  }

  async function seedAttempt(
    sub: OrganizationSubscription,
    attemptedAtOffsetSec?: number,
  ): Promise<JuspayPaymentAttempt> {
    const attemptedAt = new Date(Date.now() + (attemptedAtOffsetSec ?? 0));
    return attemptRepo.save(
      attemptRepo.create({
        subscription: sub,
        channelId: sub.channelId,
        invoiceId: `INV-${sub.id}`,
        billingPeriodStart: '2026-09-01',
        amountPaise: 49900,
        status: 'initiated',
        juspayOrderId: `jp-order-${sub.id}-${attemptedAt.getTime()}`,
        attemptedAt,
      } as any),
    );
  }

  // ─── Tests ───────────────────────────────────────────────────────────────

  describe('processRenewals discovery exclusion', () => {
    it('excludes a subscription with a fresh initiated attempt (in-flight)', async () => {
      const sub = await seedSubscription({ channelId: 'channel-fresh' });
      await seedAttempt(sub, -300); // 5 minutes ago — within 1h window

      const enqueueSpy = vi.spyOn(queueService, 'addRenewalJob').mockResolvedValue();

      const { enqueued, failures } = await renewalService.processRenewals();

      // In-flight attempt within abandonment window must prevent rediscovery.
      expect(enqueued).toBe(0);
      expect(failures).toBe(0);
      expect(enqueueSpy).not.toHaveBeenCalledWith(sub.id);

      enqueueSpy.mockRestore();
    });

    it('rediscovers a subscription when the in-flight attempt exceeds abandonment timeout', async () => {
      const sub = await seedSubscription({ channelId: 'channel-stale' });
      await seedAttempt(sub, -7200); // 2 hours ago — past default 1h timeout

      const enqueueSpy = vi.spyOn(queueService, 'addRenewalJob').mockResolvedValue();

      const { enqueued } = await renewalService.processRenewals();

      expect(enqueued).toBe(1);
      expect(enqueueSpy).toHaveBeenCalledWith(sub.id);

      enqueueSpy.mockRestore();
    });

    it('enqueues subscriptions with no in-flight attempt (normal path)', async () => {
      const sub = await seedSubscription({ channelId: 'channel-clean' });

      const enqueueSpy = vi.spyOn(queueService, 'addRenewalJob').mockResolvedValue();

      const { enqueued, failures } = await renewalService.processRenewals();
      expect(enqueued).toBe(1);
      expect(failures).toBe(0);

      enqueueSpy.mockRestore();
    });

    it('does NOT rediscover past_due subscriptions (dunning deferred to RFC-001 §4.2)', async () => {
      const sub = await seedSubscription({
        channelId: 'channel-pastdue',
        status: 'past_due',
      });

      const enqueueSpy = vi.spyOn(queueService, 'addRenewalJob').mockResolvedValue();

      const { enqueued } = await renewalService.processRenewals();
      expect(enqueueSpy).not.toHaveBeenCalledWith(sub.id);

      enqueueSpy.mockRestore();
    });
  });
});
