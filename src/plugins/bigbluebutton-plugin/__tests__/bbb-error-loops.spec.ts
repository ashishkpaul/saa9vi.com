/**
 * Gate-2 loop-level tests — REAL services + REAL BbbApiService + faked fetch.
 *
 * Why this file exists: the W1 unit spec (`bbb-api-errors.spec.ts`) proves
 * the ADAPTER throws typed errors, but the outage→stale bug lived in the
 * CALLERS. A stubbed `BbbApiService` (the bbb-metering/R4 e2e pattern) would
 * hide a caller that loads the server without its secret
 * (`findById` vs `findByIdWithSecret`) or that forgets to catch
 * `BbbMisconfiguredError`. These tests wire the real
 * BbbReconciliationService / BbbMeteringService / BbbRoomService with fake
 * repositories and a faked global `fetch`, so the full path — server load →
 * decrypt → checksum → typed error → skip/alert/gap — runs for real without
 * a database.
 *
 * Covered:
 *  (a) reconcile with one misconfigured server + one healthy server: the
 *      misconfigured meeting stays ACTIVE (+ unhealthy flag + ops alert),
 *      the healthy server's gone meeting still stales in the same pass.
 *  (b) metering tick: healthy sample inserts; outage + misconfigured become
 *      visible gaps (gapCount), config problem flags the server.
 *  (c) room runtime validation: outage/misconfigured → true (assume valid,
 *      caller must NOT complete); notFound → false (stale-active recovery).
 *  (d) join/end failures carry no URL or secret; signed join URL never
 *      contains the raw API secret.
 *  (e) metering tick: a meeting with no decryptable moderator password is
 *      skipped as a COUNTED GAP without flagging the server (the W5-8
 *      reconcile rule applied to the per-minute loop), and the authenticated
 *      call carries the side-loaded password.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  BbbApiService,
  BbbMisconfiguredError,
  BbbUnavailableError,
} from "../services/bbb-api.service";
import { BbbReconciliationService } from "../services/bbb-reconciliation.service";
import { BbbMeteringService } from "../services/bbb-metering.service";
import { BbbRoomService } from "../services/bbb-room.service";
import type { BbbServer } from "../entities/bbb-server.entity";

const SECRET = "super-secret-xyz";
const HOST = "https://bbb.example.com/bigbluebutton";

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

const NOTFOUND_XML = `<?xml version="1.0"?>
<response><returncode>FAILED</returncode><messageKey>notFound</messageKey>
<message>We could not find a meeting with that meeting ID</message></response>`;

const SUCCESS_INFO_XML = `<?xml version="1.0"?>
<response><returncode>SUCCESS</returncode><meetingID>m1</meetingID>
<internalMeetingID>i1</internalMeetingID><running>true</running>
<participantCount>5</participantCount><moderatorCount>2</moderatorCount>
<recording>false</recording><startTime>0</startTime><endTime>0</endTime></response>`;

function xmlResp(body: string): Response {
  return new Response(body, { status: 200 });
}

const CTX = { apiType: "admin" } as never;

/** Fluent TypeORM QB stub: chainable, resolves from fixtures. */
function fakeQb(opts: {
  getMany?: () => Promise<unknown[]>;
  /** Receives the params of the LAST `where(...)` call (side-load key). */
  getOne?: (whereParams?: { id?: unknown }) => Promise<unknown>;
}): any {
  const q: any = {
    leftJoinAndSelect: () => q,
    where: (_clause: string, params?: { id?: unknown }) => {
      q.whereParams = params;
      return q;
    },
    andWhere: () => q,
    addSelect: () => q,
    orderBy: () => q,
    getMany: opts.getMany ?? (async () => []),
    getOne: opts.getOne
      ? async () => opts.getOne!(q.whereParams)
      : async () => null,
  };
  return q;
}

function activeMeeting(id: string, serverId: string): any {
  const old = new Date(Date.now() - 10 * 60_000); // past the 90s grace period
  return {
    id,
    bbbMeetingId: `bbb-${id}`,
    serverId,
    provisionedAt: old,
    createdAt: old,
    reconciliationAttemptCount: 0,
    organization: null,
  };
}

