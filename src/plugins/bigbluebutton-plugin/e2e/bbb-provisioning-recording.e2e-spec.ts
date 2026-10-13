/**
 * Recording provisioning e2e — asserts the REAL BBB `/create` payload.
 *
 * Infrastructure-gated: requires Postgres. Run:
 *   BBB_PROVISIONING_RECORDING_E2E=true npx vitest run --config vitest.config.mts \
 *     src/plugins/bigbluebutton-plugin/e2e/bbb-provisioning-recording.e2e-spec.ts
 *
 * Why this exists (separate from the pure policy spec): the helper could be
 * correct while the worker accidentally drops, renames or overrides the value.
 * This spec drives the REAL `BbbProvisioningWorkerService.doProvisionMeeting()`
 * against real Postgres and captures the params object the worker hands to
 * `BbbApiService.createMeeting` — the integration boundary where the bug would
 * actually bite.
 *
 * Proves:
 *   R1 recordingEnabled=true  → record=true, autoStartRecording=true,
 *                               allowStartStopRecording=true
 *                               (BBB 3.0 defaults autoStartRecording to false,
 *                               so record=true ALONE does not start recording)
 *   R2 recordingEnabled=false → record=false, autoStartRecording=false,
 *                               allowStartStopRecording=true
 *   R3 the meeting reaches Active (the payload was accepted by the real
 *      provisioning path, not just handed to a spy)
 *
 * Only the outbound BBB HTTP hop is replaced (property replacement on the
 * injected service — the in-repo precedent: bbb-meeting-concurrency.e2e-spec.ts
 * `(worker as any).bbbApiService = {...}`); the provisioning state machine,
 * capacity reservation, grant gate, encryption and MeetingProvisionedEvent all
 * run for real.
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

const RECORDING_E2E = process.env.BBB_PROVISIONING_RECORDING_E2E === 'true';

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
      schema: 'e2e_bbb_recording',
      synchronize: true,
    },
    plugins: [TenantPlugin, BigBlueButtonPlugin],
  }),
);

/** The params object the worker handed to BbbApiService.createMeeting. */
let captured: Record<string, unknown> | null = null;

describe('BBB /create recording flags (real provisioning path)', () => {
  const d = RECORDING_E2E ? describe : describe.skip;

  let ctx: any;
  let connection: TransactionalConnection;
  let worker: BbbProvisioningWorkerService;
  let serverRow: BbbServer;

  /** One org + selectable grant + one PENDING meeting, on its own channel. */
  async function fixture(opts: {
    channelSuffix: string;
    recordingEnabled: boolean;
  }): Promise<BbbMeeting> {
    const orgRepo = connection.getRepository(ctx, BbbOrganization);
    const org = await orgRepo.save(
      orgRepo.create({
        channelId: `recording-${opts.channelSuffix}`,
        name: `Recording Org ${opts.channelSuffix}`,
        slug: `recording-${opts.channelSuffix}`,
        ownerUserId: '1',
        concurrentMeetingLimit: 5,
        recordingEnabled: opts.recordingEnabled,
      }),
    );

    const grantRepo = connection.getRepository(ctx, BbbCapacityGrant);
    await grantRepo.save(
      grantRepo.create({
        organization: org,
        // `order` is the column default and a tenant-selectable source type,
        // so the grant gate passes (same fixture shape as the concurrency spec).
        grantedMinutes: 600,
        consumedMinutes: 0,
        validFrom: new Date(Date.now() - 3600_000),
        validUntil: new Date(Date.now() + 3600_000),
        exhausted: false,
      }),
    );

    const meetingRepo = connection.getRepository(ctx, BbbMeeting);
    return meetingRepo.save(
      meetingRepo.create({
        title: `Recording Meeting ${opts.channelSuffix}`,
        state: MEETING_STATE.PENDING,
        organization: org,
        recordingEnabled: opts.recordingEnabled,
      }),
    );
  }

  /** Install the capturing stub on the worker's own service reference. */
  function installCapturingTransport(): void {
    (worker as any).bbbApiService = {
      createMeeting: async (
        _server: unknown,
        params: Record<string, unknown>,
      ) => {
        captured = params;
        return {
          internalMeetingID: `rec-internal-${Date.now()}`,
          meetingID: params.meetingID,
        };
      },
    };
  }

  d('provisioning sends the recording flags BBB needs', () => {
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
      worker = server.app.get(BbbProvisioningWorkerService);

      const serverRepo = connection.getRepository(ctx, BbbServer);
      serverRow = await serverRepo.save(
        serverRepo.create({
          name: `Recording Test Server ${Date.now()}`,
          apiUrl: 'http://localhost:1999/bigbluebutton/api',
          encryptedApiSecret: 'test-secret',
          enabled: true,
          healthy: true,
          currentLoad: 0,
          maxLoad: 100,
          capacity: 100,
        }),
      );
      expect(serverRow.id).toBeTruthy();
    }, 60000);

    afterAll(async () => {
      await server.destroy();
    });

    it('R1: a recording-enabled room sends record/autoStartRecording/allowStartStopRecording = true', async () => {
      const meeting = await fixture({
        channelSuffix: 'enabled',
        recordingEnabled: true,
      });
      captured = null;
      installCapturingTransport();

      await worker.doProvisionMeeting(ctx, meeting.id, 'r1-recording-enabled');

      expect(captured).not.toBeNull();
      expect(captured!.record).toBe(true);
      // The regression this spec exists for: the worker hard-coded `false`.
      expect(captured!.autoStartRecording).toBe(true);
      expect(captured!.allowStartStopRecording).toBe(true);

      // R3 — accepted by the real path, not just spied on.
      const after = await connection
        .getRepository(ctx, BbbMeeting)
        .findOneByOrFail({ id: String(meeting.id) });
      expect(after.state).toBe(MEETING_STATE.ACTIVE);
      expect(String(after.serverId)).toBe(String(serverRow.id));
      expect(after.grantId).toBeTruthy();
    }, 20000);

    it('R2: a recording-disabled room never records', async () => {
      const meeting = await fixture({
        channelSuffix: 'disabled',
        recordingEnabled: false,
      });
      captured = null;
      installCapturingTransport();

      await worker.doProvisionMeeting(ctx, meeting.id, 'r2-recording-disabled');

      expect(captured).not.toBeNull();
      expect(captured!.record).toBe(false);
      expect(captured!.autoStartRecording).toBe(false);
      // Never trap a moderator in an unwanted recording — but the flag stays
      // available so a moderator who starts recording manually can stop it.
      expect(captured!.allowStartStopRecording).toBe(true);

      const after = await connection
        .getRepository(ctx, BbbMeeting)
        .findOneByOrFail({ id: String(meeting.id) });
      expect(after.state).toBe(MEETING_STATE.ACTIVE);
    }, 20000);
  });
});
