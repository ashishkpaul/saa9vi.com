import { PluginError, PluginErrorCode } from '../../../common/plugin-error';
import { Injectable, Logger, Inject } from '@nestjs/common';
import * as crypto from 'crypto';
import Redis from 'ioredis';

export interface CheckoutLock {
  orderCode: string;
  lockedAt: number;
  ttlSeconds: number;
}

interface StoredCheckoutLock extends CheckoutLock {
  token: string;
}

const RELEASE_SCRIPT = `
local lock = redis.call("get", KEYS[1])
if not lock then
  return 0
end
local decoded = cjson.decode(lock)
if decoded.token == ARGV[1] then
  return redis.call("del", KEYS[1])
else
  return 0
end
`;

const TTL_SECONDS = 60;

@Injectable()
export class CheckoutLockService {
  private readonly logger = new Logger(CheckoutLockService.name);
  private readonly ownedTokens = new Map<string, string>();

  constructor(@Inject('REDIS') private readonly redis: Redis) {}

  /**
   * Acquires a distributed lock for an order checkout.
   *
   * Uses Redis SET with NX (set if not exists) and EX (expire) options.
   * TTL is strictly 60 seconds to prevent abandoned checkouts from locking orders forever.
   *
   * @param orderCode The order code to lock
   * @returns true if lock was acquired, false if already locked
   */
  async acquire(orderCode: string): Promise<boolean> {
    const token = await this.acquireToken(orderCode);
    if (!token) {
      return false;
    }
    this.ownedTokens.set(orderCode, token);
    return true;
  }

  /**
   * Releases a distributed lock for an order checkout.
   *
   * @param orderCode The order code to unlock
   * @returns true if lock was released, false if lock didn't exist or was no longer owned
   */
  async release(orderCode: string): Promise<boolean> {
    const token = this.ownedTokens.get(orderCode);
    if (!token) {
      this.logger.warn(`Checkout lock NOT released for order ${orderCode} — no owned token found`);
      return false;
    }
    const released = await this.releaseToken(orderCode, token);
    if (released) {
      this.ownedTokens.delete(orderCode);
    }
    return released;
  }

  /**
   * Checks if an order checkout is currently locked.
   *
   * @param orderCode The order code to check
   * @returns true if locked, false if not locked
   */
  async isLocked(orderCode: string): Promise<boolean> {
    try {
      return (await this.redis.exists(this.key(orderCode))) === 1;
    } catch (error) {
      this.logger.error(`Failed to check checkout lock for order ${orderCode}:`, error);
      return false;
    }
  }

  /**
   * Gets the lock information for an order checkout.
   *
   * @param orderCode The order code to get lock info for
   * @returns CheckoutLock object if locked, null if not locked
   */
  async getLockInfo(orderCode: string): Promise<CheckoutLock | null> {
    try {
      const result = await this.redis.get(this.key(orderCode));
      if (!result) {
        return null;
      }
      const lock = JSON.parse(result) as StoredCheckoutLock;
      return {
        orderCode: lock.orderCode,
        lockedAt: lock.lockedAt,
        ttlSeconds: lock.ttlSeconds,
      };
    } catch (error) {
      this.logger.error(`Failed to get checkout lock info for order ${orderCode}:`, error);
      return null;
    }
  }

  /**
   * Extends the TTL of an existing lock.
   *
   * @param orderCode The order code to extend lock for
   * @param ttlSeconds New TTL in seconds (default: 60)
   * @returns true if lock was extended, false if lock didn't exist
   */
  async extend(orderCode: string, ttlSeconds: number = TTL_SECONDS): Promise<boolean> {
    try {
      const result = await this.redis.expire(this.key(orderCode), ttlSeconds);
      return result === 1;
    } catch (error) {
      this.logger.error(`Failed to extend checkout lock for order ${orderCode}:`, error);
      return false;
    }
  }

  /**
   * Acquires a lock with automatic cleanup on error.
   *
   * This is a convenience method that wraps acquire/release in a try/finally block.
   *
   * @param orderCode The order code to lock
   * @param fn The function to execute while holding the lock
   * @returns The result of the function
   */
  async withLock<T>(orderCode: string, fn: () => Promise<T>): Promise<T> {
    const token = await this.acquireToken(orderCode);
    if (!token) {
      throw new PluginError(PluginErrorCode.CHECKOUT_LOCK_HELD, `Checkout lock already held for order: ${orderCode}`);
    }

    try {
      return await fn();
    } finally {
      await this.releaseToken(orderCode, token);
    }
  }

  private async acquireToken(orderCode: string): Promise<string | null> {
    const lockKey = this.key(orderCode);
    const token = crypto.randomUUID();
    const lockValue: StoredCheckoutLock = {
      orderCode,
      lockedAt: Date.now(),
      ttlSeconds: TTL_SECONDS,
      token,
    };

    try {
      const result = await this.redis.set(lockKey, JSON.stringify(lockValue), 'EX', TTL_SECONDS, 'NX');
      const acquired = result === 'OK';

      if (acquired) {
        this.logger.verbose(`Checkout lock acquired for order: ${orderCode}`);
        return token;
      } else {
        this.logger.verbose(`Checkout lock already held for order: ${orderCode}`);
      }

      return null;
    } catch (error) {
      this.logger.error(`Failed to acquire checkout lock for order ${orderCode}:`, error);
      return null;
    }
  }

  private async releaseToken(orderCode: string, token: string): Promise<boolean> {
    const lockKey = this.key(orderCode);

    try {
      const result = await this.redis.eval(RELEASE_SCRIPT, 1, lockKey, token);
      const released = result === 1;

      if (released) {
        this.logger.verbose(`Checkout lock released for order: ${orderCode}`);
      } else {
        this.logger.warn(`Checkout lock NOT released for order ${orderCode} — token mismatch or already expired`);
      }

      return released;
    } catch (error) {
      this.logger.error(`Failed to release checkout lock for order ${orderCode}:`, error);
      return false;
    }
  }

  private key(orderCode: string): string {
    return `checkout:lock:${orderCode}`;
  }
}
