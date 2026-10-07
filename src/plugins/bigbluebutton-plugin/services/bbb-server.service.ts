import { Injectable } from "@nestjs/common";
import {
  ID,
  Logger,
  RequestContext,
  RequestContextService,
  TransactionalConnection,
} from "@vendure/core";
import { BbbServer } from "../entities/bbb-server.entity";
import { BbbEncryptionService } from "./bbb-encryption.service";
import {
  BbbApiService,
  BbbMisconfiguredError,
  BbbRejectedError,
} from "./bbb-api.service";
import { BbbOpsAlertService } from "./bbb-ops-alert.service";
import { normalizeBbbApiUrl } from "../shared/bbb-api-url";

const loggerCtx = "BbbServerService";

export interface CreateBbbServerInput {
  name: string;
  apiUrl: string;
  apiSecret: string;
  maxLoad?: number;
  capacity?: number;
}

export interface UpdateBbbServerInput {
  name?: string;
  apiUrl?: string;
  apiSecret?: string;
  maxLoad?: number;
  capacity?: number;
  enabled?: boolean;
}

@Injectable()
export class BbbServerService {
  constructor(
    private readonly connection: TransactionalConnection,
    private readonly encryptionService: BbbEncryptionService,
    private readonly ctxService: RequestContextService,
    private readonly bbbApiService: BbbApiService,
    private readonly opsAlert: BbbOpsAlertService,
  ) {}

  async findAll(
    ctx: RequestContext,
    options?: { skip?: number; take?: number },
  ): Promise<{ items: BbbServer[]; totalItems: number }> {
    const take = Math.min(Math.max(options?.take ?? 25, 1), 100);
    const skip = Math.max(options?.skip ?? 0, 0);
    const [items, totalItems] = await this.connection
      .getRepository(ctx, BbbServer)
      .findAndCount({
        order: { createdAt: "ASC" },
        skip,
        take,
      });
    return { items, totalItems };
  }

  async findById(ctx: RequestContext, id: ID): Promise<BbbServer | null> {
    return this.connection
      .getRepository(ctx, BbbServer)
      .findOne({ where: { id } });
  }

  /**
   * Returns the server with the encryptedApiSecret field populated.
   * Only use this when you need to make API calls.
   */
  async findByIdWithSecret(
    ctx: RequestContext,
    id: ID,
  ): Promise<BbbServer | null> {
    return this.connection
      .getRepository(ctx, BbbServer)
      .createQueryBuilder("server")
      .addSelect("server.encryptedApiSecret")
      .where("server.id = :id", { id })
      .getOne();
  }

  /**
   * @deprecated Use BbbServerSelectionService.selectServer() instead.
   * Kept for backward compatibility — delegates to the selection service.
   */
  async selectBestServer(ctx: RequestContext): Promise<BbbServer | null> {
    return this.connection
      .getRepository(ctx, BbbServer)
      .createQueryBuilder("server")
      .addSelect("server.encryptedApiSecret")
      .where("server.enabled = :enabled", { enabled: true })
      .andWhere("server.healthy = :healthy", { healthy: true })
      .andWhere("server.currentLoad < server.maxLoad")
      .orderBy("server.currentLoad", "ASC")
      .getOne();
  }

  async create(
    ctx: RequestContext,
    input: CreateBbbServerInput,
  ): Promise<BbbServer> {
    const server = new BbbServer({
      name: input.name,
      apiUrl: normalizeBbbApiUrl(input.apiUrl),
      encryptedApiSecret: this.encryptionService.encrypt(input.apiSecret),
      maxLoad: input.maxLoad ?? 100,
      capacity: input.capacity ?? 200,
    });
    return this.connection.getRepository(ctx, BbbServer).save(server);
  }

  async update(
    ctx: RequestContext,
    id: ID,
    input: UpdateBbbServerInput,
  ): Promise<BbbServer> {
    const server = await this.connection.getEntityOrThrow(ctx, BbbServer, id);
    if (input.name !== undefined) server.name = input.name;
    if (input.apiUrl !== undefined)
      server.apiUrl = normalizeBbbApiUrl(input.apiUrl);
    if (input.apiSecret !== undefined) {
      server.encryptedApiSecret = this.encryptionService.encrypt(
        input.apiSecret,
      );
    }
    if (input.maxLoad !== undefined) server.maxLoad = input.maxLoad;
    if (input.capacity !== undefined) server.capacity = input.capacity;
    if (input.enabled !== undefined) server.enabled = input.enabled;
    return this.connection.getRepository(ctx, BbbServer).save(server);
  }

  async markHealthy(
    ctx: RequestContext,
    id: ID,
    healthy: boolean,
  ): Promise<void> {
    await this.connection.getRepository(ctx, BbbServer).update(id, {
      healthy,
      lastHealthCheckAt: new Date(),
    });
  }

  async delete(ctx: RequestContext, id: ID): Promise<void> {
    await this.connection.getRepository(ctx, BbbServer).delete(id);
  }

  /**
   * Periodic signed health probe — `bbb-server-health` task (every 5 min).
   * No health job existed before this (jobs/ held only reconciliation,
   * capacity-alert, daily-allowance, metering and metering-prune), and
   * nothing in the codebase ever wrote `healthy = true`: a single
   * markHealthy(false) from the config/consumption paths was permanent —
   * `updateBbbServer` cannot write `healthy`. This probe is both the
   * detection and the recovery path:
   *
   *  - one signed read-only `getMeetings` per ENABLED server;
   *  - SUCCESS → `healthy = true` (+ `lastHealthCheckAt` stamp) — recovers
   *    a server previously flagged by this probe or by a failure streak;
   *  - ANY typed BBB error (unavailable / rejected / misconfigured /
   *    notFound) → `healthy = false` + de-duplicated ops alert —
   *    `bbb-server-config` for rejected/misconfigured (same family as
   *    flagServerConfigProblem), `bbb-server-health` otherwise. A probe
   *    expects SUCCESS; the next passing probe (≤5 min) restores the
   *    server, and BbbOpsAlertService dedupes so flapping alerts once
   *    per hour per server.
   * Advisory: failures are logged, never thrown — the task cannot be
   * tripped by one bad server.
   */
  async runHealthProbe(): Promise<{
    probed: number;
    flagged: number;
    recovered: number;
  }> {
    const ctx = await this.ctxService.create({ apiType: "admin" });
    const servers = await this.connection
      .getRepository(ctx, BbbServer)
      .createQueryBuilder("server")
      .addSelect("server.encryptedApiSecret")
      .where("server.enabled = :enabled", { enabled: true })
      .getMany();

    let flagged = 0;
    let recovered = 0;
    for (const server of servers) {
      try {
        await this.bbbApiService.getMeetings(server);
        if (!server.healthy) recovered++;
        await this.markHealthy(ctx, server.id, true);
      } catch (err) {
        flagged++;
        await this.markHealthy(ctx, server.id, false);
        const config =
          err instanceof BbbMisconfiguredError ||
          err instanceof BbbRejectedError;
        this.opsAlert.notify(
          config ? "bbb-server-config" : "bbb-server-health",
          `server-${String(server.id)}`,
          `BBB health probe failed for "${server.name}": ${(err as Error).message}`.substring(
            0,
            300,
          ),
          {
            serverId: String(server.id),
            messageKey: (err as { messageKey?: string }).messageKey ?? "unknown",
          },
        );
        Logger.warn(
          `Health probe failed for BBB server ${String(server.id)}: ${(err as Error).message}`,
          loggerCtx,
        );
      }
    }
    return { probed: servers.length, flagged, recovered };
  }
}
