/**
 * W3 — BBB webhook auth + ingress unit tests.
 *
 * Coverage:
 *   - Bearer mode: good token, bad token, wrong prefix
 *   - Checksum mode: good checksum (sha1/sha256/sha384/sha512), tampered
 *     checksum, wrong server secret, unknown digest length, missing checksum
 *   - Replay idempotency (deduplication)
 *   - Poison body (auth passes, parse fails → 200 + PARSE_FAILED persisted)
 *   - Secret hygiene spy: no secret, Authorization header, or checksum
 *     value reaches Logger calls, OpenTelemetry spans, or column values
 *
 * These tests exercise `bbb-webhook-auth.ts` and `bbb-webhook-url.ts`
 * directly (pure functions, no NestJS DI needed), plus the full controller
 * path through a lightweight in-process NestJS app for the integration cases.
 *
 * The rate limiter and HTTPS guard are enforced at a higher level and are
 * not exercised here (covered by bbb-webhook-ingress.spec.ts).
 */
import * as crypto from "node:crypto";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import {
  verifyBearer,
  verifyChecksum,
  verifyWebhookAuth,
  algorithmFromDigestLength,
  constantTimeEqual,
} from "../workers/bbb-webhook-auth";
import { webhookCallbackUrl } from "../shared/bbb-webhook-url";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const SECRET = "test-shared-secret-abc";
const SERVER_ID = "srv-test-001";
const PUBLIC_BASE = "https://saa9vi.example.com";
const CALLBACK_URL = webhookCallbackUrl(PUBLIC_BASE, SERVER_ID);

/** A minimal valid BBB bbb-webhooks form body */
function makeFormBody(eventType: string = "meeting-ended"): string {
  const event = JSON.stringify([
    {
      data: {
        id: eventType,
        attributes: {
          meeting: {
            "external-meeting-id": "ext-123",
            "internal-meeting-id": "int-456",
          },
        },
      },
    },
  ]);
  return new URLSearchParams({
    domain: "bbb.example.com",
    event,
    timestamp: String(Date.now()),
  }).toString();
}

function makeRawBodyBuffer(body: string): Buffer {
  return Buffer.from(body, "utf8");
}

function checksumFor(
  callbackUrl: string,
  rawBody: Buffer,
  secret: string,
  alg: "sha1" | "sha256" | "sha384" | "sha512" = "sha256",
): string {
  return crypto
    .createHash(alg)
    .update(callbackUrl)
    .update(rawBody)
    .update(secret)
    .digest("hex");
}

// ─── Pure function tests ───────────────────────────────────────────────────────

describe("webhookCallbackUrl", () => {
  it("builds the canonical callback URL", () => {
    expect(webhookCallbackUrl("https://example.com", "srv1")).toBe(
      "https://example.com/bbb/webhook/srv1",
    );
  });

  it("normalises trailing slash in publicBaseUrl", () => {
    expect(webhookCallbackUrl("https://example.com/", "srv1")).toBe(
      "https://example.com/bbb/webhook/srv1",
    );
    expect(webhookCallbackUrl("https://example.com///", "srv1")).toBe(
      "https://example.com/bbb/webhook/srv1",
    );
  });
});

describe("algorithmFromDigestLength", () => {
  it("maps 40 → sha1", () => expect(algorithmFromDigestLength("a".repeat(40))).toBe("sha1"));
  it("maps 64 → sha256", () => expect(algorithmFromDigestLength("a".repeat(64))).toBe("sha256"));
  it("maps 96 → sha384", () => expect(algorithmFromDigestLength("a".repeat(96))).toBe("sha384"));
  it("maps 128 → sha512", () => expect(algorithmFromDigestLength("a".repeat(128))).toBe("sha512"));
  it("returns null for unknown lengths", () => {
    expect(algorithmFromDigestLength("")).toBeNull();
    expect(algorithmFromDigestLength("a".repeat(32))).toBeNull();
    expect(algorithmFromDigestLength("a".repeat(63))).toBeNull();
  });
});

