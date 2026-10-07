/**
 * W8 recording repair — REAL BbbReconciliationService + REAL BbbApiService
 * over fake repositories and a faked global fetch (the bbb-error-loops
 * pattern), so the full path — candidate query → server side-load with its
 * secret → decrypt → checksum → typed error → backfill/skip/alert — runs
 * for real without a database.
 *
 * Covered:
 *  (1) happy path: completed + recordingEnabled + recordingUrl NULL →
 *      getRecordings' playback URL backfills bbbRecordingId + recordingUrl;
 *      no health change, no ops alert.
 *  (2) processing recording (no playback): links recordID only —
 *      recordingUrl stays NULL (row remains a candidate next pass), not
 *      counted as repaired.
 *  (3) recording row for a different meetingID → no update.
 *  (4) BbbNotFoundError → silent skip: no update, no alert, no health flag.
 *  (5) HTTP 502 → BbbUnavailableError → retry next pass + deduplicated
 *      `bbb-recording-repair` ops alert, server NOT flagged unhealthy.
 *  (6) server without encryptedApiSecret → BbbMisconfiguredError →
 *      flagServerConfigProblem: markHealthy(false) + `bbb-server-config`
 *      alert, no update, request never leaves the process.
 *  (7) checksum rejection → BbbRejectedError → same server-level flagging.
 *  (8) candidate query shape: state/recordingEnabled/recordingUrl NULL/
 *      completedAt window filters + oldest-first order + batch limit —
 *      the bounded-pass guarantee.
 *  (9) candidate load failure → `bbb-recording-repair` "pass" alert + the
 *      error propagates (the task records the failed pass).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BbbApiService } from "../services/bbb-api.service";
import { BbbReconciliationService } from "../services/bbb-reconciliation.service";
import { BbbOpsAlertService } from "../services/bbb-ops-alert.service";
import { MEETING_STATE } from "../constants";
import type { BbbServer } from "../entities/bbb-server.entity";

const SECRET = "super-secret-xyz";
const HOST = "https://bbb.example.com/bigbluebutton";
const CTX = { apiType: "admin" } as never;
const PLAYBACK = "https://bbb.example.com/playback/p/1";

/** Real adapter; only the encryption service and `fetch` are faked. */
function realApi(): BbbApiService {
  return new BbbApiService({
    decrypt: (enc: string) => {
      if (enc !== "enc") throw new Error("bad ciphertext");
      return SECRET;
    },
  } as never);
}

/** Server loaded via findByIdWithSecret (has the ciphertext). */
const SERVER_OK = {
  id: "s-ok",
  name: "bbb-ok",
  apiUrl: HOST,
  encryptedApiSecret: "enc",
} as unknown as BbbServer;

/** Server loaded via findById (select:false → secret undefined). */
const SERVER_NO_SECRET = {
  id: "s-mis",
  name: "bbb-mis",
  apiUrl: HOST,
} as unknown as BbbServer;

function completedMeeting(id: string, serverId = "s-ok"): any {
  return {
    id,
    bbbMeetingId: `bbb-${id}`,
    serverId,
    state: MEETING_STATE.COMPLETED,
    recordingEnabled: true,
    recordingUrl: null,
    bbbRecordingId: null,
    completedAt: new Date(Date.now() - 60 * 60_000),
  };
}

function recordingsXml(opts: {
  meetingID?: string;
  recordID?: string;
  url?: string;
}): string {
  const rec = opts.recordID
    ? `<recording><recordID>${opts.recordID}</recordID><meetingID>${
        opts.meetingID ?? ""
      }</meetingID><name>n</name><published>${
        opts.url ? "true" : "false"
      }</published><state>${
        opts.url ? "published" : "processing"
      }</state><startTime>0</startTime><endTime>0</endTime><participants>0</participants>${
        opts.url
          ? `<playback><format><type>video</type><url>${opts.url}</url></format></playback>`
          : ""
      }</recording>`
    : "";
  const body = opts.recordID ? `<recordings>${rec}</recordings>` : "";
  return `<?xml version="1.0"?><response><returncode>SUCCESS</returncode>${body}</response>`;
}

const NOTFOUND_XML = `<?xml version="1.0"?><response><returncode>FAILED</returncode><messageKey>notFound</messageKey><message>no recording found</message></response>`;
const CHECKSUM_XML = `<?xml version="1.0"?><response><returncode>FAILED</returncode><messageKey>checksumError</messageKey><message>You did not pass the checksum security check</message></response>`;

