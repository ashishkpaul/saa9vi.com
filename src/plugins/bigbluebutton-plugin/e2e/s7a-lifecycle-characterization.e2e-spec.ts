/**
 * S7A (Phase 7.3) — lifecycle characterization tests.
 *
 * Pins the observable behavior of `BbbMeetingService.completeMeetingLifecycle()`
 * BEFORE it is mechanically relocated to `MeetingLifecycleService` (Phase 7
 * commit 4), so the extraction can be proven behavior-preserving:
 *
 *   C1  double completion   → exactly one billing fact and one
 *                             MeetingCompletedEvent (second call no-ops)
 *   C2  organizationId      → MeetingCompletedEvent.organizationId is
 *                             populated (the A13 fix)
 *   C3  grant branch        → one idempotent BbbUsageLedger row + atomic
 *                             grant CAS + GrantConsumedEvent
 *   C4  metered branch      → one frozen BbbMeteredUsage row, zero ledger
 *                             rows (INV-028: grant ledger untouched)
 *   C5  ordering            → completion transaction AND billing are
 *                             committed before MeetingCompletedEvent is
 *                             observable (room reset included)
 *   C6  stale-active recovery → room runtime staleness drives
 *                             completeMeetingLifecycle(source:
 *                             'stale-active-runtime'): meeting Completed,
 *                             room reset, billing/event semantics intact
 *
 * The only replaced component is the outbound BBB HTTP hop (property
 * replacement on the injected BbbApiService, the in-repo precedent from
 * r4-runtime-lifecycle.e2e-spec.ts). Fixtures go through Vendure
 * services / TransactionalConnection — the sanctioned service-layer path.
 *
 * Infrastructure-gated: requires Postgres. Run: npm run test:e2e:bbb-lifecycle
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
  DefaultLogger,
  EventBus,
  LanguageCode,
  LogLevel,
  mergeConfig,
  TransactionalConnection,
} from '@vendure/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getSuperadminContext } from '@vendure/testing/lib/utils/get-superadmin-context';
import { filter, firstValueFrom, take } from 'rxjs';

import { TenantPlugin } from '../../tenant-plugin/tenant-plugin.plugin';
import { BigBlueButtonPlugin } from '../bigbluebutton.plugin';
import { SchemaPostgresInitializer } from '../../tenant-plugin/e2e/schema-postgres-initializer';
import { BbbApiService } from '../services/bbb-api.service';
import { BbbMeetingService } from '../services/bbb-meeting.service';
import { BbbRoomService } from '../services/bbb-room.service';
import { BbbMeeting } from '../entities/bbb-meeting.entity';
import { BbbRoom } from '../entities/bbb-room.entity';
import { BbbOrganization } from '../entities/bbb-organization.entity';
import { BbbServer } from '../entities/bbb-server.entity';
import { BbbCapacityGrant } from '../entities/bbb-capacity-grant.entity';
import { BbbUsageLedger } from '../entities/bbb-usage-ledger.entity';
import { BbbMeetingSample } from '../entities/bbb-meeting-sample.entity';
import { BbbMeteredUsage } from '../entities/bbb-metered-usage.entity';
import { GrantConsumedEvent, MeetingCompletedEvent } from '../events/bbb-events';
import { BILLING_MODE, MEETING_STATE } from '../constants';

registerInitializer('postgres', new SchemaPostgresInitializer());

const S7A_E2E = process.env.S7A_LIFECYCLE_E2E === 'true';

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
    apiOptions: { port: 3093 },
    logger: new DefaultLogger({ level: LogLevel.Warn }),
    dbConnectionOptions: {
      type: 'postgres',
      host: process.env.DB_HOST ?? '127.0.0.1',
      port: Number(process.env.DB_PORT ?? 5432),
      database: process.env.DB_NAME ?? 'vendure',
      username: process.env.DB_USERNAME ?? 'vendure_user',
      password: process.env.DB_PASSWORD ?? '',
      // Isolated throwaway schema — never touches dev/production data.
      schema: 'e2e_s7a_lifecycle',
      synchronize: true,
    },
    plugins: [TenantPlugin, BigBlueButtonPlugin],
  }),
);

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

describe('S7A — completeMeetingLifecycle characterization', () => {
  const d = S7A_E2E ? describe : describe.skip;

  let ctx: any;
  let connection: TransactionalConnection;
  let eventBus: EventBus;
  let meetingService: BbbMeetingService;
  let roomService: BbbRoomService;
  let grantOrg: BbbOrganization;
  let meteredOrg: BbbOrganization;
  let serverRow: BbbServer;

  const completedEvents: MeetingCompletedEvent[] = [];
  const grantEvents: GrantConsumedEvent[] = [];
  let subCompleted: { unsubscribe(): void } | undefined;
  let subGrant: { unsubscribe(): void } | undefined;

  d('pinning the lifecycle contract', () => {
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
      meetingService = server.app.get(BbbMeetingService);
      roomService = server.app.get(BbbRoomService);

      subCompleted = eventBus
        .ofType(MeetingCompletedEvent)
        .subscribe((e) => completedEvents.push(e));
      subGrant = eventBus
        .ofType(GrantConsumedEvent)
        .subscribe((e) => grantEvents.push(e));

      const stamp = Date.now();
      const channelService = server.app.get(ChannelService);
      const orgRepo = connection.getRepository(ctx, BbbOrganization);

      // Grant org — billing truth is the ledger.
      grantOrg = await orgRepo.save(
        orgRepo.create({
          channelId: String(ctx.channelId),
          name: `S7A Grant Org ${stamp}`,
          slug: `s7a-grant-org-${stamp}`,
          ownerUserId: '1',
          concurrentMeetingLimit: 5,
          billingMode: BILLING_MODE.GRANT,
          ratePaisePerLearnerHour: null,
        }),
      );

      // Metered org — needs its own channel (Channel = Tenant, INV-001).
      const meteredChannel = await channelService.create(ctx, {
        code: `s7a_metered_${stamp}`,
        token: `s7a-metered-token-${stamp}`,
        defaultLanguageCode: LanguageCode.en,
        defaultCurrencyCode: CurrencyCode.INR,
        pricesIncludeTax: true,
      } as any);
      if (!('id' in meteredChannel)) {
        throw new Error(`Failed to create metered channel: ${JSON.stringify(meteredChannel)}`);
      }
      meteredOrg = await orgRepo.save(
        orgRepo.create({
          channelId: String(meteredChannel.id),
          name: `S7A Metered Org ${stamp}`,
          slug: `s7a-metered-org-${stamp}`,
          ownerUserId: '1',
          concurrentMeetingLimit: 5,
          billingMode: BILLING_MODE.METERED,
          ratePaisePerLearnerHour: 1000,
        }),
      );

      const serverRepo = connection.getRepository(ctx, BbbServer);
      serverRow = await serverRepo.save(
        serverRepo.create({
          name: `S7A Lifecycle Server ${stamp}`,
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
      subCompleted?.unsubscribe();
      subGrant?.unsubscribe();
      await server.destroy();
    });

    // ─── fixtures ─────────────────────────────────────────────────────────────

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

    /** ACTIVE meeting provisioned `minutesAgo` minutes ago. */
    async function makeActiveMeeting(opts: {
      org: BbbOrganization;
      minutesAgo: number;
      grantId?: string | null;
      /** true → carry bbbMeetingId + serverId (BBB-runtime-visible). */
      observable?: boolean;
    }): Promise<BbbMeeting> {
      const repo = connection.getRepository(ctx, BbbMeeting);
      return repo.save(
        repo.create({
          title: `S7A meeting ${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          state: MEETING_STATE.ACTIVE,
          organization: opts.org,
          provisionedAt: new Date(Date.now() - opts.minutesAgo * 60_000),
          grantId: opts.grantId ?? null,
          bbbMeetingId: opts.observable ? `s7a-${Date.now()}` : undefined,
          serverId: opts.observable ? String(serverRow.id) : undefined,
        }),
      );
    }

    /**
     * Links a meeting to a live room both ways: room.state = 'Active',
     * room.currentMeetingId = meeting, meeting.roomId = room — the state the
     * lifecycle completion contract resets.
     */
    async function makeLiveRoom(
      orgRef: BbbOrganization,
      meeting: BbbMeeting,
    ): Promise<BbbRoom> {
      const roomRepo = connection.getRepository(ctx, BbbRoom);
      const room = await roomRepo.save(
        roomRepo.create({
          organization: orgRef,
          name: `S7A room ${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          state: 'Active' as any,
          currentMeetingId: meeting.id as string,
        }),
      );
      await connection
        .getRepository(ctx, BbbMeeting)
        .update(meeting.id as string, { roomId: String(room.id) });
      return room;
    }

    async function reloadMeeting(id: string): Promise<BbbMeeting> {
      return connection
        .getRepository(ctx, BbbMeeting)
        .findOneOrFail({ where: { id } });
    }

    async function reloadRoom(id: string): Promise<BbbRoom> {
      return connection
        .getRepository(ctx, BbbRoom)
        .findOneOrFail({ where: { id } });
    }

    async function reloadGrant(id: string): Promise<BbbCapacityGrant> {
      return connection
        .getRepository(ctx, BbbCapacityGrant)
        .findOneOrFail({ where: { id } });
    }

    async function ledgerCount(meetingId: string): Promise<number> {
      return connection
        .getRepository(ctx, BbbUsageLedger)
        .count({ where: { meeting: { id: meetingId } } });
    }

    async function usageRows(meetingId: string): Promise<BbbMeteredUsage[]> {
      return connection
        .getRepository(ctx, BbbMeteredUsage)
        .find({ where: { meetingId } });
    }

    async function addSample(
      meetingId: string,
      bucketMinute: Date,
      learnerCount: number,
    ): Promise<void> {
      const repo = connection.getRepository(ctx, BbbMeetingSample);
      await repo.save(
        repo.create({
          meetingId,
          bucketMinute,
          learnerCount,
          moderatorCount: 0,
        }),
      );
    }

    // String() coercion: the runtime type of Vendure IDs (string vs numeric
    // PK) must not decide event matching.
    const completedFor = (meetingId: string) =>
      completedEvents.filter((e) => String(e.meetingId) === meetingId);
    const grantEventsFor = (meetingId: string) =>
      grantEvents.filter((e) => String(e.meetingId) === meetingId);

    // ─── C1 + C3 ──────────────────────────────────────────────────────────────

    it('C1/C3: grant branch bills exactly once; double completion is a no-op', async () => {
      const grant = await freshGrant(grantOrg, 600);
      const meeting = await makeActiveMeeting({
        org: grantOrg,
        minutesAgo: 10,
        grantId: String(grant.id),
      });
      const id = String(meeting.id);

      await meetingService.completeMeetingLifecycle(ctx, meeting.id, {
        source: 'manual',
      });

      const done = await reloadMeeting(id);
      expect(done.state).toBe(MEETING_STATE.COMPLETED);
      expect(done.completedAt).toBeTruthy();

      const rows = await connection
        .getRepository(ctx, BbbUsageLedger)
        .find({ where: { meeting: { id } } });
      expect(rows).toHaveLength(1);
      // ~10 min provisioned; ceil-to-minute semantics allow 10 or 11.
      expect(rows[0].consumedMinutes).toBeGreaterThanOrEqual(10);
      expect(rows[0].consumedMinutes).toBeLessThanOrEqual(11);

      const g1 = await reloadGrant(String(grant.id));
      expect(g1.consumedMinutes).toBe(rows[0].consumedMinutes);
      expect(grantEventsFor(id)).toHaveLength(1);
      const completedBefore = completedFor(id).length;
      expect(completedBefore).toBe(1);

      // Second completion — already Completed → no transition, no billing,
      // no event.
      await meetingService.completeMeetingLifecycle(ctx, meeting.id, {
        source: 'manual',
      });

      expect(await ledgerCount(id)).toBe(1);
      expect(completedFor(id)).toHaveLength(completedBefore);
      const g2 = await reloadGrant(String(grant.id));
      expect(g2.consumedMinutes).toBe(g1.consumedMinutes);
      expect(grantEventsFor(id)).toHaveLength(1);
    });

    // ─── C2 ───────────────────────────────────────────────────────────────────

    it('C2: MeetingCompletedEvent carries a populated organizationId', async () => {
      const grant = await freshGrant(grantOrg, 600);
      const meeting = await makeActiveMeeting({
        org: grantOrg,
        minutesAgo: 5,
        grantId: String(grant.id),
      });

      await meetingService.completeMeetingLifecycle(ctx, meeting.id, {
        source: 'manual',
      });

      const events = completedFor(String(meeting.id));
      // Diagnostic: delivery to the subscription at all (vs per-meeting filter).
      expect(completedEvents.length).toBeGreaterThanOrEqual(1);
      expect(events).toHaveLength(1);
      expect(String(events[0].organizationId)).toBe(String(grantOrg.id));
    });

    // ─── C4 ───────────────────────────────────────────────────────────────────

    it('C4: metered branch freezes one usage row and never touches the grant ledger', async () => {
      const meeting = await makeActiveMeeting({
        org: meteredOrg,
        minutesAgo: 5,
        grantId: null,
      });
      const id = String(meeting.id);
      await addSample(id, new Date(Date.now() - 4 * 60_000), 3);
      await addSample(id, new Date(Date.now() - 3 * 60_000), 3);

      await meetingService.completeMeetingLifecycle(ctx, meeting.id, {
        source: 'manual',
      });

      expect((await reloadMeeting(id)).state).toBe(MEETING_STATE.COMPLETED);

      const usage = await usageRows(id);
      expect(usage).toHaveLength(1);
      expect(usage[0].learnerMinutes).toBe(6);

      // INV-028: a metered org's billing truth is the frozen usage row —
      // the grant ledger stays untouched.
      expect(await ledgerCount(id)).toBe(0);
      expect(grantEventsFor(id)).toHaveLength(0);

      const events = completedFor(id);
      expect(events).toHaveLength(1);
      expect(String(events[0].organizationId)).toBe(String(meteredOrg.id));
    });

    // ─── C5 ───────────────────────────────────────────────────────────────────

    it('C5: completion transaction + billing are committed before the event is observable', async () => {
      const grant = await freshGrant(grantOrg, 600);
      const meeting = await makeActiveMeeting({
        org: grantOrg,
        minutesAgo: 8,
        grantId: String(grant.id),
      });
      const id = String(meeting.id);
      const room = await makeLiveRoom(grantOrg, meeting);

      type Snapshot = {
        ledgerRows: number;
        meetingState?: string;
        roomState?: string;
        roomMeeting: string | null;
      };
      // Holder object: assigned inside the subscription closure — avoids TS
      // control-flow narrowing the outer variable to null at assertion time.
      const snap: { v: Snapshot | null } = { v: null };

      // Subscribe BEFORE completing: at publish time the completion tx and
      // the billing tx must already be committed — including the in-tx room
      // reset — because listeners are documented to assume the ledger fact
      // exists.
      const observed = firstValueFrom(
        eventBus.ofType(MeetingCompletedEvent).pipe(
          filter((e) => String(e.meetingId) === id),
          take(1),
        ),
      ).then(async (event) => {
        const ledgerRows = await ledgerCount(id);
        const m = await connection
          .getRepository(ctx, BbbMeeting)
          .findOne({ where: { id } });
        const r = await connection
          .getRepository(ctx, BbbRoom)
          .findOne({ where: { id: String(room.id) } });
        snap.v = {
          ledgerRows,
          meetingState: m?.state,
          roomState: r?.state,
          roomMeeting: r?.currentMeetingId ?? null,
        };
        expect(String(event.organizationId)).toBe(String(grantOrg.id));
      });

      await meetingService.completeMeetingLifecycle(ctx, meeting.id, {
        source: 'manual',
      });
      await observed;

      expect(snap.v).not.toBeNull();
      expect(snap.v!.ledgerRows).toBe(1);
      expect(snap.v!.meetingState).toBe(MEETING_STATE.COMPLETED);
      expect(snap.v!.roomState).toBe('Idle');
      expect(snap.v!.roomMeeting).toBeNull();
    });

    // ─── C6 ───────────────────────────────────────────────────────────────────

    it('C6: stale-active recovery completes the meeting, resets the room, keeps billing/event semantics', async () => {
      // Only the outbound BBB HTTP hop is replaced (in-repo precedent:
      // r4-runtime-lifecycle.e2e-spec.ts property replacement).
      const realApi: any = server.app.get(BbbApiService);
      const stubApi: any = Object.create(realApi);
      stubApi.isMeetingRunning = async () => false;
      (roomService as any).bbbApiService = stubApi;

      const grant = await freshGrant(grantOrg, 600);
      const meeting = await makeActiveMeeting({
        org: grantOrg,
        minutesAgo: 10,
        grantId: String(grant.id),
        observable: true,
      });
      const id = String(meeting.id);
      const room = await makeLiveRoom(grantOrg, meeting);

      const res = await roomService.requestProvisioning(ctx, room.id);

      expect(res.status).toBe('provisioning');
      expect(res.shouldEnqueue).toBe(true);

      expect((await reloadMeeting(id)).state).toBe(MEETING_STATE.COMPLETED);
      const reloadedRoom = await reloadRoom(String(room.id));
      expect(reloadedRoom.state).toBe('Idle');
      expect(reloadedRoom.currentMeetingId).toBeNull();

      expect(await ledgerCount(id)).toBe(1);
      expect(grantEventsFor(id)).toHaveLength(1);

      const events = completedFor(id);
      expect(events).toHaveLength(1);
      expect(events[0].source).toBe('stale-active-runtime');
      expect(String(events[0].organizationId)).toBe(String(grantOrg.id));
      expect(String(events[0].roomId)).toBe(String(room.id));
    });
  });
});

