/**
 * Track A item 1 — provisioning resilience (real services, faked repos/fetch).
 *
 * Covered:
 *  (S1) one connection-class /create failure excludes that server from the
 *       next selectServer (NOT IN window) — no health change below N;
 *  (S2) N=3 consecutive failures → markHealthy(false) + de-duplicated
 *       `bbb-server-unreachable` ops alert (dedupe itself is
 *       BbbOpsAlertService's tested job; here we pin kind + key);
 *  (S3) a successful /create clears the streak (no exclusion);
 *  (S4) every server excluded → selectServer returns null.
 *  (W1) worker failover: A fails (BbbUnavailableError) → noteConnectionFailure
 *       → re-select → B succeeds → ACTIVE row written with B's id;
 *  (W2) single server fails → re-select null → meeting FAILED with failureReason
 *       EXACTLY "No healthy BBB server available" (tenant contract) and the
 *       connection error never leaks into failureReason;
 *  (W3) rejected (checksum) → no failover, no failure-recording: immediate
 *       FAILED with the rejection message.
 *  (H1) health probe: SUCCESS → healthy=true + stamp (recovery of a flagged row);
 *  (H2) unavailable → healthy=false + `bbb-server-health` alert;
 *  (H3) rejected → healthy=false + `bbb-server-config` alert;
 *  (H4) mixed rows counted independently.
 */
import { describe, expect, it, vi } from "vitest";
import { BbbServerSelectionService } from "../services/bbb-server-selection.service";
import { BbbProvisioningWorkerService } from "../services/bbb-provisioning-worker.service";
import { BbbServerService } from "../services/bbb-server.service";
import {
  BbbRejectedError,
  BbbUnavailableError,
} from "../services/bbb-api.service";
import { BbbMeeting } from "../entities/bbb-meeting.entity";
import { BILLING_MODE, MEETING_STATE } from "../constants";
import type { BbbServer } from "../entities/bbb-server.entity";

const CTX = { apiType: "admin" } as never;
const HOST = "https://bbb.example.com/bigbluebutton";

function serverRow(id: string, over: Partial<Record<string, unknown>> = {}): any {
  return {
    id,
    name: `bbb-${id}`,
    apiUrl: HOST,
    encryptedApiSecret: "enc",
    enabled: true,
    healthy: true,
    currentLoad: 0,
    maxLoad: 100,
    ...over,
  };
}

/**
 * Connection whose QB SIMULATES the real where-clause semantics
 * (enabled ∧ healthy ∧ currentLoad<maxLoad ∧ NOT IN excludedIds) so
 * selectServer behaviour is exercised for real without a database.
 */
function fakeConnection(rows: any[]) {
  const lastParams: Record<string, any> = {};
  const qb: any = {
    addSelect: () => qb,
    where: (_c: string, p?: Record<string, unknown>) => {
      if (p) Object.assign(lastParams, p);
      return qb;
    },
    andWhere: (_c: string, p?: Record<string, unknown>) => {
      if (p) Object.assign(lastParams, p);
      return qb;
    },
    orderBy: () => qb,
    getMany: async () =>
      rows.filter(
        (r) =>
          r.enabled === true &&
          r.healthy === true &&
          r.currentLoad < r.maxLoad &&
          !(lastParams.excludedIds ?? []).includes(String(r.id)),
      ),
  };
  const connection = {
    getRepository: () => ({
      createQueryBuilder: () => qb,
      update: vi.fn(async () => {}),
    }),
    rawConnection: { options: {}, query: async () => [] },
  };
  return { connection, lastParams };
}

function buildSelection(rows: any[]) {
  const { connection, lastParams } = fakeConnection(rows);
  const serverService = { markHealthy: vi.fn(async () => {}) };
  const opsAlert = { notify: vi.fn() };
  const svc = new BbbServerSelectionService(
    connection as never,
    serverService as never,
    opsAlert as never,
  );
  return { svc, serverService, opsAlert, lastParams };
}