function resp(body: string, status = 200): Response {
  return new Response(body, { status });
}
/** Fluent TypeORM QB stub: chainable, records clauses/order/limit. */
function fakeQb(opts: {
  getMany?: () => Promise<any[]>;
  getOne?: () => Promise<any>;
}): any {
  const clauses: string[] = [];
  const q: any = {
    clauses,
    leftJoinAndSelect: () => q,
    where: (c: string) => {
      clauses.push(c);
      return q;
    },
    andWhere: (c: string) => {
      clauses.push(c);
      return q;
    },
    addSelect: () => q,
    orderBy: (c: string, dir?: string) => {
      q.orderByArg = `${c}:${dir ?? "ASC"}`;
      return q;
    },
    limit: (n: number) => {
      q.limitArg = n;
      return q;
    },
    getMany: opts.getMany ?? (async () => []),
    getOne: opts.getOne ?? (async () => null),
  };
  return q;
}

/** Real reconciliation + real adapter over fake repos/fetch. */
function buildRepair(opts: {
  meetings?: any[];
  servers?: Record<string, any>;
  getMany?: () => Promise<any[]>;
}) {
  const updates: Array<{ id: string; data: any }> = [];
  const qb = fakeQb({
    getMany: opts.getMany ?? (async () => opts.meetings ?? []),
  });
  const connection = {
    getRepository: () => ({
      createQueryBuilder: () => qb,
      update: async (id: string, data: any) => {
        updates.push({ id, data });
      },
      findOne: async () => null,
    }),
    rawConnection: { options: {}, query: async () => [] },
  };
  const servers = opts.servers ?? { "s-ok": SERVER_OK };
  const serverService = {
    findByIdWithSecret: vi.fn(
      async (_c: any, id: string) => servers[id] ?? null,
    ),
    markHealthy: vi.fn(async (..._args: any[]) => {}),
  };
  const opsAlert = new BbbOpsAlertService();
  const notifySpy = vi.spyOn(opsAlert, "notify");
  const svc = new BbbReconciliationService(
    connection as never,
    { create: async () => CTX } as never,
    serverService as never,
    realApi(),
    {} as never, // lifecycleService (unused on this path)
    {} as never, // meteringService (unused on this path)
    { publish: vi.fn() } as never,
    {} as never, // grantConsumption (unused on this path)
    { decrypt: () => SECRET } as never, // BbbEncryptionService (unused on this path)
    opsAlert as never,
    {} as never, // metrics (unused on this path)
    {} as never, // plugin options (defaults apply)
  );
  return { svc, updates, serverService, notifySpy, qb };
}

