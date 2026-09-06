/**
 * SessionAttendance e2e (3D.3e).
 *
 * Infrastructure-gated: requires Postgres.
 *
 * Run:  ATTENDANCE_E2E=true npx vitest run --config vitest.config.mts src/plugins/bigbluebutton-plugin/e2e/attendance.e2e-spec.ts
 *
 * Coverage (phase3-attendance.md §8 matrix):
 *   1. registered + attended  → one PRESENT row
 *   2. registered, no join      → NO_SHOW row
 *   3. duplicate webhook event  → no double-count (idempotent watermark)
 *   4. late MEETING_ENDED event → status recomputed, source WEBHOOK
 *   5. unregistered attendee    → row created (evidence exists)
 *   6. admin summary query      → channel-scoped aggregates
 */

import 'reflect-metadata';
import 'dotenv/config';
import net from 'net';
import {
  createTestEnvironment,
  registerInitializer,
  testConfig,
} from '@vendure/testing';
import { mergeConfig } from '@vendure/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getSuperadminContext } from '@vendure/testing/lib/utils/get-superadmin-context';

import { TenantPlugin } from '../../tenant-plugin/tenant-plugin.plugin';
import { BigBlueButtonPlugin } from '../bigbluebutton.plugin';
import { SchemaPostgresInitializer } from '../../tenant-plugin/e2e/schema-postgres-initializer';
import { SessionAttendance } from '../entities/session-attendance.entity';
import { BbbMeeting } from '../entities/bbb-meeting.entity';
import { BbbScheduledSession } from '../entities/bbb-scheduled-session.entity';
import { BbbEntitlement } from '../entities/bbb-entitlement.entity';
import { BbbOrganization } from '../entities/bbb-organization.entity';
import { BbbMeetingService } from '../services/bbb-meeting.service';
import { AttendanceAnalyticsService } from '../services/attendance-analytics.service';
import { TransactionalConnection, Customer } from '@vendure/core';

registerInitializer('postgres', new SchemaPostgresInitializer());

const ATTENDANCE_E2E = process.env.ATTENDANCE_E2E === 'true';

async function assertPostgres(): Promise<void> {
  const host = process.env.DB_HOST ?? '127.0.0.1';
  const port = Number(process.env.DB_PORT ?? 5435);
  await new Promise<void>((resolve, reject) => {
    const sock = net.connect(port, host);
    sock.once('connect', () => { sock.destroy(); resolve(); });
    sock.once('error', (err) => reject(err));
  });
}

const { server } = createTestEnvironment(
  mergeConfig(testConfig, {
    apiOptions: { port: 3079 },
    dbConnectionOptions: {
      type: 'postgres',
      host: process.env.DB_HOST ?? '127.0.0.1',
      port: Number(process.env.DB_PORT ?? 5435),
      database: process.env.DB_NAME ?? 'vendure',
      username: process.env.DB_USERNAME ?? 'vendure_user',
      password: process.env.DB_PASSWORD ?? '',
      schema: 'e2e_attendance',
      synchronize: true,
    },
    plugins: [TenantPlugin, BigBlueButtonPlugin],
  }),
);


