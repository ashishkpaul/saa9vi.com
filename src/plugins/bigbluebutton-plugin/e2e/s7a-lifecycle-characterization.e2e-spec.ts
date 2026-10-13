/**
 * S7A (Phase 7.3) — lifecycle characterization tests.
 *
 * Pins the observable behavior of `MeetingLifecycleService.completeMeetingLifecycle()`
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
 * W1 regression cases (typed-error hardening — outages must never forfeit
 * a live meeting; only a PROVEN notFound may end one):
 *
 *   W1-A outage → reconciliation skips: meeting stays ACTIVE, no billing
 *   W1-B outage → room runtime validation assumes valid: no completion
 *   W1-C notFound → reconciliation stales: terminal, still no billing
 *
 * W5 cases (reconcile-remote-gone billing decision — a missed BBB end event
 * must not leave a metered meeting ACTIVE until BBB purges it):
 *
 *   W5-1 confirmed notFound + samples → COMPLETED via
 *         source 'reconcile-remote-gone': one usage row whose periodMonth
 *         derives from completedAt (last sample + 1 min, clamped), room
 *         reset, exactly one MeetingCompletedEvent, webhook-missed alert,
 *         metric counter bumped
 *   W5-2 confirmed notFound + 0 samples → STALE, zero usage rows, ops alert
 *         (zero samples may mean broken metering, not an empty room)
 *   W5-3 getMeetingInfo success with endTime > 0 → same confirmed end
 *   W5-4 outage / misconfigured / rejected → meetings untouched (never act)
 *   W5-5 double reconcile + late webhook + billing replay → exactly one
 *         usage row and one event
 *   W5-6 grant-mode confirmed gone → STALE, zero billing (unchanged; W1-C)
 *   W5-7 billing ceiling with null grantId → completes capped without
 *         publishing CapacityExhaustedEvent / touching any grant row
 *   W5-8 missing moderator password on the meeting row → per-meeting skip
 *         (API never called, server stays healthy, no config alert)
 *   W5-9 month boundary — completedAt month wins over reconcile-time month
 *         (fake clock: a Jan 31 IST end books to '2026-01' while the pass runs
 *         at 00:30 IST on Feb 1)
 *   W5-10 billing ceiling books to provisionedAt + maxMeetingDurationMs,
 *         not the pass clock (fake clock: a Jan 30→31 IST capped meeting books
 *         to '2026-01' while the ceiling pass runs at 00:30 IST on Feb 1)
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
import { startOnFreePort } from '../../../test-utils/free-port';
import {
  ChannelService,
  CurrencyCode,
  DefaultLogger,
  EventBus,
  LanguageCode,
  LogLevel,
  mergeConfig,
  RequestContextService,
  TransactionalConnection,
} from '@vendure/core';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { getSuperadminContext } from '@vendure/testing/lib/utils/get-superadmin-context';
import { filter, firstValueFrom, take } from 'rxjs';

import { TenantPlugin } from '../../tenant-plugin/tenant-plugin.plugin';
import { BigBlueButtonPlugin } from '../bigbluebutton.plugin';
import { SchemaPostgresInitializer } from '../../tenant-plugin/e2e/schema-postgres-initializer';
import {
  BbbApiService,
  BbbMisconfiguredError,
  BbbNotFoundError,
  BbbRejectedError,
  BbbUnavailableError,
} from '../services/bbb-api.service';
import { MeetingLifecycleService } from '../services/bbb-meeting-lifecycle.service';
import { BbbMeetingService } from '../services/bbb-meeting.service';
import { BbbReconciliationService } from '../services/bbb-reconciliation.service';
import { BbbRoomService } from '../services/bbb-room.service';
import { BbbMeteringService } from '../services/bbb-metering.service';
import { BbbMetricsService } from '../services/bbb-metrics.service';
import { BbbEncryptionService } from '../services/bbb-encryption.service';
import { BbbOpsAlertService } from '../services/bbb-ops-alert.service';
import { monthOf } from '../services/metered-billing.policy';
import { BbbMeeting } from '../entities/bbb-meeting.entity';
import { BbbRoom } from '../entities/bbb-room.entity';
import { BbbOrganization } from '../entities/bbb-organization.entity';
import { BbbServer } from '../entities/bbb-server.entity';
import { BbbCapacityGrant } from '../entities/bbb-capacity-grant.entity';
import { BbbUsageLedger } from '../entities/bbb-usage-ledger.entity';
import { BbbMeetingSample } from '../entities/bbb-meeting-sample.entity';
import { BbbMeteredUsage } from '../entities/bbb-metered-usage.entity';
import {
  CapacityExhaustedEvent,
  GrantConsumedEvent,
  MeetingCompletedEvent,
} from '../events/bbb-events';
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

const { server, adminClient, shopClient } = createTestEnvironment(
  mergeConfig(testConfig, {
    // Free port assigned by startOnFreePort() in beforeAll (test-utils/free-port).
    apiOptions: { port: 0 },
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
  let lifecycleService: MeetingLifecycleService;
  let meetingService: BbbMeetingService;
  let roomService: BbbRoomService;
  let reconciliationService: BbbReconciliationService;
  let grantOrg: BbbOrganization;
  let meteredOrg: BbbOrganization;
  let serverRow: BbbServer;

  const completedEvents: MeetingCompletedEvent[] = [];
  const grantEvents: GrantConsumedEvent[] = [];
  let subCompleted: { unsubscribe(): void } | undefined;
  let subGrant: { unsubscribe(): void } | undefined;
  let subCapacity: { unsubscribe(): void } | undefined;
  let capacityEvents: CapacityExhaustedEvent[] = [];
  /** Real encryption service — W5 fixtures store REAL encrypted passwords. */
  let encryptionService: BbbEncryptionService;
  let metrics: BbbMetricsService;
  /** Spy on the real ops-alert channel (calls through; records every call). */
  let opsNotifySpy: any;

  d('pinning the lifecycle contract', () => {
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
      eventBus = server.app.get(EventBus);
      lifecycleService = server.app.get(MeetingLifecycleService);
      meetingService = server.app.get(BbbMeetingService);
      roomService = server.app.get(BbbRoomService);
      reconciliationService = server.app.get(BbbReconciliationService);
      encryptionService = server.app.get(BbbEncryptionService);
      metrics = server.app.get(BbbMetricsService);
      opsNotifySpy = vi.spyOn(server.app.get(BbbOpsAlertService), 'notify');

      subCompleted = eventBus
        .ofType(MeetingCompletedEvent)
        .subscribe((e) => completedEvents.push(e));
      subGrant = eventBus
        .ofType(GrantConsumedEvent)
        .subscribe((e) => grantEvents.push(e));
      subCapacity = eventBus
        .ofType(CapacityExhaustedEvent)
        .subscribe((e) => capacityEvents.push(e));

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
      subCapacity?.unsubscribe();
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
      /**
       * Plaintext moderator password for the reconcile side-load (W5). An
       * observable meeting defaults to 'e2e-mod-pw', encrypted with the REAL
       * key so the production decrypt path runs. Pass `null` to store
       * NOTHING — the W5-8 per-meeting-skip fixture.
       */
      moderatorPassword?: string | null;
    }): Promise<BbbMeeting> {
      const repo = connection.getRepository(ctx, BbbMeeting);
      const encryptedModeratorPassword =
        opts.observable && opts.moderatorPassword !== null
          ? encryptionService.encrypt(opts.moderatorPassword ?? 'e2e-mod-pw')
          : undefined;
      return repo.save(
        repo.create({
          title: `S7A meeting ${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          state: MEETING_STATE.ACTIVE,
          organization: opts.org,
          provisionedAt: new Date(Date.now() - opts.minutesAgo * 60_000),
          grantId: opts.grantId ?? null,
          bbbMeetingId: opts.observable ? `s7a-${Date.now()}` : undefined,
          serverId: opts.observable ? String(serverRow.id) : undefined,
          encryptedModeratorPassword,
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

    // ─── W5 helpers (reconcile-remote-gone) ─────────────────────────────────

    /** Property-replaced API stub whose getMeetingInfo throws `err`. */
    const apiThrowing = (err: unknown): any => {
      const stub: any = Object.create(server.app.get(BbbApiService));
      stub.getMeetingInfo = async () => {
        throw err;
      };
      return stub;
    };

    /**
     * Property-replaced API stub whose getMeetingInfo SUCCEEDS — the W5 "BBB
     * still answers for an ended meeting" case. `endTime` is epoch seconds,
     * exactly as BBB returns it.
     */
    const apiWithEndTime = (endTimeSec: number): any => {
      const stub: any = Object.create(server.app.get(BbbApiService));
      stub.getMeetingInfo = async () => ({
        meetingID: 'stub',
        internalMeetingID: 'stub',
        running: false,
        participantCount: 0,
        moderatorCount: 0,
        recording: false,
        startTime: 0,
        endTime: endTimeSec,
      });
      return stub;
    };

    const setReconcileApi = (api: any): void => {
      (reconciliationService as any).bbbApiService = api;
    };

    const alertsOfKind = (kind: string): any[][] =>
      (opsNotifySpy?.mock?.calls ?? []).filter((c: any[]) => c[0] === kind);

    const remoteGoneCompletions = (): number =>
      metrics.snapshot().reconciliation.remoteGoneCompletions;

    // ─── C1 + C3 ──────────────────────────────────────────────────────────────

    it('C1/C3: grant branch bills exactly once; double completion is a no-op', async () => {
      const grant = await freshGrant(grantOrg, 600);
      const meeting = await makeActiveMeeting({
        org: grantOrg,
        minutesAgo: 10,
        grantId: String(grant.id),
      });
      const id = String(meeting.id);

      await lifecycleService.completeMeetingLifecycle(ctx, meeting.id, {
        source: 'manual',
      });

      const done = await reloadMeeting(id);
      expect(done.state).toBe(MEETING_STATE.COMPLETED);
      expect(done.completedAt).toBeTruthy();
      // W5 audit trail: the completing context is recorded verbatim — a bare
      // superadmin/system context has no active user → null.
      expect(done.endedByUserId).toBe(
        ctx.activeUserId != null ? String(ctx.activeUserId) : null,
      );

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
      await lifecycleService.completeMeetingLifecycle(ctx, meeting.id, {
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

      await lifecycleService.completeMeetingLifecycle(ctx, meeting.id, {
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

      await lifecycleService.completeMeetingLifecycle(ctx, meeting.id, {
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

      await lifecycleService.completeMeetingLifecycle(ctx, meeting.id, {
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
      // r4-runtime-lifecycle.e2e-spec.ts property replacement). W1: the
      // runtime check is now getMeetingInfo (throws); notFound = proven gone.
      const realApi: any = server.app.get(BbbApiService);
      const stubApi: any = Object.create(realApi);
      stubApi.getMeetingInfo = async () => {
        throw new BbbNotFoundError("s7a-c6-stub");
      };
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

    // ─── W1 regression cases ───────────────────────────────────────────────────
    //
    // The outage→stale bug at e2e level: only the outbound BBB HTTP hop is
    // property-replaced (same precedent as C6). The real reconciliation /
    // room services, typed errors, grace periods and billing rules all run.

    it('W1-A: outage during reconciliation never stales a live meeting', async () => {
      const realApi: any = server.app.get(BbbApiService);
      const stubApi: any = Object.create(realApi);
      stubApi.getMeetingInfo = async () => {
        throw new BbbUnavailableError('getMeetingInfo', 'e2e outage stub');
      };
      (reconciliationService as any).bbbApiService = stubApi;

      const grant = await freshGrant(grantOrg, 600);
      const meeting = await makeActiveMeeting({
        org: grantOrg,
        minutesAgo: 10,
        grantId: String(grant.id),
        observable: true,
      });
      const id = String(meeting.id);

      const reconciled = await reconciliationService.reconcileActiveMeetings();

      // Unavailable ≠ proven gone → nothing was staled this pass.
      expect(reconciled).toBe(0);
      const reloaded = await reloadMeeting(id);
      expect(reloaded.state).toBe(MEETING_STATE.ACTIVE);
      // The audit write proves the loop really processed this meeting.
      expect(reloaded.lastReconciledAt).not.toBeNull();
      expect(await ledgerCount(id)).toBe(0);
      expect(completedFor(id)).toHaveLength(0);
    });

    it('W1-B: outage during room runtime validation never completes the meeting', async () => {
      const realApi: any = server.app.get(BbbApiService);
      const stubApi: any = Object.create(realApi);
      stubApi.getMeetingInfo = async () => {
        throw new BbbUnavailableError('getMeetingInfo', 'e2e outage stub');
      };
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

      // Cannot prove the meeting is gone → still reported live: the meeting
      // must NOT complete (that would stop metering for a live class).
      expect(res.status).toBe('active');
      expect(res.shouldEnqueue).toBe(false);
      expect((await reloadMeeting(id)).state).toBe(MEETING_STATE.ACTIVE);
      expect((await reloadRoom(String(room.id))).state).toBe('Active');
      expect(await ledgerCount(id)).toBe(0);
      expect(completedFor(id)).toHaveLength(0);
    });

    it('W1-C: confirmed notFound during reconciliation stales the meeting without billing', async () => {
      const realApi: any = server.app.get(BbbApiService);
      const stubApi: any = Object.create(realApi);
      stubApi.getMeetingInfo = async () => {
        throw new BbbNotFoundError('e2e notFound stub');
      };
      (reconciliationService as any).bbbApiService = stubApi;

      const grant = await freshGrant(grantOrg, 600);
      const meeting = await makeActiveMeeting({
        org: grantOrg,
        minutesAgo: 10,
        grantId: String(grant.id),
        observable: true,
      });
      const id = String(meeting.id);

      const reconciled = await reconciliationService.reconcileActiveMeetings();

      // Stales W1-C's meeting — and the still-ACTIVE leftovers of W1-A/W1-B,
      // because the stub now proves EVERY meeting gone. Per-meeting verdicts,
      // not pass-aborts.
      expect(reconciled).toBeGreaterThanOrEqual(1);
      expect((await reloadMeeting(id)).state).toBe(MEETING_STATE.STALE);
      // STALE is terminal but never billed (markMeetingStale writes no ledger).
      expect(await ledgerCount(id)).toBe(0);
      expect(completedFor(id)).toHaveLength(0);
    });

    // ─── W5 regression cases (reconcile-remote-gone billing decision) ─────────
    //
    // Only the outbound BBB HTTP hop is property-replaced (same precedent as
    // C6/W1). Real reconcile loop, grace period, metered/grant branching,
    // lifecycle transaction, billing and alerting all run.

    it('W5-1: confirmed notFound with samples completes the metered meeting and bills one usage row', async () => {
      setReconcileApi(apiThrowing(new BbbNotFoundError('w5-1-gone')));
      opsNotifySpy.mockClear();
      const metricBefore = remoteGoneCompletions();

      const meeting = await makeActiveMeeting({
        org: meteredOrg,
        minutesAgo: 10,
        grantId: null,
        observable: true,
      });
      const id = String(meeting.id);
      const room = await makeLiveRoom(meteredOrg, meeting);
      const bucket1 = new Date(Date.now() - 5 * 60_000);
      const bucket2 = new Date(Date.now() - 4 * 60_000);
      await addSample(id, bucket1, 3);
      await addSample(id, bucket2, 3);

      const reconciled = await reconciliationService.reconcileActiveMeetings();

      expect(reconciled).toBe(1);
      const done = await reloadMeeting(id);
      expect(done.state).toBe(MEETING_STATE.COMPLETED);
      // completedAt = last sample + 1 minute (notFound carries no endTime),
      // clamped to >= provisionedAt. The month derivation of a wrong
      // fallback (new Date()) is pinned by W5-9 below.
      expect(done.completedAt).toBeTruthy();
      expect(
        Math.abs(done.completedAt!.getTime() - (bucket2.getTime() + 60_000)),
      ).toBeLessThan(1000);
      expect(done.completedAt!.getTime()).toBeGreaterThanOrEqual(
        meeting.provisionedAt!.getTime(),
      );

      // Room reset happens inside the same completion transaction.
      const roomAfter = await reloadRoom(String(room.id));
      expect(roomAfter.state).toBe('Idle');
      expect(roomAfter.currentMeetingId).toBeNull();

      const usage = await usageRows(id);
      expect(usage).toHaveLength(1);
      expect(usage[0].learnerMinutes).toBe(6);
      expect(usage[0].periodMonth).toBe(monthOf(done.completedAt!));
      expect(await ledgerCount(id)).toBe(0);

      const events = completedFor(id);
      expect(events).toHaveLength(1);
      expect(events[0].source).toBe('reconcile-remote-gone');

      expect(remoteGoneCompletions()).toBe(metricBefore + 1);
      const missed = alertsOfKind('bbb-webhook-missed');
      expect(missed).toHaveLength(1);
      expect(String(missed[0][1])).toBe(`server-${meeting.serverId}`);
    });

    it('W5-2: confirmed notFound with zero samples stales and raises a metering-gap alert', async () => {
      setReconcileApi(apiThrowing(new BbbNotFoundError('w5-2-gone')));
      opsNotifySpy.mockClear();
      const metricBefore = remoteGoneCompletions();

      const meeting = await makeActiveMeeting({
        org: meteredOrg,
        minutesAgo: 10,
        grantId: null,
        observable: true,
      });
      const id = String(meeting.id);

      const reconciled = await reconciliationService.reconcileActiveMeetings();

      expect(reconciled).toBe(1);
      expect((await reloadMeeting(id)).state).toBe(MEETING_STATE.STALE);
      expect(await usageRows(id)).toHaveLength(0);
      expect(await ledgerCount(id)).toBe(0);
      expect(completedFor(id)).toHaveLength(0);
      // Zero samples may mean broken metering — never a silent stale.
      expect(remoteGoneCompletions()).toBe(metricBefore);
      const gapAlerts = alertsOfKind('bbb-metering-zero-samples');
      expect(gapAlerts).toHaveLength(1);
      expect(String(gapAlerts[0][1])).toBe(`meeting-${id}`);
    });

    it('W5-3: getMeetingInfo success with endTime > 0 behaves like a confirmed end', async () => {
      const endTimeSec = Math.floor((Date.now() - 3 * 60_000) / 1000);
      setReconcileApi(apiWithEndTime(endTimeSec));
      opsNotifySpy.mockClear();

      const meeting = await makeActiveMeeting({
        org: meteredOrg,
        minutesAgo: 10,
        grantId: null,
        observable: true,
      });
      const id = String(meeting.id);
      await addSample(id, new Date(Date.now() - 6 * 60_000), 2);
      await addSample(id, new Date(Date.now() - 5 * 60_000), 2);

      const reconciled = await reconciliationService.reconcileActiveMeetings();

      expect(reconciled).toBe(1);
      const done = await reloadMeeting(id);
      expect(done.state).toBe(MEETING_STATE.COMPLETED);
      // BBB's own endTime (within [provisionedAt, now]) is the completedAt.
      expect(done.completedAt!.getTime()).toBe(endTimeSec * 1000);
      const usage = await usageRows(id);
      expect(usage).toHaveLength(1);
      expect(usage[0].periodMonth).toBe(monthOf(done.completedAt!));
      const events = completedFor(id);
      expect(events).toHaveLength(1);
      expect(events[0].source).toBe('reconcile-remote-gone');
    });

    it('W5-4: outage, misconfigured and rejected never touch the meeting', async () => {
      opsNotifySpy.mockClear();
      const metricBefore = remoteGoneCompletions();
      const meetingRepo = connection.getRepository(ctx, BbbMeeting);
      const serverRepo = connection.getRepository(ctx, BbbServer);
      const ids: string[] = [];
      for (let i = 0; i < 3; i++) {
        const m = await makeActiveMeeting({
          org: meteredOrg,
          minutesAgo: 10,
          grantId: null,
          observable: true,
        });
        await addSample(String(m.id), new Date(Date.now() - 4 * 60_000), 2);
        ids.push(String(m.id));
      }
      const expectUntouched = async (): Promise<void> => {
        for (const id of ids) {
          expect((await reloadMeeting(id)).state).toBe(MEETING_STATE.ACTIVE);
        }
      };

      // Outage: cannot prove gone → skip, no flag, nothing staled.
      setReconcileApi(apiThrowing(new BbbUnavailableError('getMeetingInfo', 'w5-4 outage')));
      expect(await reconciliationService.reconcileActiveMeetings()).toBe(0);
      await expectUntouched();

      // Misconfigured: skip + the SERVER is flagged (config problem), meeting untouched.
      setReconcileApi(apiThrowing(new BbbMisconfiguredError('w5-4 missing secret')));
      expect(await reconciliationService.reconcileActiveMeetings()).toBe(0);
      await expectUntouched();
      expect(
        (await serverRepo.findOneOrFail({ where: { id: serverRow.id } })).healthy,
      ).toBe(false);
      await serverRepo.update(serverRow.id, { healthy: true });

      // Rejected (bad checksum): same — server flagged, meeting untouched.
      setReconcileApi(
        apiThrowing(new BbbRejectedError('getMeetingInfo', 'checksumError', 'w5-4 rejected')),
      );
      expect(await reconciliationService.reconcileActiveMeetings()).toBe(0);
      await expectUntouched();
      expect(
        (await serverRepo.findOneOrFail({ where: { id: serverRow.id } })).healthy,
      ).toBe(false);
      await serverRepo.update(serverRow.id, { healthy: true });

      for (const id of ids) {
        expect(await usageRows(id)).toHaveLength(0);
        expect(completedFor(id)).toHaveLength(0);
      }
      expect(remoteGoneCompletions()).toBe(metricBefore);
      expect(alertsOfKind('bbb-webhook-missed')).toHaveLength(0);

      // Hygiene: terminalize so later W5 passes see only their own meetings.
      for (const id of ids) {
        await meetingRepo.update(id, { state: MEETING_STATE.STALE });
      }
    });

    it('W5-5: double reconcile, a late webhook and a billing replay yield exactly one usage row', async () => {
      setReconcileApi(apiThrowing(new BbbNotFoundError('w5-5-gone')));

      const meeting = await makeActiveMeeting({
        org: meteredOrg,
        minutesAgo: 10,
        grantId: null,
        observable: true,
      });
      const id = String(meeting.id);
      await addSample(id, new Date(Date.now() - 5 * 60_000), 4);
      await addSample(id, new Date(Date.now() - 4 * 60_000), 4);

      expect(await reconciliationService.reconcileActiveMeetings()).toBe(1);
      expect(await usageRows(id)).toHaveLength(1);
      const eventsAfterFirst = completedFor(id).length;
      expect(eventsAfterFirst).toBe(1);

      // Second pass: the meeting is no longer ACTIVE → untouched.
      expect(await reconciliationService.reconcileActiveMeetings()).toBe(0);
      expect(await usageRows(id)).toHaveLength(1);
      expect(completedFor(id)).toHaveLength(eventsAfterFirst);

      // Late webhook replay: already Completed → no transition, no billing.
      await lifecycleService.completeMeetingLifecycle(ctx, meeting.id, {
        source: 'webhook',
      });
      // Metered recovery replay: INSERT … ON CONFLICT (meetingId) DO NOTHING.
      const metering = server.app.get(BbbMeteringService);
      await metering.billMeteredMeeting(ctx, id);

      expect(await usageRows(id)).toHaveLength(1);
      expect(completedFor(id)).toHaveLength(eventsAfterFirst);
    });

    it('W5-6: grant-mode confirmed notFound stays STALE with zero billing (unchanged)', async () => {
      setReconcileApi(apiThrowing(new BbbNotFoundError('w5-6-gone')));
      opsNotifySpy.mockClear();

      const grant = await freshGrant(grantOrg, 600);
      const meeting = await makeActiveMeeting({
        org: grantOrg,
        minutesAgo: 10,
        grantId: String(grant.id),
        observable: true,
      });
      const id = String(meeting.id);
      // Samples must never drive grant-mode billing — grant mode is STALE.
      await addSample(id, new Date(Date.now() - 4 * 60_000), 5);

      const reconciled = await reconciliationService.reconcileActiveMeetings();

      expect(reconciled).toBe(1);
      expect((await reloadMeeting(id)).state).toBe(MEETING_STATE.STALE);
      expect(await ledgerCount(id)).toBe(0);
      expect(await usageRows(id)).toHaveLength(0);
      expect((await reloadGrant(String(grant.id))).consumedMinutes).toBe(0);
      expect(completedFor(id)).toHaveLength(0);
      expect(grantEventsFor(id)).toHaveLength(0);
      // The webhook-missed completion alert belongs to metered completions only.
      const missed = alertsOfKind('bbb-webhook-missed');
      expect(
        missed.filter((c: any[]) => String((c[3] ?? {}).meetingId) === id),
      ).toHaveLength(0);
    });

    it('W5-7: billing ceiling with null grantId completes capped, no grant event published', async () => {
      opsNotifySpy.mockClear();
      const controlGrant = await freshGrant(grantOrg, 600);
      const capacityBefore = capacityEvents.length;

      // 25 h old → past maxMeetingDurationMs (default 24 h) → ceiling branch.
      const meeting = await makeActiveMeeting({
        org: meteredOrg,
        minutesAgo: 25 * 60,
        grantId: null,
        observable: true,
      });
      const id = String(meeting.id);
      await addSample(id, new Date(Date.now() - 10 * 60_000), 7);
      await addSample(id, new Date(Date.now() - 9 * 60_000), 7);

      const reconciled = await reconciliationService.reconcileActiveMeetings();

      expect(reconciled).toBe(1);
      const done = await reloadMeeting(id);
      expect(done.state).toBe(MEETING_STATE.COMPLETED);
      expect(done.billingCapped).toBe(true);
      expect(done.billingCapReason).toContain('maxMeetingDurationMs');
      // The meeting ENDED at the ceiling (provisionedAt + 24 h), not when
      // this pass happened to run — see W5-10 for the month consequence.
      expect(done.completedAt!.getTime()).toBe(
        (meeting.provisionedAt as Date).getTime() + 24 * 60 * 60_000,
      );

      const usage = await usageRows(id);
      expect(usage).toHaveLength(1);
      expect(usage[0].billingCapped).toBe(true);

      // grantId is null → the grant lookup is skipped entirely: no
      // CapacityExhaustedEvent and no arbitrary grant row touched.
      expect(capacityEvents.length).toBe(capacityBefore);
      expect(
        capacityEvents.filter(
          (e) => String(e.organization?.id) === String(meteredOrg.id),
        ),
      ).toHaveLength(0);
      expect((await reloadGrant(String(controlGrant.id))).consumedMinutes).toBe(0);
      expect(await ledgerCount(id)).toBe(0);
    });

    it('W5-8: missing moderator password skips the meeting without flagging the server', async () => {
      const stub: any = Object.create(server.app.get(BbbApiService));
      const getMeetingInfo = vi.fn(async () => ({
        meetingID: 'never-called',
        internalMeetingID: 'never-called',
        running: false,
        participantCount: 0,
        moderatorCount: 0,
        recording: false,
        startTime: 0,
        endTime: 0,
      }));
      stub.getMeetingInfo = getMeetingInfo;
      setReconcileApi(stub);
      opsNotifySpy.mockClear();

      const meeting = await makeActiveMeeting({
        org: meteredOrg,
        minutesAgo: 10,
        grantId: null,
        observable: true,
        moderatorPassword: null,
      });
      const id = String(meeting.id);

      const reconciled = await reconciliationService.reconcileActiveMeetings();

      expect(reconciled).toBe(0);
      // Per-meeting data problem: the API is never called — an
      // unauthenticated getMeetingInfo would be rejected and would flag the
      // whole server because of ONE bad meeting row.
      expect(getMeetingInfo).not.toHaveBeenCalled();
      const reloaded = await reloadMeeting(id);
      expect(reloaded.state).toBe(MEETING_STATE.ACTIVE);
      // The audit write proves the loop processed (and skipped) this meeting.
      expect(reloaded.lastReconciledAt).not.toBeNull();
      const serverRepo = connection.getRepository(ctx, BbbServer);
      expect(
        (await serverRepo.findOneOrFail({ where: { id: serverRow.id } })).healthy,
      ).toBe(true);
      expect(alertsOfKind('bbb-server-config')).toHaveLength(0);
    });

    it('W5-9: month boundary — completedAt month wins over reconcile-time month', async () => {
      // Freeze the wall clock so "now" is 00:30 IST on February 1st while the
      // meeting, its samples and BBB's endTime all sit on January 31st IST.
      // (A real-clock version only works within 24 h of a month boundary —
      // and a >24 h-old meeting would hit the billing ceiling instead.)
      // IST day boundary: 2026-01-31T18:30:00Z == 2026-02-01T00:00:00+05:30,
      // so every instant below must precede 18:30Z to stay in January IST.
      vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-01-31T19:00:00.000Z') });
      try {
        const endTimeSec = Math.floor(
          new Date('2026-01-31T18:20:00.000Z').getTime() / 1000,
        );
        setReconcileApi(apiWithEndTime(endTimeSec));
        opsNotifySpy.mockClear();

        const meeting = await makeActiveMeeting({
          org: meteredOrg,
          minutesAgo: 60, // provisionedAt = 2026-01-31T18:00Z (frozen clock)
          grantId: null,
          observable: true,
        });
        const id = String(meeting.id);
        await addSample(id, new Date('2026-01-31T18:10:00.000Z'), 5);
        await addSample(id, new Date('2026-01-31T18:15:00.000Z'), 5);

        expect(await reconciliationService.reconcileActiveMeetings()).toBe(1);

        const done = await reloadMeeting(id);
        expect(done.state).toBe(MEETING_STATE.COMPLETED);
        expect(done.completedAt!.getTime()).toBe(endTimeSec * 1000);

        const usage = await usageRows(id);
        expect(usage).toHaveLength(1);
        // Booked to JANUARY IST (18:20Z == 23:50 IST Jan 31) — deriving
        // periodMonth from reconcile-time (19:00Z == 00:30 IST Feb 1) would
        // produce '2026-02'.
        expect(usage[0].periodMonth).toBe('2026-01');
        expect(usage[0].periodMonth).toBe(monthOf(done.completedAt!));
        expect(usage[0].periodMonth).not.toBe(
          monthOf(new Date('2026-01-31T19:00:00.000Z')),
        );
      } finally {
        vi.useRealTimers();
      }
    });

    it('W5-11: endedByUserId keep-first — moderator end survives system completion, failed end stays null, reconcile stays null', async () => {
      // (a) Explicit carrier wins over a null system ctx (moderator pressed
      // End; the webhook completion runs under a system ctx).
      const meetingA = await makeActiveMeeting({
        org: grantOrg,
        minutesAgo: 10,
        grantId: String((await freshGrant(grantOrg, 600)).id),
      });
      await lifecycleService.completeMeetingLifecycle(ctx, meetingA.id, {
        source: 'end-meeting',
        endedByUserId: 'moderator-user-1',
      });
      const doneA = await reloadMeeting(String(meetingA.id));
      expect(doneA.state).toBe(MEETING_STATE.COMPLETED);
      expect(doneA.endedByUserId).toBe('moderator-user-1');

      // (b) Later system completion never overwrites the human stamp
      // (idempotent no-op here — but the row must keep the human). A REAL
      // system ctx via RequestContextService (no user), not a spread copy:
      // `{ ...ctx, activeUserId: null }` loses the RequestContext prototype
      // (B3 red run), so getters like channelId and methods like
      // userHasPermissions disappear.
      const systemCtx = await server.app
        .get(RequestContextService)
        .create({ apiType: 'admin' });
      await lifecycleService.completeMeetingLifecycle(systemCtx, meetingA.id, {
        source: 'webhook',
      });
      expect((await reloadMeeting(String(meetingA.id))).endedByUserId).toBe(
        'moderator-user-1',
      );

      // (c) System-only completion stays null (reconcile / webhook with no
      // requesting user) — the keep-first guard must not invent a stamp.
      const meetingC = await makeActiveMeeting({
        org: grantOrg,
        minutesAgo: 10,
        grantId: String((await freshGrant(grantOrg, 600)).id),
      });
      await lifecycleService.completeMeetingLifecycle(systemCtx, meetingC.id, {
        source: 'reconciliation',
      });
      expect((await reloadMeeting(String(meetingC.id))).endedByUserId).toBeNull();

      // (d) A failed /end through BbbMeetingService leaves endedByUserId null
      // AND the meeting ACTIVE (post-ack contract, BUG-059: the catch rethrows
      // before the stamp). The BBB hop is stubbed at the injected
      // BbbApiService — the in-repo precedent (r4-runtime-lifecycle). The
      // moderator password is real-encrypted (W5 fixture path) so decrypt runs.
      const meetingD = await makeActiveMeeting({
        org: grantOrg,
        minutesAgo: 10,
        grantId: String((await freshGrant(grantOrg, 600)).id),
        observable: true,
      });
      const idD = String(meetingD.id);
      const failingApi: any = Object.create(server.app.get(BbbApiService));
      failingApi.endMeeting = async () => {
        throw new BbbUnavailableError('endMeeting', 'w5-11d outage');
      };
      const meetingSvc = meetingService as any;
      const realApi = meetingSvc.bbbApiService;
      meetingSvc.bbbApiService = failingApi;
      try {
        await expect(meetingService.endMeeting(ctx, idD)).rejects.toThrow(
          'w5-11d outage',
        );
      } finally {
        meetingSvc.bbbApiService = realApi;
      }
      const afterFail = await reloadMeeting(idD);
      expect(afterFail.state).toBe(MEETING_STATE.ACTIVE);
      expect(afterFail.endedByUserId).toBeNull();
      expect(completedFor(idD)).toHaveLength(0);

      // (e) Successful /end through BbbMeetingService stamps the post-ack
      // requester (ctx.activeUserId) and completes the meeting. Same seam as
      // (d), resolving stub this time — the path (a)/(b) exercise only at the
      // lifecycle layer.
      const meetingE = await makeActiveMeeting({
        org: grantOrg,
        minutesAgo: 10,
        grantId: String((await freshGrant(grantOrg, 600)).id),
        observable: true,
      });
      const idE = String(meetingE.id);
      const succeedingApi: any = Object.create(server.app.get(BbbApiService));
      succeedingApi.endMeeting = async () => undefined;
      meetingSvc.bbbApiService = succeedingApi;
      try {
        const ended = await meetingService.endMeeting(ctx, idE);
        expect(ended.state).toBe(MEETING_STATE.COMPLETED);
      } finally {
        meetingSvc.bbbApiService = realApi;
      }
      const afterSuccess = await reloadMeeting(idE);
      expect(afterSuccess.state).toBe(MEETING_STATE.COMPLETED);
      expect(afterSuccess.endedByUserId).toBe(
        ctx.activeUserId != null ? String(ctx.activeUserId) : null,
      );
      expect(completedFor(idE)).toHaveLength(1);
    });

    it('W5-10: billing ceiling books usage to provisionedAt + maxMeetingDuration, not the pass clock', async () => {
      // Frozen clock: now = 00:30 IST on February 1st. The meeting was
      // provisioned January 30th 06:30Z (12:00 IST) → 36.5 h old → the 24 h
      // ceiling fires, so for billing the meeting ENDED on January 31st
      // 06:30Z (12:00 IST). Taking completedAt from the pass clock instead
      // (pre-W5-10 behaviour) would book '2026-02' — one day late, wrong month.
      // IST day boundary: 2026-01-31T18:30:00Z == 2026-02-01T00:00:00+05:30.
      vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-01-31T19:00:00.000Z') });
      try {
        // If the ceiling branch ever lost to the remote-gone branch, this
        // stub would book the pass clock (Feb IST) and fail the month assertions.
        setReconcileApi(
          apiWithEndTime(
            Math.floor(new Date('2026-01-31T19:00:00.000Z').getTime() / 1000),
          ),
        );

        const meeting = await makeActiveMeeting({
          org: meteredOrg,
          minutesAgo: 36 * 60 + 30, // provisionedAt = 2026-01-30T06:30Z = 12:00 IST (frozen clock)
          grantId: null,
          observable: true,
        });
        const id = String(meeting.id);
        await addSample(id, new Date('2026-01-30T07:30:00.000Z'), 5);
        await addSample(id, new Date('2026-01-30T08:30:00.000Z'), 5);

        expect(await reconciliationService.reconcileActiveMeetings()).toBe(1);

        const done = await reloadMeeting(id);
        expect(done.state).toBe(MEETING_STATE.COMPLETED);
        expect(done.billingCapped).toBe(true);
        // provisionedAt + maxMeetingDurationMs (24 h) — NOT the reconcile clock.
        // 2026-01-30T06:30Z + 24 h = 2026-01-31T06:30Z == 12:00 IST Jan 31.
        expect(done.completedAt!.toISOString()).toBe('2026-01-31T06:30:00.000Z');

        const usage = await usageRows(id);
        expect(usage).toHaveLength(1);
        expect(usage[0].billingCapped).toBe(true);
        // Booked to JANUARY IST — a clock-derived completedAt gives '2026-02'.
        expect(usage[0].periodMonth).toBe('2026-01');
        expect(usage[0].periodMonth).toBe(monthOf(done.completedAt!));
        expect(usage[0].periodMonth).not.toBe(
          monthOf(new Date('2026-01-31T19:00:00.000Z')),
        );
        // Both samples sit inside the cap window (before Jan 31 06:30Z).
        expect(usage[0].learnerMinutes).toBe(10);
      } finally {
        vi.useRealTimers();
      }
    });
  });
});

