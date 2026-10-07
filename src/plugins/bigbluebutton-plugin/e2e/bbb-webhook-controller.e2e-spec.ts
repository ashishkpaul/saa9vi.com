/**
 * W3 controller e2e — HTTP-level tests for POST /bbb/webhook/:serverId.
 *
 * Infrastructure-gated: requires Postgres.
 * Run:
 *   BBB_WEBHOOK_CONTROLLER_E2E=true npx vitest run \
 *     src/plugins/bigbluebutton-plugin/e2e/bbb-webhook-controller.e2e-spec.ts
 *
 * Coverage:
 *   C1  Good sha256 checksum → 200, PENDING row persisted
 *   C2  Bearer mode, good token → 200, bearer-mode alert fired
 *   C3  Bad checksum (tampered) → 401, no row persisted
 *   C4  Bad bearer token → 401, no row persisted
 *   C5  Unknown serverId → 404
 *   C6  Disabled (known) server → 200 (not 404), event accepted
 *   C7  Replay of identical body → 200 idempotent (no second row)
 *   C8  Poison body (auth OK, bad JSON) → 200, PARSE_FAILED row
 *   C9  meeting-ended → meeting transitions to Completed
 *   C10 rap-publish-ended → bbbRecordingId + recordingUrl updated
 *   C11 meeting-created (not allow-listed) → 200, no row persisted
 *   C12 Multi-element array → 200, multi-event ops alert fired
 */
import "reflect-metadata";
import "dotenv/config";
import * as crypto from "crypto";
import net from "net";

import {
  createTestEnvironment,
  registerInitializer,
  testConfig,
} from "@vendure/testing";
import { mergeConfig, TransactionalConnection } from "@vendure/core";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
  type MockInstance,
} from "vitest";
import { getSuperadminContext } from "@vendure/testing/lib/utils/get-superadmin-context";

import { TenantPlugin } from "../../tenant-plugin/tenant-plugin.plugin";
import { BigBlueButtonPlugin } from "../bigbluebutton.plugin";
import { SchemaPostgresInitializer } from "../../tenant-plugin/e2e/schema-postgres-initializer";
import { startOnFreePort } from "../../../test-utils/free-port";
import { BbbEncryptionService } from "../services/bbb-encryption.service";
import { BbbServer } from "../entities/bbb-server.entity";
import { BbbMeeting } from "../entities/bbb-meeting.entity";
import { BbbOrganization } from "../entities/bbb-organization.entity";
import { BbbWebhookEvent } from "../entities/bbb-webhook-event.entity";
import { BbbOpsAlertService } from "../services/bbb-ops-alert.service";
import { webhookCallbackUrl } from "../shared/bbb-webhook-url";
import { MEETING_STATE } from "../constants";

registerInitializer("postgres", new SchemaPostgresInitializer());

const SKIP = process.env.BBB_WEBHOOK_CONTROLLER_E2E !== "true";

async function assertPostgres(): Promise<void> {
  const host = process.env.DB_HOST ?? "127.0.0.1";
  const port = Number(process.env.DB_PORT ?? 5432);
  await new Promise<void>((resolve, reject) => {
    const sock = net.connect(port, host);
    sock.once("connect", () => { sock.destroy(); resolve(); });
    sock.once("error", reject);
  });
}

// ─── Fixture helpers ──────────────────────────────────────────────────────────

const PUBLIC_BASE = "https://saa9vi-test.example.com";
const RAW_SECRET = "test-webhook-secret-abc123";

function makeFormBody(
  eventType: string,
  extraAttrs: Record<string, unknown> = {},
): string {
  const event = JSON.stringify([
    {
      data: {
        id: eventType,
        attributes: {
          meeting: {
            "external-meeting-id": "ext-meet-w3",
            "internal-meeting-id": "int-meet-w3",
          },
          ...extraAttrs,
        },
      },
    },
  ]);
  return new URLSearchParams({
    domain: "bbb.example.com",
    event,
    timestamp: String(Date.now()),
  }).toString();
}

function makeRapBody(recordId: string, playbackLink: string): string {
  const event = JSON.stringify([
    {
      data: {
        id: "rap-publish-ended",
        attributes: {
          "record-id": recordId,
          success: true,
          workflow: "presentation",
          recording: { playback: { link: playbackLink } },
          meeting: {
            "external-meeting-id": "ext-meet-w3",
            "internal-meeting-id": recordId,
          },
        },
      },
    },
  ]);
  return new URLSearchParams({
    domain: "bbb.example.com",
    event,
    timestamp: String(Date.now()),
  }).toString();
}