/** Real reconciliation + real adapter over fake repos/fetch. */
function buildReconciliation(meetings: any[], servers: Record<string, any>) {
  const updates: Array<{ id: string; data: any }> = [];
  const connection = {
    getRepository: () => ({
      createQueryBuilder: () =>
        fakeQb({
          getMany: async () => meetings,
          // moderator-password side-load (reconciliation decrypts it)
          getOne: async () => ({ encryptedModeratorPassword: "enc-mpw" }),
        }),
      update: async (id: string, data: any) => {
        updates.push({ id, data });
      },
      findOne: async () => null,
    }),
    rawConnection: { options: {}, query: async () => [] },
  };
  const serverService = {
    findByIdWithSecret: vi.fn(async (_c: any, id: string) => servers[id]),
    markHealthy: vi.fn(async (..._args: any[]) => {}),
  };
  const lifecycle = {
    markMeetingStale: vi.fn(async (..._args: any[]) => {}),
    completeMeetingLifecycle: vi.fn(async (..._args: any[]) => {}),
  };
  const opsAlert = { notify: vi.fn() };
  const svc = new BbbReconciliationService(
    connection as never,
    { create: async () => CTX } as never,
    serverService as never,
    realApi(),
    lifecycle as never,
    {} as never, // meteringService (unused on this path)
    { publish: vi.fn() } as never,
    {} as never, // grantConsumption (unused on this path)
    { decrypt: () => "mod-pw" } as never, // BbbEncryptionService
    opsAlert as never,
    { recordReconcileRemoteGoneCompletion: vi.fn() } as never, // BbbMetricsService
    {} as never, // plugin options (defaults apply)
  );
  return { svc, updates, serverService, lifecycle, opsAlert };
}

/** Real metering + real adapter over fake repos/fetch. */
function buildMetering(
  meetings: any[],
  servers: Record<string, any>,
  opts?: {
    /**
     * Per-meeting password side-load fixture: return null (or a bad
     * ciphertext) for a meeting with NO decryptable moderator password.
     */
    passwordRowFor?: (meetingId: string) => unknown;
  },
) {
  const rawQuery = vi.fn(async (..._args: any[]) => []);
  const connection = {
    getRepository: () => ({
      createQueryBuilder: () =>
        fakeQb({
          getMany: async () => meetings,
          // moderator-password side-load (metering decrypts it, like reconcile)
          getOne: async (whereParams?: { id?: unknown }) => {
            if (opts?.passwordRowFor) {
              return opts.passwordRowFor(String(whereParams?.id ?? ""));
            }
            return { encryptedModeratorPassword: "enc-mpw" };
          },
        }),
    }),
    rawConnection: { options: {}, query: rawQuery },
  };
  const serverService = {
    findByIdWithSecret: vi.fn(async (_c: any, id: string) => servers[id]),
    markHealthy: vi.fn(async (..._args: any[]) => {}),
  };
  const opsAlert = { notify: vi.fn() };
  const svc = new BbbMeteringService(
    connection as never,
    { create: async () => CTX } as never,
    realApi(),
    serverService as never,
    { publish: vi.fn() } as never,
    {
      decrypt: (enc: string) => {
        if (enc !== "enc-mpw") throw new Error("bad ciphertext");
        return "mod-pw";
      },
    } as never, // BbbEncryptionService
    opsAlert as never,
    {} as never, // plugin options (defaults apply)
  );
  return { svc, rawQuery, serverService, opsAlert };
}

