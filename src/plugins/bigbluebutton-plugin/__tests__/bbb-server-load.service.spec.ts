/**
 * Phase 2 — unit tests for BbbServerLoadService.
 *
 * Stubbed BbbApiService and repository. Covers:
 *  - refreshAll updates currentLoad / liveMeetings / liveParticipants / loadUpdatedAt
 *  - one server throwing leaves its row untouched and others still update
 *  - no healthy write on failure
 *  - noteMeetingCreated is a single atomic increment statement
 */
import { describe, expect, it, vi } from "vitest";
import { BbbServerLoadService } from "../services/bbb-server-load.service";
import { BbbApiService } from "../services/bbb-api.service";
import type { BbbServer } from "../entities/bbb-server.entity";

const CTX = { apiType: "admin" } as never;

function serverRow(
  id: string,
  over: Partial<Record<string, unknown>> = {},
): BbbServer {
  return {
    id,
    name: `bbb-${id}`,
    apiUrl: "https://bbb.example.com/bigbluebutton",
    encryptedApiSecret: "enc",
    enabled: true,
    healthy: true,
    currentLoad: 0,
    maxLoad: 100,
    liveMeetings: 0,
    liveParticipants: 0,
    loadUpdatedAt: null,
    ...over,
  } as unknown as BbbServer;
}

/** Repository stub that records updates and simulates per-server fetch isolation. */
function buildRepo(servers: BbbServer[], failingServerId?: string) {
  const updates: Array<{ id: string; data: Record<string, unknown> }> = [];

  function makeQb() {
    let whereId: string | null = null;
    let setData: Record<string, unknown> = {};
    const qb: any = {
      addSelect: () => qb,
      update: () => qb,
      where: (_c: string, p?: Record<string, unknown>) => {
        if (p && "id" in p) whereId = String(p.id);
        return qb;
      },
      set: (data: Record<string, unknown>) => {
        setData = data;
        return qb;
      },
      execute: async () => {
        if (whereId) {
          const row = servers.find((s) => s.id === whereId);
          if (row) {
            Object.assign(row, setData);
            updates.push({ id: whereId, data: { ...setData } });
          }
        }
      },
      getMany: async () => servers.filter((s) => s.enabled === true),
    };
    return qb;
  }

  const connection = {
    getRepository: () => ({
      createQueryBuilder: () => makeQb(),
      update: vi.fn(async () => {}),
    }),
    createQueryBuilder: () => makeQb(),
    getManager: () => connection,
  };

  const api = {
    getMeetings: vi.fn(async (server: BbbServer) => {
      if (failingServerId && server.id === failingServerId) {
        throw new Error(`boom for ${server.id}`);
      }
      return [
        {
          meetingID: "m1",
          internalMeetingID: "int-m1",
          name: "meeting 1",
          running: true,
          participantCount: 10,
          moderatorCount: 1,
          hasBeenForciblyEnded: false,
          createTime: Date.now() - 2 * 60 * 60 * 1000, // 2 hours ago — established
          isBreakout: false,
          videoCount: 2,
        },
        {
          meetingID: "m2",
          internalMeetingID: "int-m2",
          name: "meeting 2",
          running: true,
          participantCount: 20,
          moderatorCount: 2,
          hasBeenForciblyEnded: false,
          createTime: Date.now() - 3 * 60 * 60 * 1000, // 3 hours ago — established
          isBreakout: false,
          videoCount: 1,
        },
      ];
    }),
  };

  return { connection, api, updates };
}

function buildService(servers: BbbServer[], failingServerId?: string) {
  const { connection, api, updates } = buildRepo(servers, failingServerId);
  const ctxService = {
    create: vi.fn(async () => CTX),
  };
  const svc = new BbbServerLoadService(
    connection as never,
    ctxService as never,
    api as never,
    { loadMinUserCount: 15, loadJoinBufferMinutes: 15 } as never,
  );
  return { svc, connection, api, updates, ctxService };
}

