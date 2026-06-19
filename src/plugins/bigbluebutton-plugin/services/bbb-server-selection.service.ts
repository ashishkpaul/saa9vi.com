import { Injectable, Logger } from "@nestjs/common";
import { RequestContext, TransactionalConnection } from "@vendure/core";
import { BbbServer } from "../entities/bbb-server.entity";

const loggerCtx = "BbbServerSelectionService";

/**
 * Owns the server-selection algorithm. Decoupled from provisioning so the
 * strategy can be swapped (weighted, region-aware, cost-optimised) without
 * touching BbbMeetingService or BbbRoomService.
 *
 * V1 strategy: healthy + enabled + not at capacity, ordered by lowest load.
 * Small random jitter breaks ties when all servers have equal load.
 */
@Injectable()
export class BbbServerSelectionService {
  constructor(private readonly connection: TransactionalConnection) {}

  /**
   * Returns the best available server with encryptedApiSecret pre-loaded,
   * or null if no healthy server is available.
   */
  async selectServer(ctx: RequestContext): Promise<BbbServer | null> {
    const candidates = await this.connection
      .getRepository(ctx, BbbServer)
      .createQueryBuilder("server")
      .addSelect("server.encryptedApiSecret")
      .where("server.enabled = :enabled", { enabled: true })
      .andWhere("server.healthy = :healthy", { healthy: true })
      .andWhere("server.currentLoad < server.maxLoad")
      .orderBy("server.currentLoad", "ASC")
      .getMany();

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
}