function meteredMeeting(id = "m1"): any {
  return {
    id,
    title: "Live class",
    state: MEETING_STATE.PENDING,
    retryCount: 0,
    recordingEnabled: false,
    roomId: null,
    organization: {
      id: "o1",
      billingMode: BILLING_MODE.METERED,
      suspended: false,
      maxParticipantsPerMeeting: 20,
    },
  };
}

describe("Connection-failure exclusion (BbbServerSelectionService)", () => {
  it("(S1) one failure excludes the server from the next select", async () => {
    const { svc, serverService, opsAlert, lastParams } = buildSelection([
      serverRow("s1"),
    ]);

    await svc.noteConnectionFailure(CTX, serverRow("s1"), {
      message: "request failed (bbb)",
      messageKey: "unavailable",
    });

    expect(await svc.selectServer(CTX)).toBeNull();
    expect(lastParams.excludedIds).toEqual(["s1"]);
    // Below N: health untouched, no alert.
    expect(serverService.markHealthy).not.toHaveBeenCalled();
    expect(opsAlert.notify).not.toHaveBeenCalled();
  });

  it("(S2) N=3 consecutive failures → unhealthy + bbb-server-unreachable alert", async () => {
    const { svc, serverService, opsAlert } = buildSelection([serverRow("s1")]);
    const err = { message: "request failed (bbb)", messageKey: "unavailable" };

    for (let i = 0; i < 2; i++) {
      await svc.noteConnectionFailure(CTX, serverRow("s1"), err);
    }
    expect(serverService.markHealthy).not.toHaveBeenCalled();

    await svc.noteConnectionFailure(CTX, serverRow("s1"), err);
    expect(serverService.markHealthy).toHaveBeenCalledWith(CTX, "s1", false);
    expect(opsAlert.notify).toHaveBeenCalledWith(
      "bbb-server-unreachable",
      "server-s1",
      expect.stringContaining("3 consecutive"),
      expect.objectContaining({ serverId: "s1", consecutive: 3 }),
    );
  });

  it("(S3) a success clears the streak — no exclusion afterwards", async () => {
    const { svc, lastParams } = buildSelection([serverRow("s1")]);

    await svc.noteConnectionFailure(CTX, serverRow("s1"), {
      message: "request failed (bbb)",
      messageKey: "unavailable",
    });
    svc.noteConnectionSuccess("s1");

    const picked = await svc.selectServer(CTX);
    expect(picked?.id).toBe("s1");
    expect(lastParams.excludedIds).toBeUndefined();
  });

  it("(S4) every server excluded → null (worker maps this to the tenant error)", async () => {
    const { svc } = buildSelection([serverRow("s1"), serverRow("s2")]);
    const err = { message: "request failed (bbb)", messageKey: "unavailable" };

    await svc.noteConnectionFailure(CTX, serverRow("s1"), err);
    await svc.noteConnectionFailure(CTX, serverRow("s2"), err);

    expect(await svc.selectServer(CTX)).toBeNull();
  });
});

/** Real worker + fake repos; reserveProvisioningCapacity spied to `true`. */
function buildWorker(opts: {
  meeting?: any;
  /** Successive selectServer returns; the queue's last entry repeats. */
  selectResults: any[];
  createMeeting: (server: any) => Promise<any>;
}) {
  const updates: Array<{ id: string; data: any }> = [];
  const meetingRepo = {
    findOne: vi.fn(async () => opts.meeting ?? meteredMeeting()),
    update: vi.fn(async (id: string, data: any) => {
      updates.push({ id, data });
    }),
  };
  const connection = {
    getRepository: (_c: unknown, entity: unknown) =>
      entity === (BbbMeeting as unknown)
        ? meetingRepo
        : { createQueryBuilder: () => ({}) },
    withTransaction: async (_c: unknown, fn: any) => fn(_c),
    rawConnection: { options: {}, query: async () => [] },
  };
  const queue = [...opts.selectResults];
  const selection = {
    selectServer: vi.fn(async () => queue.shift() ?? null),
    noteConnectionFailure: vi.fn(async () => {}),
    noteConnectionSuccess: vi.fn(),
  };
  const bbbApi = {
    createMeeting: vi.fn((server: any) => opts.createMeeting(server)),
  };
  const metrics = {
    recordProvisioningFailed: vi.fn(),
    recordProvisioningSucceeded: vi.fn(),
  };
  const eventBus = { publish: vi.fn() };
  const worker = new BbbProvisioningWorkerService(
    connection as never,
    {} as never, // jobQueueService — only used by enqueue/onModuleInit
    bbbApi as never,
    selection as never,
    { encrypt: (v: string) => `enc:${v}` } as never,
    metrics as never,
    eventBus as never,
    {} as never, // meteringService — metered org without a spend limit skips it
    {} as never, // roomService — roomId null keeps every room hook idle
  );
  vi.spyOn(worker as any, "reserveProvisioningCapacity").mockResolvedValue(
    true,
  );
  return { worker, selection, bbbApi, updates, metrics, eventBus };
}