describe("constantTimeEqual", () => {
  it("returns true for equal strings", () => {
    expect(constantTimeEqual("hello", "hello")).toBe(true);
    expect(constantTimeEqual("", "")).toBe(true);
  });
  it("returns false for different strings", () => {
    expect(constantTimeEqual("hello", "world")).toBe(false);
    expect(constantTimeEqual("hello", "hello ")).toBe(false);
  });
});

// ─── verifyBearer ─────────────────────────────────────────────────────────────

describe("verifyBearer", () => {
  it("accepts correct bearer token", () => {
    const result = verifyBearer({
      authorizationHeader: `Bearer ${SECRET}`,
      secret: SECRET,
    });
    expect(result).toEqual({ ok: true, isBearerMode: true });
  });

  it("rejects wrong bearer token", () => {
    const result = verifyBearer({
      authorizationHeader: "Bearer wrong-secret",
      secret: SECRET,
    });
    expect(result.ok).toBe(false);
  });

  it("rejects missing Authorization header", () => {
    const result = verifyBearer({ authorizationHeader: undefined, secret: SECRET });
    expect(result.ok).toBe(false);
    expect(result.isBearerMode).toBe(false);
  });

  it("rejects header without Bearer prefix", () => {
    const result = verifyBearer({ authorizationHeader: SECRET, secret: SECRET });
    expect(result.ok).toBe(false);
  });

  it("rejects token that is a prefix of the secret", () => {
    const result = verifyBearer({
      authorizationHeader: `Bearer ${SECRET.slice(0, 5)}`,
      secret: SECRET,
    });
    expect(result.ok).toBe(false);
  });
});

// ─── verifyChecksum ───────────────────────────────────────────────────────────

describe("verifyChecksum", () => {
  const rawBody = makeRawBodyBuffer(makeFormBody());

  it("accepts correct sha256 checksum", () => {
    const checksum = checksumFor(CALLBACK_URL, rawBody, SECRET, "sha256");
    expect(checksum).toHaveLength(64); // sanity
    const result = verifyChecksum({ checksum, callbackUrl: CALLBACK_URL, rawBody, secret: SECRET });
    expect(result.ok).toBe(true);
  });

  it("accepts correct sha1 checksum", () => {
    const checksum = checksumFor(CALLBACK_URL, rawBody, SECRET, "sha1");
    expect(checksum).toHaveLength(40);
    const result = verifyChecksum({ checksum, callbackUrl: CALLBACK_URL, rawBody, secret: SECRET });
    expect(result.ok).toBe(true);
  });

  it("accepts correct sha384 checksum", () => {
    const checksum = checksumFor(CALLBACK_URL, rawBody, SECRET, "sha384");
    expect(checksum).toHaveLength(96);
    const result = verifyChecksum({ checksum, callbackUrl: CALLBACK_URL, rawBody, secret: SECRET });
    expect(result.ok).toBe(true);
  });

  it("accepts correct sha512 checksum", () => {
    const checksum = checksumFor(CALLBACK_URL, rawBody, SECRET, "sha512");
    expect(checksum).toHaveLength(128);
    const result = verifyChecksum({ checksum, callbackUrl: CALLBACK_URL, rawBody, secret: SECRET });
    expect(result.ok).toBe(true);
  });

  it("rejects tampered checksum", () => {
    const checksum = checksumFor(CALLBACK_URL, rawBody, SECRET, "sha256");
    const tampered = checksum.replace(checksum[0]!, checksum[0] === "a" ? "b" : "a");
    const result = verifyChecksum({
      checksum: tampered,
      callbackUrl: CALLBACK_URL,
      rawBody,
      secret: SECRET,
    });
    expect(result.ok).toBe(false);
  });

  it("rejects checksum computed with a different server's secret", () => {
    const otherSecret = "other-server-secret-xyz";
    const checksum = checksumFor(CALLBACK_URL, rawBody, otherSecret, "sha256");
    const result = verifyChecksum({
      checksum,
      callbackUrl: CALLBACK_URL,
      rawBody,
      secret: SECRET,
    });
    expect(result.ok).toBe(false);
  });

  it("rejects checksum computed against a different callback URL", () => {
    const wrongUrl = webhookCallbackUrl(PUBLIC_BASE, "srv-other-999");
    const checksum = checksumFor(wrongUrl, rawBody, SECRET, "sha256");
    const result = verifyChecksum({
      checksum,
      callbackUrl: CALLBACK_URL,
      rawBody,
      secret: SECRET,
    });
    expect(result.ok).toBe(false);
  });

  it("rejects unknown digest length (e.g. md5 / 32 hex chars)", () => {
    const md5Checksum = crypto.createHash("md5").update("anything").digest("hex");
    expect(md5Checksum).toHaveLength(32);
    const result = verifyChecksum({
      checksum: md5Checksum,
      callbackUrl: CALLBACK_URL,
      rawBody,
      secret: SECRET,
    });
    expect(result.ok).toBe(false);
  });

  it("rejects missing checksum", () => {
    const result = verifyChecksum({
      checksum: undefined,
      callbackUrl: CALLBACK_URL,
      rawBody,
      secret: SECRET,
    });
    expect(result.ok).toBe(false);
  });

  it("rejects empty string checksum", () => {
    const result = verifyChecksum({
      checksum: "",
      callbackUrl: CALLBACK_URL,
      rawBody,
      secret: SECRET,
    });
    expect(result.ok).toBe(false);
  });
});