describe("BbbServerLoadService.refreshAll", () => {
  it("updates currentLoad, liveMeetings, liveParticipants, loadUpdatedAt for each enabled server", async () => {
    const servers = [serverRow("s1"), serverRow("s2")];
    const { svc, updates } = buildService(servers);

    const result = await svc.refreshAll();

    expect(result.polled).toBe(2);
    expect(result.updated).toBe(2);
    expect(result.failed).toBe(0);

    const s1 = servers.find((s) => s.id === "s1")!;
    expect(s1.currentLoad).toBe(30); // 10 + 20
    expect(s1.liveMeetings).toBe(2);
    expect(s1.liveParticipants).toBe(30); // 10 + 20
    expect(s1.loadUpdatedAt).toBeInstanceOf(Date);

    const s1Update = updates.find((u) => u.id === "s1");
    expect(s1Update).toBeDefined();
    expect(s1Update!.data.currentLoad).toBe(30);
    expect(s1Update!.data.liveMeetings).toBe(2);
    expect(s1Update!.data.liveParticipants).toBe(30);
    expect(s1Update!.data.loadUpdatedAt).toBeInstanceOf(Date);
  });

  it("one failing server leaves its row untouched and others still update", async () => {
    const servers = [serverRow("s1"), serverRow("s2", { currentLoad: 5 })];
    const { svc, updates } = buildService(servers, "s2");

    const result = await svc.refreshAll();

    expect(result.polled).toBe(2);
    expect(result.updated).toBe(1);
    expect(result.failed).toBe(1);

    expect(servers.find((s) => s.id === "s1")!.currentLoad).toBe(30);

    const s2 = servers.find((s) => s.id === "s2")!;
    expect(s2.currentLoad).toBe(5);
    expect(s2.loadUpdatedAt).toBeNull();

    expect(updates).toHaveLength(1);
    expect(updates[0].id).toBe("s1");
  });

  it("no healthy write on failure — healthy column never touched", async () => {
    const servers = [serverRow("s1", { healthy: true })];
    const { svc } = buildService(servers, "s1");

    await svc.refreshAll();

    const s1 = servers.find((s) => s.id === "s1")!;
    expect(s1.healthy).toBe(true);
  });
});

describe("BbbServerLoadService.noteMeetingCreated", () => {
  it("increments currentLoad atomically via a single raw-expression set", async () => {
    const servers = [serverRow("s1", { currentLoad: 10 })];
    const { svc, updates } = buildService(servers);

    await svc.noteMeetingCreated(CTX, "s1");

    expect(updates).toHaveLength(1);
    expect(updates[0].id).toBe("s1");
    // The set() call carries a raw-expression function (not evaluated by stub)
    expect(typeof updates[0].data.currentLoad).toBe("function");
    // Evaluating it should give 10 + 15 = 25
    expect((updates[0].data.currentLoad as () => string)()).toBe(
      `"currentLoad" + 15`,
    );
  });

  it("swallows errors and never breaks the caller", async () => {
    const servers = [serverRow("s1")];
    const { connection, api } = buildRepo(servers);
    const throwingConnection = {
      ...connection,
      getRepository: () => ({
        createQueryBuilder: () => {
          const qb: any = {
            addSelect: () => qb,
            where: () => qb,
            set: () => qb,
            execute: async () => {
              throw new Error("db down");
            },
            getMany: async () => [],
          };
          return qb;
        },
        update: vi.fn(async () => {
          throw new Error("db down");
        }),
      }),
    };
    const ctxService = { create: vi.fn(async () => CTX) };
    const svc = new BbbServerLoadService(
      throwingConnection as never,
      ctxService as never,
      api as never,
      { loadMinUserCount: 15 } as never,
    );

    await expect(svc.noteMeetingCreated(CTX, "s1")).resolves.toBeUndefined();
  });
});