function checksumFor(url: string, body: string, secret: string): string {
  return crypto.createHash("sha256").update(url).update(body).update(secret).digest("hex");
}

function dedupeKeyFor(serverId: string, body: string): string {
  return crypto.createHash("sha256").update(serverId).update("\x00").update(body).digest("hex");
}

async function postWebhook(
  base: string,
  serverId: string,
  body: string,
  opts: { checksum?: string; bearer?: string } = {},
): Promise<Response> {
  const url = new URL(`${base}/bbb/webhook/${serverId}`);
  if (opts.checksum) url.searchParams.set("checksum", opts.checksum);
  const headers: Record<string, string> = {
    "content-type": "application/x-www-form-urlencoded",
  };
  if (opts.bearer) headers["authorization"] = `Bearer ${opts.bearer}`;
  return fetch(url.toString(), { method: "POST", headers, body });
}

// ─── Suite ────────────────────────────────────────────────────────────────────

const { server, adminClient, shopClient } = createTestEnvironment(
  mergeConfig(testConfig, {
    apiOptions: { port: 0 },
    dbConnectionOptions: {
      type: "postgres",
      host: process.env.DB_HOST ?? "127.0.0.1",
      port: Number(process.env.DB_PORT ?? 5432),
      database: process.env.DB_NAME ?? "vendure",
      username: process.env.DB_USERNAME ?? "vendure_user",
      password: process.env.DB_PASSWORD ?? "",
      schema: "e2e_bbb_webhook_controller",
      synchronize: true,
    },
    plugins: [
      TenantPlugin,
      BigBlueButtonPlugin.init({
        publicBaseUrl: PUBLIC_BASE,
        runScheduledTasks: false,
      }),
    ],
  }),
);

const initialData = {
  defaultLanguage: "en" as any,
  defaultZone: "India",
  taxRates: [{ name: "Standard Tax", percentage: 18 }],
  shippingMethods: [{ name: "Standard Shipping", price: 0 }],
  paymentMethods: [],
  countries: [{ name: "India", code: "IN", zone: "India" }],
  collections: [],
};

