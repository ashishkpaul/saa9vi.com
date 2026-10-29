/**
 * Phase 3 — unit tests for `rankServers` and `pickBestServer` from
 * `services/server-selection.policy.ts`.
 *
 * Pure, dependency-free ranking of BBB server candidates. Input rows are
 * constructed directly, no database or BBB API.
 */
import { describe, expect, it } from "vitest";
import {
  rankServers,
  pickBestServer,
  type ServerSelectionOpts,
} from "../services/server-selection.policy";
import type { BbbServer } from "../entities/bbb-server.entity";

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

function nowMs(minutesAgo: number) {
  return Date.now() - minutesAgo * 60_000;
}

describe("rankServers", () => {
  it("returns an empty array for no servers", () => {
    const ranked = rankServers([], {
      nowMs: nowMs(0),
      loadStaleAfterMinutes: 5,
    });
    expect(ranked).toEqual([]);
  });

  it("sorts under-capacity before over-capacity", () => {
    const servers = [
      serverRow("over", { currentLoad: 150, maxLoad: 100 }),
      serverRow("under", { currentLoad: 40, maxLoad: 100 }),
    ];
    const ranked = rankServers(servers, {
      nowMs: nowMs(0),
      loadStaleAfterMinutes: 5,
    });
    expect(ranked[0].server.id).toBe("under");
    expect(ranked[1].server.id).toBe("over");
  });

  it("fresh before stale within same capacity tier", () => {
    const servers = [
      serverRow("stale", { loadUpdatedAt: new Date(nowMs(10)) }),
      serverRow("fresh", { loadUpdatedAt: new Date(nowMs(1)) }),
    ];
    const ranked = rankServers(servers, {
      nowMs: nowMs(0),
      loadStaleAfterMinutes: 5,
    });
    expect(ranked[0].server.id).toBe("fresh");
    expect(ranked[1].server.id).toBe("stale");
  });

  it("stale/unknown before over-capacity", () => {
    const servers = [
      serverRow("stale", { loadUpdatedAt: new Date(nowMs(10)) }),
      serverRow("over", { currentLoad: 150, maxLoad: 100 }),
    ];
    const ranked = rankServers(servers, {
      nowMs: nowMs(0),
      loadStaleAfterMinutes: 5,
    });
    // stale (utilisation 0, under capacity flag) ranks above over (utilisation 1.5)
    expect(ranked[0].server.id).toBe("stale");
    expect(ranked[1].server.id).toBe("over");
  });

  it("by ascending utilisation within same tier", () => {
    const servers = [
      serverRow("low", { currentLoad: 10, maxLoad: 100 }),
      serverRow("high", { currentLoad: 80, maxLoad: 100 }),
      serverRow("mid", { currentLoad: 30, maxLoad: 100 }),
    ];
    const ranked = rankServers(servers, {
      nowMs: nowMs(0),
      loadStaleAfterMinutes: 5,
    });
    expect(ranked.map((r) => r.server.id)).toEqual(["low", "mid", "high"]);
  });

describe("pickBestServer", () => {
  const opts: ServerSelectionOpts = {
    nowMs: nowMs(0),
    loadStaleAfterMinutes: 5,
  };

  it("picks the least-loaded under-capacity server", () => {
    const servers = [
      serverRow("s1", { currentLoad: 20, maxLoad: 100, loadUpdatedAt: new Date(nowMs(1)) }),
      serverRow("s2", { currentLoad: 5, maxLoad: 100, loadUpdatedAt: new Date(nowMs(1)) }),
      serverRow("s3", { currentLoad: 40, maxLoad: 100, loadUpdatedAt: new Date(nowMs(1)) }),
    ];
    const ranked = rankServers(servers, opts);
    const { pick } = pickBestServer(ranked, opts);
    expect(pick?.id).toBe("s2");
  });

  it("ties by input order when Math.random returns 0", () => {
    const origRandom = Math.random;
    Math.random = () => 0;
    try {
      const servers = [
        serverRow("s1", { currentLoad: 10, maxLoad: 100, loadUpdatedAt: new Date(nowMs(1)) }),
        serverRow("s2", { currentLoad: 10, maxLoad: 100, loadUpdatedAt: new Date(nowMs(1)) }),
      ];
      const ranked = rankServers(servers, opts);
      const { pick } = pickBestServer(ranked, opts);
      expect(pick?.id).toBe("s1");
    } finally {
      Math.random = origRandom;
    }
  });


  it("returns null pick and null overflow when no servers", () => {
    const ranked: any[] = [];
    const { pick, overflow } = pickBestServer(ranked, opts);
    expect(pick).toBeNull();
    expect(overflow).toBeNull();
  });

  it("fresh before stale within same utilisation", () => {
    const now = Date.now();
    const staleThreshold = now - 5 * 60_000; // 5 minutes ago
    const servers = [
      serverRow("stale", {
        currentLoad: 10,
        maxLoad: 100,
        loadUpdatedAt: new Date(staleThreshold - 1000), // 1 second before threshold -> stale
      }),
      serverRow("fresh", {
        currentLoad: 10,
        maxLoad: 100,
        loadUpdatedAt: new Date(staleThreshold + 1000), // 1 second after threshold -> fresh
      }),
    ];
    const ranked = rankServers(servers, { nowMs: now, loadStaleAfterMinutes: 5 });
    const { pick } = pickBestServer(ranked, { nowMs: now, loadStaleAfterMinutes: 5 });
    expect(pick?.id).toBe("fresh");
  });

});
});
