/**
 * B3 — money-path e2e: provision → sample → end → usage row → billing summary.
 *
 * Infrastructure-gated: requires Postgres. Run:
 *   BBB_MONEY_PATH_E2E=true npx vitest run --config vitest.config.mts \
 *     src/plugins/bigbluebutton-plugin/e2e/bbb-money-path.e2e-spec.ts
 *
 * Unlike R4 (which replaces whole BbbApiService methods on the injected
 * instance) this spec runs the REAL `BbbApiService` — real checksum builder,
 * real XML parsing, real typed errors — and fakes ONLY the network hop via
 * `vi.stubGlobal('fetch', …)` returning canned BBB XML envelopes. That pins
 * the contract the money path actually depends on: `create` returns the
 * internal/meeting ids, `getMeetingInfo` reports occupancy, and the sampler's
 * learner maths (participants − moderators) flows into the frozen usage row
 * and out through `bbbBillingSummary`.
 *
 * Path: createMeeting (real service, fake fetch) → ACTIVE meeting row →
 * 4 × sampleActiveMeetings ticks with 5 participants / 2 moderators →
 * endMeeting (real service, fake fetch) → state COMPLETED → billMeteredMeeting
 * → ONE BbbMeteredUsage row with 12 learner-minutes → getSummary month math.
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
  Channel,
  RequestContext,
  TransactionalConnection,
} from '@vendure/core';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { getSuperadminContext } from '@vendure/testing/lib/utils/get-superadmin-context';

import { TenantPlugin } from '../../tenant-plugin/tenant-plugin.plugin';
import { BigBlueButtonPlugin } from '../bigbluebutton.plugin';
import { SchemaPostgresInitializer } from '../../tenant-plugin/e2e/schema-postgres-initializer';
import { BbbApiService } from '../services/bbb-api.service';
import { BbbBillingService } from '../services/bbb-billing.service';
import { BbbEncryptionService } from '../services/bbb-encryption.service';
import { BbbMeeting } from '../entities/bbb-meeting.entity';
import { BbbMeetingSample } from '../entities/bbb-meeting-sample.entity';
import { BbbMeteredUsage } from '../entities/bbb-metered-usage.entity';
import { BbbOrganization } from '../entities/bbb-organization.entity';
import { BbbServer } from '../entities/bbb-server.entity';
import { BbbMeetingService } from '../services/bbb-meeting.service';
import { BbbMeteringService } from '../services/bbb-metering.service';
import { BILLING_MODE, MEETING_STATE } from '../constants';
import { monthOf } from '../services/metered-billing.policy';

registerInitializer('postgres', new SchemaPostgresInitializer());

const MONEY_PATH_E2E = process.env.BBB_MONEY_PATH_E2E === 'true';

/** Org-level rate (paise / learner-hour) — must surface in the summary. */
const ORG_RATE = 900;

/** Fake BBB occupancy per tick: 5 participants, 2 moderators → 3 learners. */
const PARTICIPANTS = 5;
const MODERATORS = 2;
const LEARNERS_PER_TICK = PARTICIPANTS - MODERATORS;
/** Four ticks → 12 learner-minutes. */
const TICKS = 4;
const EXPECTED_LEARNER_MINUTES = LEARNERS_PER_TICK * TICKS;
/** 12 learner-minutes at Rs 9/learner-hour = 12/60 × 900 = 180 paise. */
const EXPECTED_CHARGE_PAISE = 180;

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

const { server } = createTestEnvironment(
  mergeConfig(testConfig, {
    apiOptions: { port: 3101 },
    dbConnectionOptions: {
      type: 'postgres',
      host: process.env.DB_HOST ?? '127.0.0.1',
      port: Number(process.env.DB_PORT ?? 5432),
      database: process.env.DB_NAME ?? 'vendure',
      username: process.env.DB_USERNAME ?? 'vendure_user',
      password: process.env.DB_PASSWORD ?? '',
      schema: 'e2e_bbb_money_path',
      synchronize: true,
    },
    plugins: [
      TenantPlugin,
      BigBlueButtonPlugin.init({
        defaultRatePaisePerLearnerHour: 1200,
        maxMeetingDurationMs: 60 * 60 * 1000,
      }),
    ],
  }),
);

function xmlEnvelope(body: string): string {
  return `<response><returncode>SUCCESS</returncode>${body}</response>`;
}