describe("Provisioning failover on connection-class /create failures", () => {
  const sA = serverRow("sA");
  const sB = serverRow("sB");

  it("(W1) A fails (connection) → recorded + excluded → B succeeds", async () => {
    const { worker, selection, bbbApi, updates, metrics } = buildWorker({
      selectResults: [sA, sB],
      createMeeting: async (server) => {
        if (server.id === "sA") {
          throw new BbbUnavailableError("create", "request failed (a)");
        }
        return { internalMeetingID: "int-1", meetingID: "bbb-m1" };
      },
    });

    await worker.doProvisionMeeting(CTX, "m1", "job-1");

    expect(selection.selectServer).toHaveBeenCalledTimes(2);
    expect(selection.noteConnectionFailure).toHaveBeenCalledTimes(1);
    expect(selection.noteConnectionFailure).toHaveBeenCalledWith(
      CTX,
      sA,
      expect.any(BbbUnavailableError),
    );
    expect(selection.noteConnectionSuccess).toHaveBeenCalledWith("sB");
    expect(bbbApi.createMeeting).toHaveBeenCalledTimes(2);
    const last = updates[updates.length - 1].data;
    expect(last.state).toBe(MEETING_STATE.ACTIVE);
    expect(last.serverId).toBe("sB");
    expect(last.bbbMeetingId).toBe("bbb-m1");
    expect(last.bbbInternalMeetingId).toBe("int-1");
    expect(
      updates.find((u) => u.data.state === MEETING_STATE.FAILED),
    ).toBeUndefined();
    expect(metrics.recordProvisioningSucceeded).toHaveBeenCalledTimes(1);
  });

  it("(W2) single server fails → failureReason stays exactly 'No healthy BBB server available'", async () => {
    const { worker, selection, updates, metrics, eventBus } = buildWorker({
      selectResults: [sA],
      createMeeting: async () => {
        throw new BbbUnavailableError("create", "request failed (a)");
      },
    });

    await worker.doProvisionMeeting(CTX, "m1", "job-1");

    // Recorded once, then re-selection found nothing — no loop, no leak.
    expect(selection.noteConnectionFailure).toHaveBeenCalledTimes(1);
    expect(selection.selectServer).toHaveBeenCalledTimes(2);
    const failed = updates.find((u) => u.data.state === MEETING_STATE.FAILED);
    expect(failed?.data.failureReason).toBe(
      "No healthy BBB server available",
    );
    // The raw connection error must NOT reach the tenant-visible reason.
    expect(failed?.data.failureReason).not.toContain("request failed");
    expect(metrics.recordProvisioningFailed).toHaveBeenCalledTimes(1);
    expect(eventBus.publish).toHaveBeenCalledTimes(1);
  });

  it("(W3) rejected (checksum) → no failover, no failure-recording", async () => {
    const { worker, selection, updates } = buildWorker({
      selectResults: [sA],
      createMeeting: async () => {
        throw new BbbRejectedError("create", "checksumError", "bad checksum");
      },
    });

    await worker.doProvisionMeeting(CTX, "m1", "job-1");

    expect(selection.selectServer).toHaveBeenCalledTimes(1);
    expect(selection.noteConnectionFailure).not.toHaveBeenCalled();
    expect(selection.noteConnectionSuccess).not.toHaveBeenCalled();
    const failed = updates.find((u) => u.data.state === MEETING_STATE.FAILED);
    expect(failed?.data.failureReason).toContain("checksumError");
  });
});

