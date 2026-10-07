/**
 * Report-only orphan scan — REAL BbbReconciliationService + REAL
 * BbbApiService over fake repositories and a faked global fetch (the
 * bbb-error-loops pattern), so the full path — enabled-server census →
 * getMeetings → local IN-query match → report — runs for real without a
 * database.
 *
 * The central invariant: REPORT-ONLY. An unknown remote meeting is surfaced
 * (Logger.warn + de-duplicated `bbb-orphan-meeting` ops alert) and NEVER
 * ended — `endMeeting` is never invoked and no meeting/room state is ever
 * written (the meeting FSM owns termination).
 *
 * Covered:
 *  (1) mixed census: known meeting (bbbMeetingId match) + unknown → 1 orphan
 *      reported, alert carries serverId/meetingID.
 *  (2) derivation match: remote `bbb-<uuid>` ↔ local row id (bbbMeetingId
 *      null) → not an orphan.
 *  (3) single <meeting> object (xml2js non-array) parses and reports.
 *  (4) empty census → 0; the local match query is never executed.
 *  (5) HTTP 502 → `bbb-orphan-scan` alert, server health untouched.
 *  (6) server row without encryptedApiSecret → BbbMisconfiguredError →
 *      flagServerConfigProblem (markHealthy(false) + `bbb-server-config`).
 *  (7) NEVER-ENDS: after reporting orphans, fetch was called exactly once
 *      with /api/getMeetings and endMeeting was never invoked.
 *  (8) adapter: passwords present in the raw XML are dropped at parse time
 *      (BbbRemoteMeeting carries meetingID/running/counts only — W2).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BbbApiService } from "../services/bbb-api.service";
import { BbbReconciliationService } from "../services/bbb-reconciliation.service";
import { BbbOpsAlertService } from "../services/bbb-ops-alert.service";
import { BbbServer } from "../entities/bbb-server.entity";

const SECRET = "super-secret-xyz";
const HOST = "https://bbb.example.com/bigbluebutton";
const CTX = { apiType: "admin" } as never;

/** Real adapter; only the encryption service and `fetch` are faked. */
function realApi(): BbbApiService {
  return new BbbApiService({
    decrypt: (enc: string) => {
      if (enc !== "enc") throw new Error("bad ciphertext");
      return SECRET;
    },
  } as never);
}

/** Server row WITH the secret (as the enabled-servers query returns it). */
const SERVER_OK = {
  id: "s-ok",
  name: "bbb-ok",
  apiUrl: HOST,
  encryptedApiSecret: "enc",
  enabled: true,
} as unknown as BbbServer;

/** Server row missing encryptedApiSecret (select:false violated upstream). */
const SERVER_NO_SECRET = {
  id: "s-mis",
  name: "bbb-mis",
  apiUrl: HOST,
  enabled: true,
} as unknown as BbbServer;

function meetingXml(
  id: string,
  opts: { running?: string; participants?: number } = {},
): string {
  return `<meeting><meetingID>${id}</meetingID><internalMeetingID>int-${id}</internalMeetingID><name>live class</name><running>${
    opts.running ?? "true"
  }</running><participantCount>${
    opts.participants ?? 0
  }</participantCount><moderatorCount>1</moderatorCount><hasBeenForciblyEnded>false</hasBeenForciblyEnded><attendeePW>ap-secret</attendeePW><moderatorPW>mp-secret</moderatorPW></meeting>`;
}

function censusXml(inner: string): string {
  return `<?xml version="1.0"?><response><returncode>SUCCESS</returncode><meetings>${inner}</meetings></response>`;
}

function resp(body: string, status = 200): Response {
  return new Response(body, { status });
}

/**
 * Fluent TypeORM QB stub: chainable, records clauses/params and whether
 * `getMany` was ever reached (used to prove the empty-census short-circuit).
 */