/** Minimal canned BBB transport: real URL parsing proves the checksum path. */
function installFakeFetch(opts: {
  internalMeetingID: string;
  meetingID: string;
}): { urls: string[]; running: { current: boolean } } {
  const urls: string[] = [];
  const running = { current: true };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      urls.push(url);
      const u = new URL(url);
      const method = u.pathname.split('/').pop();
      // Every outbound call must carry a checksum — the real service builds it.
      expect(u.searchParams.get('checksum')).toBeTruthy();
      if (method === 'create') {
        return {
          ok: true,
          text: async () =>
            xmlEnvelope(
              `<meetingID>${opts.meetingID}</meetingID>` +
                `<internalMeetingID>${opts.internalMeetingID}</internalMeetingID>`,
            ),
        };
      }
      if (method === 'getMeetingInfo') {
        return {
          ok: true,
          text: async () =>
            xmlEnvelope(
              `<meetingID>${opts.meetingID}</meetingID>` +
                `<internalMeetingID>${opts.internalMeetingID}</internalMeetingID>` +
                `<running>${running.current ? 'true' : 'false'}</running>` +
                `<participantCount>${running.current ? PARTICIPANTS : 0}</participantCount>` +
                `<moderatorCount>${running.current ? MODERATORS : 0}</moderatorCount>` +
                `<recording>false</recording>`,
            ),
        };
      }
      if (method === 'end') {
        running.current = false;
        return { ok: true, text: async () => xmlEnvelope('') };
      }
      throw new Error(`unexpected BBB method in fake fetch: ${method}`);
    }),
  );
  return { urls, running };
}

