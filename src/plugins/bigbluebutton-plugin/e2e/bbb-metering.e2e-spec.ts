/**
 * ADR-047 Phase 2B — metered attendee-hour billing e2e (INV-028 / INV-002).
 *
 * Infrastructure-gated: requires Postgres. Run:
 *   BBB_METERING_E2E=true npx vitest run --config vitest.config.mts \
 *     src/plugins/bigbluebutton-plugin/e2e/bbb-metering.e2e-spec.ts
 *
 * Proves the Phase 2B metering layer on real Postgres through the real wiring
 * (the real `BbbMeteringService`, the real recovery scan, and the real
 * provisioning gate — never by calling a private helper):
 *
 *   M1  Sampling scope — only ACTIVE meetings of `metered` orgs are sampled.
 *       A `grant` org's ACTIVE meeting is never sampled (INV-028: its billing
 *       truth is the ledger, so a sample would be dead weight), and a
 *       COMPLETED metered meeting is not sampled either.
 *   M2  At-least-once safety — two ticks inside the SAME minute produce ONE
 *       sample row (the unique `(meetingId, bucketMinute)` + ON CONFLICT,
 *       INV-002). An overlapping tick must never double-count minutes.
 *   M3  Freeze on completion — `billMeteredMeeting()` writes ONE
 *       `BbbMeteredUsage` row whose `learnerMinutes` is Σ sample
 *       `learnerCount`, and re-billing the same meeting is a no-op that
 *       returns the same row id. Trainers (moderators) are never billable.
 *   M4  Rate snapshot — the org's own `ratePaisePerLearnerHour` wins; only an
 *       org WITHOUT a rate falls back to the plugin default
 *       (`defaultRatePaisePerLearnerHour`). A later rate change cannot
 *       re-price the frozen row.
 *   M5  Duration cap — when reconciliation force-completed a meeting
 *       (`billingCapped`), samples at/after `provisionedAt +
 *       maxMeetingDurationMs` are excluded from the frozen learner-minutes.
 *   M6  Recovery scan — a COMPLETED metered meeting with no usage row is
 *       billed exactly once by `reconcilePendingMeteredBilling()`, and the
 *       scan then terminates (second sweep bills 0). A `grant` org's
 *       COMPLETED meeting is never picked up by the metered scan.
 *
 * Fixtures are created through Vendure services / `TransactionalConnection`
 * inside the test environment (the sanctioned service-layer path). No manual
 * SQL mutation is used anywhere; the only replaced component is the outbound
 * BBB HTTP hop, exactly as `r4-runtime-lifecycle.e2e-spec.ts` does.
 */

import 'reflect-metadata';
import 'dotenv/config';
import net from 'net';
import {
  createTestEnvironment,
  registerInitializer,
  testConfig,
} from '@vendure/testing';
import { startOnFreePort } from '../../../test-utils/free-port';
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
import { BbbApiService } from '../services/bbb-api.service';
import { BbbMeeting } from '../entities/bbb-meeting.entity';
import { BbbMeetingSample } from '../entities/bbb-meeting-sample.entity';
import { BbbMeteredUsage } from '../entities/bbb-metered-usage.entity';
import { BbbOrganization } from '../entities/bbb-organization.entity';
import { BbbServer } from '../entities/bbb-server.entity';
import { BbbMeteringService } from '../services/bbb-metering.service';
import { BbbEncryptionService } from '../services/bbb-encryption.service';
import { BbbReconciliationService } from '../services/bbb-reconciliation.service';
import { BILLING_MODE, MEETING_STATE } from '../constants';
import { monthOf } from '../services/metered-billing.policy';

registerInitializer('postgres', new SchemaPostgresInitializer());

const METERING_E2E = process.env.BBB_METERING_E2E === 'true';

/** Plugin default (paise / learner-hour) — only used when the org has none. */
const PLUGIN_DEFAULT_RATE = 1200;
/** Org-level override — must win over the plugin default. */
const ORG_RATE = 900;
/** 1 hour, so the M5 cap test needs no clock control. */
const MAX_MEETING_DURATION_MS = 60 * 60 * 1000;

async function assertPostgres(): Promise<void> {
  const host = process.env.DB_HOST ?? '127.0.0.1';
  const port = Number(process.env.DB_PORT ?? 5432);
  await new Promise<void>((resolve, reject) => {
    const sock = net.connect(port, host);
    sock.once('connect', () => {
      sock.destroy();
      resolve();
    });
    sock.once('error', (err) => reject(err));
  });
}