describe('SessionAttendance (3D.3e)', () => {
  const d = ATTENDANCE_E2E ? describe : describe.skip;

  // placeholder test to verify harness

  let ctx: any;
  let connection: TransactionalConnection;
  let meetingService: BbbMeetingService;
  let analytics: AttendanceAnalyticsService;

  let customerA: Customer;
  let customerB: Customer;
  let customerC: Customer;

  let org: BbbOrganization;
  let session: BbbScheduledSession;
  let meeting: BbbMeeting;

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
    meetingService = server.app.get(BbbMeetingService);
    analytics = server.app.get(AttendanceAnalyticsService);

    // Create test customers
    const customerRepo = connection.getRepository(ctx, Customer);
    customerA = (await customerRepo.save(
      customerRepo.create({
        firstName: 'Alice',
        lastName: 'Test',
        emailAddress: `alice-${Date.now()}@test.com`,
      } as any),
    )) as unknown as Customer;
    customerB = (await customerRepo.save(
      customerRepo.create({
        firstName: 'Bob',
        lastName: 'Test',
        emailAddress: `bob-${Date.now()}@test.com`,
      } as any),
    )) as unknown as Customer;
    customerC = (await customerRepo.save(
      customerRepo.create({
        firstName: 'Charlie',
        lastName: 'Noshow',
        emailAddress: `charlie-${Date.now()}@test.com`,
      } as any),
    )) as unknown as Customer;

    // Create organization
    const orgRepo = connection.getRepository(ctx, BbbOrganization);
    org = await orgRepo.save(
      orgRepo.create({
        channelId: String(ctx.channelId),
        name: 'E2E Test Org',
        slug: `e2e-test-org-${Date.now()}`,
        ownerUserId: '1',
      }),
    );

    // Create scheduled session
    const sessionRepo = connection.getRepository(ctx, BbbScheduledSession);
    const now = new Date();
    session = await sessionRepo.save(
      sessionRepo.create({
        title: 'E2E Test Session',
        startTime: now,
        endTime: new Date(now.getTime() + 3600000),
        status: 'LIVE',
        organizationId: String(org.id),
        organization: org,
      }),
    );

    // Create meeting linked to session
    const meetingRepo = connection.getRepository(ctx, BbbMeeting);
    meeting = (await meetingRepo.save(
      meetingRepo.create({
        title: 'E2E Test Meeting',
        state: 'Active',
        bbbMeetingId: `e2e-meeting-${Date.now()}`,
        organization: org,
      } as any),
    )) as unknown as BbbMeeting;

    // Link meeting to session
    session.activeMeeting = meeting;
    await sessionRepo.save(session);

    // Create entitlements (registered students): A and C
    const entitlementRepo = connection.getRepository(ctx, BbbEntitlement);
    await entitlementRepo.save(
      entitlementRepo.create({
        type: 'bbb_session',
        resourceId: String(session.id),
        customerId: String(customerA.id),
        channelId: String(ctx.channelId),
        source: 'admin',
        validFrom: null,
        validUntil: null,
      }),
    );
    await entitlementRepo.save(
      entitlementRepo.create({
        type: 'bbb_session',
        resourceId: String(session.id),
        customerId: String(customerC.id),
        channelId: String(ctx.channelId),
        source: 'admin',
        validFrom: null,
        validUntil: null,
      }),
    );
  }, 60000);

  afterAll(async () => {
    await server.destroy();
  });

  function makeMeetingEndedPayload(attendeeIds: string[]): Record<string, unknown> {
    return {
      event: 'meeting-ended',
      meetingID: meeting.bbbMeetingId,
      attendees: attendeeIds.map((id) => ({ userId: id })),
    };
  }

  describe('attendance derivation from MEETING_ENDED', () => {
    it('creates PRESENT for attendees and NO_SHOW for registered non-attendees', async () => {
      const payload = makeMeetingEndedPayload([String(customerA.id)]);
      await meetingService.handleWebhookEvent(ctx, 'meeting-ended', payload, 'evt-001');

      const repo = connection.getRepository(ctx, SessionAttendance);
      const rows = await repo.find({ where: { scheduledSessionId: String(session.id) } });

      // customerA attended → PRESENT
      const aRow = rows.find((r) => r.customerId === String(customerA.id));
      expect(aRow).toBeDefined();
      expect(aRow!.attendanceStatus).toBe('PRESENT');

      // customerC registered but no join → NO_SHOW
      const cRow = rows.find((r) => r.customerId === String(customerC.id));
      expect(cRow).toBeDefined();
      expect(cRow!.attendanceStatus).toBe('NO_SHOW');
    });

    it('is idempotent: reprocessing same webhook event does not double-count', async () => {
      const payload = makeMeetingEndedPayload([String(customerA.id)]);
      await meetingService.handleWebhookEvent(ctx, 'meeting-ended', payload, 'evt-001');

      const repo = connection.getRepository(ctx, SessionAttendance);
      const rows = await repo.find({
        where: { scheduledSessionId: String(session.id), customerId: String(customerA.id) },
      });
      expect(rows.length).toBe(1);
      expect(rows[0].lastProcessedWebhookEventId).toBe('evt-001');
    });

    it('recomputes on new webhook event (late event updates status)', async () => {
      const payload = makeMeetingEndedPayload([String(customerA.id), String(customerB.id)]);
      await meetingService.handleWebhookEvent(ctx, 'meeting-ended', payload, 'evt-002');

      const repo = connection.getRepository(ctx, SessionAttendance);

      // customerB (unregistered) should now have a row
      const bRow = await repo.findOne({
        where: { scheduledSessionId: String(session.id), customerId: String(customerB.id) },
      });
      expect(bRow).toBeDefined();
      expect(bRow!.attendanceStatus).toBe('PRESENT');
      expect(bRow!.source).toBe('WEBHOOK');

      // customerA still PRESENT with updated watermark
      const aRow = await repo.findOne({
        where: { scheduledSessionId: String(session.id), customerId: String(customerA.id) },
      });
      expect(aRow!.attendanceStatus).toBe('PRESENT');
      expect(aRow!.lastProcessedWebhookEventId).toBe('evt-002');
    });

    it('admin summary returns channel-scoped aggregates', async () => {
      const from = new Date(Date.now() - 86400000);
      const to = new Date(Date.now() + 86400000);
      const summary = await analytics.getChannelAttendanceSummary(ctx, from, to);

      expect(summary.totalRegistered).toBeGreaterThanOrEqual(3); // A, B, C
      expect(summary.totalAttended).toBeGreaterThanOrEqual(2); // A, B
      expect(summary.totalNoShow).toBeGreaterThanOrEqual(1); // C
      expect(summary.attendanceRate).toBeGreaterThan(0);
      expect(summary.totalSessions).toBeGreaterThanOrEqual(1);
    });
  });
});