describe('B3 — money path through the real BbbApiService', () => {
  const d = MONEY_PATH_E2E ? describe : describe.skip;

  let ctx: any;
  let connection: TransactionalConnection;
  let api: BbbApiService;
  let metering: BbbMeteringService;
  let billing: BbbBillingService;
  let meetings: BbbMeetingService;
  let encryption: BbbEncryptionService;

  d('provision → sample → end → usage → summary', () => {
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
      api = server.app.get(BbbApiService);
      metering = server.app.get(BbbMeteringService);
      billing = server.app.get(BbbBillingService);
      meetings = server.app.get(BbbMeetingService);
      encryption = server.app.get(BbbEncryptionService);
    }, 60000);

    afterAll(async () => {
      await server.destroy();
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('books 12 learner-minutes and charges 180 paise for the month', async () => {
      const stamp = `${Date.now()}`;
      const channelResult = await server.app
        .get(ChannelService)
        .create(ctx, {
          code: `money_${stamp}`,
          token: `money-token-${stamp}`,
          defaultLanguageCode: LanguageCode.en,
          defaultCurrencyCode: CurrencyCode.INR,
          pricesIncludeTax: true,
        } as any);
      if (!('id' in channelResult)) {
        throw new Error(`channel create failed: ${JSON.stringify(channelResult)}`);
      }
      const channelId = String(channelResult.id);
      const orgRepo = connection.getRepository(ctx, BbbOrganization);
      const org = await orgRepo.save(
        orgRepo.create({
          channelId,
          name: `Money Org ${stamp}`,
          slug: `money-org-${stamp}`,
          ownerUserId: '1',
          concurrentMeetingLimit: 5,
          billingMode: BILLING_MODE.METERED,
          ratePaisePerLearnerHour: ORG_RATE,
        }),
      );

      const serverRepo = connection.getRepository(ctx, BbbServer);
      const saved = await serverRepo.save(
        serverRepo.create({
          name: `Money Server ${stamp}`,
          apiUrl: 'http://localhost:1999/bigbluebutton/api',
          encryptedApiSecret: encryption.encrypt('money-e2e-secret'),
          enabled: true,
          healthy: true,
          currentLoad: 0,
          maxLoad: 100,
          capacity: 100,
        }),
      );
      const serverWithSecret = await connection
        .getRepository(ctx, BbbServer)
        .createQueryBuilder('s')
        .addSelect('s.encryptedApiSecret')
        .where('s.id = :id', { id: saved.id })
        .getOneOrFail();

      // 1. Provision through the REAL adapter (fake fetch = canned XML).
      const bbbMeetingID = `money-${stamp}`;
      const { urls } = installFakeFetch({
        internalMeetingID: `money-internal-${stamp}`,
        meetingID: bbbMeetingID,
      });
      const created = await api.createMeeting(serverWithSecret, {
        meetingID: bbbMeetingID,
        name: 'Money path class',
        attendeePW: 'ap',
        moderatorPW: 'mp',
        record: false,
      } as any);
      expect(created.internalMeetingID).toBe(`money-internal-${stamp}`);
      expect(urls.some((u) => u.includes('/api/create?'))).toBe(true);

      // 2. ACTIVE meeting row carrying the moderator password the sampler needs.
      const meetingRepo = connection.getRepository(ctx, BbbMeeting);
      const provisionedAt = new Date(Date.now() - 10 * 60_000);
      const meeting = await meetingRepo.save(
        meetingRepo.create({
          title: `Money meeting ${stamp}`,
          state: MEETING_STATE.ACTIVE,
          organization: org,
          provisionedAt,
          bbbMeetingId: bbbMeetingID,
          serverId: String(saved.id),
          encryptedModeratorPassword: encryption.encrypt('mp'),
        }),
      );

      // 3. Four sampling ticks, one minute apart, through the real sampler.
      for (let i = 0; i < TICKS; i++) {
        const tick = new Date(provisionedAt.getTime() + (i + 1) * 60_000);
        const result = await metering.sampleActiveMeetings(tick);
        expect(result.failed).toBe(0);
      }
      const samples = await connection
        .getRepository(ctx, BbbMeetingSample)
        .find({ where: { meetingId: String(meeting.id) } });
      expect(samples).toHaveLength(TICKS);
      for (const s of samples) {
        expect(s.learnerCount).toBe(LEARNERS_PER_TICK);
        expect(s.moderatorCount).toBe(MODERATORS);
      }
      const infoUrls = urls.filter((u) => u.includes('/api/getMeetingInfo?'));
      expect(infoUrls).toHaveLength(TICKS);
      // The sampler passes the meeting's moderator password to getMeetingInfo.
      for (const u of infoUrls) {
        expect(u).toContain('password=mp');
      }

      // 4. End through the REAL adapter, then complete the row.
      await api.endMeeting(serverWithSecret, bbbMeetingID, 'mp');
      expect(urls.some((u) => u.includes('/api/end?'))).toBe(true);
      const completedAt = new Date();
      await meetingRepo.save({
        ...meeting,
        state: MEETING_STATE.COMPLETED,
        completedAt,
      });

      // 5. Freeze the usage row through the real billing path.
      const usageId = await metering.billMeteredMeeting(ctx, String(meeting.id));
      expect(usageId).toBeTruthy();
      const rows = await connection
        .getRepository(ctx, BbbMeteredUsage)
        .find({ where: { meetingId: String(meeting.id) } });
      expect(rows).toHaveLength(1);
      expect(rows[0].learnerMinutes).toBe(EXPECTED_LEARNER_MINUTES);
      expect(rows[0].ratePaisePerHour).toBe(ORG_RATE);
      expect(rows[0].periodMonth).toBe(monthOf(completedAt));

      // 6. The summary reads the same frozen row — one rounding pass.
      // RequestContext.channelId is a getter from _channel: build a real
      // channel-scoped context (never a spread copy — that loses the
      // prototype and getRepository reads "[object Object]" metadata).
      const channelEntity = await connection.rawConnection
        .getRepository(Channel)
        .findOne({ where: { id: Number(channelId) } });
      expect(channelEntity).toBeTruthy();
      const channelCtx = new RequestContext({
        apiType: 'admin',
        channel: channelEntity!,
        isAuthorized: true,
        authorizedAsOwnerOnly: false,
      });
      const summary = await billing.getSummary(channelCtx, monthOf(completedAt));
      expect(summary.totalLearnerMinutes).toBe(EXPECTED_LEARNER_MINUTES);
      expect(summary.totalChargePaise).toBe(EXPECTED_CHARGE_PAISE);
      expect(summary.ratePaisePerHour).toBe(ORG_RATE);
      expect(summary.byRoom.reduce((s, r) => s + r.learnerMinutes, 0)).toBe(
        EXPECTED_LEARNER_MINUTES,
      );

      // Sanity: the meeting service still resolves the row (join-path seam),
      // read with the tenant-scoped context — the superadmin ctx is channel 1
      // and the guard correctly refuses a foreign-channel meeting.
      const loaded = await meetings.findById(channelCtx, String(meeting.id));
      expect(loaded?.state).toBe(MEETING_STATE.COMPLETED);
    });
  });
});


