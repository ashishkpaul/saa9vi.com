import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import * as crypto from "crypto";
import Redis from "ioredis";
import type { ID } from "@vendure/core";
import { BbbMetricsService } from "./bbb-metrics.service";
import { BBB_PLUGIN_OPTIONS } from "../constants";
import type { BigBlueButtonPluginOptions } from "../types";

const KEY_PREFIX = "bbb:room:lock:";

const RELEASE_SCRIPT = `
local v = redis.call("get", KEYS[1])
if v == ARGV[1] then
  return redis.call("del", KEYS[1])
else
  return 0
end
`;

/**
 * Extension script: extends TTL only if token still matches.
 * Returns 1 if extended, 0 if lock lost / held by another owner.
 */
const EXTEND_SCRIPT = `
local v = redis.call("get", KEYS[1])
if v == ARGV[1] then
  return redis.call("expire", KEYS[1], ARGV[2])
else
  return 0
end
`;

/**
 * Distributed lock for BbbRoom provisioning.
 *
 * Prevents concurrent double-provisioning across multiple server instances.
 * Uses Redis SET NX EX — same pattern as CheckoutLockService.
 *
 * Includes a heartbeat mechanism: while withLock's fn() is running,
 * the lock TTL is periodically extended to prevent expiry during long
 * provisioning operations (>30s).
 *
 * Falls back gracefully (allows provisioning) if Redis is unavailable,
 * so a Redis outage does not hard-block meeting creation.
 *
 * All timing parameters are configurable via BigBlueButtonPluginOptions
 * and can be set in vendure-config.ts or via environment variables.
 */