const { server, adminClient, shopClient } = createTestEnvironment(
  mergeConfig(testConfig, {
    // Free port assigned by startOnFreePort() in beforeAll (test-utils/free-port).
    apiOptions: { port: 0 },
    dbConnectionOptions: {
      type: 'postgres',
      host: process.env.DB_HOST ?? '127.0.0.1',
      port: Number(process.env.DB_PORT ?? 5432),
      database: process.env.DB_NAME ?? 'vendure',
      username: process.env.DB_USERNAME ?? 'vendure_user',
      password: process.env.DB_PASSWORD ?? '',
      schema: 'e2e_bbb_metering',
      synchronize: true,
    },
    plugins: [
      TenantPlugin,
      BigBlueButtonPlugin.init({
        defaultRatePaisePerLearnerHour: PLUGIN_DEFAULT_RATE,
        maxMeetingDurationMs: MAX_MEETING_DURATION_MS,
      }),
    ],
  }),
);

describe('Phase 2B — metered attendee-hour billing', () => {
  const d = METERING_E2E ? describe : describe.skip;

  let ctx: any;
  let connection: TransactionalConnection;
  let metering: BbbMeteringService;
  let recon: BbbReconciliationService;
  let encryption: BbbEncryptionService;
  let meteredOrg: BbbOrganization;
  let defaultRateOrg: BbbOrganization;
  let grantOrg: BbbOrganization;
  let bbbServerId: string;

  // Controllable BBB occupancy for the ONE replaced hop (outbound HTTP).
  let participantCount = 5;
  let moderatorCount = 2;

  d('metering lifecycle', () => {
    beforeAll(async () => {
      await assertPostgres();
      await startOnFreePort({ server, adminClient, shopClient }, {
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
      metering = server.app.get(BbbMeteringService);
      recon = server.app.get(BbbReconciliationService);
      encryption = server.app.get(BbbEncryptionService);

      const channelService = server.app.get(ChannelService);
      const orgRepo = connection.getRepository(ctx, BbbOrganization);
      const stamp = `${Date.now()}`;

      /**
       * One org per Vendure channel — Channel = Tenant (INV-001), so the
       * fixtures cannot share `ctx.channelId` (`channelId` is unique).
       */
      async function createOrg(opts: {
        suffix: string;
        billingMode: string;
        rate: number | null;
      }): Promise<BbbOrganization> {
        const channelResult = await channelService.create(ctx, {
          code: `meter_${opts.suffix}_${stamp}`,
          token: `meter-${opts.suffix}-token-${stamp}`,
          defaultLanguageCode: LanguageCode.en,
          defaultCurrencyCode: CurrencyCode.INR,
          pricesIncludeTax: true,
        } as any);
        if (!('id' in channelResult)) {
          throw new Error(
            `Failed to create channel ${opts.suffix}: ${JSON.stringify(channelResult)}`,
          );
        }
        return orgRepo.save(
          orgRepo.create({
            channelId: String(channelResult.id),
            name: `Meter Org ${opts.suffix} ${stamp}`,
            slug: `meter-org-${opts.suffix}-${stamp}`,
            ownerUserId: '1',
            concurrentMeetingLimit: 5,
            billingMode: opts.billingMode as any,
            ratePaisePerLearnerHour: opts.rate,
          }),
        );
      }

      // The org-level rate must beat the plugin default (M4).
      meteredOrg = await createOrg({
        suffix: 'rate',
        billingMode: BILLING_MODE.METERED,
        rate: ORG_RATE,
      });
      defaultRateOrg = await createOrg({
        suffix: 'default',
        billingMode: BILLING_MODE.METERED,
        rate: null,
      });
      grantOrg = await createOrg({
        suffix: 'grant',
        billingMode: BILLING_MODE.GRANT,
        rate: null,
      });

      const serverRepo = connection.getRepository(ctx, BbbServer);
      const bbbServer = await serverRepo.save(
        serverRepo.create({
          name: `Metering Test Server ${stamp}`,
          apiUrl: 'http://localhost:1999/bigbluebutton/api',
          encryptedApiSecret: 'test-secret',
          enabled: true,
          healthy: true,
          currentLoad: 0,
          maxLoad: 100,
          capacity: 100,
        }),
      );
      bbbServerId = String(bbbServer.id);

      installStubbedBbbTransport();
    }, 60000);

    afterAll(async () => {
      await server.destroy();
    });

    /**
     * Replaces only the outbound BBB HTTP hop on the injected service — the
     * precedent set by `r4-runtime-lifecycle.e2e-spec.ts:882-912`. The
     * sampler's query, scoping, INSERT ... ON CONFLICT and learner maths all
     * run for real.
     */
    function installStubbedBbbTransport(): void {
      const real: any = server.app.get(BbbApiService);
      const stubbed: any = Object.create(real);
      stubbed.getMeetingInfo = async () => ({
        meetingID: 'metering-meeting',
        internalMeetingID: 'metering-internal',
        running: true,
        participantCount,
        moderatorCount,
        recording: false,
        startTime: 0,
        endTime: 0,
      });
      (metering as any).bbbApiService = stubbed;
    }

    async function makeMeeting(opts: {
      org: BbbOrganization;
      state: string;
      provisionedAt: Date;
      completedAt?: Date | null;
      billingCapped?: boolean;
      /** true → carry the fields the sampler needs to observe it. */
      observable?: boolean;
      grantId?: string | null;
    }): Promise<BbbMeeting> {
      const repo = connection.getRepository(ctx, BbbMeeting);
      return repo.save(
        repo.create({
          title: `Meter meeting ${Date.now()}-${Math.random()
            .toString(36)
            .slice(2, 7)}`,
          state: opts.state as any,
          organization: opts.org,
          provisionedAt: opts.provisionedAt,
          completedAt: opts.completedAt ?? undefined,
          billingCapped: opts.billingCapped ?? false,
          grantId: opts.grantId ?? null,
          bbbMeetingId: opts.observable ? `meter-${Date.now()}` : undefined,
          serverId: opts.observable ? bbbServerId : undefined,
          // Observable meetings carry an encrypted moderator password — the
          // provisioning path always stores one, and the sampler skips a
          // meeting without it as a counted gap (the W5-8 reconcile rule).
          encryptedModeratorPassword: opts.observable
            ? encryption.encrypt('meter-e2e-mod-pw')
            : undefined,
        }),
      );
    }

    async function addSample(opts: {
      meetingId: string;
      bucketMinute: Date;
      learnerCount: number;
      moderatorCount?: number;
    }): Promise<void> {
      const repo = connection.getRepository(ctx, BbbMeetingSample);
      await repo.save(
        repo.create({
          meetingId: opts.meetingId,
          bucketMinute: opts.bucketMinute,
          learnerCount: opts.learnerCount,
          moderatorCount: opts.moderatorCount ?? 0,
        }),
      );
    }

    async function samplesFor(meetingId: string): Promise<BbbMeetingSample[]> {
      return connection
        .getRepository(ctx, BbbMeetingSample)
        .find({ where: { meetingId } });
    }

    async function usageFor(meetingId: string): Promise<BbbMeteredUsage[]> {
      return connection
        .getRepository(ctx, BbbMeteredUsage)
        .find({ where: { meetingId } });
    }

    // ── M1 — sampling scope ───────────────────────────────────────────────
    it('M1 samples ACTIVE meetings of metered orgs only (INV-028)', async () => {
      participantCount = 5;
      moderatorCount = 2;
      const now = new Date();
      const provisionedAt = new Date(now.getTime() - 10 * 60_000);

      const meteredActive = await makeMeeting({
        org: meteredOrg,
        state: MEETING_STATE.ACTIVE,
        provisionedAt,
        observable: true,
      });
      const grantActive = await makeMeeting({
        org: grantOrg,
        state: MEETING_STATE.ACTIVE,
        provisionedAt,
        observable: true,
      });
      const meteredCompleted = await makeMeeting({
        org: meteredOrg,
        state: MEETING_STATE.COMPLETED,
        provisionedAt,
        completedAt: now,
        observable: true,
      });

      const result = await metering.sampleActiveMeetings(now);

      // Stub reports participantCount 5 / moderatorCount 2 → 3 billable
      // learners (D1: trainers are never billable).
      const meteredSamples = await samplesFor(String(meteredActive.id));
      expect(meteredSamples).toHaveLength(1);
      expect(meteredSamples[0].learnerCount).toBe(3);
      expect(meteredSamples[0].moderatorCount).toBe(2);

      // The grant org's live meeting is never sampled — its billing truth is
      // the ledger, so a sample would be dead weight (INV-028).
      expect(await samplesFor(String(grantActive.id))).toHaveLength(0);
      // Only live meetings are sampled; the fee for a finished one is frozen.
      expect(await samplesFor(String(meteredCompleted.id))).toHaveLength(0);

      expect(result.scanned).toBeGreaterThanOrEqual(1);
      expect(result.sampled).toBeGreaterThanOrEqual(1);
      expect(result.failed).toBe(0);
    });

    // ── M2 — overlapping tick idempotency ─────────────────────────────────
    it('M2 absorbs an overlapping tick in the same minute (INV-002)', async () => {
      participantCount = 4;
      moderatorCount = 1;
      const now = new Date();
      const meeting = await makeMeeting({
        org: meteredOrg,
        state: MEETING_STATE.ACTIVE,
        provisionedAt: new Date(now.getTime() - 5 * 60_000),
        observable: true,
      });

      // Three ticks at the SAME instant → same bucketMinute. The scheduler is
      // at-least-once, so this overlap must collapse to one row.
      await metering.sampleActiveMeetings(now);
      await metering.sampleActiveMeetings(now);
      await metering.sampleActiveMeetings(now);

      const samples = await samplesFor(String(meeting.id));
      expect(samples).toHaveLength(1);
      expect(samples[0].learnerCount).toBe(3);
    });

    // ── M3 — freeze on completion ─────────────────────────────────────────
    it('M3 freezes Σ learner-minutes into ONE usage row, idempotently', async () => {
      const completedAt = new Date();
      const provisionedAt = new Date(completedAt.getTime() - 30 * 60_000);
      const meeting = await makeMeeting({
        org: meteredOrg,
        state: MEETING_STATE.COMPLETED,
        provisionedAt,
        completedAt,
      });
      const meetingId = String(meeting.id);

      // 2 + 3 + 4 learners across three minutes → 9 learner-minutes.
      await addSample({
        meetingId,
        bucketMinute: new Date(provisionedAt.getTime() + 60_000),
        learnerCount: 2,
        moderatorCount: 1,
      });
      await addSample({
        meetingId,
        bucketMinute: new Date(provisionedAt.getTime() + 120_000),
        learnerCount: 3,
        moderatorCount: 1,
      });
      await addSample({
        meetingId,
        bucketMinute: new Date(provisionedAt.getTime() + 180_000),
        learnerCount: 4,
        moderatorCount: 1,
      });

      const firstId = await metering.billMeteredMeeting(ctx, meetingId);
      const secondId = await metering.billMeteredMeeting(ctx, meetingId);
      expect(firstId).toBeTruthy();
      // ON CONFLICT (meetingId) → the retry finds and returns the same row.
      expect(secondId).toBe(firstId);

      const rows = await usageFor(meetingId);
      expect(rows).toHaveLength(1);
      expect(rows[0].learnerMinutes).toBe(9);
      expect(rows[0].peakLearners).toBe(4);
      expect(rows[0].peakModerators).toBe(1);
      expect(rows[0].ratePaisePerHour).toBe(ORG_RATE);
      expect(rows[0].periodMonth).toBe(monthOf(completedAt));
      expect(rows[0].organizationId).toBe(String(meteredOrg.id));
      expect(rows[0].channelId).toBe(String(meteredOrg.channelId));
      expect(rows[0].billingCapped).toBe(false);
    });

    it('M3b writes a zero-minute (trainer-only) row rather than nothing', async () => {
      const completedAt = new Date();
      const provisionedAt = new Date(completedAt.getTime() - 5 * 60_000);
      const meeting = await makeMeeting({
        org: meteredOrg,
        state: MEETING_STATE.COMPLETED,
        provisionedAt,
        completedAt,
      });
      const meetingId = String(meeting.id);

      // A setup call: two trainers, no learners (D1/D9).
      await addSample({
        meetingId,
        bucketMinute: new Date(provisionedAt.getTime() + 60_000),
        learnerCount: 0,
        moderatorCount: 2,
      });

      expect(await metering.billMeteredMeeting(ctx, meetingId)).toBeTruthy();
      const rows = await usageFor(meetingId);
      // The row is written even at zero: it proves the meeting was accounted
      // for and it terminates the recovery scan (A14).
      expect(rows).toHaveLength(1);
      expect(rows[0].learnerMinutes).toBe(0);
      expect(rows[0].peakLearners).toBe(0);
      expect(rows[0].peakModerators).toBe(2);
    });

    it('M3c billMeteredMeeting is a no-op for a grant org (INV-028)', async () => {
      const completedAt = new Date();
      const meeting = await makeMeeting({
        org: grantOrg,
        state: MEETING_STATE.COMPLETED,
        provisionedAt: new Date(completedAt.getTime() - 10 * 60_000),
        completedAt,
      });
      expect(await metering.billMeteredMeeting(ctx, String(meeting.id))).toBeNull();
      expect(await usageFor(String(meeting.id))).toHaveLength(0);
    });

    // ── M4 — rate snapshot ────────────────────────────────────────────────
    it('M4 snapshots the org rate, falling back to the plugin default', async () => {
      const completedAt = new Date();
      const provisionedAt = new Date(completedAt.getTime() - 20 * 60_000);

      const orgRated = await makeMeeting({
        org: meteredOrg,
        state: MEETING_STATE.COMPLETED,
        provisionedAt,
        completedAt,
      });
      const defaultRated = await makeMeeting({
        org: defaultRateOrg,
        state: MEETING_STATE.COMPLETED,
        provisionedAt,
        completedAt,
      });
      for (const m of [orgRated, defaultRated]) {
        await addSample({
          meetingId: String(m.id),
          bucketMinute: new Date(provisionedAt.getTime() + 60_000),
          learnerCount: 4,
        });
        await metering.billMeteredMeeting(ctx, String(m.id));
      }

      const [orgRow] = await usageFor(String(orgRated.id));
      const [defaultRow] = await usageFor(String(defaultRated.id));
      expect(orgRow.ratePaisePerHour).toBe(ORG_RATE);
      expect(defaultRow.ratePaisePerHour).toBe(PLUGIN_DEFAULT_RATE);

      // Re-pricing after the fact must not rewrite frozen history
      // (ADR-047 decision 3: the rate is snapshotted at completion).
      await connection
        .getRepository(ctx, BbbOrganization)
        .update(String(meteredOrg.id), { ratePaisePerLearnerHour: ORG_RATE * 3 });
      const [stillFrozen] = await usageFor(String(orgRated.id));
      expect(stillFrozen.ratePaisePerHour).toBe(ORG_RATE);
      await connection
        .getRepository(ctx, BbbOrganization)
        .update(String(meteredOrg.id), { ratePaisePerLearnerHour: ORG_RATE });
    });

    // ── M5 — duration cap ─────────────────────────────────────────────────
    it('M5 excludes samples past provisionedAt + maxMeetingDurationMs', async () => {
      const provisionedAt = new Date(Date.now() - 3 * 60 * 60_000); // 3h ago
      const completedAt = new Date(Date.now() - 60 * 60_000);
      const minuteOffsets = [10, 50, 70, 90];
      const learnerCounts = [5, 7, 100, 100];

      async function seedSamples(meetingId: string): Promise<void> {
        for (let i = 0; i < minuteOffsets.length; i++) {
          await addSample({
            meetingId,
            bucketMinute: new Date(
              provisionedAt.getTime() + minuteOffsets[i] * 60_000,
            ),
            learnerCount: learnerCounts[i],
          });
        }
      }

      // Reconciliation force-completed this one at the 1h ceiling.
      const capped = await makeMeeting({
        org: meteredOrg,
        state: MEETING_STATE.COMPLETED,
        provisionedAt,
        completedAt,
        billingCapped: true,
      });
      // Control: identical samples, but the meeting was not capped.
      const uncapped = await makeMeeting({
        org: meteredOrg,
        state: MEETING_STATE.COMPLETED,
        provisionedAt,
        completedAt,
        billingCapped: false,
      });
      await seedSamples(String(capped.id));
      await seedSamples(String(uncapped.id));

      await metering.billMeteredMeeting(ctx, String(capped.id));
      await metering.billMeteredMeeting(ctx, String(uncapped.id));

      const [cappedRow] = await usageFor(String(capped.id));
      const [uncappedRow] = await usageFor(String(uncapped.id));
      // +10m and +50m are inside the ceiling; +70m and +90m are not billed.
      expect(cappedRow.learnerMinutes).toBe(12);
      expect(uncappedRow.learnerMinutes).toBe(212);
      // Peak is an observation about the meeting, not a billable quantity, so
      // it is still reported from the full sample set.
      expect(cappedRow.peakLearners).toBe(100);
      expect(cappedRow.billingCapped).toBe(true);
      expect(uncappedRow.billingCapped).toBe(false);
    });

    // ── M6 — recovery scan ────────────────────────────────────────────────
    it('M6 recovery scan bills a stranded COMPLETED metered meeting once', async () => {
      const completedAt = new Date();
      const provisionedAt = new Date(completedAt.getTime() - 20 * 60_000);
      const stranded = await makeMeeting({
        org: meteredOrg,
        state: MEETING_STATE.COMPLETED,
        provisionedAt,
        completedAt,
      });
      const strandedId = String(stranded.id);
      await addSample({
        meetingId: strandedId,
        bucketMinute: new Date(provisionedAt.getTime() + 60_000),
        learnerCount: 6,
      });
      // The crash window: completed, samples present, no billing fact yet.
      expect(await usageFor(strandedId)).toHaveLength(0);
      expect(await metering.findUnbilledCompletedMeetings(500)).toContain(
        strandedId,
      );

      const firstSweep = await recon.reconcilePendingMeteredBilling();
      expect(firstSweep).toBeGreaterThanOrEqual(1);
      const rows = await usageFor(strandedId);
      expect(rows).toHaveLength(1);
      expect(rows[0].learnerMinutes).toBe(6);

      // The frozen row terminates the scan: the same meeting is never billed
      // twice and never re-scanned forever (A14 / INV-002).
      expect(await recon.reconcilePendingMeteredBilling()).toBe(0);
      expect(await usageFor(strandedId)).toHaveLength(1);
    });

    it('M6b the metered scan never picks up a grant org meeting', async () => {
      const completedAt = new Date();
      const meeting = await makeMeeting({
        org: grantOrg,
        state: MEETING_STATE.COMPLETED,
        provisionedAt: new Date(completedAt.getTime() - 10 * 60_000),
        completedAt,
      });
      const meetingId = String(meeting.id);

      expect(await metering.findUnbilledCompletedMeetings(500)).not.toContain(
        meetingId,
      );
      await recon.reconcilePendingMeteredBilling();
      expect(await usageFor(meetingId)).toHaveLength(0);
    });

    // ── M7 — retention (plan item 8) ──────────────────────────────────────
    it('M7 prunes only samples whose meeting can no longer be billed', async () => {
      const old = new Date(Date.now() - 60 * 24 * 60 * 60_000); // 60 days ago
      const completedAt = new Date(old.getTime() + 10 * 60_000);

      // Billed + terminal → the frozen usage row is the bill, prune away.
      const billed = await makeMeeting({
        org: meteredOrg,
        state: MEETING_STATE.COMPLETED,
        provisionedAt: old,
        completedAt,
      });
      await addSample({
        meetingId: String(billed.id),
        bucketMinute: old,
        learnerCount: 3,
      });
      await metering.billMeteredMeeting(ctx, String(billed.id));

      // COMPLETED, not yet billed → these samples ARE the bill. Pruning them
      // would erase learner-minutes that were never invoiced.
      const unbilled = await makeMeeting({
        org: meteredOrg,
        state: MEETING_STATE.COMPLETED,
        provisionedAt: old,
        completedAt: new Date(old.getTime() + 20 * 60_000),
      });
      await addSample({
        meetingId: String(unbilled.id),
        bucketMinute: new Date(old.getTime() + 60_000),
        learnerCount: 9,
      });

      // LIVE → sampled input for a meeting that is still running.
      const live = await makeMeeting({
        org: meteredOrg,
        state: MEETING_STATE.ACTIVE,
        provisionedAt: old,
        observable: true,
      });
      await addSample({
        meetingId: String(live.id),
        bucketMinute: old,
        learnerCount: 2,
      });

      const pruned = await metering.pruneSamples(35);
      expect(pruned).toBeGreaterThanOrEqual(1);
      expect(await samplesFor(String(billed.id))).toHaveLength(0);
      expect(await samplesFor(String(unbilled.id))).toHaveLength(1);
      expect(await samplesFor(String(live.id))).toHaveLength(1);

      // The surviving unbilled meeting is still billable after the sweep.
      await metering.billMeteredMeeting(ctx, String(unbilled.id));
      const [row] = await usageFor(String(unbilled.id));
      expect(row.learnerMinutes).toBe(9);
    });

  });
});