describe("W8 recording repair (real service + real adapter, faked fetch)", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("(1) backfills recordingUrl + bbbRecordingId from the playback URL", async () => {
    vi.mocked(fetch).mockResolvedValue(
      resp(
        recordingsXml({ meetingID: "bbb-m1", recordID: "rec-1", url: PLAYBACK }),
      ),
    );
    const { svc, updates, serverService, notifySpy } = buildRepair({
      meetings: [completedMeeting("m1")],
    });

    expect(await svc.repairRecordings()).toBe(1);
    expect(updates).toEqual([
      { id: "m1", data: { bbbRecordingId: "rec-1", recordingUrl: PLAYBACK } },
    ]);
    expect(serverService.markHealthy).not.toHaveBeenCalled();
    expect(notifySpy).not.toHaveBeenCalled();
    // Server side-loaded WITH its secret (select:false rule).
    expect(serverService.findByIdWithSecret).toHaveBeenCalledWith(
      expect.objectContaining({ apiType: "admin" }),
      "s-ok",
    );
  });

  it("(2) processing recording: links recordID only, not counted repaired", async () => {
    vi.mocked(fetch).mockResolvedValue(
      resp(recordingsXml({ meetingID: "bbb-m1", recordID: "rec-9" })),
    );
    const { svc, updates } = buildRepair({
      meetings: [completedMeeting("m1")],
    });

    expect(await svc.repairRecordings()).toBe(0);
    expect(updates).toEqual([{ id: "m1", data: { bbbRecordingId: "rec-9" } }]);
    // recordingUrl untouched → the row stays a candidate until playback exists.
    expect(updates[0].data.recordingUrl).toBeUndefined();
  });

  it("(3) ignores a recording row belonging to another meeting", async () => {
    vi.mocked(fetch).mockResolvedValue(
      resp(
        recordingsXml({
          meetingID: "bbb-someone-else",
          recordID: "rec-x",
          url: PLAYBACK,
        }),
      ),
    );
    const { svc, updates, notifySpy } = buildRepair({
      meetings: [completedMeeting("m1")],
    });

    expect(await svc.repairRecordings()).toBe(0);
    expect(updates).toEqual([]);
    expect(notifySpy).not.toHaveBeenCalled();
  });

  it("(4) notFound → silent skip: no update, no alert, no health flag", async () => {
    vi.mocked(fetch).mockResolvedValue(resp(NOTFOUND_XML));
    const { svc, updates, serverService, notifySpy } = buildRepair({
      meetings: [completedMeeting("m1")],
    });

    expect(await svc.repairRecordings()).toBe(0);
    expect(updates).toEqual([]);
    expect(notifySpy).not.toHaveBeenCalled();
    expect(serverService.markHealthy).not.toHaveBeenCalled();
  });

  it("(5) HTTP 502 → transient retry + repair alert, health untouched", async () => {
    vi.mocked(fetch).mockResolvedValue(resp("bad gateway", 502));
    const { svc, updates, serverService, notifySpy } = buildRepair({
      meetings: [completedMeeting("m1")],
    });

    expect(await svc.repairRecordings()).toBe(0);
    expect(updates).toEqual([]);
    // De-duplicated ops alert (kind, `server-*` key) so an outage fires once.
    expect(notifySpy).toHaveBeenCalledWith(
      "bbb-recording-repair",
      "server-s-ok",
      expect.stringContaining("unavailable"),
      expect.objectContaining({ serverId: "s-ok", meetingId: "m1" }),
    );
    // Transient outage must NOT mark the server unhealthy.
    expect(serverService.markHealthy).not.toHaveBeenCalled();
  });

  it("(6) server without secret → misconfigured: flag + config alert", async () => {
    const { svc, updates, serverService, notifySpy } = buildRepair({
      meetings: [completedMeeting("m1", "s-mis")],
      servers: { "s-mis": SERVER_NO_SECRET },
    });

    expect(await svc.repairRecordings()).toBe(0);
    expect(updates).toEqual([]);
    expect(serverService.markHealthy).toHaveBeenCalledWith(
      expect.objectContaining({ apiType: "admin" }),
      "s-mis",
      false,
    );
    expect(notifySpy).toHaveBeenCalledWith(
      "bbb-server-config",
      "server-s-mis",
      expect.stringContaining("misconfigured"),
      expect.objectContaining({ serverId: "s-mis" }),
    );
    // The request must never have left the process.
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });

  it("(7) checksum rejection → BbbRejectedError → server-level flagging", async () => {
    vi.mocked(fetch).mockResolvedValue(resp(CHECKSUM_XML));
    const { svc, updates, serverService, notifySpy } = buildRepair({
      meetings: [completedMeeting("m1")],
    });

    expect(await svc.repairRecordings()).toBe(0);
    expect(updates).toEqual([]);
    expect(serverService.markHealthy).toHaveBeenCalledWith(
      expect.objectContaining({ apiType: "admin" }),
      "s-ok",
      false,
    );
    expect(notifySpy).toHaveBeenCalledWith(
      "bbb-server-config",
      "server-s-ok",
      expect.stringContaining("misconfigured"),
      expect.objectContaining({ serverId: "s-ok" }),
    );
  });

  it("(8) candidate query is bounded: filters, oldest-first, batch limit", async () => {
    const { svc, qb } = buildRepair({ meetings: [] });
    await svc.repairRecordings();

    const sql = qb.clauses.join(" AND ");
    expect(sql).toContain("meeting.state = :state");
    expect(sql).toContain("meeting.recordingEnabled = true");
    expect(sql).toContain("meeting.recordingUrl IS NULL");
    expect(sql).toContain("meeting.bbbMeetingId IS NOT NULL");
    expect(sql).toContain("meeting.serverId IS NOT NULL");
    expect(sql).toContain("meeting.completedAt >= :cutoff");
    expect(qb.orderByArg).toBe("meeting.completedAt:ASC");
    // Hard batch cap — a pass can never become an unbounded scan.
    expect(qb.limitArg).toBe(20);
  });

  it("(9) candidate load failure alerts once and propagates", async () => {
    const { svc, notifySpy } = buildRepair({
      getMany: async () => {
        throw new Error("db down");
      },
    });

    await expect(svc.repairRecordings()).rejects.toThrow("db down");
    expect(notifySpy).toHaveBeenCalledTimes(1);
    expect(notifySpy).toHaveBeenCalledWith(
      "bbb-recording-repair",
      "pass",
      expect.stringContaining("db down"),
    );
  });
});