@Injectable()
export class BbbRoomLockService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BbbRoomLockService.name);
  private redis: Redis | null = null;
  private readonly lockTtlSeconds: number;
  private readonly lockHeartbeatIntervalMs: number;
  private readonly strictMode: boolean;

  constructor(
    private readonly metrics: BbbMetricsService,
    @Inject(BBB_PLUGIN_OPTIONS)
    private readonly options: BigBlueButtonPluginOptions,
  ) {
    this.lockTtlSeconds = options.lockTtlSeconds ?? 30;
    this.lockHeartbeatIntervalMs = options.lockHeartbeatIntervalMs ?? 10_000;
    this.strictMode =
      options.roomLockStrict ?? process.env.BBB_ROOM_LOCK_STRICT === "true";

    const host = options.redisHost ?? process.env.REDIS_HOST;
    if (!host) {
      this.redis = null as any;
      return;
    }
    const port = options.redisPort ?? Number(process.env.REDIS_PORT ?? 6379);
    const password = options.redisPassword ?? process.env.REDIS_PASSWORD;

    this.redis = new Redis({
      host,
      port,
      password,

      lazyConnect: true,
      enableOfflineQueue: false,

      retryStrategy: (times: number) => {
        if (times > 3) {
          return null; // Stop retrying
        }
        const delay = Math.min(100 * 2 ** (times - 1), 2000);
        this.logger.warn(`Redis retry #${times}: reconnecting in ${delay}ms`);
        return delay;
      },

      maxRetriesPerRequest: 3,
    });

    this.redis.on("error", (err) => {
      this.logger.error(`BBB room lock Redis error: ${err.message}`);
    });

    this.redis.on("connect", () => {
      this.logger.log("BBB room lock Redis connected");
    });

    this.redis.on("ready", () => {
      this.logger.log("BBB room lock Redis ready");
    });

    this.redis.on("close", () => {
      this.logger.warn("BBB room lock Redis connection closed");
    });

    this.redis.on("reconnecting", () => {
      this.logger.warn("BBB room lock Redis reconnecting");
    });
  }

  async onModuleInit() {
    if (!this.redis) return;
    try {
      await this.redis.connect();
      this.logger.log("BBB room lock Redis initialization completed");
    } catch (err) {
      this.logger.warn(
        `BBB room lock Redis unreachable: ${(err as Error).message}. Operating in fallback mode.`,
      );
      try {
        this.redis.disconnect();
      } catch {}
      this.redis = null as any;
      if (this.strictMode) {
        throw err;
      }
    }
  }

  async onModuleDestroy() {
    if (!this.redis) return;
    try {
      await this.redis.quit();
    } catch (err) {
      this.logger.warn(`Redis quit failed: ${(err as Error).message}`);
    }
  }

  /**
   * Acquires a distributed lock for the given roomId.
   * Returns the lock token if acquired, null if already locked.
   */
  async acquire(roomId: ID): Promise<string | null> {
    const token = crypto.randomUUID();

    if (!this.redis) {
      if (this.strictMode) {
        this.logger.error(
          `Room lock Redis unavailable in strict mode for room ${roomId}`,
        );
        throw new Error(
          "Room provisioning is temporarily unavailable because Redis locking is required",
        );
      }
      return token;
    }

    try {
      const result = await this.redis.set(
        this.key(roomId),
        token,
        "EX",
        this.lockTtlSeconds,
        "NX",
      );

      if (result === "OK") {
        this.metrics.recordLockAcquired();
        this.logger.verbose(`Room lock acquired: ${roomId}`);
        return token;
      }

      this.metrics.recordLockContention();
      this.logger.verbose(`Room lock already held: ${roomId}`);
      return null;
    } catch (err) {
      this.metrics.recordLockRedisFailure();

      if (this.strictMode) {
        this.logger.error(
          `Room lock Redis unavailable in strict mode for room ${roomId}: ${(err as Error).message}`,
        );
        throw new Error(
          "Room provisioning is temporarily unavailable because Redis locking is required",
        );
      }

      this.logger.warn(
        `Room lock Redis unavailable, failing open for room ${roomId}: ${(err as Error).message}`,
      );
      return token;
    }
  }

  /**
   * Releases the lock. Only releases if the token matches
   * (prevents releasing a lock acquired by another instance after TTL expiry).
   */
  async release(roomId: ID, token: string): Promise<void> {
    if (!this.redis) return;
    try {
      await this.redis.eval(RELEASE_SCRIPT, 1, this.key(roomId), token);
      this.logger.verbose(`Room lock released: ${roomId}`);
    } catch (err) {
      this.logger.warn(
        `Room lock release failed for room ${roomId}: ${(err as Error).message}`,
      );
    }
  }

  /**
   * Extends the lock TTL.
   * Only extends if the token still matches.
   */
  async extend(
    roomId: ID,
    token: string,
    ttlSeconds?: number,
  ): Promise<boolean> {
    if (!this.redis) return false;
    const ttl = ttlSeconds ?? this.lockTtlSeconds;
    try {
      const result = await this.redis.eval(
        EXTEND_SCRIPT,
        1,
        this.key(roomId),
        token,
        ttl,
      );

      if (result === 1) {
        this.metrics.recordLockHeartbeatExtended();
      } else {
        this.metrics.recordLockHeartbeatFailed();
      }

      return result === 1;
    } catch (err) {
      this.metrics.recordLockHeartbeatFailed();
      this.logger.warn(
        `Lock extend failed for room ${roomId}: ${(err as Error).message}`,
      );
      return false;
    }
  }

  /**
   * Convenience wrapper:
   * acquire → run fn with heartbeat → release.
   *
   * Returns null if lock is already held.
   */
  async withLock<T>(roomId: ID, fn: () => Promise<T>): Promise<T | null> {
    const token = await this.acquire(roomId);

    if (!token) {
      return null;
    }

    const heartbeatTimer = setInterval(() => {
      this.extend(roomId, token).catch(() => {
        // Heartbeat failures are non-fatal
      });
    }, this.lockHeartbeatIntervalMs);

    try {
      return await fn();
    } finally {
      clearInterval(heartbeatTimer);
      await this.release(roomId, token);
    }
  }

  private key(roomId: ID): string {
    return `${KEY_PREFIX}${roomId}`;
  }
}