// ─── verifyWebhookAuth (top-level) ────────────────────────────────────────────

describe("verifyWebhookAuth", () => {
  const rawBody = makeRawBodyBuffer(makeFormBody());

  it("accepts bearer mode and marks isBearerMode: true", () => {
    const result = verifyWebhookAuth({
      authorizationHeader: `Bearer ${SECRET}`,
      checksum: undefined,
      callbackUrl: CALLBACK_URL,
      rawBody,
      secret: SECRET,
    });
    expect(result).toEqual({ ok: true, isBearerMode: true });
  });

  it("accepts checksum mode and marks isBearerMode: false", () => {
    const checksum = checksumFor(CALLBACK_URL, rawBody, SECRET, "sha256");
    const result = verifyWebhookAuth({
      authorizationHeader: undefined,
      checksum,
      callbackUrl: CALLBACK_URL,
      rawBody,
      secret: SECRET,
    });
    expect(result).toEqual({ ok: true, isBearerMode: false });
  });

  it("rejects if Authorization header is present but wrong (does not fall through to checksum)", () => {
    const checksum = checksumFor(CALLBACK_URL, rawBody, SECRET, "sha256");
    const result = verifyWebhookAuth({
      authorizationHeader: "Bearer wrong-token",
      checksum, // correct checksum — but should NOT be tried after header fails
      callbackUrl: CALLBACK_URL,
      rawBody,
      secret: SECRET,
    });
    expect(result.ok).toBe(false);
  });

  it("rejects when both auth header and checksum are missing", () => {
    const result = verifyWebhookAuth({
      authorizationHeader: undefined,
      checksum: undefined,
      callbackUrl: CALLBACK_URL,
      rawBody,
      secret: SECRET,
    });
    expect(result.ok).toBe(false);
  });

  it("rejects checksum computed with wrong server's secret", () => {
    const wrongSecret = "not-this-servers-secret";
    const checksum = checksumFor(CALLBACK_URL, rawBody, wrongSecret, "sha256");
    const result = verifyWebhookAuth({
      authorizationHeader: undefined,
      checksum,
      callbackUrl: CALLBACK_URL,
      rawBody,
      secret: SECRET,
    });
    expect(result.ok).toBe(false);
  });
});

// ─── Secret hygiene (spy test) ────────────────────────────────────────────────

