/**
 * W3 authentication — BBB webhook request verifier.
 *
 * Supports both BBB auth modes:
 *
 *   auth2_0: true  → `Authorization: Bearer <raw shared secret>`
 *                    Constant-time compare after hashing both sides to equal
 *                    length (sha256 of each). Production: emit a de-duplicated
 *                    ops alert recommending migration to auth2_0: false.
 *
 *   auth2_0: false → `?checksum=<hex>` in query string.
 *                    checksum = sha<N>(callbackUrl + rawBody + secret)
 *                    Algorithm inferred from digest hex-length:
 *                      40 → sha1, 64 → sha256, 96 → sha384, 128 → sha512
 *                    All four are on the explicit allow-list; anything else is
 *                    rejected before the compare so a zero-length checksum
 *                    cannot produce a false match.
 *
 * Security properties:
 *   - Both compares are constant-time (hashed to equal-length buffers first).
 *   - Neither the incoming checksum nor the Authorization header value is ever
 *     logged, recorded, or attached to an OpenTelemetry span.
 *   - On failure the caller returns HTTP 401 — BBB counts 401 as delivered,
 *     avoiding retry storms and hook removal.
 *
 * Extracted as a pure module (no NestJS decorators) so specs can import it
 * directly and spy-test that no secret reaches logs or spans.
 */
import * as crypto from "crypto";

export type AuthAlgorithm = "sha1" | "sha256" | "sha384" | "sha512";

/** Map hex-digest length → algorithm. Unknown lengths return null (reject). */
export function algorithmFromDigestLength(
  hex: string,
): AuthAlgorithm | null {
  switch (hex.length) {
    case 40:
      return "sha1";
    case 64:
      return "sha256";
    case 96:
      return "sha384";
    case 128:
      return "sha512";
    default:
      return null;
  }
}

/**
 * Constant-time compare of two arbitrary strings.
 * Both are sha256-hashed to produce equal-length buffers before the compare.
 */
export function constantTimeEqual(a: string, b: string): boolean {
  const ha = crypto.createHash("sha256").update(a).digest();
  const hb = crypto.createHash("sha256").update(b).digest();
  return crypto.timingSafeEqual(ha, hb);
}

export interface VerifyBearerOptions {
  authorizationHeader: string | undefined;
  secret: string;
}

export interface VerifyBearerResult {
  ok: boolean;
  /** true when auth succeeded via bearer — caller should emit alert */
  isBearerMode: boolean;
}

/**
 * Verify `Authorization: Bearer <token>` mode.
 * Returns `{ ok: true, isBearerMode: true }` when the header matches the
 * raw shared secret. Never logs the header value.
 */
export function verifyBearer(opts: VerifyBearerOptions): VerifyBearerResult {
  const { authorizationHeader, secret } = opts;
  if (!authorizationHeader) {
    return { ok: false, isBearerMode: false };
  }
  const prefix = "Bearer ";
  if (!authorizationHeader.startsWith(prefix)) {
    return { ok: false, isBearerMode: false };
  }
  const token = authorizationHeader.slice(prefix.length);
  return {
    ok: constantTimeEqual(token, secret),
    isBearerMode: true,
  };
}

export interface VerifyChecksumOptions {
  /** Hex checksum from query string `?checksum=` */
  checksum: string | undefined;
  /** The EXACT string BBB registered as the callback URL (from webhookCallbackUrl helper) */
  callbackUrl: string;
  /** Raw request body bytes — NOT the parsed form object */
  rawBody: Buffer;
  secret: string;
}

export interface VerifyChecksumResult {
  ok: boolean;
}

/**
 * Verify `?checksum=` mode (auth2_0: false).
 * Algorithm is inferred from digest length; an unknown length is rejected.
 * Never logs the checksum value.
 */
export function verifyChecksum(
  opts: VerifyChecksumOptions,
): VerifyChecksumResult {
  const { checksum, callbackUrl, rawBody, secret } = opts;
  if (!checksum) {
    return { ok: false };
  }
  const algorithm = algorithmFromDigestLength(checksum);
  if (!algorithm) {
    return { ok: false };
  }
  const expected = crypto
    .createHash(algorithm)
    .update(callbackUrl)
    .update(rawBody)
    .update(secret)
    .digest("hex");
  return { ok: constantTimeEqual(expected, checksum) };
}

export interface VerifyWebhookAuthOptions {
  authorizationHeader: string | undefined;
  checksum: string | undefined;
  callbackUrl: string;
  rawBody: Buffer;
  secret: string;
}

export type VerifyWebhookAuthResult =
  | { ok: true; isBearerMode: boolean }
  | { ok: false };

/**
 * Top-level verifier: tries bearer first, then checksum.
 * Callers should emit an alert when `isBearerMode: true` in production.
 */
export function verifyWebhookAuth(
  opts: VerifyWebhookAuthOptions,
): VerifyWebhookAuthResult {
  const { authorizationHeader, checksum, callbackUrl, rawBody, secret } = opts;

  // Bearer mode: Authorization: Bearer <secret>
  if (authorizationHeader) {
    const result = verifyBearer({ authorizationHeader, secret });
    if (result.ok) return { ok: true, isBearerMode: true };
    // Header was present but wrong — don't fall through to checksum
    return { ok: false };
  }

  // Checksum mode: ?checksum=<hex>
  const result = verifyChecksum({ checksum, callbackUrl, rawBody, secret });
  return result.ok ? { ok: true, isBearerMode: false } : { ok: false };
}
