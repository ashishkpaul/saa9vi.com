/**
 * Plan-derived concurrency e2e — ADR-031 amendment (2026-09-25) gate.
 *
 * Infrastructure-gated: requires Postgres.
 * Run:
 *   PLAN_CAPACITY_E2E=true npx vitest run --config vitest.config.mts \
 *     src/plugins/bigbluebutton-plugin/e2e/plan-derived-concurrency.e2e-spec.ts
 *
 * Proves the tier-aware denormalization model in which
 * `BbbOrganization.concurrentMeetingLimit` is a CACHE of
 * `BbbPlatformCapacityPolicy.maxConcurrentMeetings`:
 *
 *   • Free Basic (tier 1) derives 1 from its plan's policy row.
 *   • A plan change re-derives the new plan's ceiling.
 *   • The organisation field stays the enforcement surface; the policy is never
 *     resolved at enforcement time (asserted in bbb-meeting-concurrency).
 *
 * And, most importantly, the negative half — the rule that stops this from
 * silently rewriting tenants:
 *
 *   • A Tier 3 (platform-default) or Tier 4 (fallback) resolution must NEVER
 *     overwrite an Admin-set value. Only 'plan' / 'channel-override' do.
 *
 * Every path here goes through the REAL wiring — the actual
 * `SubscriptionPlanChangedEvent` publish/subscribe pair and the actual startup
 * reconciliation service — rather than calling the sync method directly, so a
 * regression in the consumer, the tier cascade, or the guard is caught.
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
  RequestContextService,
  TransactionalConnection,
} from '@vendure/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getSuperadminContext } from '@vendure/testing/lib/utils/get-superadmin-context';

import { TenantPlugin } from '../../tenant-plugin/tenant-plugin.plugin';
import { BigBlueButtonPlugin } from '../bigbluebutton.plugin';
import { SubscriptionPlugin } from '../../subscription/subscription.plugin';
import { SchemaPostgresInitializer } from '../../tenant-plugin/e2e/schema-postgres-initializer';
import { BbbOrganization } from '../entities/bbb-organization.entity';
import { BbbPlatformCapacityPolicy } from '../entities/bbb-platform-capacity-policy.entity';
import { OrganizationSubscription } from '../../subscription/entities/organization-subscription.entity';
import { SubscriptionPlan } from '../../subscription/entities/subscription-plan.entity';
import { BbbPlatformCapacityPolicyService } from '../services/bbb-platform-capacity-policy.service';
import { BbbPlanCapacityReconciliationBootstrap } from '../listeners/bbb-plan-capacity-reconciliation.bootstrap';
import { SubscriptionPlanChangedEvent } from '../../subscription/events/subscription.events';

registerInitializer('postgres', new SchemaPostgresInitializer());

const PLAN_CAPACITY_E2E = process.env.PLAN_CAPACITY_E2E === 'true';

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
    apiOptions: { port: 3094 },
    dbConnectionOptions: {
      type: 'postgres',
      host: process.env.DB_HOST ?? '127.0.0.1',
      port: Number(process.env.DB_PORT ?? 5432),
      database: process.env.DB_NAME ?? 'vendure',
      username: process.env.DB_USERNAME ?? 'vendure_user',
      password: process.env.DB_PASSWORD ?? '',
      schema: 'e2e_plan_capacity',
      synchronize: true,
    },
    plugins: [
      TenantPlugin,
      BigBlueButtonPlugin,
      SubscriptionPlugin.init({}) as any,
    ],
  }),
);

describe('Plan-derived concurrentMeetingLimit (ADR-031 amendment)', () => {
  const d = PLAN_CAPACITY_E2E ? describe : describe.skip;

  let ctx: any;
  let connection: TransactionalConnection;
  let eventBus: EventBus;
  let policyService: BbbPlatformCapacityPolicyService;
  let reconciliation: BbbPlanCapacityReconciliationBootstrap;

  const orgRepo = () => connection.getRepository(ctx, BbbOrganization);
  const policyRepo = () =>
    connection.getRepository(ctx, BbbPlatformCapacityPolicy);
  const planRepo = () => connection.getRepository(ctx, SubscriptionPlan);
  const subRepo = () =>
    connection.getRepository(ctx, OrganizationSubscription);

  const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

  /**
   * Convergence is EVENTUAL by design (the announce hands off to non-blocking
   * `ofType` subscribers), so every assertion polls rather than sampling one
   * instant. Returns the last observed value so a failure reports what it saw.
   */
  async function waitForOrgLimit(
    orgId: string,
    expected: number,
    timeoutMs = 5000,
  ): Promise<number> {
    const deadline = Date.now() + timeoutMs;
    let last = -1;
    for (;;) {
      const fresh = await orgRepo().findOne({ where: { id: orgId } });
      last = fresh ? fresh.concurrentMeetingLimit : -1;
      if (last === expected || Date.now() >= deadline) return last;
      await sleep(100);
    }
  }

  async function seedPlan(slug: string, name: string): Promise<SubscriptionPlan> {
    return planRepo().save(
      planRepo().create({
        name,
        slug,
        description: `${name} (e2e)`,
        monthlyPriceInPaise: 0,
        includedBbbMinutes: 0,
        providerPlanId: null as any,
        isActive: true,
      }),
    );
  }

  async function seedActiveSubscription(
    channelId: string,
    plan: SubscriptionPlan,
  ): Promise<OrganizationSubscription> {
    return subRepo().save(
      subRepo().create({
        channelId,
        plan,
        // 'active' is what Tier 2's raw SQL predicate matches.
        status: 'active' as any,
        currentPeriodStart: null as any,
        currentPeriodEnd: null as any,
        cancelAtPeriodEnd: false,
        version: 1,
      }),
    );
  }

  async function seedOrg(
    channelId: string,
    limit: number,
    slug: string,
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

  async function seedPolicy(input: {
    subscriptionPlanId?: string | null;
    channelId?: string | null;
    maxConcurrentMeetings: number;
  }): Promise<BbbPlatformCapacityPolicy> {
    return policyRepo().save(
      policyRepo().create({
        // A NULL FK means "unscoped" — the row applies to no plan and no
        // channel in particular, rather than being omitted from the row.
        subscriptionPlanId: (input.subscriptionPlanId ?? null) as any,
        channelId: (input.channelId ?? null) as any,
        defaultRoomCapacity: 5,
        maxRoomCapacity: 5,
        maxConcurrentParticipants: 5,
        maxConcurrentMeetings: input.maxConcurrentMeetings,
      }),
    );
  }

  /**
   * Drive the real consumer through the real EventBus — the same call the
   * subscription plugin makes after committing.
   */
  async function publishPlanChanged(
    channelId: string,
    subscription: OrganizationSubscription,
    planId: string,
    cause: 'activated' | 'changed' | 'subscribed',
  ): Promise<void> {
    await eventBus.publish(
      new SubscriptionPlanChangedEvent(
        ctx,
        subscription,
        channelId,
        planId,
        null,
        cause,
      ),
    );
  }

  // Synthetic raw channel ids — BbbOrganization.channelId has no FK, and
  // distinct ids stop the four scenarios from resolving each other's policy.
  const FREE_CHANNEL = '91001';
  const PRESERVE_CHANNEL = '91003';
  const RECON_CHANNEL = '91004';

  let freePlan: SubscriptionPlan;
  let freeSub: OrganizationSubscription;
  let paidPlan: SubscriptionPlan;
  let freeOrgId: string;
  let preserveOrgId: string;
  let reconOrgId: string;

  d('tier-aware sync', () => {
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
      policyService = server.app.get(BbbPlatformCapacityPolicyService);
      reconciliation = server.app.get(BbbPlanCapacityReconciliationBootstrap);
    }, 60000);

    afterAll(async () => {
      await server.destroy();
    });

    it('isPlanDerived() admits only plan and channel-override resolutions', () => {
      const base = {
        defaultRoomCapacity: 5,
        maxRoomCapacity: 5,
        maxConcurrentParticipants: 5,
        maxConcurrentMeetings: 1,
      };
      expect(policyService.isPlanDerived({ ...base, source: 'plan' })).toBe(
        true,
      );
      expect(
        policyService.isPlanDerived({ ...base, source: 'channel-override' }),
      ).toBe(true);
      // The two GENERIC answers must never be authoritative, otherwise a cache
      // refresh would clobber every Admin-set value.
      expect(
        policyService.isPlanDerived({ ...base, source: 'platform-default' }),
      ).toBe(false);
      expect(
        policyService.isPlanDerived({ ...base, source: 'fallback' }),
      ).toBe(false);
    });

    it('derives Free Basic (tier 1) concurrentMeetingLimit = 1 from the plan policy', async () => {
      freePlan = await seedPlan('free-basic-e2e', 'Free Basic (e2e)');
      await seedPolicy({
        subscriptionPlanId: String(freePlan.id),
        maxConcurrentMeetings: 1,
      });

      // Organisation created BEFORE the subscription exists — exactly the real
      // registration order (the BBB plugin's tenant listener runs before the
      // subscription plugin's free-plan listener), so the org starts at the
      // column default and Tier 2 cannot match yet.
      const org = await seedOrg(FREE_CHANNEL, 5, 'e2e-free-org');
      freeOrgId = String(org.id);
      expect(org.concurrentMeetingLimit).toBe(5);

      freeSub = await seedActiveSubscription(FREE_CHANNEL, freePlan);

      const resolved = await policyService.getEffectivePolicy(ctx, FREE_CHANNEL);
      expect(resolved.source).toBe('plan');
      expect(resolved.maxConcurrentMeetings).toBe(1);

      // The event the subscription plugin publishes once the free row commits.
      await publishPlanChanged(
        FREE_CHANNEL,
        freeSub,
        String(freePlan.id),
        'activated',
      );

      expect(await waitForOrgLimit(freeOrgId, 1)).toBe(1);
    }, 30000);

    it('re-derives the new ceiling when the plan changes', async () => {
      paidPlan = await seedPlan('paid-growth-e2e', 'Growth (e2e)');
      await seedPolicy({
        subscriptionPlanId: String(paidPlan.id),
        maxConcurrentMeetings: 3,
      });

      // Supersede-in-place, the ADR-044 shape: the SAME row's plan changes.
      const managed = await subRepo().findOne({ where: { id: freeSub.id } });
      managed!.plan = paidPlan;
      await subRepo().save(managed!);

      const resolved = await policyService.getEffectivePolicy(ctx, FREE_CHANNEL);
      expect(resolved.source).toBe('plan');
      expect(resolved.maxConcurrentMeetings).toBe(3);

      // cause 'changed' — the same call SubscriptionService.announcePlanChange
      // makes after changeOrganizationSubscriptionPlan commits.
      await publishPlanChanged(
        FREE_CHANNEL,
        managed!,
        String(paidPlan.id),
        'changed',
      );

      expect(await waitForOrgLimit(freeOrgId, 3)).toBe(3);
    }, 30000);

    it('preserves an Admin-set value for a plan the Portal has not configured', async () => {
      // A real, ACTIVE subscription — but on a plan with NO policy row, which is
      // the "paid tier stays Admin-set" case. Tier 2 finds the planId and then
      // finds nothing, so resolution falls through to the generic tiers.
      const unconfigured = await seedPlan(
        'unconfigured-e2e',
        'Unconfigured (e2e)',
      );
      const sub = await seedActiveSubscription(PRESERVE_CHANNEL, unconfigured);

      const org = await seedOrg(PRESERVE_CHANNEL, 7, 'e2e-preserve-org');
      preserveOrgId = String(org.id);

      // No platform-default row exists yet → Tier 4 fallback.
      const fallback = await policyService.getEffectivePolicy(
        ctx,
        PRESERVE_CHANNEL,
      );
      expect(fallback.source).toBe('fallback');
      expect(fallback.maxConcurrentMeetings).toBe(5); // the neutral fallback

      await publishPlanChanged(
        PRESERVE_CHANNEL,
        sub,
        String(unconfigured.id),
        'subscribed',
      );
      // Let a (wrongly) unguarded consumer act before asserting.
      await sleep(1000);
      expect(
        (await orgRepo().findOne({ where: { id: preserveOrgId } }))!
          .concurrentMeetingLimit,
      ).toBe(7);

      // Now add a platform-default row → Tier 3. Still generic, still must not
      // overwrite the Admin's 7. This is the regression the guard exists for.
      await seedPolicy({ maxConcurrentMeetings: 9 });
      const platformDefault = await policyService.getEffectivePolicy(
        ctx,
        PRESERVE_CHANNEL,
      );
      expect(platformDefault.source).toBe('platform-default');
      expect(platformDefault.maxConcurrentMeetings).toBe(9);

      await publishPlanChanged(
        PRESERVE_CHANNEL,
        sub,
        String(unconfigured.id),
        'subscribed',
      );
      await sleep(1000);
      expect(
        (await orgRepo().findOne({ where: { id: preserveOrgId } }))!
          .concurrentMeetingLimit,
      ).toBe(7);

      // …and prove the guard is not simply "always refuse": a channel override
      // IS plan-derived, so it must apply.
      await seedPolicy({
        channelId: PRESERVE_CHANNEL,
        maxConcurrentMeetings: 4,
      });
      const override = await policyService.getEffectivePolicy(
        ctx,
        PRESERVE_CHANNEL,
      );
      expect(override.source).toBe('channel-override');

      await publishPlanChanged(
        PRESERVE_CHANNEL,
        sub,
        String(unconfigured.id),
        'subscribed',
      );
      expect(await waitForOrgLimit(preserveOrgId, 4)).toBe(4);
    }, 30000);

    it('startup reconciliation repairs stragglers and is idempotent', async () => {
      // A fourth organisation: no subscription, no channel override. Its
      // resolution is generic, so its Admin value must survive the pass.
      const org = await seedOrg(RECON_CHANNEL, 7, 'e2e-recon-org');
      reconOrgId = String(org.id);

      // Wind the plan-derived org back to the column default, as if every event
      // had been lost — a crash between commit and consumption, or a tenant
      // created before this feature existed. This is what the pass exists for.
      const straggler = await orgRepo().findOne({ where: { id: freeOrgId } });
      straggler!.concurrentMeetingLimit = 5;
      await orgRepo().save(straggler!);

      const corrected = await reconciliation.reconcileAllOrganizations();

      // Exactly ONE org was stale; the rest already matched and must not be
      // written (the pass is not a blanket UPDATE).
      expect(corrected).toBe(1);
      // 5 → 3, the current plan's ceiling — not the Free Basic 1, proving the
      // pass re-derives from the policy rather than from a constant.
      expect(
        (await orgRepo().findOne({ where: { id: freeOrgId } }))!
          .concurrentMeetingLimit,
      ).toBe(3);
      // Channel override already matched → untouched.
      expect(
        (await orgRepo().findOne({ where: { id: preserveOrgId } }))!
          .concurrentMeetingLimit,
      ).toBe(4);
      // Generic resolution → Admin value preserved, no write.
      expect(
        (await orgRepo().findOne({ where: { id: reconOrgId } }))!
          .concurrentMeetingLimit,
      ).toBe(7);

      // Idempotent: nothing left to converge, so zero writes on a rerun. This
      // is the property that makes it safe to run on every boot.
      expect(await reconciliation.reconcileAllOrganizations()).toBe(0);
    }, 30000);
  });
});
