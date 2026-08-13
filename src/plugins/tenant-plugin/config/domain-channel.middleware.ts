import type { Request, Response, NextFunction } from "express";
import Redis from "ioredis";
const keyPrefix = "channel-token:";

let redis: Redis | null = null;

function getRedis(): Redis | null {
  if (!process.env.REDIS_HOST) return null;
  if (redis) return redis;
  const host = process.env.REDIS_HOST;
  const port = Number(process.env.REDIS_PORT) || 6379;
  const password = process.env.REDIS_PASSWORD || undefined;

  try {
    redis = new Redis({
      host,
      port,
      password,
      maxRetriesPerRequest: 1,
      retryStrategy: () => null, // don't retry — fail fast
      lazyConnect: true,
    });
    redis.on("error", () => {}); // suppress connection errors
    return redis;
  } catch {
    return null;
  }
}

/**
 * Express middleware that resolves the incoming hostname to a channel token
 * via Redis, and sets the X-Vendure-Token header on the request.
 *
 * This enables custom domain tenants (e.g. mehta.saa9vi.com) to be routed
 * to the correct channel without requiring the storefront to explicitly
 * pass the channel token.
 *
 * The middleware is non-blocking — if Redis is unavailable or the domain
 * is not found, the request passes through unmodified (the default channel
 * will be used).
 *
 * See ADR v1.7 §13 Production Readiness, SEC-006.
 */
export function domainChannelMiddleware(
  req: Request,
  _res: Response,
  next: NextFunction,
): void {
  const hostname = req.hostname;
  if (!hostname || hostname === "localhost" || hostname === "127.0.0.1") {
    next();
    return;
  }

  const r = getRedis();
  if (!r) {
    next();
    return;
  }

  r.get(`${keyPrefix}${hostname}`)
    .then((channelToken) => {
      if (channelToken) {
        // Set the channel token header for Vendure to pick up
        req.headers["x-vendure-token"] = channelToken;
      }
      next();
    })
    .catch(() => {
      next();
    });
}
