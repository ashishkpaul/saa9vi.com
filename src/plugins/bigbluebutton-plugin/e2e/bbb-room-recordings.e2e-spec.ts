/**
 * `bbbRoomRecordings` — the channel-scoped recordings read model.
 *
 * Infrastructure-gated: requires Postgres. Run:
 *   npm run test:e2e:bbb-recordings
 *   (BBB_RECORDINGS_E2E=true npx vitest run --config vitest.config.mts \
 *    src/plugins/bigbluebutton-plugin/e2e/bbb-room-recordings.e2e-spec.ts)
 *
 * Why this exists: the Recordings tab used to read `bbbMeteredMeetings`
 * (BbbMeteredUsage-backed), so a GRANT-billed room's recordings were invisible
 * — grant meetings never write a metered-usage row even when the
 * rap-publish-ended webhook stored a playback link.
 *
 * Proves:
 *   V1 grant-billed meeting WITH a stored recordingUrl → returned
 *   V2 metered-organization meeting WITH a recordingUrl → returned
 *   V3 recordingUrl IS NULL (and completedAt IS NULL) → excluded
 *   V4 cross-channel meeting → excluded (channel scope is server-derived)
 *   V5 IST month window on completedAt, on BOTH boundaries
 *   V6 skip/take + totalItems, and the minimal projection (only fields
 *      BbbMeeting actually has — nothing invented)
 *   V7 a non-YYYY-MM month is a UserInputError, not an empty list
 *
 * Fixtures are written through the repository/service layer (the sanctioned
 * service-layer path used by bbb-usage-ledger.e2e-spec). Isolated schema
 * `e2e_bbb_recordings` — never touches dev/production data.
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
  Channel,
  ChannelService,
  CurrencyCode,
  LanguageCode,
  mergeConfig,
  RequestContext,
  RequestContextService,
  TransactionalConnection,
  UserInputError,
} from '@vendure/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getSuperadminContext } from '@vendure/testing/lib/utils/get-superadmin-context';

import { TenantPlugin } from '../../tenant-plugin/tenant-plugin.plugin';
import { BigBlueButtonPlugin } from '../bigbluebutton.plugin';
import { SchemaPostgresInitializer } from '../../tenant-plugin/e2e/schema-postgres-initializer';
import { BbbMeeting } from '../entities/bbb-meeting.entity';
import { BbbOrganization } from '../entities/bbb-organization.entity';
import { BbbRoom } from '../entities/bbb-room.entity';
import { BbbMeetingService } from '../services/bbb-meeting.service';
import { BILLING_MODE, MEETING_STATE } from '../constants';

registerInitializer('postgres', new SchemaPostgresInitializer());

const RECORDINGS_E2E = process.env.BBB_RECORDINGS_E2E === 'true';

async function assertPostgres(): Promise<void> {
  const host = process.env.DB_HOST ?? '127.0.0.1';
  const port = Number(process.env.DB_PORT ?? 5432);
  await new Promise<void>((resolve, reject) => {
    const sock = net.connect(port, host);
    sock.once('connect', () => { sock.destroy(); resolve(); });
    sock.once('error', (err) => reject(err));
  });
}

const { server, adminClient, shopClient } = createTestEnvironment(
  mergeConfig(testConfig, {
    apiOptions: { port: 0 },
    dbConnectionOptions: {
      type: 'postgres',
      host: process.env.DB_HOST ?? '127.0.0.1',
      port: Number(process.env.DB_PORT ?? 5432),
      database: process.env.DB_NAME ?? 'vendure',
      username: process.env.DB_USERNAME ?? 'vendure_user',
      password: process.env.DB_PASSWORD ?? '',
      schema: 'e2e_bbb_recordings',
      synchronize: true,
    },
    plugins: [TenantPlugin, BigBlueButtonPlugin],
  }),
);

/** Fixed IST period under test — deliberately not "now" so the run is stable. */
const PERIOD = '2030-05';

/** IST month boundaries for 2030-05, as absolute UTC instants (IST = UTC+5:30). */
const IST_MAY_START = new Date(Date.UTC(2030, 4, 1) - 5.5 * 3600_000); // 2030-04-30T18:30Z
const IST_MAY_END = new Date(Date.UTC(2030, 5, 1) - 5.5 * 3600_000); // 2030-05-31T18:30Z

const URL = 'https://meeting.example.com/playback/presentation/2.3/rec-x';