function fakeQb(opts: { getMany?: () => Promise<any[]> }): any {
  const clauses: string[] = [];
  const params: any[] = [];
  const q: any = {
    clauses,
    params,
    select: (c: string) => {
      clauses.push(c);
      return q;
    },
    addSelect: (c: string) => {
      clauses.push(c);
      return q;
    },
    where: (c: string, p?: unknown) => {
      clauses.push(c);
      params.push(p);
      return q;
    },
    andWhere: (c: string, p?: unknown) => {
      clauses.push(c);
      params.push(p);
      return q;
    },
    orWhere: (c: string, p?: unknown) => {
      clauses.push(c);
      params.push(p);
      return q;
    },
    orderBy: () => q,
    limit: () => q,
    getMany:
      opts.getMany ??
      (async () => {
        q.getManyCalls = (q.getManyCalls ?? 0) + 1;
        return [];
      }),
  };
  return q;
}

/** Real reconciliation + real adapter over fake repos/fetch. */
function buildScan(opts: {
  serverRows?: any[];
  knownRows?: any[];
  knownGetMany?: () => Promise<any[]>;
}) {
  const api = realApi();
  const serverQb = fakeQb({
    getMany: async () => opts.serverRows ?? [SERVER_OK],
  });
  const knownGetMany =
    opts.knownGetMany ?? (async () => opts.knownRows ?? []);
  const meetingQb = fakeQb({ getMany: knownGetMany });
  const connection = {
    getRepository: (_ctx: unknown, entity: unknown) =>
      entity === BbbServer
        ? { createQueryBuilder: () => serverQb }
        : { createQueryBuilder: () => meetingQb },
    rawConnection: { options: {}, query: async () => [] },
  };
  const serverService = {
    findByIdWithSecret: vi.fn(async () => SERVER_OK),
    markHealthy: vi.fn(async (..._args: any[]) => {}),
  };
  const opsAlert = new BbbOpsAlertService();
  const notifySpy = vi.spyOn(opsAlert, "notify");
  const svc = new BbbReconciliationService(
    connection as never,
    { create: async () => CTX } as never,
    serverService as never,
    api,
    {} as never, // lifecycleService (unused on this path)
    {} as never, // meteringService (unused on this path)
    { publish: vi.fn() } as never,
    {} as never, // grantConsumption (unused on this path)
    { decrypt: () => SECRET } as never, // BbbEncryptionService (unused on this path)
    opsAlert as never,
    {} as never, // metrics (unused on this path)
    {} as never, // plugin options (defaults apply)
  );
  const endSpy = vi.spyOn(api, "endMeeting");
  return { svc, api, endSpy, notifySpy, serverService, serverQb, meetingQb };
}

