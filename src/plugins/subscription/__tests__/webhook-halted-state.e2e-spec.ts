/**
 * Halted-state lifecycle integration test — R2-G:
 *
 * Verifies the provider failure-state bridge that gives the documented dunning
 * path its entry point (RFC-001 §4.2):
 *
 *   subscription.halted (provider retries exhausted, subscription suspended)
 *        ├─ binding.providerStatus = 'halted', binding.active = false
 *        ├─ subscription.providerStatus = 'halted'   (ADR-041 G7, same txn)
 *        ├─ subscription.status = 'past_due'         (ADR-042 grace window)
 *        └─ billing attempt 'failed' when the event carries a payment
 *
 * Plus the two fail-safe behaviours around it:
 *   - ADR-041 G6 freshness guard: a halted event describing a cycle that is at
 *     or before the locally finalized currentPeriodStart is stale and must NOT
 *     drag an active subscription into past_due.
 *   - ADR-041 G6 fail-closed: a halted event without current_start throws
 *     MissingProviderCycleError, so no domain mutation happens and the inbox
 *     event stays retryable instead of being marked processed.
 *
 * Run: npx vitest run --config vitest.config.mts src/plugins/subscription/__tests__/webhook-halted-state.e2e-spec.ts
 */

import 'reflect-metadata';
import path from 'path';
import 'dotenv/config';
import {
  createTestEnvironment,
  registerInitializer,
  testConfig,
} from '@vendure/testing';
import {
  ChannelService,
  CurrencyCode,
  LanguageCode,
  mergeConfig,
  TransactionalConnection,
} from '@vendure/core';
import { getSuperadminContext } from '@vendure/testing/lib/utils/get-superadmin-context';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NestFactory } from '@nestjs/core';

import { SchemaPostgresInitializer } from '../../tenant-plugin/e2e/schema-postgres-initializer';
import { E2E_INITIAL_DATA } from '../../tenant-plugin/e2e/fixtures/e2e-initial-data';
import { SubscriptionPlugin } from '../subscription.plugin';
import { ProviderWebhookEvent } from '../entities/provider-webhook-event.entity';
import { SubscriptionProviderBinding } from '../entities/subscription-provider-binding.entity';
import { SubscriptionBillingAttempt } from '../entities/subscription-billing-attempt.entity';
import { OrganizationSubscription } from '../entities/organization-subscription.entity';
import { SubscriptionPlan } from '../entities/subscription-plan.entity';
import { ProviderWebhookQueueService } from '../services/provider-webhook-queue.service';
import { MissingProviderCycleError } from '../providers/razorpay/razorpay-webhook.processor';

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

const SUB_ACTIVE = 'sub_halted_active';
const SUB_STALE = 'sub_halted_stale';
const SUB_NO_CYCLE = 'sub_halted_nocycle';
const EVT_STALE = 'test-halted-002';
const EVT_NO_CYCLE = 'test-halted-003';
const EVT_HALTED = 'test-halted-001';
const EVT_REPLAY = 'test-halted-004';
const PAYMENT_ID = 'pay_halted_001';

/** Razorpay sends cycle boundaries as Unix epoch seconds. */
const epochSeconds = (iso: string) => Math.floor(new Date(iso).getTime() / 1000);

/**
 * Build the Razorpay `subscription.halted` envelope exactly as the queue worker
 * unwraps it (`rawPayload.payload.subscription.entity`).
 */
function haltedPayload(
  providerSubscriptionId: string,
  opts: { cycleStartIso?: string; paymentId?: string } = {},
): Record<string, unknown> {
  const subscriptionEntity: Record<string, unknown> = {
    id: providerSubscriptionId,
    status: 'halted',
    paid_count: 3,
  };

  if (opts.cycleStartIso) {
    const start = epochSeconds(opts.cycleStartIso);
    subscriptionEntity.current_start = start;
    subscriptionEntity.current_end = start + 30 * 24 * 60 * 60;
  }

  const payload: Record<string, unknown> = {
    entity: 'event',
    event: 'subscription.halted',
    contains: ['subscription'],
    subscription: { entity: subscriptionEntity },
  };

  if (opts.paymentId) {
    payload.payment = {
      entity: { id: opts.paymentId, amount: 10000, currency: 'INR', status: 'failed' },
    };
  }

  return payload;
}

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
      schema: 'e2e_webhook_halted',
      synchronize: true,
    },
    plugins: [
      SubscriptionPlugin.init({}) as any,
    ],
  }),
);