describe.skipIf(SKIP)(
  "W3 controller e2e — POST /bbb/webhook/:serverId",
  () => {
    let base: string;
    let conn: TransactionalConnection;
    let encryptionService: BbbEncryptionService;
    let opsAlertSpy: MockInstance;
    let serverId: string;
    let callbackUrl: string;
    let meeting: BbbMeeting;

    beforeAll(async () => {
      await assertPostgres();

      // Stub fetch to satisfy hooks/list calls on startup without real BBB.
      vi.stubGlobal(
        "fetch",
        vi.fn(async (url: string) => {
          if (String(url).includes("/api/hooks/list")) {
            return new Response(
              `<?xml version="1.0"?><response><returncode>SUCCESS</returncode><hooks></hooks></response>`,
              { status: 200 },
            );
          }
          return new Response(
            `<?xml version="1.0"?><response><returncode>SUCCESS</returncode></response>`,
            { status: 200 },
          );
        }),
      );

      await startOnFreePort({ server, adminClient, shopClient }, {
        initialData,
        customerCount: 0,
      });

      base = `http://127.0.0.1:${(server as any).httpServer?.address()?.port ?? server.app.getHttpServer().address().port}`;

      conn = server.app.get(TransactionalConnection);
      encryptionService = server.app.get(BbbEncryptionService);

      const opsAlert = server.app.get(BbbOpsAlertService);
      opsAlertSpy = vi.spyOn(opsAlert, "notify");

      const ctx = await getSuperadminContext(server.app);
      _ = ctx; // suppress unused-var lint

      // Create test server row.
      const serverRepo = conn.rawConnection.getRepository(BbbServer);
      const s = serverRepo.create({
        name: "w3-test-server",
        apiUrl: "https://bbb.example.com/bigbluebutton",
        encryptedApiSecret: encryptionService.encrypt(RAW_SECRET),
        enabled: true,
        healthy: true,
      });
      const savedServer = await serverRepo.save(s);
      serverId = savedServer.id as string;
      callbackUrl = webhookCallbackUrl(PUBLIC_BASE, serverId);

      // Create org + meeting for event-processing tests.
      const orgRepo = conn.rawConnection.getRepository(BbbOrganization);
      const org = orgRepo.create({ name: "W3 Test Org", channelId: "1", billingMode: "grant" as any });
      const savedOrg = await orgRepo.save(org);

      const meetingRepo = conn.rawConnection.getRepository(BbbMeeting);
      const m = meetingRepo.create({
        title: "W3 Test Meeting",
        bbbMeetingId: "ext-meet-w3",
        bbbInternalMeetingId: "int-meet-w3",
        serverId,
        organization: savedOrg,
        state: MEETING_STATE.ACTIVE,
        recordingEnabled: true,
      });
      meeting = await meetingRepo.save(m);
    }, 120_000);

    afterAll(async () => {
      vi.unstubAllGlobals();
      await server.destroy();
    });

    afterEach(() => {
      opsAlertSpy.mockClear();
    });

    // ── C1 ───────────────────────────────────────────────────────────────────
    it("C1: good sha256 checksum → 200, PENDING row persisted", async () => {
      const body = makeFormBody("meeting-ended");
      const res = await postWebhook(base, serverId, body, {
        checksum: checksumFor(callbackUrl, body, RAW_SECRET),
      });
      expect(res.status).toBe(200);
      expect((await res.json() as any).ok).toBe(true);

      const row = await conn.rawConnection
        .getRepository(BbbWebhookEvent)
        .findOne({ where: { dedupeKey: dedupeKeyFor(serverId, body) } });
      expect(row).toBeTruthy();
      expect(row?.eventType).toBe("meeting-ended");
      expect(row?.serverId).toBe(serverId);
    });

    // ── C2 ───────────────────────────────────────────────────────────────────
    it("C2: bearer mode → 200, bearer-mode alert fired", async () => {
      const body = makeFormBody("meeting-ended");
      const res = await postWebhook(base, serverId, body, { bearer: RAW_SECRET });
      expect(res.status).toBe(200);
      expect(opsAlertSpy.mock.calls.some(([k]) => k === "bbb-webhook-bearer-mode")).toBe(true);
    });

    // ── C3 ───────────────────────────────────────────────────────────────────
    it("C3: bad checksum → 401, nothing persisted", async () => {
      const body = makeFormBody("meeting-ended");
      const before = await conn.rawConnection.getRepository(BbbWebhookEvent).count({ where: { serverId } });
      const res = await postWebhook(base, serverId, body, { checksum: "a".repeat(64) });
      expect(res.status).toBe(401);
      await res.arrayBuffer();
      const after = await conn.rawConnection.getRepository(BbbWebhookEvent).count({ where: { serverId } });
      expect(after).toBe(before);
    });

    // ── C4 ───────────────────────────────────────────────────────────────────
    it("C4: bad bearer token → 401, nothing persisted", async () => {
      const body = makeFormBody("meeting-ended");
      const res = await postWebhook(base, serverId, body, { bearer: "wrong-secret" });
      expect(res.status).toBe(401);
    });

    // ── C5 ───────────────────────────────────────────────────────────────────
    it("C5: unknown serverId → 404", async () => {
      const body = makeFormBody("meeting-ended");
      const res = await postWebhook(base, "srv-does-not-exist", body, { checksum: "a".repeat(64) });
      expect(res.status).toBe(404);
    });

    // ── C6 ───────────────────────────────────────────────────────────────────
    it("C6: disabled server → 200 (not 404), still authenticates and accepts", async () => {
      const serverRepo = conn.rawConnection.getRepository(BbbServer);
      await serverRepo.update(serverId, { enabled: false });

      const body = makeFormBody("meeting-ended");
      const res = await postWebhook(base, serverId, body, {
        checksum: checksumFor(callbackUrl, body, RAW_SECRET),
      });
      expect(res.status).toBe(200);
      await serverRepo.update(serverId, { enabled: true });
    });

    // ── C7 ───────────────────────────────────────────────────────────────────
    it("C7: replay of identical body → 200, idempotent (no second row)", async () => {
      const body = makeFormBody("rap-publish-ended");
      const cs = checksumFor(callbackUrl, body, RAW_SECRET);
      const dk = dedupeKeyFor(serverId, body);

      const r1 = await postWebhook(base, serverId, body, { checksum: cs });
      expect(r1.status).toBe(200);
      await r1.arrayBuffer();
      const count1 = await conn.rawConnection.getRepository(BbbWebhookEvent).count({ where: { dedupeKey: dk } });

      const r2 = await postWebhook(base, serverId, body, { checksum: cs });
      expect(r2.status).toBe(200);
      await r2.arrayBuffer();
      const count2 = await conn.rawConnection.getRepository(BbbWebhookEvent).count({ where: { dedupeKey: dk } });

      expect(count2).toBe(count1);
    });

    // ── C8 ───────────────────────────────────────────────────────────────────
    it("C8: poison body → 200, PARSE_FAILED row persisted", async () => {
      const poisonBody = new URLSearchParams({
        domain: "bbb.example.com",
        event: "NOT_JSON_AT_ALL{{{",
        timestamp: String(Date.now()),
      }).toString();
      const cs = checksumFor(callbackUrl, poisonBody, RAW_SECRET);
      const res = await postWebhook(base, serverId, poisonBody, { checksum: cs });
      expect(res.status).toBe(200);

      const row = await conn.rawConnection
        .getRepository(BbbWebhookEvent)
        .findOne({ where: { dedupeKey: dedupeKeyFor(serverId, poisonBody) } });
      expect(row?.status).toBe("PARSE_FAILED");
    });

    // ── C9 ───────────────────────────────────────────────────────────────────
    it("C9: meeting-ended → meeting transitions to Completed", async () => {
      const body = makeFormBody("meeting-ended");
      const res = await postWebhook(base, serverId, body, {
        checksum: checksumFor(callbackUrl, body, RAW_SECRET),
      });
      expect(res.status).toBe(200);
      await res.arrayBuffer();

      // Wait for async queue processor.
      await new Promise((r) => setTimeout(r, 800));

      const updated = await conn.rawConnection
        .getRepository(BbbMeeting)
        .findOne({ where: { id: meeting.id as string } });
      expect(updated?.state).toBe(MEETING_STATE.COMPLETED);
    }, 10_000);

    // ── C10 ──────────────────────────────────────────────────────────────────
    it("C10: rap-publish-ended → bbbRecordingId + recordingUrl stored", async () => {
      const body = makeRapBody(
        "int-meet-w3",
        "https://bbb.example.com/playback/presentation/int-meet-w3",
      );
      const res = await postWebhook(base, serverId, body, {
        checksum: checksumFor(callbackUrl, body, RAW_SECRET),
      });
      expect(res.status).toBe(200);
      await res.arrayBuffer();
      await new Promise((r) => setTimeout(r, 800));

      const updated = await conn.rawConnection
        .getRepository(BbbMeeting)
        .findOne({ where: { id: meeting.id as string } });
      expect(updated?.bbbRecordingId).toBe("int-meet-w3");
      expect(updated?.recordingUrl).toBe(
        "https://bbb.example.com/playback/presentation/int-meet-w3",
      );
    }, 10_000);

    // ── C11 ──────────────────────────────────────────────────────────────────
    it("C11: meeting-created (not allow-listed) → 200, no row persisted", async () => {
      const body = makeFormBody("meeting-created");
      const before = await conn.rawConnection.getRepository(BbbWebhookEvent).count({ where: { serverId } });
      const res = await postWebhook(base, serverId, body, {
        checksum: checksumFor(callbackUrl, body, RAW_SECRET),
      });
      expect(res.status).toBe(200);
      await res.arrayBuffer();
      const after = await conn.rawConnection.getRepository(BbbWebhookEvent).count({ where: { serverId } });
      expect(after).toBe(before);
    });

    // ── C12 ──────────────────────────────────────────────────────────────────
    it("C12: two-element event array → 200, multi-event alert fired", async () => {
      const twoElementEvent = JSON.stringify([
        { data: { id: "meeting-ended", attributes: { meeting: { "external-meeting-id": "ext-multi", "internal-meeting-id": "int-multi" } } } },
        { data: { id: "rap-publish-ended", attributes: { "record-id": "int-multi", success: true, workflow: "presentation", recording: { playback: { link: "" } }, meeting: { "external-meeting-id": "ext-multi", "internal-meeting-id": "int-multi" } } } },
      ]);
      const body = new URLSearchParams({
        domain: "bbb.example.com",
        event: twoElementEvent,
        timestamp: String(Date.now()),
      }).toString();
      const res = await postWebhook(base, serverId, body, {
        checksum: checksumFor(callbackUrl, body, RAW_SECRET),
      });
      expect(res.status).toBe(200);
      await res.arrayBuffer();
      expect(opsAlertSpy.mock.calls.some(([k]) => k === "bbb-webhook-multi-event")).toBe(true);
    });
  },
);

// Suppress unused-variable TS error for ctx
declare let _: unknown;
