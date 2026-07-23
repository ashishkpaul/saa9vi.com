import type { Request, Response, NextFunction } from "express";
import rateLimit from "express-rate-limit";

/**
 * IP-based rate limiter for the BBB webhook endpoint.
 *
 * BBB server IPs should be allowlisted by setting the `BBB_WEBHOOK_ALLOWED_IPS`
 * environment variable (comma-separated). Unknown IPs are limited to 100 req/min.
 *
 * See ADR v1.7 §13 Production Readiness, SEC-004.
 */
export const bbbWebhookRateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, error: "Too many requests — rate limit exceeded" },
  skip: (req) => {
    // Allowlist: skip rate limiting for known BBB server IPs
    const allowedIps = (process.env.BBB_WEBHOOK_ALLOWED_IPS || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (allowedIps.length === 0) return false;
    const clientIp = req.ip || req.socket?.remoteAddress || "";
    return allowedIps.includes(clientIp);
  },
});

/**
 * Creates an Express rate limiter middleware for a specific Shop API mutation.
 * Since all GraphQL mutations share the same `/shop-api` POST route, this
 * middleware inspects the request body to identify the operation name and
 * applies rate limiting only to the specified mutation.
 */
function createMutationRateLimiter(
  mutationName: string,
  maxRequests: number,
  windowMinutes: number = 1,
) {
  return rateLimit({
    windowMs: windowMinutes * 60 * 1000,
    max: maxRequests,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
      errors: [
        {
          message: `Rate limit exceeded for ${mutationName}. Try again later.`,
          extensions: { code: "RATE_LIMITED" },
        },
      ],
    },
    keyGenerator: (req) => {
      const customerId = (req as any).activeUserId;
      return customerId
        ? `customer:${customerId}`
        : req.ip || req.socket?.remoteAddress || "unknown";
    },
    skip: (req) => {
      // Only apply when this specific mutation is being called
      const body = req.body as
        | { query?: string; operationName?: string }
        | undefined;
      if (!body?.query && !body?.operationName) return true;
      const operationName = body.operationName || "";
      const query = body.query || "";
      return !query.includes(mutationName) && operationName !== mutationName;
    },
  });
}

/**
 * Express middleware that applies per-mutation rate limiting to the Shop API.
 *
 * Inspects the GraphQL request body to identify the operation name and
 * applies the appropriate rate limiter:
 *   - registerForTrial: 10 req/min per customer
 *   - bbbJoinMeeting: 10 req/min per customer
 *   - registerNewTenant: 5 req/hour per IP (no authenticated customer at registration time)
 *
 * All other operations pass through unmodified.
 */
export const shopApiRateLimiter = (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  const body = req.body as
    | { query?: string; operationName?: string }
    | undefined;
  if (!body?.query && !body?.operationName) {
    next();
    return;
  }

  const operationName = body.operationName || "";
  const query = body.query || "";

  // registerForTrial: 10 req/min per customer
  if (query.includes("registerForTrial") || operationName === "registerForTrial") {
    const limiter = createMutationRateLimiter("registerForTrial", 10, 1);
    limiter(req, res, next);
    return;
  }

  // bbbJoinMeeting: 10 req/min per customer
  if (query.includes("bbbJoinMeeting") || operationName === "bbbJoinMeeting") {
    const limiter = createMutationRateLimiter("bbbJoinMeeting", 10, 1);
    limiter(req, res, next);
    return;
  }

  // registerNewTenant: 5 req/hour per IP
  // IP-keyed because no authenticated customer exists at registration time.
  // Uses a 60-minute window to prevent rapid-fire tenant creation from a single IP.
  if (query.includes("registerNewTenant") || operationName === "registerNewTenant") {
    const limiter = createMutationRateLimiter("registerNewTenant", 5, 60);
    limiter(req, res, next);
    return;
  }

  // No matching limiter — pass through
  next();
};
