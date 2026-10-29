/**
 * BBB server selection policy — Phase 3 of the measured-load plan.
 *
 * Pure, dependency-free ranking of candidate BBB servers. No I/O, no
 * database, no side effects — the same style as `grant-selection.policy.ts`
 * and `server-load.policy.ts`.
 *
 * Ranking rules (INV-012-safe):
 *  1. Candidates are already pre-filtered by the SQL layer to enabled +
 *     healthy + not connection-failure-excluded.
 *  2. Prefer candidates with `currentLoad < maxLoad` (under capacity).
 *  3. Among under-capacity candidates: rank fresh before stale, then by
 *     utilisation `currentLoad / max(maxLoad, 1)` ascending.
 *  4. Exact ties are returned in input order — the caller applies jitter.
 *  5. If NO candidate is under capacity but candidates exist: the least-
 *     utilised candidate is the overflow pick (caller logs + alerts).
 *
 * A server is "fresh" when `loadUpdatedAt` is within `loadStaleAfterMinutes`.
 * A null or old `loadUpdatedAt` is stale/unknown and ranks below fresh.
 */



import type { BbbServer } from "../entities/bbb-server.entity";
export interface ServerSelectionOpts {
  /** Current time in ms since epoch. */
  nowMs: number;
  /** A server's load is stale if `loadUpdatedAt` is older than this many minutes. */
  loadStaleAfterMinutes: number;
}

export interface RankedServer {
  server: BbbServer;
  /** currentLoad / max(maxLoad, 1) — lower is better. */
  utilisation: number;
  /** True when currentLoad < maxLoad. */
  isUnderMaxLoad: boolean;
  /** True when loadUpdatedAt is recent (within loadStaleAfterMinutes). */
  isFresh: boolean;
}

/**
 * Rank candidate servers for selection. Returns a new array sorted by:
 *   under-capacity first, then fresh before stale, then utilisation ascending.
 * Exact ties preserve input order (stable sort).
 */
export function rankServers(
  servers: ReadonlyArray<BbbServer>,
  opts: ServerSelectionOpts,
): RankedServer[] {
  const now = opts.nowMs;
  const staleThreshold = now - opts.loadStaleAfterMinutes * 60 * 1000;

  return servers
    .map((server) => {
      const loadUpdatedAtMs =
        server.loadUpdatedAt instanceof Date
          ? server.loadUpdatedAt.getTime()
          : 0;
      const isFresh = loadUpdatedAtMs > 0 && loadUpdatedAtMs > staleThreshold;
      const isUnderMaxLoad = server.currentLoad < server.maxLoad;
      const utilisation =
        server.currentLoad / Math.max(server.maxLoad, 1);
      return {
        server,
        utilisation,
        isUnderMaxLoad,
        isFresh,
      };
    })
    .sort((a, b) => {
      // 1. Under-capacity candidates first
      if (a.isUnderMaxLoad !== b.isUnderMaxLoad) {
        return a.isUnderMaxLoad ? -1 : 1;
      }
      // 2. Fresh before stale
      if (a.isFresh !== b.isFresh) {
        return a.isFresh ? -1 : 1;
      }
      // 3. By utilisation ascending (lower load wins)
      if (a.utilisation !== b.utilisation) {
        return a.utilisation - b.utilisation;
      }
      // 4. Exact tie — preserve input order (stable)
      return 0;
    });
}

/**
 * From a ranked list, pick the best under-capacity candidate, applying
 * jitter among exact utilisation ties.
 *
 * Returns `{ pick, overflow }`:
 *  - `pick`: the selected server, or null if no under-capacity candidate.
 *  - `overflow`: the least-utilised candidate when none are under capacity
 *    (caller logs + alerts). Null when no candidates at all.
 */
export function pickBestServer(
  ranked: RankedServer[],
  opts: ServerSelectionOpts,
): { pick: BbbServer | null; overflow: BbbServer | null } {
  const underCapacity = ranked.filter((r) => r.isUnderMaxLoad);

  if (underCapacity.length > 0) {
    // Jitter among servers sharing the minimum utilisation.
    const minUtil = underCapacity[0].utilisation;
    const tied = underCapacity.filter((r) => r.utilisation === minUtil);
    const pick = tied[Math.floor(Math.random() * tied.length)];
    return { pick: pick.server, overflow: null };
  }

  // No under-capacity candidate. Overflow: least-utilised candidate.
  if (ranked.length > 0) {
    const overflow = ranked[0].server;
    return { pick: null, overflow };
  }

  return { pick: null, overflow: null };
}