/** Server-service harness for the signed health probe. */
function buildProbe(opts: {
  rows: any[];
  getMeetings?: () => Promise<unknown>;
}) {
  const updates: Array<{ id: string; data: any }> = [];
  const qb: any = {
    addSelect: () => qb,
    where: () => qb,
    getMany: async () => opts.rows,
  };
  const connection = {
    getRepository: () => ({
      createQueryBuilder: () => qb,
      update: vi.fn(async (id: string, data: any) => {
        updates.push({ id, data });
      }),
    }),
  };
  const api = { getMeetings: opts.getMeetings ?? (async () => []) };
  const opsAlert = { notify: vi.fn() };
  const svc = new BbbServerService(
    connection as never,
    {} as never, // encryption — unused by the probe
    { create: async () => CTX } as never,
    api as never,
    opsAlert as never,
  );
  return { svc, updates, opsAlert };
}

describe("Signed getMeetings health probe (runHealthProbe)", () => {
  it("(H1) SUCCESS on a flagged row → healthy=true + stamp (recovery)", async () => {
    const { svc, updates, opsAlert } = buildProbe({
      rows: [serverRow("s1", { healthy: false })],
    });

    const result = await svc.runHealthProbe();
    expect(result).toEqual({ probed: 1, flagged: 0, recovered: 1 });
    expect(updates).toHaveLength(1);
    expect(updates[0].id).toBe("s1");
    expect(updates[0].data.healthy).toBe(true);
    expect(updates[0].data.lastHealthCheckAt).toBeInstanceOf(Date);
    expect(opsAlert.notify).not.toHaveBeenCalled();
  });

  it("(H2) unavailable → healthy=false + bbb-server-health alert", async () => {
    const { svc, updates, opsAlert } = buildProbe({
      rows: [serverRow("s1")],
      getMeetings: async () => {
        throw new BbbUnavailableError("getMeetings", "request failed (s1)");
      },
    });

    const result = await svc.runHealthProbe();
    expect(result).toEqual({ probed: 1, flagged: 1, recovered: 0 });
    expect(updates[0].data.healthy).toBe(false);
    expect(opsAlert.notify).toHaveBeenCalledWith(
      "bbb-server-health",
      "server-s1",
      expect.stringContaining("health probe failed"),
      expect.objectContaining({ serverId: "s1", messageKey: "unavailable" }),
    );
  });

  it("(H3) rejected → healthy=false + bbb-server-config alert (flag family)", async () => {
    const { svc, updates, opsAlert } = buildProbe({
      rows: [serverRow("s1")],
      getMeetings: async () => {
        throw new BbbRejectedError("getMeetings", "checksumError", "bad sum");
      },
    });

    const result = await svc.runHealthProbe();
    expect(result.flagged).toBe(1);
    expect(updates[0].data.healthy).toBe(false);
    expect(opsAlert.notify).toHaveBeenCalledWith(
      "bbb-server-config",
      "server-s1",
      expect.stringContaining("health probe failed"),
      expect.objectContaining({ messageKey: "checksumError" }),
    );
  });

  it("(H4) mixed rows are counted independently", async () => {
    let call = 0;
    const { svc, updates, opsAlert } = buildProbe({
      rows: [serverRow("s1"), serverRow("s2")],
      getMeetings: async () => {
        call++;
        if (call === 1) return [];
        throw new BbbUnavailableError("getMeetings", "request failed (s2)");
      },
    });

    const result = await svc.runHealthProbe();
    expect(result).toEqual({ probed: 2, flagged: 1, recovered: 0 });
    expect(updates.map((u) => [u.id, u.data.healthy])).toEqual([
      ["s1", true],
      ["s2", false],
    ]);
    expect(opsAlert.notify).toHaveBeenCalledTimes(1);
    expect(opsAlert.notify).toHaveBeenCalledWith(
      "bbb-server-health",
      "server-s2",
      expect.any(String),
      expect.anything(),
    );
  });
});