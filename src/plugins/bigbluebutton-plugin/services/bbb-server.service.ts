import { Injectable } from "@nestjs/common";
import { ID, RequestContext, TransactionalConnection } from "@vendure/core";
import { BbbServer } from "../entities/bbb-server.entity";
import { BbbEncryptionService } from "./bbb-encryption.service";

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
      apiUrl: input.apiUrl.replace(/\/$/, ""),
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
      server.apiUrl = input.apiUrl.replace(/\/$/, "");
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
}