describe('bbbRoomRecordings — channel-scoped recordings read', () => {
  const d = RECORDINGS_E2E ? describe : describe.skip;

  let ctxA: RequestContext; // default channel — grant-billed org
  let ctxB: RequestContext; // second channel — metered org
  let service: BbbMeetingService;

  /** Meeting ids, keyed by the fixture role they play. */
  const m = {
    grant: '', // V1 — grant org, URL, mid-May
    noUrl: '', // V3 — grant org, NULL recordingUrl
    noCompletedAt: '', // V3 — URL but NULL completedAt
    beforeStart: '', // V5 — one second BEFORE the IST month starts
    atStart: '', // V5 — exactly the IST month start (inclusive)
    atEnd: '', // V5 — one minute BEFORE the IST month ends (inclusive)
    afterEnd: '', // V5 — exactly the IST month end (exclusive)
    metered: '', // V2/V4 — metered org on the OTHER channel
  };

  /** One meeting row with explicit recording facts (sanctioned repo path). */
  async function seedMeeting(opts: {
    org: BbbOrganization;
    title: string;
    completedAt: Date | null;
    recordingUrl?: string | null;
    roomId?: string;
  }): Promise<string> {
    const conn = server.app.get(TransactionalConnection);
    const repo = conn.getRepository(ctxA, BbbMeeting);
    // `as any`: the columns are nullable in the database but declared non-null
    // on the entity (TypeORM convention in this codebase), so the literal needs
    // a widening cast to persist an explicit NULL.
    const saved = await repo.save(
      new BbbMeeting({
        organization: opts.org,
        title: opts.title,
        state: MEETING_STATE.COMPLETED,
        completedAt: opts.completedAt,
        recordingUrl: opts.recordingUrl ?? null,
        roomId: opts.roomId ?? null,
      } as any),
    );
    return String(saved.id);
  }

  const ids = (list: Array<{ id: string }>): string[] => list.map((r) => r.id);

  d('channel-scoped recordings read over BbbMeeting', () => {
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

      ctxA = await getSuperadminContext(server.app);
      service = server.app.get(BbbMeetingService);
      const conn = server.app.get(TransactionalConnection);

      const orgRepo = conn.getRepository(ctxA, BbbOrganization);
      // Channel A — GRANT billing (the column default). This is the case the
      // old metered-usage read could never return.
      const orgA = await orgRepo.save(
        orgRepo.create({
          channelId: String(ctxA.channelId),
          name: 'Recordings Grant Org',
          slug: 'recordings-grant-org',
          ownerUserId: '1',
          concurrentMeetingLimit: 5,
        }),
      );

      // Channel B — METERED billing. BbbOrganization.channelId is UNIQUE
      // (one org per channel), so the metered case must own its own channel.
      const created = await server.app.get(ChannelService).create(ctxA, {
        code: 'recordings_metered',
        token: `recordings-metered-${Date.now()}`,
        defaultLanguageCode: LanguageCode.en,
        defaultCurrencyCode: CurrencyCode.INR,
        pricesIncludeTax: true,
      } as any);
      if (!created || !('id' in created)) {
        throw new Error(`channel create failed: ${JSON.stringify(created)}`);
      }
      const channelB = created as Channel;
      ctxB = await server.app.get(RequestContextService).create({
        apiType: 'admin',
        channelOrToken: channelB,
      });

      const orgB = await orgRepo.save(
        orgRepo.create({
          channelId: String(channelB.id),
          name: 'Recordings Metered Org',
          slug: 'recordings-metered-org',
          ownerUserId: '1',
          concurrentMeetingLimit: 5,
          billingMode: BILLING_MODE.METERED,
        }),
      );

      const roomRepo = conn.getRepository(ctxA, BbbRoom);
      const room = await roomRepo.save(
        roomRepo.create({
          organization: orgA,
          name: 'Recordings Room',
          slug: 'recordings-room',
        }),
      );
      const roomId = String(room.id);

      m.grant = await seedMeeting({
        org: orgA,
        title: 'Grant class with recording',
        completedAt: new Date('2030-05-15T12:00:00.000Z'),
        recordingUrl: URL,
        roomId,
      });
      m.noUrl = await seedMeeting({
        org: orgA,
        title: 'Grant class, recording not published',
        completedAt: new Date('2030-05-16T12:00:00.000Z'),
        recordingUrl: null,
        roomId,
      });
      m.noCompletedAt = await seedMeeting({
        org: orgA,
        title: 'Recording URL but no completion instant',
        completedAt: null,
        recordingUrl: `${URL}-nocompleted`,
      });
      m.beforeStart = await seedMeeting({
        org: orgA,
        title: 'One second before the IST month starts',
        completedAt: new Date(IST_MAY_START.getTime() - 1000),
        recordingUrl: `${URL}-before`,
      });
      m.atStart = await seedMeeting({
        org: orgA,
        title: 'Exactly the IST month start',
        completedAt: IST_MAY_START,
        recordingUrl: `${URL}-atstart`,
      });
      m.atEnd = await seedMeeting({
        org: orgA,
        title: 'One minute before the IST month ends',
        completedAt: new Date(IST_MAY_END.getTime() - 60_000),
        recordingUrl: `${URL}-atend`,
      });
      m.afterEnd = await seedMeeting({
        org: orgA,
        title: 'Exactly the IST month end',
        completedAt: IST_MAY_END,
        recordingUrl: `${URL}-afterend`,
      });
      m.metered = await seedMeeting({
        org: orgB,
        title: 'Metered class with recording',
        completedAt: new Date('2030-05-20T10:00:00.000Z'),
        recordingUrl: `${URL}-metered`,
      });
    }, 60000);

    afterAll(async () => {
      await server.destroy();
    });

    it('V1/V2/V3/V4: grant and metered recordings are visible; no-URL rows and other channels are not', async () => {
      const resA = await service.getRecordings(ctxA, PERIOD);
      const found = ids(resA.items);

      // V1 — the regression this read exists for: a GRANT-billed meeting has
      // no bbb_metered_usage row, yet its published recording must be visible.
      expect(found).toContain(m.grant);

      // V2 — a metered-org meeting is visible on ITS channel.
      const resB = await service.getRecordings(ctxB, PERIOD);
      expect(ids(resB.items)).toEqual([m.metered]);
      expect(resB.totalItems).toBe(1);

      // V3 — recordingUrl IS NOT NULL / completedAt IS NOT NULL are filters.
      expect(found).not.toContain(m.noUrl);
      expect(found).not.toContain(m.noCompletedAt);

      // V4 — channel scope is server-derived: no cross-tenant leakage either way.
      expect(found).not.toContain(m.metered);

      // Exactly the in-month, in-channel, published set.
      expect([...found].sort()).toEqual([m.grant, m.atStart, m.atEnd].sort());
      expect(resA.totalItems).toBe(3);
    }, 30000);

    it('V5: the month is the IST calendar month of completedAt, on both boundaries', async () => {
      const may = ids((await service.getRecordings(ctxA, '2030-05')).items);
      expect(may).toContain(m.atStart); // 00:00:00 IST May 1 → inclusive
      expect(may).toContain(m.atEnd); // 23:59:00 IST May 31 → inclusive
      expect(may).not.toContain(m.beforeStart); // 23:59:59 IST Apr 30
      expect(may).not.toContain(m.afterEnd); // 00:00:00 IST Jun 1 → exclusive

      const april = await service.getRecordings(ctxA, '2030-04');
      expect(ids(april.items)).toEqual([m.beforeStart]);
      expect(april.totalItems).toBe(1);

      const june = await service.getRecordings(ctxA, '2030-06');
      expect(ids(june.items)).toEqual([m.afterEnd]);
      expect(june.totalItems).toBe(1);
    }, 30000);

    it('V6: skip/take paginate while totalItems stays the full month count', async () => {
      const all = await service.getRecordings(ctxA, PERIOD);
      // ordered by completedAt DESC
      expect(ids(all.items)).toEqual([m.atEnd, m.grant, m.atStart]);

      const first = await service.getRecordings(ctxA, PERIOD, 0, 1);
      expect(ids(first.items)).toEqual([m.atEnd]);
      expect(first.totalItems).toBe(3);

      const second = await service.getRecordings(ctxA, PERIOD, 1, 1);
      expect(ids(second.items)).toEqual([m.grant]);
      expect(second.totalItems).toBe(3);
    }, 30000);

    it('V6b: projection is minimal — only fields BbbMeeting actually has', async () => {
      const res = await service.getRecordings(ctxA, PERIOD);
      const grantRow = res.items.find((r) => r.id === m.grant);
      expect(grantRow).toBeTruthy();

      expect(Object.keys(grantRow!).sort()).toEqual([
        'completedAt',
        'id',
        'recordingUrl',
        'roomId',
        'title',
      ]);
      // Recording facts are stored, never invented.
      expect(grantRow!.recordingUrl).toBe(URL);
      expect(grantRow!.roomId).not.toBeNull();
      expect(grantRow!.completedAt).toBeInstanceOf(Date);
      // Nothing derived from billing/attendance tables leaks into the row.
      expect((grantRow as any).startedAt).toBeUndefined();
      expect((grantRow as any).durationMinutes).toBeUndefined();
      expect((grantRow as any).peakLearners).toBeUndefined();
      expect((grantRow as any).learnerMinutes).toBeUndefined();
    }, 30000);

    it('V7: a non-YYYY-MM month is a UserInputError, not an empty list', async () => {
      await expect(service.getRecordings(ctxA, '2030-13')).rejects.toBeInstanceOf(
        UserInputError,
      );
      await expect(service.getRecordings(ctxA, 'nope')).rejects.toBeInstanceOf(
        UserInputError,
      );
    }, 30000);

    it('V7b: omitting month falls back to the current IST month (still month-filtered)', async () => {
      // Every fixture sits in 2030-05, so a correct default yields zero rows —
      // an unfiltered fallback would return the whole table.
      const now = await service.getRecordings(ctxA);
      expect(now.totalItems).toBe(0);
      expect(now.items).toEqual([]);
    }, 30000);
  });
});
