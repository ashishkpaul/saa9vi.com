import { Injectable, Logger } from "@nestjs/common";
import { RequestContext, TransactionalConnection } from "@vendure/core";
import { BbbServer } from "../entities/bbb-server.entity";
import { BbbServerService } from "./bbb-server.service";
import { BbbOpsAlertService } from "./bbb-ops-alert.service";

const loggerCtx = "BbbServerSelectionService";

/**
 * Owns the server-selection algorithm. Decoupled from provisioning so the
 * strategy can be swapped (weighted, region-aware, cost-optimised) without
 * touching BbbMeetingService or BbbRoomService.
 *
 * V1 strategy: healthy + enabled + not at capacity, ordered by lowest load.
 * Small random jitter breaks ties when all servers have equal load.
 *
 * Connection-failure bookkeeping (2026-10-07 hardening, Track A item 1):
 *  - a connection-class `/create` failure (`BbbUnavailableError`: DNS,
 *    HTTP 5xx, timeout, malformed XML) EXCLUDES that server from
 *    selection for 2 minutes — the provisioning job's failover loop and
 *    any other attempt inside the window re-select around it;
 *  - `MAX_CONSECUTIVE_CONNECTION_FAILURES` (3) consecutive failures with
 *    no success in between mark the server unhealthy (SQL-level
 *    exclusion) + raise a de-duplicated `bbb-server-unreachable` ops
 *    alert (BbbOpsAlertService: 1 h per server);
 *  - a successful `/create` resets the server's streak.
 * State is process-local and advisory (no migration): each worker process
 * tracks its own counts and a restart clears them. Recovery from
 * `healthy=false` is owned by the signed `bbb-server-health` probe task —
 * nothing else in the codebase ever writes `healthy = true`.
 */
@Injectable()
export class BbbServerSelectionService {
  /** Consecutive connection-class failures before unhealthy + ops alert. */
  static readonly MAX_CONSECUTIVE_CONNECTION_FAILURES = 3;

  /** Exclusion window after a single connection-class failure. */
  static readonly CONNECTION_FAILURE_EXCLUDE_MS = 2 * 60_000;

  private readonly connectionFailures = new Map<
    string,
    { consecutive: number; excludedUntil: number }
  >();

  constructor(
    private readonly connection: TransactionalConnection,
    private readonly serverService: BbbServerService,
    private readonly opsAlert: BbbOpsAlertService,
  ) {}

  /**
   * Returns the best available server with encryptedApiSecret pre-loaded,
   * or null if no healthy server is available (including when every
   * healthy server is currently excluded by a fresh connection failure —
   * the tenant-facing provisioning error stays "No healthy BBB server
   * available" in that case).
   */
  async selectServer(ctx: RequestContext): Promise<BbbServer | null> {
    const now = Date.now();
    const excludedIds = [...this.connectionFailures.entries()]
      .filter(([, state]) => state.excludedUntil > now)
      .map(([serverId]) => serverId);
    let qb = this.connection
      .getRepository(ctx, BbbServer)
      .createQueryBuilder("server")
      .addSelect("server.encryptedApiSecret")
      .where("server.enabled = :enabled", { enabled: true })
      .andWhere("server.healthy = :healthy", { healthy: true })
      .andWhere("server.currentLoad < server.maxLoad");
    if (excludedIds.length > 0) {
      qb = qb.andWhere("server.id NOT IN (:...excludedIds)", { excludedIds });
    }
    const candidates = await qb.orderBy("server.currentLoad", "ASC").getMany();

    if (candidates.length === 0) {
      Logger.warn("No healthy BBB servers available for selection", loggerCtx);
      return null;
    }

    // Jitter: if multiple servers share the minimum load, pick randomly
    // among them to avoid thundering-herd when loads are equal.
    const minLoad = candidates[0].currentLoad;
    const tied = candidates.filter((s) => s.currentLoad === minLoad);
    return tied[Math.floor(Math.random() * tied.length)];
  }

  /**
   * Record a connection-class `/create` failure for a server:
   *  - exclude the server from the next `selectServer` (2 min window — the
   *    provisioning job's failover loop re-selects around it immediately);
   *  - after `MAX_CONSECUTIVE_CONNECTION_FAILURES` consecutive failures,
   *    mark it unhealthy (SQL-level exclusion) + de-duplicated
   *    `bbb-server-unreachable` ops alert (1 h per server).
   * Advisory by design: markHealthy is best-effort, and alerting must
   * never break the provisioning path (INV-012 family).
   */
  async noteConnectionFailure(
    ctx: RequestContext,
    server: Pick<BbbServer, "id" | "name">,
    err: { message: string; messageKey?: string },
  ): Promise<void> {
    const serverId = String(server.id);
    const state = this.connectionFailures.get(serverId) ?? {
      consecutive: 0,
      excludedUntil: 0,
    };
    state.consecutive += 1;
    state.excludedUntil =
      Date.now() + BbbServerSelectionService.CONNECTION_FAILURE_EXCLUDE_MS;
    this.connectionFailures.set(serverId, state);
    // Opportunistic pruning so the map cannot grow past the server count.
    if (this.connectionFailures.size > 100) {
      const cutoff = Date.now();
      for (const [key, s] of this.connectionFailures) {
        if (
          s.excludedUntil < cutoff &&
          s.consecutive < BbbServerSelectionService.MAX_CONSECUTIVE_CONNECTION_FAILURES
        ) {
          this.connectionFailures.delete(key);
        }
      }
    }

    const max = BbbServerSelectionService.MAX_CONSECUTIVE_CONNECTION_FAILURES;
    Logger.warn(
      `Connection-class /create failure ${state.consecutive}/${max} for BBB server ${serverId}: ${err.message} — excluded from selection for ${BbbServerSelectionService.CONNECTION_FAILURE_EXCLUDE_MS / 1000}s`,
      loggerCtx,
    );

    if (state.consecutive >= max) {
      try {
        await this.serverService.markHealthy(ctx, serverId as never, false);
      } catch {
        // Selection exclusion via healthy=false is advisory — the 2-min
        // window already protected this attempt.
      }
      this.opsAlert.notify(
        "bbb-server-unreachable",
        `server-${serverId}`,
        `BBB server "${server.name ?? serverId}" failed ${state.consecutive} consecutive /create calls — marked unhealthy, excluded from selection`,
        {
          serverId,
          consecutive: state.consecutive,
          messageKey: err.messageKey ?? "unavailable",
        },
      );
    }
  }

  /** A successful `/create` clears the server's failure streak. */
  noteConnectionSuccess(serverId: string): void {
    this.connectionFailures.delete(serverId);
  }
}
