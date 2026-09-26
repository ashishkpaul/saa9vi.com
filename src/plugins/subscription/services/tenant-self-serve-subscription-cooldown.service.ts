import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import Redis from "ioredis";

export const TENANT_SELF_SERVE_PLAN_CHANGE_COOLDOWN_SECONDS = 300;

const KEY_PREFIX = "subscription:self-serve:plan-change:";

/**
 * Cross-request cooldown for tenant self-serve subscription plan changes.
 *
 * ADR-046 / decision 3:
 * - Redis SET NX EX is the inter-request cooldown primitive.
 * - The key is scoped to the resolved tenant channel.
 * - No DB transaction is held across the provider HTTP call.
 * - Failure to reach Redis is fail-closed: the billing mutation is rejected.
 *
 * Billing lifecycle mutations must never bypass their abuse/idempotency guard.
 */
@Injectable()
export class TenantSelfServeSubscriptionCooldownService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TenantSelfServeSubscriptionCooldownService.name);
  private redis: Redis | null = null;

  constructor() {
    const host = process.env.REDIS_HOST;
    if (!host) return;

    const port = Number(process.env.REDIS_PORT ?? 6379);
    const password = process.env.REDIS_PASSWORD || undefined;

    this.redis = new Redis({
      host,
      port,
      password,
      lazyConnect: true,
      enableOfflineQueue: false,
      maxRetriesPerRequest: 1,
      retryStrategy: (times: number) => (times > 2 ? null : Math.min(250 * 2 ** (times - 1), 1000)),
    });

    this.redis.on("error", (err) => {
      this.logger.error(`Redis error: ${err.message}`);
    });
  }

  async onModuleInit(): Promise<void> {
    if (!this.redis) {
      this.logger.warn(
        "Tenant self-serve subscription cooldown is unavailable: REDIS_HOST is not configured. " +
          "Billing mutations will fail closed.",
      );
      return;
    }

    try {
      await this.redis.connect();
      this.logger.log("Tenant self-serve subscription cooldown Redis connected");
    } catch (err) {
      this.logger.error(
        `Tenant self-serve subscription cooldown Redis unavailable: ${err instanceof Error ? err.message : String(err)}. ` +
          "Billing mutations will fail closed.",
      );
      try {
        this.redis.disconnect();
      } catch {}
      this.redis = null;
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (!this.redis) return;
    try {
      await this.redis.quit();
    } catch (err) {
      this.logger.warn(
        `Redis quit failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /** Acquire the five-minute cooldown for a tenant channel. */
  async acquire(channelId: string): Promise<void> {
    if (!channelId) {
      throw new Error("Tenant channel is required for self-serve subscription changes");
    }
    if (!this.redis) {
      throw new Error(
        "Tenant self-serve subscription changes are temporarily unavailable because Redis " +
          "cooldown protection is unavailable",
      );
    }

    try {
      const result = await this.redis.set(
        `${KEY_PREFIX}${channelId}`,
        "1",
        "EX",
        TENANT_SELF_SERVE_PLAN_CHANGE_COOLDOWN_SECONDS,
        "NX",
      );

      if (result !== "OK") {
        throw new Error(
          "A subscription plan change was already requested for this tenant. " +
            "Please wait for the cooldown period before trying again.",
        );
      }
    } catch (err) {
      if (err instanceof Error && /already requested for this tenant/.test(err.message)) {
        throw err;
      }
      throw new Error(
        "Tenant self-serve subscription changes are temporarily unavailable because Redis " +
          "cooldown protection is unavailable",
      );
    }
  }
}
