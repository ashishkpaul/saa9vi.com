/**
 * Slice 6 — daily live allowance e2e (ADR-045 / INV-026 gate).
 *
 * Infrastructure-gated: requires Postgres.
 * Run:
 *   DAILY_ALLOWANCE_E2E=true npx vitest run --config vitest.config.mts \
 *     src/plugins/bigbluebutton-plugin/e2e/daily-allowance.e2e-spec.ts
 *
 * Proves the daily-allowance layer end to end, on real Postgres, through the
 * real wiring (the real EventBus consumer and the real provisioning worker —
 * never by calling a private helper):
 *
 *   1. A provider-free plan materialises exactly one 60-minute grant per server
 *      day, with the window the read model and the gate both use.
 *   2. The write is idempotent — including under two CONCURRENT sweeps, which is
 *      the case the per-key advisory lock exists for (two grants for one day
 *      would be a 120-minute allowance for a 60-minute day).
 *   3. A provider-backed plan gets NO daily grant: its allowance is the
 *      billing-period pool (§3.6 — the paid daily row is `—`). This is the
 *      scoping that keeps the daily job off the `(org, validFrom, sourceType)`
 *      key the renewal writer owns.
 *   4. A previous day's grant falls out of the window and is never reused, so
 *      yesterday's allowance cannot leak into today's numbers.
 *   5. The plan-changed consumer writes today's grant (the event trigger).
 *   6. D-6 — an exhausted allowance at PROVISIONING time is a terminal failure
 *      with the accurate user-visible reason plus a MeetingFailedEvent. Before
 *      BUG-036 this path mis-reported "no grant exists"; the unacceptable
 *      alternative D-6 rejects is a meeting that silently stays PENDING.
 *   7. Free → paid stops daily grants without disturbing the day already granted.
 */

import 'reflect-metadata';
import 'dotenv/config';
import net from 'net';
import {
  createTestEnvironment,
  registerInitializer,
  testConfig,
} from '@vendure/testing';
import {
  EventBus,
  mergeConfig,
  TransactionalConnection,
} from '@vendure/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getSuperadminContext } from '@vendure/testing/lib/utils/get-superadmin-context';

import { TenantPlugin } from '../../tenant-plugin/tenant-plugin.plugin';
import { BigBlueButtonPlugin } from '../bigbluebutton.plugin';
import { SubscriptionPlugin } from '../../subscription/subscription.plugin';
import { SchemaPostgresInitializer } from '../../tenant-plugin/e2e/schema-postgres-initializer';
import { BbbOrganization } from '../entities/bbb-organization.entity';
import { BbbMeeting } from '../entities/bbb-meeting.entity';
import { BbbServer } from '../entities/bbb-server.entity';
import { BbbCapacityGrant } from '../entities/bbb-capacity-grant.entity';
import { BbbProvisioningWorkerService } from '../services/bbb-provisioning-worker.service';
import { BbbDailyAllowanceService } from '../services/bbb-daily-allowance.service';
import { MEETING_STATE } from '../constants';
import { MeetingFailedEvent } from '../events/bbb-events';
import {
  PROVISIONING_ALLOWANCE_EXHAUSTED_ERROR,
} from '../services/grant-selection.policy';
import {
  DAILY_ALLOWANCE_MINUTES,
  DAILY_ALLOWANCE_SOURCE_TYPE,
  dailyAllowanceWindowFor,
  startOfServerDay,
} from '../services/daily-allowance.policy';
import { OrganizationSubscription } from '../../subscription/entities/organization-subscription.entity';
import { SubscriptionPlan } from '../../subscription/entities/subscription-plan.entity';
import { SubscriptionPlanChangedEvent } from '../../subscription/events/subscription.events';

registerInitializer('postgres', new SchemaPostgresInitializer());

const DAILY_ALLOWANCE_E2E = process.env.DAILY_ALLOWANCE_E2E === 'true';

async function assertPostgres(): Promise<void> {
  const host = process.env.DB_HOST ?? '127.0.0.1';
  const port = Number(process.env.DB_PORT ?? 5432);
  await new Promise<void>((resolve, reject) => {
    const sock = net.connect(port, host);
    sock.once('connect', () => {
      sock.destroy();
      resolve();
    });
    sock.once('error', err => reject(err));
  });
}