describe("Gate-2 loops (real services + real adapter, faked fetch)", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("(a) reconcile: misconfigured server skips+flags, healthy gone meeting still stales", async () => {
    vi.mocked(fetch).mockResolvedValue(xmlResp(NOTFOUND_XML));
    const meetings = [
      activeMeeting("m-mis", "s-mis"),
      activeMeeting("m-gone", "s-ok"),
    ];
    const { svc, serverService, lifecycle, opsAlert } = buildReconciliation(
      meetings,
      { "s-mis": SERVER_NO_SECRET, "s-ok": SERVER_OK },
    );

    const reconciled = await svc.reconcileActiveMeetings();

    // Only the healthy server's proven-gone meeting stales.
    expect(reconciled).toBe(1);
    expect(lifecycle.markMeetingStale).toHaveBeenCalledTimes(1);
    expect(lifecycle.markMeetingStale.mock.calls[0][1]).toBe(meetings[1]);
    // The misconfigured server is flagged unhealthy + one de-duplicated alert.
    expect(serverService.markHealthy).toHaveBeenCalledWith(
      expect.anything(),
      "s-mis",
      false,
    );
    expect(opsAlert.notify).toHaveBeenCalledTimes(1);
    expect(opsAlert.notify.mock.calls[0][0]).toBe("bbb-server-config");
    // Misconfigured server never reached the network; secret never in a URL.
    expect(fetch).toHaveBeenCalledTimes(1);
    for (const call of vi.mocked(fetch).mock.calls) {
      expect(String(call[0])).not.toContain(SECRET);
    }
  });

  it("(b) metering: healthy sample inserts; outage+misconfigured are gaps with flag", async () => {
    vi.mocked(fetch).mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("bbb-m-outage")) return new Response("oops", { status: 500 });
      return xmlResp(SUCCESS_INFO_XML);
    });
    const meetings = [
      activeMeeting("m-ok", "s-ok"),
      activeMeeting("m-outage", "s-ok"),
      activeMeeting("m-mis", "s-mis"),
    ];
    const { svc, rawQuery, serverService, opsAlert } = buildMetering(
      meetings,
      { "s-mis": SERVER_NO_SECRET, "s-ok": SERVER_OK },
    );

    const result = await svc.sampleActiveMeetings();

    expect(result).toEqual({
      scanned: 3,
      sampled: 1,
      skipped: 2,
      failed: 0,
      gapCount: 2,
    });
    // Only the healthy+reachable meeting inserted a sample row.
    expect(rawQuery).toHaveBeenCalledTimes(1);
    expect(String(rawQuery.mock.calls[0][1]?.[0])).toBe("m-ok");
    // The tick is AUTHENTICATED now: every getMeetingInfo issued by the
    // sampler carries the moderator password side-loaded from the row.
    for (const call of vi.mocked(fetch).mock.calls) {
      expect(String(call[0])).toContain("password=mod-pw");
    }
    // Outage alone must NOT flag the server; the config problem must.
    expect(serverService.markHealthy).toHaveBeenCalledTimes(1);
    expect(serverService.markHealthy.mock.calls[0][1]).toBe("s-mis");
    expect(opsAlert.notify).toHaveBeenCalledTimes(1);
  });

  it("(e) metering: missing moderator password skips as a gap, server untouched", async () => {
    vi.mocked(fetch).mockResolvedValue(xmlResp(SUCCESS_INFO_XML));
    const meetings = [
      activeMeeting("m-ok", "s-ok"),
      activeMeeting("m-nopw", "s-ok"),
    ];
    const { svc, rawQuery, serverService, opsAlert } = buildMetering(
      meetings,
      { "s-ok": SERVER_OK },
      {
        // m-nopw has NO decryptable password on its row — the W5-8 fixture,
        // now applied to the per-minute sampling loop.
        passwordRowFor: (id) =>
          id === "m-nopw" ? null : { encryptedModeratorPassword: "enc-mpw" },
      },
    );

    const result = await svc.sampleActiveMeetings();

    expect(result).toEqual({
      scanned: 2,
      sampled: 1,
      skipped: 1,
      failed: 0,
      gapCount: 1,
    });
    // The passwordless meeting never reached the network: an unauthenticated
    // call would be rejected (BbbRejectedError) and — the actual hazard —
    // flagServerConfigProblem() would mark the whole SERVER unhealthy because
    // of ONE bad meeting row.
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
    const calledUrl = String(vi.mocked(fetch).mock.calls[0][0]);
    expect(calledUrl).toContain("meetingID=bbb-m-ok");
    expect(calledUrl).not.toContain("bbb-m-nopw");
    expect(calledUrl).toContain("password=mod-pw");
    expect(serverService.markHealthy).not.toHaveBeenCalled();
    expect(opsAlert.notify).not.toHaveBeenCalled();
    // Counted as a gap (visible under-billing) — only m-ok inserted a sample.
    expect(rawQuery).toHaveBeenCalledTimes(1);
    expect(String(rawQuery.mock.calls[0][1]?.[0])).toBe("m-ok");
  });

  it("(c) room runtime validation: no completion on outage/misconfig; invalidate on notFound", async () => {
    const buildRoomSvc = () => {
      const svc: any = Object.create(BbbRoomService.prototype);
      svc.connection = {
        getRepository: () => ({
          createQueryBuilder: () =>
            fakeQb({
              getOne: async () => ({ encryptedModeratorPassword: "enc-mpw" }),
            }),
        }),
      };
      svc.serverService = {
        findByIdWithSecret: vi.fn(async (_c: any, id: string) =>
          id === "s-mis" ? SERVER_NO_SECRET : SERVER_OK,
        ),
      };
      svc.encryptionService = { decrypt: () => "mod-pw" };
      svc.bbbApiService = realApi();
      svc.metrics = { recordRuntimeValidationFailed: vi.fn() };
      svc.options = {};
      return svc;
    };
    const room = { id: "r1", lastRuntimeValidatedAt: null };
    const meeting = { id: "m1", bbbMeetingId: "bbb-1", serverId: "s-out" };

    // Outage (HTTP 500) → assume valid: caller must NOT complete the meeting.
    vi.mocked(fetch).mockResolvedValue(new Response("oops", { status: 500 }));
    let svc = buildRoomSvc();
    expect(await svc.validateRuntimeMeeting(CTX, room, meeting)).toBe(true);
    expect(svc.metrics.recordRuntimeValidationFailed).not.toHaveBeenCalled();

    // Misconfigured server (no secret) → also assume valid, no completion.
    svc = buildRoomSvc();
    meeting.serverId = "s-mis";
    expect(await svc.validateRuntimeMeeting(CTX, room, meeting)).toBe(true);
    expect(svc.metrics.recordRuntimeValidationFailed).not.toHaveBeenCalled();

    // CONFIRMED notFound → false: caller runs the stale-active recovery.
    vi.mocked(fetch).mockResolvedValue(xmlResp(NOTFOUND_XML));
    svc = buildRoomSvc();
    meeting.serverId = "s-out";
    expect(await svc.validateRuntimeMeeting(CTX, room, meeting)).toBe(false);
    expect(svc.metrics.recordRuntimeValidationFailed).toHaveBeenCalledTimes(1);
  });

  it("(d) join/end paths leak no URL or secret", async () => {
    // End path: network error embedding the signed URL is fully sanitized.
    vi.mocked(fetch).mockRejectedValue(
      new Error(
        `fetch failed: ${HOST}/api/end?meetingID=m1&password=attendee-pw&checksum=abc123`,
      ),
    );
    const endErr = await realApi()
      .endMeeting(SERVER_OK, "m1", "mod-pw")
      .catch((e) => e);
    expect(endErr).toBeInstanceOf(BbbUnavailableError);
    const msg = (endErr as Error).message;
    expect(msg).not.toContain("checksum=");
    expect(msg).not.toContain("password=");
    expect(msg).not.toContain(SECRET);

    // Join path: secretless server throws typed BEFORE any URL is built.
    const joinSvc = realApi();
    const misErr = (() => {
      try {
        joinSvc.buildJoinUrl(SERVER_NO_SECRET, {
          fullName: "Learner",
          meetingID: "m1",
          password: "attendee-pw",
        });
        return null;
      } catch (e) {
        return e;
      }
    })();
    expect(misErr).toBeInstanceOf(BbbMisconfiguredError);

    // Signed join URL contains a checksum derived FROM the secret, never the
    // secret itself.
    const url = joinSvc.buildJoinUrl(SERVER_OK, {
      fullName: "Learner",
      meetingID: "m1",
      password: "attendee-pw",
    });
    expect(url).toContain("checksum=");
    expect(url).not.toContain(SECRET);
  });
});

