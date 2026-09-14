/**
 * Concurrent meeting-limit e2e — Commit 2 gate.
 *
 * Infrastructure-gated: requires Postgres.
 * Run:
 *   MEETING_CONCURRENCY_E2E=true npx vitest run --config vitest.config.mts \
 *     src/plugins/bigbluebutton-plugin/e2e/bbb-meeting-concurrency.e2e-spec.ts
 *
 * Proves concurrent PENDING→PROVISIONING promotions cannot push
 * (PROVISIONING + ACTIVE) past the org's concurrentMeetingLimit. The promotion
 * is one atomic transaction: pessimistic lock on the org row, count live
 * meetings, and only then flip the meeting to PROVISIONING
 * (BbbProvisioningWorkerService.reserveProvisioningCapacity).
 *
 * Setup: org limit=2, one enabled/healthy server, one valid grant, 3 PENDING
 * meetings. bbbApiService.createMeeting is stubbed to block, so the 2 accepted
 * promotions pause in PROVISIONING while the 3rd stays PENDING — observable peak.
 */

import 'reflect-metadata';
import 'dotenv/config';
import net from 'net';
import {
  createTestEnvironment,
  registerInitializer,
  testConfig,
} from '@vendure/testing';
import { mergeConfig, TransactionalConnection } from '@vendure/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getSuperadminContext } from '@vendure/testing/lib/utils/get-superadmin-context';

import { TenantPlugin } from '../../tenant-plugin/tenant-plugin.plugin';
import { BigBlueButtonPlugin } from '../bigbluebutton.plugin';
import { SchemaPostgresInitializer } from '../../tenant-plugin/e2e/schema-postgres-initializer';
import { BbbMeeting } from '../entities/bbb-meeting.entity';
import { BbbOrganization } from '../entities/bbb-organization.entity';
import { BbbServer } from '../entities/bbb-server.entity';
import { BbbCapacityGrant } from '../entities/bbb-capacity-grant.entity';
import { BbbProvisioningWorkerService } from '../services/bbb-provisioning-worker.service';
import { MEETING_STATE } from '../constants';

registerInitializer('postgres', new SchemaPostgresInitializer());

const CONCURRENCY_E2E = process.env.MEETING_CONCURRENCY_E2E === 'true';

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
    apiOptions: { port: 3089 },
    dbConnectionOptions: {
      type: 'postgres',
      host: process.env.DB_HOST ?? '127.0.0.1',
      port: Number(process.env.DB_PORT ?? 5432),
      database: process.env.DB_NAME ?? 'vendure',
      username: process.env.DB_USERNAME ?? 'vendure_user',
      password: process.env.DB_PASSWORD ?? '',
      schema: 'e2e_bbb_concurrency',
      synchronize: true,
    },
    plugins: [TenantPlugin, BigBlueButtonPlugin],
  }),
);

const LIMIT = 2;
describe('BbbProvisioningWorker concurrent capacity (Commit 2 gate)', () => {
  const d = CONCURRENCY_E2E ? describe : describe.skip;

  let ctx: any;
  let connection: TransactionalConnection;
  let worker: BbbProvisioningWorkerService;
  let org: BbbOrganization;
  let releaseCreate: () => void;

  d('concurrent promotions respect concurrentMeetingLimit', () => {
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
      worker = server.app.get(BbbProvisioningWorkerService);

      const orgRepo = connection.getRepository(ctx, BbbOrganization);
      org = await orgRepo.save(
        orgRepo.create({
          channelId: String(ctx.channelId),
          name: `Concurrency Org ${Date.now()}`,
          slug: `conc-org-${Date.now()}`,
          ownerUserId: '1',
          concurrentMeetingLimit: LIMIT,
        }),
      );

      const serverRepo = connection.getRepository(ctx, BbbServer);
      await serverRepo.save(
        serverRepo.create({
          name: `Conc Test Server ${Date.now()}`,
          apiUrl: 'http://localhost:1999/bigbluebutton/api',
          encryptedApiSecret: 'test-secret',
          enabled: true,
          healthy: true,
          currentLoad: 0,
          maxLoad: 100,
          capacity: 100,
        }),
      );

      const grantRepo = connection.getRepository(ctx, BbbCapacityGrant);
      await grantRepo.save(
        grantRepo.create({
          organization: org,
          grantedMinutes: 600,
          consumedMinutes: 0,
          validFrom: new Date(Date.now() - 3600_000),
          validUntil: new Date(Date.now() + 3600_000),
          exhausted: false,
        }),
      );

      const meetingRepo = connection.getRepository(ctx, BbbMeeting);
      for (let i = 0; i < LIMIT + 1; i++) {
        await meetingRepo.save(
          meetingRepo.create({
            title: `Concurrent Meeting ${i}`,
            state: MEETING_STATE.PENDING,
            organization: org,
          }),
        );
      }
    }, 60000);

    afterAll(async () => {
      if (releaseCreate) releaseCreate();
      await server.destroy();
    });

    it(`leaves PROVISIONING+ACTIVE <= ${LIMIT} and at least one PENDING`, async () => {
      const blocked = new Promise<void>((resolve) => {
        releaseCreate = resolve;
      });
      (worker as any).bbbApiService = {
        createMeeting: async () => {
          await blocked;
          throw new Error('stubbed-bbb-failure');
        },
      };

      const meetingRepo = connection.getRepository(ctx, BbbMeeting);
      const meetings = await meetingRepo.find({
        where: { organization: { id: String(org.id) } },
        order: { id: 'ASC' },
      });
      expect(meetings.length).toBe(LIMIT + 1);

      const attempts = meetings.map((m, i) =>
        worker.doProvisionMeeting(ctx, m.id, String(i)),
      );

      await new Promise((r) => setTimeout(r, 600));

      const states = await meetingRepo.find({
        where: { organization: { id: String(org.id) } },
      });
      const live = states.filter(
        (s) => s.state === MEETING_STATE.PROVISIONING || s.state === MEETING_STATE.ACTIVE,
      ).length;
      const pending = states.filter((s) => s.state === MEETING_STATE.PENDING).length;

      releaseCreate();
      await Promise.allSettled(attempts);

      expect(live).toBe(LIMIT);
      expect(pending).toBeGreaterThanOrEqual(1);
      expect(live).toBeLessThanOrEqual(LIMIT);
    }, 15000);
  });
});