describe('Webhook halted state (R2-G)', () => {
  let connection: TransactionalConnection;
  let queueService: ProviderWebhookQueueService;
  // VendureEntity.id is `ID` (string | number) — the worker's private
  // processWebhookEvent(eventId: number) is invoked through `as any`, so the
  // declared call signature stays compatible with the entity ID's union type.
  let processMethod: (eventId: string | number) => Promise<void>;

  // INV-001 (Channel = Tenant): each scenario gets its own channel and its own
  // single active subscription (UNIQUE(channelId) WHERE status != 'cancelled'),
  // so the specs stay independent of execution order. The authoritative channel
  // always comes from the binding, never from the payload.
  const DEFAULT_CHANNEL_ID = '1';
  let staleChannelId: string;
  let noCycleChannelId: string;
  let subscriptionActive: OrganizationSubscription;
  let subscriptionStale: OrganizationSubscription;
  let subscriptionNoCycle: OrganizationSubscription;

  const LOCAL_PERIOD_START = '2026-10-25T00:00:00Z';
  const NEWER_CYCLE_START = '2026-10-26T00:00:00Z';
  const STALE_CYCLE_START = '2026-09-20T00:00:00Z';

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
    queueService = server.app.get(ProviderWebhookQueueService);
    processMethod = (queueService as any).processWebhookEvent.bind(queueService);

    const planRepo = connection.rawConnection.getRepository(SubscriptionPlan);
    const subRepo = connection.rawConnection.getRepository(OrganizationSubscription);
    const bindingRepo = connection.rawConnection.getRepository(SubscriptionProviderBinding);

    const plan = await planRepo.save(planRepo.create({
      name: 'Halted Test Plan',
      slug: 'halted-test-plan',
      monthlyPriceInPaise: 10000,
      includedBbbMinutes: 600,
      maxStudents: 100,
    }));

    // Channel = Tenant (INV-001): each scenario owns its own Vendure channel,
    // so neither the FSM writes of one scenario nor test order can leak into
    // another. The default channel hosts the halted-bridge scenario.
    const ctx = await getSuperadminContext(server.app);
    const channelService = server.app.get(ChannelService);
    const stamp = Date.now();
    const createChannel = async (label: string): Promise<string> => {
      const result = await channelService.create(ctx, {
        code: `halted_${label}_${stamp}`,
        token: `halted-${label}-token-${stamp}`,
        defaultLanguageCode: LanguageCode.en,
        defaultCurrencyCode: CurrencyCode.INR,
        pricesIncludeTax: true,
      } as any);
      if (!('id' in result)) {
        throw new Error(`Failed to create channel for ${label}: ${JSON.stringify(result)}`);
      }
      return String(result.id);
    };
    staleChannelId = await createChannel('stale');
    noCycleChannelId = await createChannel('nocycle');

    const seed = async (
      channelId: string,
      providerSubscriptionId: string,
    ): Promise<OrganizationSubscription> => {
      const sub = await subRepo.save(subRepo.create({
        channelId,
        plan: plan as any,
        status: 'active',
        currentPeriodStart: new Date(LOCAL_PERIOD_START),
        currentPeriodEnd: new Date('2026-11-24T00:00:00Z'),
      }));
      await bindingRepo.save(bindingRepo.create({
        subscription: { id: sub.id } as OrganizationSubscription,
        channelId,
        provider: 'razorpay',
        providerSubscriptionId,
        providerPlanId: 'plan_halted_test',
        providerStatus: 'active',
        active: true,
      }));
      return sub;
    };

    subscriptionActive = await seed(DEFAULT_CHANNEL_ID, SUB_ACTIVE);
    subscriptionStale = await seed(staleChannelId, SUB_STALE);
    subscriptionNoCycle = await seed(noCycleChannelId, SUB_NO_CYCLE);
  }, 30000);

  afterAll(async () => {
    await server.destroy();
  });

  const subRepo = () => connection.rawConnection.getRepository(OrganizationSubscription);
  const bindingRepo = () => connection.rawConnection.getRepository(SubscriptionProviderBinding);
  const eventRepo = () => connection.rawConnection.getRepository(ProviderWebhookEvent);
  const attemptRepo = () => connection.rawConnection.getRepository(SubscriptionBillingAttempt);

  const saveHaltedEvent = async (
    providerEventId: string,
    providerSubscriptionId: string,
    opts: { cycleStartIso?: string; paymentId?: string } = {},
  ): Promise<ProviderWebhookEvent> => {
    const repo = eventRepo();
    return repo.save(repo.create({
      provider: 'razorpay',
      providerEventId,
      eventType: 'subscription.halted',
      payloadHash: `test-hash-${providerEventId}`,
      rawPayload: haltedPayload(providerSubscriptionId, opts),
      processingStatus: 'pending',
      attemptCount: 0,
      channelId: null,
      verifiedAt: new Date(),
    }));
  };

  it('does NOT bridge a subscription to past_due when the halted cycle is already finalized (ADR-041 G6)', async () => {
    const event = await saveHaltedEvent(EVT_STALE, SUB_STALE, { cycleStartIso: STALE_CYCLE_START });
    await processMethod(event.id);

    // The binding reflects provider truth...
    const binding = await bindingRepo().findOne({ where: { providerSubscriptionId: SUB_STALE } });
    expect(binding!.providerStatus).toBe('halted');
    expect(binding!.active).toBe(false);

    // ...but the stale cycle must not touch the local FSM.
    const sub = await subRepo().findOne({ where: { id: subscriptionStale.id } });
    expect(sub!.status).toBe('active');
    expect(sub!.marketplaceGraceUntil).toBeNull();

    // No charge event → no billing attempt is manufactured from a state change.
    const attempts = await attemptRepo().find({ where: { providerSubscriptionId: SUB_STALE } });
    expect(attempts).toHaveLength(0);

    // The authoritative channel is resolved from the binding, not the payload.
    const reloaded = await eventRepo().findOne({ where: { id: event.id } });
    expect(reloaded!.processingStatus).toBe('processed');
    expect(reloaded!.channelId).toBe(staleChannelId);
  });

  it('fails closed when a halted event carries no provider cycle (ADR-041 G6)', async () => {
    const event = await saveHaltedEvent(EVT_NO_CYCLE, SUB_NO_CYCLE);

    await expect(processMethod(event.id)).rejects.toBeInstanceOf(MissingProviderCycleError);

    // No domain mutation: the binding was not flipped before the guard fired.
    const binding = await bindingRepo().findOne({ where: { providerSubscriptionId: SUB_NO_CYCLE } });
    expect(binding!.providerStatus).toBe('active');
    expect(binding!.active).toBe(true);

    const sub = await subRepo().findOne({ where: { id: subscriptionNoCycle.id } });
    expect(sub!.status).toBe('active');

    // The inbox event stays retryable rather than being marked processed.
    const reloaded = await eventRepo().findOne({ where: { id: event.id } });
    expect(reloaded!.processingStatus).toBe('pending');
    expect(reloaded!.attemptCount).toBe(1);
    expect(reloaded!.processedAt).toBeNull();
    expect(reloaded!.errorMessage).toContain('ADR-041 G6');
    // Channel resolution happens before the guard fires (INV-001).
    expect(reloaded!.channelId).toBe(noCycleChannelId);
  });

  it('bridges an active subscription to past_due and records the failed attempt', async () => {
    const event = await saveHaltedEvent(EVT_HALTED, SUB_ACTIVE, {
      cycleStartIso: NEWER_CYCLE_START,
      paymentId: PAYMENT_ID,
    });
    await processMethod(event.id);

    // Binding: provider truth.
    const binding = await bindingRepo().findOne({ where: { providerSubscriptionId: SUB_ACTIVE } });
    expect(binding!.providerStatus).toBe('halted');
    expect(binding!.active).toBe(false);

    // Subscription: providerStatus mirrored (ADR-041 G7) and the Saa9vi FSM
    // bridged to past_due, opening the marketplace grace window (ADR-042 §3/§5).
    const sub = await subRepo().findOne({ where: { id: subscriptionActive.id } });
    expect(sub!.providerStatus).toBe('halted');
    expect(sub!.status).toBe('past_due');
    expect(sub!.marketplaceGraceUntil).toBeInstanceOf(Date);
    expect(sub!.channelId).toBe(DEFAULT_CHANNEL_ID);

    // The halted cycle is recorded as a failed attempt (never as a success).
    const attempts = await attemptRepo().find({ where: { providerEventId: EVT_HALTED } });
    expect(attempts).toHaveLength(1);
    expect(attempts[0].status).toBe('failed');
    expect(attempts[0].provider).toBe('razorpay');
    expect(attempts[0].amountPaise).toBe(10000);
    expect(attempts[0].billingPeriodStart).toBe('2026-10-26');
    expect(attempts[0].billingPeriodEnd).toBe('2026-11-25');
    expect(attempts[0].failureReason).toBe('failed');
    expect(attempts[0].channelId).toBe(DEFAULT_CHANNEL_ID);

    // The inbox event is terminal-successful and carries the binding's channel.
    const reloaded = await eventRepo().findOne({ where: { id: event.id } });
    expect(reloaded!.processingStatus).toBe('processed');
    expect(reloaded!.processedAt).toBeInstanceOf(Date);
    expect(reloaded!.errorMessage).toBeNull();
    expect(reloaded!.channelId).toBe(DEFAULT_CHANNEL_ID);
  });

  it('is idempotent when a later halted event replays the same payment', async () => {
    // Intentionally ordered after the bridge case: this spec's subject is the
    // second event replaying a payment that already has a terminal attempt row.
    const event = await saveHaltedEvent(EVT_REPLAY, SUB_ACTIVE, {
      cycleStartIso: NEWER_CYCLE_START,
      paymentId: PAYMENT_ID,
    });
    await processMethod(event.id);

    // Cross-event idempotency: the terminal failed attempt for this payment is
    // recognised, so no second attempt row is created.
    const attempts = await attemptRepo().find({ where: { providerPaymentId: PAYMENT_ID } });
    expect(attempts).toHaveLength(1);

    const sub = await subRepo().findOne({ where: { id: subscriptionActive.id } });
    expect(sub!.status).toBe('past_due');

    const binding = await bindingRepo().findOne({ where: { providerSubscriptionId: SUB_ACTIVE } });
    expect(binding!.providerStatus).toBe('halted');

    const reloaded = await eventRepo().findOne({ where: { id: event.id } });
    expect(reloaded!.processingStatus).toBe('processed');
  });
});