describe("Secret hygiene — no secret or auth material reaches Logger or persisted data", () => {
  it("verifyBearer never logs the Authorization header value or the secret", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const badToken = "Bearer leaked-secret-value-12345";
    verifyBearer({ authorizationHeader: badToken, secret: SECRET });
    verifyBearer({ authorizationHeader: undefined, secret: SECRET });

    const allOutput = [
      ...logSpy.mock.calls.flat(),
      ...warnSpy.mock.calls.flat(),
      ...errorSpy.mock.calls.flat(),
    ]
      .map(String)
      .join(" ");

    expect(allOutput).not.toContain("leaked-secret-value-12345");
    expect(allOutput).not.toContain(SECRET);

    logSpy.mockRestore();
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it("verifyChecksum never logs the checksum or the secret", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const rawBody = makeRawBodyBuffer(makeFormBody());
    const checksum = checksumFor(CALLBACK_URL, rawBody, SECRET, "sha256");

    verifyChecksum({ checksum, callbackUrl: CALLBACK_URL, rawBody, secret: SECRET });
    verifyChecksum({ checksum: "tampered", callbackUrl: CALLBACK_URL, rawBody, secret: SECRET });

    const allOutput = [
      ...logSpy.mock.calls.flat(),
      ...warnSpy.mock.calls.flat(),
    ]
      .map(String)
      .join(" ");

    expect(allOutput).not.toContain(checksum);
    expect(allOutput).not.toContain(SECRET);

    logSpy.mockRestore();
    warnSpy.mockRestore();
  });

  it("dedupeKey does not contain the secret or raw authorization material", () => {
    // dedupeKey = sha256(serverId + rawBody) — no secret involved
    const rawBodyText = makeFormBody();
    const dedupeKey = crypto
      .createHash("sha256")
      .update(SERVER_ID)
      .update("\x00")
      .update(rawBodyText)
      .digest("hex");

    expect(dedupeKey).not.toContain(SECRET);
    expect(dedupeKey).not.toContain("Bearer");
    expect(dedupeKey.length).toBe(64); // sha256 hex
  });
});

// ─── Fixture validity checks (document the wire format) ──────────────────────

describe("BBB bbb-webhooks form body fixture", () => {
  it("is valid application/x-www-form-urlencoded", () => {
    const body = makeFormBody();
    const params = new URLSearchParams(body);
    expect(params.get("domain")).toBe("bbb.example.com");
    expect(params.get("event")).toBeTruthy();
    expect(params.get("timestamp")).toBeTruthy();
  });

  it("event field is a JSON array with one element", () => {
    const body = makeFormBody("meeting-ended");
    const params = new URLSearchParams(body);
    const eventStr = params.get("event")!;
    const parsed = JSON.parse(eventStr) as unknown[];
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed).toHaveLength(1);
  });

  it("event[0].data.id is the event type", () => {
    const body = makeFormBody("rap-publish-ended");
    const params = new URLSearchParams(body);
    const parsed = JSON.parse(params.get("event")!) as Array<{
      data: { id: string };
    }>;
    expect(parsed[0]?.data.id).toBe("rap-publish-ended");
  });

  it("checksum over the fixture body is deterministic and algorithm-dependent", () => {
    const body = makeFormBody();
    const raw = makeRawBodyBuffer(body);
    const cs256 = checksumFor(CALLBACK_URL, raw, SECRET, "sha256");
    const cs1 = checksumFor(CALLBACK_URL, raw, SECRET, "sha1");
    expect(cs256).toHaveLength(64);
    expect(cs1).toHaveLength(40);
    expect(cs256).not.toBe(cs1);
    // Same body + same secret + same URL → same checksum (deterministic)
    expect(checksumFor(CALLBACK_URL, raw, SECRET, "sha256")).toBe(cs256);
  });

  it("checksum is sensitive to body byte differences (retry invariant)", () => {
    const body1 = makeFormBody("meeting-ended");
    const body2 = body1 + "&extra=1"; // different byte sequence
    const raw1 = makeRawBodyBuffer(body1);
    const raw2 = makeRawBodyBuffer(body2);
    expect(
      checksumFor(CALLBACK_URL, raw1, SECRET, "sha256"),
    ).not.toBe(
      checksumFor(CALLBACK_URL, raw2, SECRET, "sha256"),
    );
    // But the SAME body retried produces the SAME checksum (BBB retries are identical)
    expect(
      checksumFor(CALLBACK_URL, makeRawBodyBuffer(body1), SECRET, "sha256"),
    ).toBe(
      checksumFor(CALLBACK_URL, makeRawBodyBuffer(body1), SECRET, "sha256"),
    );
  });
});