describe("Report-only orphan scan (real service + real adapter, faked fetch)", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("(1) mixed census: known meeting passes, unknown is reported once", async () => {
    vi.mocked(fetch).mockResolvedValue(
      resp(
        censusXml(
          meetingXml("bbb-u1") + meetingXml("mystery-9", { participants: 4 }),
        ),
      ),
    );
    const { svc, notifySpy } = buildScan({
      knownRows: [{ id: "u1", bbbMeetingId: "bbb-u1" }],
    });

    expect(await svc.scanOrphanMeetings()).toBe(1);
    expect(notifySpy).toHaveBeenCalledTimes(1);
    expect(notifySpy).toHaveBeenCalledWith(
      "bbb-orphan-meeting",
      "s-ok:mystery-9",
      expect.stringContaining("mystery-9"),
      expect.objectContaining({
        serverId: "s-ok",
        meetingID: "mystery-9",
        running: true,
        participantCount: 4,
      }),
    );
  });

  it("(2) derivation match: remote bbb-<uuid> ↔ local row id is known", async () => {
    vi.mocked(fetch).mockResolvedValue(
      resp(censusXml(meetingXml("bbb-u2"))),
    );
    const { svc, notifySpy } = buildScan({
      knownRows: [{ id: "u2", bbbMeetingId: null }],
    });

    expect(await svc.scanOrphanMeetings()).toBe(0);
    expect(notifySpy).not.toHaveBeenCalled();
  });

  it("(3) single <meeting> object (xml2js non-array) parses and reports", async () => {
    vi.mocked(fetch).mockResolvedValue(
      resp(censusXml(meetingXml("lone-external"))),
    );
    const { svc, notifySpy } = buildScan({ knownRows: [] });

    expect(await svc.scanOrphanMeetings()).toBe(1);
    expect(notifySpy).toHaveBeenCalledWith(
      "bbb-orphan-meeting",
      "s-ok:lone-external",
      expect.stringContaining("lone-external"),
      expect.anything(),
    );
  });

  it("(4) empty census → 0 and the local match query never runs", async () => {
    vi.mocked(fetch).mockResolvedValue(resp(censusXml("")));
    const knownGetMany = vi.fn(async () => []);
    const { svc, notifySpy, meetingQb } = buildScan({ knownGetMany });

    expect(await svc.scanOrphanMeetings()).toBe(0);
    expect(notifySpy).not.toHaveBeenCalled();
    expect(knownGetMany).not.toHaveBeenCalled();
    expect(meetingQb.clauses).toEqual([]); // no query was even built
  });

  it("(5) HTTP 502 → scan alert, server health untouched", async () => {
    vi.mocked(fetch).mockResolvedValue(resp("bad gateway", 502));
    const { svc, notifySpy, serverService } = buildScan({});

    expect(await svc.scanOrphanMeetings()).toBe(0);
    expect(notifySpy).toHaveBeenCalledWith(
      "bbb-orphan-scan",
      "server-s-ok",
      expect.stringContaining("unavailable"),
      expect.objectContaining({ serverId: "s-ok" }),
    );
    // Transient outage must NOT mark the server unhealthy.
    expect(serverService.markHealthy).not.toHaveBeenCalled();
  });

  it("(6) server row without secret → misconfigured: flag + config alert", async () => {
    const { svc, notifySpy, serverService } = buildScan({
      serverRows: [SERVER_NO_SECRET],
    });

    expect(await svc.scanOrphanMeetings()).toBe(0);
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

  it("(7) NEVER ENDS: census runs once, endMeeting is never invoked", async () => {
    vi.mocked(fetch).mockResolvedValue(
      resp(
        censusXml(
          meetingXml("ghost-1") + meetingXml("ghost-2", { running: "false" }),
        ),
      ),
    );
    const { svc, endSpy } = buildScan({ knownRows: [] });

    expect(await svc.scanOrphanMeetings()).toBe(2);
    // Exactly one BBB call happened: getMeetings — never /api/end.
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
    const url = String(vi.mocked(fetch).mock.calls[0][0]);
    expect(url).toContain("/api/getMeetings");
    expect(url).not.toContain("/api/end");
    expect(endSpy).not.toHaveBeenCalled();
  });

  it("(8) adapter drops passwords from the raw census XML (W2)", async () => {
    vi.mocked(fetch).mockResolvedValue(
      resp(censusXml(meetingXml("bbb-pw", { participants: 3 }))),
    );
    const list = await realApi().getMeetings(SERVER_OK);

    expect(list).toHaveLength(1);
    expect(list[0]).toEqual({
      meetingID: "bbb-pw",
      internalMeetingID: "int-bbb-pw",
      name: "live class",
      running: true,
      participantCount: 3,
      moderatorCount: 1,
      hasBeenForciblyEnded: false,
    });
    expect(list[0]).not.toHaveProperty("attendeePW");
    expect(list[0]).not.toHaveProperty("moderatorPW");
    // The XML carried the passwords — they never reached the result.
    const raw = String(vi.mocked(fetch).mock.calls[0][0]);
    expect(raw).toContain("getMeetings");
  });
});