const { server } = createTestEnvironment(
  mergeConfig(testConfig, {
    apiOptions: { port: 3096 },
    dbConnectionOptions: {
      type: 'postgres',
      host: process.env.DB_HOST ?? '127.0.0.1',
      port: Number(process.env.DB_PORT ?? 5432),
      database: process.env.DB_NAME ?? 'vendure',
      username: process.env.DB_USERNAME ?? 'vendure_user',
      password: process.env.DB_PASSWORD ?? '',
      schema: 'e2e_daily_allowance',
      synchronize: true,
    },
    plugins: [
      TenantPlugin,
      BigBlueButtonPlugin,
      SubscriptionPlugin.init({}) as any,
    ],
  }),
);

describe('Slice 6 daily live allowance (ADR-045)', () => {
  const d = DAILY_ALLOWANCE_E2E ? describe : describe.skip;

  let ctx: any;
  let connection: TransactionalConnection;
  let eventBus: EventBus;
  let allowanceService: BbbDailyAllowanceService;
  let worker: BbbProvisioningWorkerService;

  const orgRepo = () => connection.getRepository(ctx, BbbOrganization);
  const grantRepo = () => connection.getRepository(ctx, BbbCapacityGrant);
  const planRepo = () => connection.getRepository(ctx, SubscriptionPlan);
  const subRepo = () => connection.getRepository(ctx, OrganizationSubscription);
  const meetingRepo = () => connection.getRepository(ctx, BbbMeeting);

  const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

  /**
   * Synthetic raw channel ids — `BbbOrganization.channelId` is a scalar with no
   * FK, so distinct ids keep the scenarios from resolving each other's
   * subscription. Same approach as plan-derived-concurrency.e2e-spec.ts.
   */
  const FREE_CHANNEL = '93001';
  const CONCURRENT_CHANNEL = '93002';
  const YESTERDAY_CHANNEL = '93003';
  const EVENT_CHANNEL = '93004';
  const SWITCH_CHANNEL = '93005';
  const PAID_CHANNEL = '93006';
  const PROVISION_CHANNEL = '93007';

  let dailyPlan: SubscriptionPlan;
  let paidPlan: SubscriptionPlan;

  async function seedOrg(
    channelId: string,
    slug: string,
    limit = 5,
  ): Promise<BbbOrganization> {
    return orgRepo().save(
      orgRepo().create({
        channelId,
        name: slug,
        slug,
        ownerUserId: '1',
        concurrentMeetingLimit: limit,
      }),
    );
  }

  async function seedPlan(
    slug: string,
    providerPlanId: string | null,
  ): Promise<SubscriptionPlan> {
    return planRepo().save(
      planRepo().create({
        name: slug,
        slug,
        description: `${slug} (slice-6 e2e)`,
        monthlyPriceInPaise: providerPlanId ? 99_900 : 0,
        includedBbbMinutes: providerPlanId ? 600 : 0,
        // The discriminator under test: provider-free ⇔ providerPlanId IS NULL.
        providerPlanId: providerPlanId as any,
        isActive: true,
      }),
    );
  }

  async function seedSubscription(
    channelId: string,
    plan: SubscriptionPlan,
  ): Promise<OrganizationSubscription> {
    return subRepo().save(
      subRepo().create({
        channelId,
        plan,
        status: 'active' as any,
        currentPeriodStart: null as any,
        currentPeriodEnd: null as any,
        cancelAtPeriodEnd: false,
        version: 1,
      }),
    );
  }

  /** Grants for one organization, newest window first. */
  async function grantsFor(orgId: string): Promise<BbbCapacityGrant[]> {
    return grantRepo().find({
      where: { organization: { id: orgId } },
      order: { validFrom: 'DESC' },
    });
  }

  /**
   * The same predicate the provisioning gate and `myLiveUsage` apply:
   * `validFrom <= now AND validUntil >= now`, tenant-selectable source types
   * only. Counting through this rather than re-implementing it is the point —
   * it is what makes the grant visible to both consumers.
   */
  async function inWindowSubscriptionGrants(
    orgId: string,
    now: Date,
  ): Promise<BbbCapacityGrant[]> {
    const grants = await grantsFor(orgId);
    return grants.filter(
      g =>
        g.sourceType === DAILY_ALLOWANCE_SOURCE_TYPE &&
        g.validFrom.getTime() <= now.getTime() &&
        g.validUntil.getTime() >= now.getTime(),
    );
  }

  async function waitForInWindowGrants(
    orgId: string,
    expected: number,
    timeoutMs = 5000,
  ): Promise<number> {
    const now = new Date();
    const deadline = Date.now() + timeoutMs;
    let last = -1;
    for (;;) {
      last = (await inWindowSubscriptionGrants(orgId, now)).length;
      if (last === expected || Date.now() >= deadline) return last;
      await sleep(100);
    }
  }

  d('daily-allowance layer', () => {
    beforeAll(async () => {
      await assertPostgres();
      await server.init({
        initialData: {
          defaultLanguage: 'en' as any,
          defaultZone: 'India',
          taxRates: [{ name: 'Standard Tax', percentage: 18 }],
          shippingMethods: [{ name: 'Standard Shipping', price: 0 }],
          paymentMethods: [],
          countries: [{ name: 'India', code: 'IN', zone: 'India' }],
          collections: [],
        },
        customerCount: 0,
      });

      ctx = await getSuperadminContext(server.app);
      connection = server.app.get(TransactionalConnection);
      eventBus = server.app.get(EventBus);
      allowanceService = server.app.get(BbbDailyAllowanceService);
      worker = server.app.get(BbbProvisioningWorkerService);

      // Free Basic: provider-free (providerPlanId IS NULL) → daily only.
      dailyPlan = await seedPlan('free-basic-slice6-e2e', null);
      // A paid plan: provider-backed → billing-period pool, never a daily grant.
      paidPlan = await seedPlan('growth-slice6-e2e', 'plan_slice6paid');
    }, 60000);

    afterAll(async () => {
      await server.destroy();
    });

    it('materialises exactly one 60-minute grant for the current server day', async () => {
      const org = await seedOrg(FREE_CHANNEL, 'e2e-daily-org');
      await seedSubscription(FREE_CHANNEL, dailyPlan);

      const now = new Date();
      const result = await allowanceService.refreshDailyAllowance(now);

      // The channel is on a provider-free plan, so it is part of the sweep.
      expect(result.scanned).toBeGreaterThanOrEqual(1);
      expect(result.created).toBe(1);
      expect(result.failed).toBe(0);

      const grants = await grantsFor(String(org.id));
      expect(grants).toHaveLength(1);

      const grant = grants[0];
      expect(grant.sourceType).toBe(DAILY_ALLOWANCE_SOURCE_TYPE); // 'subscription' (F-6)
      expect(grant.grantedMinutes).toBe(DAILY_ALLOWANCE_MINUTES); // 60 (§3.6/D-1)
      expect(grant.consumedMinutes).toBe(0);
      expect(grant.exhausted).toBe(false);
      // A daily 60 is a real quantity, never the internal_overhead sentinel.
      expect(grant.isUnbounded).toBe(false);
      // No order stands behind a daily allowance.
      expect(grant.orderId).toBeNull();
      expect(grant.orderLineId).toBeNull();

      // Window = the server day containing `now`, and it must contain `now` —
      // otherwise the gate and myLiveUsage would both ignore the grant.
      const expected = dailyAllowanceWindowFor(now);
      expect(grant.validFrom.getTime()).toBe(expected.start.getTime());
      expect(grant.validUntil.getTime()).toBe(expected.end.getTime());
      expect(startOfServerDay(now).getTime()).toBe(grant.validFrom.getTime());

      // Visible to the shared read/gate predicate without any change to it.
      const inWindow = await inWindowSubscriptionGrants(String(org.id), now);
      expect(inWindow).toHaveLength(1);
      expect(inWindow[0].grantedMinutes - inWindow[0].consumedMinutes).toBe(
        DAILY_ALLOWANCE_MINUTES,
      );
    }, 30000);

    it('is idempotent, including under two CONCURRENT sweeps (advisory-lock proof)', async () => {
      const org = await seedOrg(CONCURRENT_CHANNEL, 'e2e-daily-concurrent-org');
      await seedSubscription(CONCURRENT_CHANNEL, dailyPlan);

      // The race the per-key advisory lock exists for: both sweeps enumerate the
      // same freshly-eligible channel and both would miss the same findOne().
      const [a, b] = await Promise.all([
        allowanceService.refreshDailyAllowance(),
        allowanceService.refreshDailyAllowance(),
      ]);

      // Exactly one of the two sweeps may have written the day's grant.
      expect(a.created + b.created).toBe(1);

      // …and the tenant sees one 60, not two 120.
      const grants = await grantsFor(String(org.id));
      expect(grants).toHaveLength(1);
      expect(grants[0].grantedMinutes).toBe(DAILY_ALLOWANCE_MINUTES);

      // A later sweep is a pure no-op, not another allowance.
      const third = await allowanceService.refreshDailyAllowance();
      expect(third.created).toBe(0);
      expect((await grantsFor(String(org.id))).length).toBe(1);
    }, 30000);

    it('gives a provider-backed plan NO daily grant (its allowance is the period pool)', async () => {
      const org = await seedOrg(PAID_CHANNEL, 'e2e-paid-org');
      await seedSubscription(PAID_CHANNEL, paidPlan);

      await allowanceService.refreshDailyAllowance();

      // The load-bearing scoping rule: the daily job must stay off the key the
      // renewal writer owns, and must not sell a paid tenant a free allowance.
      expect(await grantsFor(String(org.id))).toHaveLength(0);

      // The event path agrees with the sweep — same writer, same verdict.
      expect(
        await allowanceService.ensureDailyGrantForChannel(
          PAID_CHANNEL,
          'e2e-paid',
        ),
      ).toBeNull();
      expect(await grantsFor(String(org.id))).toHaveLength(0);
    }, 30000);

    it("never reuses a previous day's allowance (windows are disjoint)", async () => {
      const org = await seedOrg(YESTERDAY_CHANNEL, 'e2e-yesterday-org');
      await seedSubscription(YESTERDAY_CHANNEL, dailyPlan);

      // Yesterday's grant, fully consumed — the free tier's normal overnight state.
      const today = dailyAllowanceWindowFor(new Date());
      const yesterdayStart = new Date(today.start.getTime());
      yesterdayStart.setDate(yesterdayStart.getDate() - 1);
      const yesterdayEnd = new Date(today.start.getTime() - 1);

      const seeded = await grantRepo().save(
        grantRepo().create({
          organization: org,
          grantedMinutes: DAILY_ALLOWANCE_MINUTES,
          consumedMinutes: DAILY_ALLOWANCE_MINUTES,
          validFrom: yesterdayStart,
          validUntil: yesterdayEnd,
          exhausted: true,
          sourceType: DAILY_ALLOWANCE_SOURCE_TYPE,
          isUnbounded: false,
        }),
      );

      const now = new Date();
      const result = await allowanceService.refreshDailyAllowance(now);
      expect(result.created).toBeGreaterThanOrEqual(1);

      const grants = await grantsFor(String(org.id));
      expect(grants).toHaveLength(2); // yesterday preserved, today added

      // Yesterday's row is untouched — append-only history, never recycled.
      const reloaded = grants.find(g => String(g.id) === String(seeded.id))!;
      expect(reloaded.exhausted).toBe(true);
      expect(reloaded.consumedMinutes).toBe(DAILY_ALLOWANCE_MINUTES);

      // Exactly ONE grant is in-window: today's. Yesterday's cannot leak in.
      const inWindow = await inWindowSubscriptionGrants(String(org.id), now);
      expect(inWindow).toHaveLength(1);
      expect(inWindow[0].validFrom.getTime()).toBe(today.start.getTime());
    }, 30000);

    it("writes today's grant through the plan-changed consumer (event trigger)", async () => {
      const org = await seedOrg(EVENT_CHANNEL, 'e2e-event-org');
      const sub = await seedSubscription(EVENT_CHANNEL, dailyPlan);

      // The real announce the subscription plugin makes once the row commits —
      // the same event that drives plan-derived concurrency.
      await eventBus.publish(
        new SubscriptionPlanChangedEvent(
          ctx,
          sub,
          EVENT_CHANNEL,
          String(dailyPlan.id),
          null,
          'activated',
        ),
      );

      // Eventual by construction: the consumer is a non-blocking `ofType`
      // subscriber, so the grant appears shortly after the publish.
      expect(await waitForInWindowGrants(String(org.id), 1)).toBe(1);

      // And the consumer used the ONE writer rather than writing a grant itself:
      // a second publish adds nothing.
      await eventBus.publish(
        new SubscriptionPlanChangedEvent(
          ctx,
          sub,
          EVENT_CHANNEL,
          String(dailyPlan.id),
          String(dailyPlan.id),
          'changed',
        ),
      );
      await sleep(500);
      expect(await grantsFor(String(org.id))).toHaveLength(1);
    }, 30000);

    it('D-6: an exhausted allowance fails provisioning TERMINALLY with the accurate reason', async () => {
      const org = await seedOrg(PROVISION_CHANNEL, 'e2e-provision-org', 1);

      const serverRepo = connection.getRepository(ctx, BbbServer);
      await serverRepo.save(
        serverRepo.create({
          name: `Slice 6 Server ${Date.now()}`,
          apiUrl: 'http://localhost:1999/bigbluebutton/api',
          encryptedApiSecret: 'test-secret',
          enabled: true,
          healthy: true,
          currentLoad: 0,
          maxLoad: 100,
          capacity: 100,
        }),
      );

      // Today's allowance, fully consumed — the moment §5.1 calls
      // "allowance exhausted".
      const window = dailyAllowanceWindowFor(new Date());
      await grantRepo().save(
        grantRepo().create({
          organization: org,
          grantedMinutes: DAILY_ALLOWANCE_MINUTES,
          consumedMinutes: DAILY_ALLOWANCE_MINUTES,
          validFrom: window.start,
          validUntil: window.end,
          exhausted: true,
          sourceType: DAILY_ALLOWANCE_SOURCE_TYPE,
          isUnbounded: false,
        }),
      );

      const meeting = await meetingRepo().save(
        meetingRepo().create({
          title: 'Exhausted daily allowance meeting',
          state: MEETING_STATE.PENDING,
          organization: org,
        }),
      );

      const failures: MeetingFailedEvent[] = [];
      const sub = eventBus
        .ofType(MeetingFailedEvent)
        .subscribe(e => failures.push(e));

      try {
        await worker.doProvisionMeeting(ctx, meeting.id, 'slice6-d6');

        const reloaded = (await meetingRepo().findOne({
          where: { id: meeting.id },
        }))!;

        // The D-6 decision, asserted: terminal FAILED with a user-visible reason.
        // The rejected alternative is a meeting that silently stays PENDING with
        // only a log — indistinguishable, to the tenant, from a hang.
        expect(reloaded.state).toBe(MEETING_STATE.FAILED);
        expect(reloaded.failureReason).toBe(
          PROVISIONING_ALLOWANCE_EXHAUSTED_ERROR,
        );
        expect(reloaded.retryCount).toBe(1);

        // …paired with the notification half of "terminal state + notification".
        const deadline = Date.now() + 3000;
        while (failures.length === 0 && Date.now() < deadline) {
          await sleep(50);
        }
        expect(failures).toHaveLength(1);
        expect(failures[0].reason).toBe(
          PROVISIONING_ALLOWANCE_EXHAUSTED_ERROR,
        );
        expect(String(failures[0].organizationId)).toBe(String(org.id));
      } finally {
        if (typeof (sub as any)?.unsubscribe === 'function') {
          (sub as any).unsubscribe();
        }
      }
    }, 60000);

    it('a free → paid change stops daily grants without clawing back the granted day', async () => {
      const org = await seedOrg(SWITCH_CHANNEL, 'e2e-switch-org');
      const seeded = await seedSubscription(SWITCH_CHANNEL, dailyPlan);

      // Free: today's allowance exists (the event path).
      expect(
        await allowanceService.ensureDailyGrantForChannel(
          SWITCH_CHANNEL,
          'e2e-switch-free',
        ),
      ).not.toBeNull();
      expect(
        await inWindowSubscriptionGrants(String(org.id), new Date()),
      ).toHaveLength(1);

      // Supersede-in-place, the ADR-044 shape: the SAME row's plan changes.
      const managed = (await subRepo().findOne({
        where: { id: seeded.id },
      }))!;
      managed.plan = paidPlan;
      await subRepo().save(managed);

      // A granted allowance is not revoked — the day already given stands.
      expect(
        await inWindowSubscriptionGrants(String(org.id), new Date()),
      ).toHaveLength(1);

      // But nothing NEW is written: the paid tier is served by the period pool,
      // and tomorrow's sweep no longer sees this channel as daily-only.
      expect(
        await allowanceService.ensureDailyGrantForChannel(
          SWITCH_CHANNEL,
          'e2e-switch-paid',
        ),
      ).toBeNull();
      await allowanceService.refreshDailyAllowance();
      expect(await grantsFor(String(org.id))).toHaveLength(1);
    }, 30000);
  });
});
