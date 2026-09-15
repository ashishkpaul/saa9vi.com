/**
 * Gate 3 — MEETING_ENDED → immutable BbbUsageLedger e2e.
 *
 * Infrastructure-gated: requires Postgres. Run:
 *   BBB_USAGE_LEDGER_E2E=true npx vitest run --config vitest.config.mts \
 *     src/plugins/bigbluebutton-plugin/e2e/bbb-usage-ledger.e2e-spec.ts
 *
 * Proves (docs/what-next.md Gate 3, INV-002):
 *
 *   G3-A  Happy path: meeting completion → exactly one ledger fact →
 *         grant consumption → MeetingCompletedEvent → session FINISHED.
 *   G3-B  Duplicate completion: second completion call is a no-op —
 *         ledger stays 1, grant unchanged.
 *   G3-C  Billing recovery: COMPLETED meeting without a ledger row is
 *         repaired by reconcilePendingBilling() exactly once, and the
 *         re-published MeetingCompletedEvent finishes a still-LIVE session.
 *   G3-D  Concurrent billing: N parallel consumeGrantHours() calls on the
 *         same (meeting, grant) produce ONE ledger row and ONE grant
 *         increment — insert-on-conflict is the idempotency decision.
 *   G3-E  Persisted grant linkage + cross-org isolation: billing consumes
 *         the meeting's stored grantId (Grant A), never another org's
 *         current grant (Grant B).
 *
 * Fixtures are created through Vendure services/TransactionalConnection
 * inside the test environment (the sanctioned service-layer path). No
 * manual SQL mutation is used anywhere.
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
  ChannelService,
  CurrencyCode,
  LanguageCode,
  mergeConfig,
  TransactionalConnection,
} from '@vendure/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getSuperadminContext } from '@vendure/testing/lib/utils/get-superadmin-context';

import { TenantPlugin } from '../../tenant-plugin/tenant-plugin.plugin';
import { BigBlueButtonPlugin } from '../bigbluebutton.plugin';
import { SchemaPostgresInitializer } from '../../tenant-plugin/e2e/schema-postgres-initializer';
import { BbbMeeting } from '../entities/bbb-meeting.entity';
import { BbbOrganization } from '../entities/bbb-organization.entity';
import { BbbServer } from '../entities/bbb-server.entity';
import { BbbCapacityGrant } from '../entities/bbb-capacity-grant.entity';
import { BbbUsageLedger } from '../entities/bbb-usage-ledger.entity';
import { BbbScheduledSession } from '../entities/bbb-scheduled-session.entity';
import { BbbReconciliationService } from '../services/bbb-reconciliation.service';
import { BbbMeetingService } from '../services/bbb-meeting.service';
import { MEETING_STATE } from '../constants';

registerInitializer('postgres', new SchemaPostgresInitializer());

const G3_E2E = process.env.BBB_USAGE_LEDGER_E2E === 'true';

async function assertPostgres(): Promise<void> {
  const host = process.env.DB_HOST ?? '127.0.0.1';
  const port = Number(process.env.DB_PORT ?? 5432);
  await new Promise<void>((resolve, reject) => {
    const sock = net.connect(port, host);
    sock.once('connect', () => { sock.destroy(); resolve(); });
    sock.once('error', (err) => reject(err));
  });
}

const { server } = createTestEnvironment(
  mergeConfig(testConfig, {
    apiOptions: { port: 3090 },
    dbConnectionOptions: {
      type: 'postgres',
      host: process.env.DB_HOST ?? '127.0.0.1',
      port: Number(process.env.DB_PORT ?? 5432),
      database: process.env.DB_NAME ?? 'vendure',
      username: process.env.DB_USERNAME ?? 'vendure_user',
      password: process.env.DB_PASSWORD ?? '',
      schema: 'e2e_bbb_usage_ledger',
      synchronize: true,
    },
    plugins: [TenantPlugin, BigBlueButtonPlugin],
  }),
);

// ─── helpers ────────────────────────────────────────────────────────────────

async function waitFor(
  fn: () => Promise<boolean>,
  timeoutMs = 5000,
  stepMs = 100,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, stepMs));
  }
  throw new Error('waitFor: condition not met within timeout');
}

describe('Gate 3 — usage ledger billing invariants', () => {
  const d = G3_E2E ? describe : describe.skip;

  let ctx: any;
  let connection: TransactionalConnection;
  let recon: BbbReconciliationService;
  let meetingService: BbbMeetingService;
  let org: BbbOrganization;
  let orgB: BbbOrganization;

  d('billing lifecycle', () => {
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
      recon = server.app.get(BbbReconciliationService);
      meetingService = server.app.get(BbbMeetingService);

      const orgRepo = connection.getRepository(ctx, BbbOrganization);
      org = await orgRepo.save(
        orgRepo.create({
          channelId: String(ctx.channelId),
          name: `Ledger Org A ${Date.now()}`,
          slug: `ledger-org-a-${Date.now()}`,
          ownerUserId: '1',
          concurrentMeetingLimit: 5,
        }),
      );
      // Channel = Tenant (INV-001): each org owns exactly one channel, so the
      // cross-org isolation fixture needs its own Vendure channel.
      const channelService = server.app.get(ChannelService);
      const orgBChannelResult = await channelService.create(ctx, {
        code: `g3_org_b_${Date.now()}`,
        token: `g3-org-b-token-${Date.now()}`,
        defaultLanguageCode: LanguageCode.en,
        defaultCurrencyCode: CurrencyCode.INR,
        pricesIncludeTax: true,
      } as any);
      if (!('id' in orgBChannelResult)) {
        throw new Error(
          `Failed to create channel for org B: ${JSON.stringify(orgBChannelResult)}`,
        );
      }
      const orgBChannel = orgBChannelResult;

      orgB = await orgRepo.save(
        orgRepo.create({
          channelId: String(orgBChannel.id),
          name: `Ledger Org B ${Date.now()}`,
          slug: `ledger-org-b-${Date.now()}`,
          ownerUserId: '1',
          concurrentMeetingLimit: 5,
        }),
      );

      const serverRepo = connection.getRepository(ctx, BbbServer);
      await serverRepo.save(
        serverRepo.create({
          name: `Ledger Test Server ${Date.now()}`,
          apiUrl: 'http://localhost:1999/bigbluebutton/api',
          encryptedApiSecret: 'test-secret',
          enabled: true,
          healthy: true,
          currentLoad: 0,
          maxLoad: 100,
          capacity: 100,
        }),
      );
    }, 60000);

    afterAll(async () => {
      await server.destroy();
    });

    /**
     * Creates an ACTIVE meeting provisioned `minutesAgo` minutes ago, linked
     * to `grant`, optionally with a LIVE scheduled session attached via
     * activeMeeting (so the lifecycle listener path is exercised).
     */
    async function makeActiveMeeting(opts: {
      grant: BbbCapacityGrant;
      minutesAgo: number;
      org: BbbOrganization;
      withSession?: boolean;
    }): Promise<BbbMeeting> {
      const meetingRepo = connection.getRepository(ctx, BbbMeeting);
      const provisionedAt = new Date(Date.now() - opts.minutesAgo * 60_000);
      const meeting = await meetingRepo.save(
        meetingRepo.create({
          title: `G3 meeting ${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          state: MEETING_STATE.ACTIVE,
          organization: opts.org,
          grantId: String(opts.grant.id),
          provisionedAt,
        }),
      );

      if (opts.withSession) {
        const sessionRepo = connection.getRepository(ctx, BbbScheduledSession);
        await sessionRepo.save(
          sessionRepo.create({
            title: `G3 session for meeting ${meeting.id}`,
            startTime: new Date(Date.now() - 30 * 60_000),
            endTime: new Date(Date.now() + 30 * 60_000),
            status: 'LIVE',
            organization: opts.org,
            organizationId: String(opts.org.id),
            activeMeeting: meeting,
            channelId: String(ctx.channelId),
            slug: `g3-${meeting.id}`,
          }),
        );
      }
      return meeting;
    }

    async function ledgerCount(meetingId: string): Promise<number> {
      return connection
        .getRepository(ctx, BbbUsageLedger)
        .count({ where: { meeting: { id: meetingId } } });
    }

    async function freshGrant(
      orgRef: BbbOrganization,
      grantedMinutes = 600,
    ): Promise<BbbCapacityGrant> {
      const grantRepo = connection.getRepository(ctx, BbbCapacityGrant);
      return grantRepo.save(
        grantRepo.create({
          organization: orgRef,
          grantedMinutes,
          consumedMinutes: 0,
          validFrom: new Date(Date.now() - 3600_000),
          validUntil: new Date(Date.now() + 3600_000),
          exhausted: false,
          sourceType: 'order',
        }),
      );
    }

    async function reloadGrant(id: string): Promise<BbbCapacityGrant> {
      return connection
        .getRepository(ctx, BbbCapacityGrant)
        .findOneOrFail({ where: { id } });
    }

    /** Force a meeting to COMPLETED without going through billing. */
    async function forceComplete(meetingId: string): Promise<void> {
      await connection
        .getRepository(ctx, BbbMeeting)
        .update(meetingId, {
          state: MEETING_STATE.COMPLETED,
          completedAt: new Date(),
        });
    }

    async function sessionStatus(meetingId: string): Promise<string | null> {
      const s = await connection
        .getRepository(ctx, BbbScheduledSession)
        .findOne({ where: { activeMeeting: { id: meetingId } } });
      return s?.status ?? null;
    }

    /** Rounding rule from consumeGrantHours: ceil to whole minutes, min 1. */
    function expectedMinutes(
      provisionedAt: Date | null | undefined,
      completedAt: Date | null | undefined,
    ): number {
      const ms =
        (completedAt ?? new Date()).getTime() -
        (provisionedAt as Date).getTime();
      return Math.max(1, Math.ceil(ms / 60_000));
    }

    async function getLedger(meetingId: string): Promise<BbbUsageLedger> {
      return connection.getRepository(ctx, BbbUsageLedger).findOneOrFail({
        where: { meeting: { id: meetingId } },
        relations: ['meeting', 'grant'],
      });
    }

    // ── G3-A ──────────────────────────────────────────────────────────────
    it('G3-A: completion bills exactly once and finishes the linked session', async () => {
      const grant = await freshGrant(org);
      const meeting = await makeActiveMeeting({
        grant,
        minutesAgo: 10,
        org,
        withSession: true,
      });

      const completed = await meetingService.completeMeetingLifecycle(
        ctx,
        meeting.id as string,
        { source: 'webhook' },
      );

      expect(completed.state).toBe(MEETING_STATE.COMPLETED);
      expect(completed.completedAt).toBeTruthy();
      const expected = expectedMinutes(
        meeting.provisionedAt,
        completed.completedAt,
      );

      await waitFor(async () => (await ledgerCount(meeting.id as string)) === 1);
      const ledger = await getLedger(meeting.id as string);
      expect(ledger.consumedMinutes).toBe(expected);
      expect(String(ledger.grant.id)).toBe(String(grant.id));

      const billedGrant = await reloadGrant(grant.id as string);
      expect(billedGrant.consumedMinutes).toBe(expected);
      expect(billedGrant.exhausted).toBe(false);

      // Session LIVE → FINISHED via the re-published lifecycle event.
      await waitFor(
        async () => (await sessionStatus(meeting.id as string)) === 'FINISHED',
      );
    }, 30000);

    // ── G3-B ──────────────────────────────────────────────────────────────
    it('G3-B: duplicate completion is a no-op (ledger stays 1, grant unchanged)', async () => {
      const grant = await freshGrant(org);
      const meeting = await makeActiveMeeting({ grant, minutesAgo: 5, org });

      await meetingService.completeMeetingLifecycle(ctx, meeting.id as string, {
        source: 'webhook',
      });
      const grantAfterFirst = await reloadGrant(grant.id as string);

      // Duplicate delivery of the same logical completion.
      const again = await meetingService.completeMeetingLifecycle(
        ctx,
        meeting.id as string,
        { source: 'webhook' },
      );
      expect(again.state).toBe(MEETING_STATE.COMPLETED);

      expect(await ledgerCount(meeting.id as string)).toBe(1);
      const grantAfterDup = await reloadGrant(grant.id as string);
      expect(grantAfterDup.consumedMinutes).toBe(grantAfterFirst.consumedMinutes);
    }, 30000);

    // ── G3-C ──────────────────────────────────────────────────────────────
    it('G3-C: reconcilePendingBilling recovers a COMPLETED meeting without a ledger row', async () => {
      const grant = await freshGrant(org);
      const meeting = await makeActiveMeeting({
        grant,
        minutesAgo: 7,
        org,
        withSession: true,
      });

      // Simulate "meeting completed but billing failed": force the terminal
      // state without the billing path, leaving zero ledger rows.
      await forceComplete(meeting.id as string);
      expect(await ledgerCount(meeting.id as string)).toBe(0);

      const persistedAfterForce = await connection
        .getRepository(ctx, BbbMeeting)
        .findOneOrFail({ where: { id: meeting.id as string } });
      const expected = expectedMinutes(
        persistedAfterForce.provisionedAt,
        persistedAfterForce.completedAt,
      );

      const recovered = await recon.reconcilePendingBilling();
      expect(recovered).toBeGreaterThanOrEqual(1);

      await waitFor(async () => (await ledgerCount(meeting.id as string)) === 1);
      const ledger = await getLedger(meeting.id as string);
      expect(ledger.consumedMinutes).toBe(expected);

      const billedGrant = await reloadGrant(grant.id as string);
      expect(billedGrant.consumedMinutes).toBe(expected);

      // Re-published MeetingCompletedEvent must finish the still-LIVE session.
      await waitFor(
        async () => (await sessionStatus(meeting.id as string)) === 'FINISHED',
      );

      // Recovery is idempotent: a second scan must not re-bill.
      const grantBefore = (await reloadGrant(grant.id as string)).consumedMinutes;
      await recon.reconcilePendingBilling();
      expect(await ledgerCount(meeting.id as string)).toBe(1);
      expect((await reloadGrant(grant.id as string)).consumedMinutes).toBe(grantBefore);
    }, 30000);

    // ── G3-D ──────────────────────────────────────────────────────────────
    it('G3-D: 6 concurrent consumeGrantHours calls produce ONE ledger row and ONE increment', async () => {
      const grant = await freshGrant(org);
      const meeting = await makeActiveMeeting({ grant, minutesAgo: 4, org });
      await forceComplete(meeting.id as string);

      const persisted = await connection
        .getRepository(ctx, BbbMeeting)
        .findOneOrFail({ where: { id: meeting.id as string } });
      const expected = expectedMinutes(persisted.provisionedAt, persisted.completedAt);

      const results = await Promise.allSettled(
        Array.from({ length: 6 }, () =>
          recon.consumeGrantHours(ctx, persisted),
        ),
      );
      // No worker may surface an unhandled unique-violation failure.
      for (const r of results) {
        expect(r.status).toBe('fulfilled');
      }

      expect(await ledgerCount(meeting.id as string)).toBe(1);
      const ledger = await getLedger(meeting.id as string);
      expect(ledger.consumedMinutes).toBe(expected);

      const billedGrant = await reloadGrant(grant.id as string);
      // Exactly one increment — not 6 × expected.
      expect(billedGrant.consumedMinutes).toBe(expected);
    }, 30000);

    // ── G3-E ──────────────────────────────────────────────────────────────
    it('G3-E: billing consumes the meeting’s persisted grant, never another org’s current grant', async () => {
      const grantA = await freshGrant(org); // persisted on the meeting
      const grantB = await freshGrant(orgB); // "current" elsewhere — must not move

      const meeting = await makeActiveMeeting({
        grant: grantA,
        minutesAgo: 6,
        org,
      });
      await forceComplete(meeting.id as string);

      const persisted = await connection
        .getRepository(ctx, BbbMeeting)
        .findOneOrFail({ where: { id: meeting.id as string } });
      const expected = expectedMinutes(persisted.provisionedAt, persisted.completedAt);
      await recon.consumeGrantHours(ctx, persisted);

      const ledger = await getLedger(meeting.id as string);
      expect(String(ledger.grant.id)).toBe(String(grantA.id));
      expect(ledger.consumedMinutes).toBe(expected);

      expect((await reloadGrant(grantA.id as string)).consumedMinutes).toBe(expected);
      expect((await reloadGrant(grantB.id as string)).consumedMinutes).toBe(0);
    }, 30000);
  });
});




