import {
  Inject,
  Injectable,
  Logger,
} from "@nestjs/common";
import {
  RequestContext,
  RequestContextService,
  TransactionalConnection,
} from "@vendure/core";
import { BbbServer } from "../entities/bbb-server.entity";
import { BbbApiService } from "./bbb-api.service";
import { computeServerLoad, type ServerLoadOpts } from "./server-load.policy";
import { BBB_PLUGIN_OPTIONS } from "../constants";
import type { BigBlueButtonPluginOptions } from "../types";

const loggerCtx = "BbbServerLoadService";

/**
 * Writes measured BBB server load into `BbbServer.currentLoad`,
 * `liveMeetings`, `liveParticipants`, and `loadUpdatedAt`.
 *
 * Two writers:
 *  1. `refreshAll()` — 1-minute poll of every enabled server via `getMeetings`.
 *  2. `noteMeetingCreated()` — atomic optimistic increment after `/create`.
 *
 * The next poll overwrites the increment with the measured value. On any
 * poll error, previous values are left untouched (staleness handled by
 * `loadUpdatedAt` in Phase 3 selection). Never writes `healthy` and never
 * raises config/health alerts — the health probe owns that.
 */
@Injectable()
export class BbbServerLoadService {
  private readonly concurrency = 5;

  constructor(
    private readonly connection: TransactionalConnection,
    private readonly ctxService: RequestContextService,
    private readonly bbbApiService: BbbApiService,
    @Inject(BBB_PLUGIN_OPTIONS)
    private readonly options: BigBlueButtonPluginOptions,
  ) {}

  /**
   * Poll every enabled server, compute measured load, and persist it.
   * Per-server error isolation: one failing server never fails the tick.
   * Returns { polled, updated, failed }.
   */
  async refreshAll(): Promise<{
    polled: number;
    updated: number;
    failed: number;
  }> {
    const ctx = await this.ctxService.create({ apiType: "admin" });
    const servers = await this.connection
      .getRepository(ctx, BbbServer)
      .createQueryBuilder("server")
      .addSelect("server.encryptedApiSecret")
      .where("server.enabled = :enabled", { enabled: true })
      .getMany();

    const opts: ServerLoadOpts = {
      nowMs: Date.now(),
      minUserCount: this.options.loadMinUserCount ?? 15,
      joinBufferMs: (this.options.loadJoinBufferMinutes ?? 15) * 60 * 1000,
    };

    let polled = 0;
    let updated = 0;
    let failed = 0;

    // Bounded concurrency so a large pool doesn't hammer BBB.
    for (let i = 0; i < servers.length; i += this.concurrency) {
      const batch = servers.slice(i, i + this.concurrency);
      await Promise.all(
        batch.map(async (server) => {
          polled += 1;
          try {
            const meetings = await this.bbbApiService.getMeetings(server);
            const result = computeServerLoad(
              meetings as never,
              opts,
            );
            await this.connection
              .getRepository(ctx, BbbServer)
              .createQueryBuilder("server")
              .update(BbbServer)
              .set({
                currentLoad: result.load,
                liveMeetings: result.liveMeetings,
                liveParticipants: result.liveParticipants,
                loadUpdatedAt: new Date(),
              })
              .where("id = :id", { id: server.id })
              .execute();
            updated += 1;
          } catch (err) {
            failed += 1;
            Logger.warn(
              `Load refresh failed for BBB server ${server.id}: ${(
                err as Error
              ).message}`,
              loggerCtx,
            );
            // Leave previous load values and loadUpdatedAt unchanged —
            // staleness is handled by loadUpdatedAt in selection.
          }
        }),
      );
    }

    return { polled, updated, failed };
  }

  /**
   * Atomically increment `currentLoad` after a successful `/create`, so a
   * burst of new meetings doesn't pile onto one node between polls.
   * The next `refreshAll()` overwrites with the measured value.
   *
   * Uses a single raw-expression `set` (not read-modify-write) so concurrent
   * increments never lose updates. Swallows and logs errors — must never
   * break provisioning.
   */
  async noteMeetingCreated(
    ctx: RequestContext,
    serverId: string,
  ): Promise<void> {
    const n = this.options.loadMinUserCount ?? 15;
    try {
      await this.connection
        .getRepository(ctx, BbbServer)
        .createQueryBuilder("server")
        .update(BbbServer)
        .set({ currentLoad: () => `"currentLoad" + ${n}` })
        .where("id = :id", { id: serverId })
        .execute();
    } catch (err) {
      Logger.warn(
        `noteMeetingCreated failed for server ${serverId}: ${(
          err as Error
        ).message}`,
        loggerCtx,
      );
    }
  }
}
