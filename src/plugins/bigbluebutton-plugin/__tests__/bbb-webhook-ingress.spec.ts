/**
 * W3 ingress preflight — NO webhook route code (the real delivery fixture is
 * still pending; this file only pins two platform facts the route depends on).
 *
 * P1 — Raw bytes for form bodies. BBB's callback checksum is
 *      `sha<1|256|384|512>(callbackURL + body + sharedSecret)` over the EXACT
 *      bytes BBB sent (`application/x-www-form-urlencoded`); a parsed and
 *      re-serialized object can never verify. Production boots with
 *      `nestApplicationOptions.rawBody: true` (src/index.ts) — proven for
 *      JSON by the Razorpay suite — so this probe answers the urlencoded
 *      half through the same NestFactory path production uses. If it fails,
 *      W3 needs a route-scoped raw text parser that never re-serializes.
 *
 * P2 — Rate-limiter path matching. Vendure registers `apiOptions.middleware`
 *      through `consumer.apply(...).forRoutes(route)`
 *      (node_modules/@vendure/core/dist/app.module.js:60) — the exact Nest
 *      mechanism reproduced here with the REAL limiter instance. The limiter
 *      must throttle the future per-server callback path
 *      `/bbb/webhook/<serverId>` (W3), not just the legacy bare path, or
 *      per-server deliveries arrive unthrottled. `BBB_WEBHOOK_RATE_LIMIT_ROUTES`
 *      is the single source of truth shared with `BigBlueButtonPlugin`.
 */
import {
  Controller,
  HttpCode,
  type INestApplication,
  MiddlewareConsumer,
  Module,
  type NestModule,
  Post,
  Req,
} from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  BBB_WEBHOOK_RATE_LIMIT_ROUTES,
  bbbWebhookRateLimiter,
} from "../config/rate-limiter.middleware";

/** A realistic BBB callback body (form-encoded; `event` carries JSON). */
const FORM_BODY =
  "event=%7B%22data%22%3A%7B%22id%22%3A%22meeting-ended%22%7D%7D&timestamp=1712345678901";
const PARSED_EVENT = '{"data":{"id":"meeting-ended"}}';

function postForm(base: string, path: string): Promise<Response> {
  return fetch(`${base}${path}`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: FORM_BODY,
  });
}

interface Echo {
  hasRawBody: boolean;
  rawBodyText: string | null;
  parsedEvent: string | null;
}

function echo(req: any): Echo {
  return {
    hasRawBody: Buffer.isBuffer(req.rawBody),
    rawBodyText: req.rawBody ? req.rawBody.toString("utf8") : null,
    parsedEvent:
      typeof req.body?.event === "string" ? req.body.event : null,
  };
}

/** The future W3 route shape: bare path + one serverId segment. */
@Controller("bbb/webhook")
class WebhookPathController {
  @Post()
  @HttpCode(200)
  bare(@Req() req: any): Echo {
    return echo(req);
  }

  @Post(":serverId")
  @HttpCode(200)
  perServer(@Req() req: any): Echo {
    return echo(req);
  }
}

/** Off-limiter path so the P1 probe never touches the rate-limit window. */
@Controller("probe")
class RawBodyController {
  @Post("raw")
  @HttpCode(200)
  raw(@Req() req: any): Echo {
    return echo(req);
  }
}

@Module({ controllers: [WebhookPathController, RawBodyController] })
class IngressProbeModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    // Same registration mechanism and same limiter instance as production.
    consumer
      .apply(bbbWebhookRateLimiter)
      .forRoutes(...[...BBB_WEBHOOK_RATE_LIMIT_ROUTES]);
  }
}

describe("W3 ingress preflight (raw body + webhook rate-limit path)", () => {
  let app: INestApplication;
  let base: string;

  beforeAll(async () => {
    vi.stubEnv("BBB_WEBHOOK_ALLOWED_IPS", "");
    app = await NestFactory.create(IngressProbeModule, {
      logger: false,
      rawBody: true,
    });
    await app.listen(0, "127.0.0.1");
    const address = app.getHttpServer().address() as { port: number };
    base = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await app?.close();
    vi.unstubAllEnvs();
  });

  it("P1: rawBody is populated byte-exact for application/x-www-form-urlencoded", async () => {
    const res = await postForm(base, "/probe/raw");
    expect(res.status).toBe(200);
    const json = (await res.json()) as Echo;
    expect(
      json.hasRawBody,
      "req.rawBody not populated for a form body — W3 needs a route-scoped raw text parser that never re-serializes",
    ).toBe(true);
    // Byte-exact: the checksum is over THESE bytes, not a re-serialization.
    expect(json.rawBodyText).toBe(FORM_BODY);
    // ...and the parsed view must still be available to the handler.
    expect(json.parsedEvent).toBe(PARSED_EVENT);
  });

  it("P2: the limiter throttles the W3 per-server path /bbb/webhook/<serverId>", async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 101; i++) {
      const res = await postForm(base, "/bbb/webhook/srv-preflight");
      statuses.push(res.status);
      await res.arrayBuffer();
    }
    expect(statuses[0], "the first delivery must pass").toBe(200);
    expect(statuses[99], "the 100th request inside the window must pass").toBe(
      200,
    );
    expect(
      statuses[100],
      "the 101st must be throttled — BBB_WEBHOOK_RATE_LIMIT_ROUTES must cover /bbb/webhook/<serverId>",
    ).toBe(429);
  });

  it("P2b: the legacy bare path /bbb/webhook stays covered by the same limiter", async () => {
    // P2 just exhausted the shared per-IP window: the plugin registers ONE
    // limiter instance across all its routes, so the store is shared — the
    // same is true in production. A 429 here proves the bare route still
    // passes THROUGH the limiter; a 200 would mean the widening dropped it.
    const res = await postForm(base, "/bbb/webhook");
    await res.arrayBuffer();
    expect(res.status).toBe(429);
  });
});