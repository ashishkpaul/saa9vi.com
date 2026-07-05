import { Injectable, OnModuleDestroy } from "@nestjs/common";
import { Logger } from "@vendure/core";
import Redis from "ioredis";

const loggerCtx = "DomainChannelResolver";

/**
 * Manages the Redis mapping between custom domains and channel tokens.
 *
 * Key format: `channel-token:{customDomain}` → channelToken
 *
 * When a TenantProfile's customDomain is set or updated, the corresponding
 * Redis key is written. When it's removed, the key is deleted.
 *
 * In Next.js middleware (or any reverse proxy), the hostname is resolved
 * against Redis to determine the correct X-Vendure-Token header.
 *
 * See ADR v1.7 §13 Production Readiness, SEC-006.
 */
@Injectable()
export class DomainChannelResolverService implements OnModuleDestroy {
  private redis: Redis | null = null;
  private readonly keyPrefix = "channel-token:";

  constructor() {
    this.initRedis();
  }

  private initRedis(): void {
    const host = process.env.REDIS_HOST || "localhost";
    const port = Number(process.env.REDIS_PORT) || 6379;
    const password = process.env.REDIS_PASSWORD || undefined;

    try {
      this.redis = new Redis({
        host,
        port,
        password,
        maxRetriesPerRequest: 3,
        retryStrategy: (times) => {
          if (times > 3) {
            Logger.warn(
              `Redis connection failed after ${times} retries — domain→channel resolution will be unavailable`,
              loggerCtx,
            );
            return null; // stop retrying
          }
          return Math.min(times * 200, 2000);
        },
        lazyConnect: true,
      });

      this.redis.on("error", (err) => {
        Logger.error(
          `Redis connection error: ${(err as Error).message}`,
          loggerCtx,
        );
      });
    } catch (err) {
      Logger.warn(
        `Failed to initialize Redis for DomainChannelResolver: ${(err as Error).message}`,
        loggerCtx,
      );
    }
  }

  /**
   * Sets the Redis mapping: customDomain → channelToken.
   * Called when TenantProfile.customDomain is set or updated.
   */
  async setMapping(customDomain: string, channelToken: string): Promise<void> {
    if (!this.redis) return;
    try {
      await this.redis.set(
        `${this.keyPrefix}${customDomain}`,
        channelToken,
        "EX",
        86400 * 7, // 7-day TTL — refreshed on each update
      );
      Logger.debug(
        `Domain→channel mapping set: ${customDomain} → ${channelToken}`,
        loggerCtx,
      );
    } catch (err) {
      Logger.error(
        `Failed to set Redis mapping for ${customDomain}: ${(err as Error).message}`,
        loggerCtx,
      );
    }
  }

  /**
   * Removes the Redis mapping for a custom domain.
   * Called when TenantProfile.customDomain is cleared or changed.
   */
  async removeMapping(customDomain: string): Promise<void> {
    if (!this.redis) return;
    try {
      await this.redis.del(`${this.keyPrefix}${customDomain}`);
      Logger.debug(
        `Domain→channel mapping removed: ${customDomain}`,
        loggerCtx,
      );
    } catch (err) {
      Logger.error(
        `Failed to remove Redis mapping for ${customDomain}: ${(err as Error).message}`,
        loggerCtx,
      );
    }
  }

  /**
   * Resolves a custom domain to a channel token.
   * Used by the Express middleware to set X-Vendure-Token.
   */
  async resolveChannelToken(customDomain: string): Promise<string | null> {
    if (!this.redis) return null;
    try {
      return await this.redis.get(`${this.keyPrefix}${customDomain}`);
    } catch (err) {
      Logger.error(
        `Failed to resolve domain ${customDomain}: ${(err as Error).message}`,
        loggerCtx,
      );
      return null;
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.redis) {
      await this.redis.quit();
      this.redis = null;
    }
  }
}
