/**
 * Production boot guard — presence + format checks for the values whose
 * failure mode is silent corruption rather than a crash.
 *
 * W3/W4 angle: `BBB_PUBLIC_BASE_URL` is what hook registration builds the
 * BBB callback URL from, and BBB signs the URL that was REGISTERED — a
 * relative or schemeless value would register a callback BBB can never
 * produce a valid checksum for, and the verifier reconstructing a different
 * string would reject every delivery. Non-dev boot must refuse without it.
 * W4 amendment: non-dev must be absolute `https://` (plain http refused —
 * the registered callback carries the auth material W3 verifies).
 */
import { describe, expect, it } from "vitest";
import { assertProductionSecrets } from "./require-production-secrets";

/**
 * `src/environment.d.ts` augments the global ProcessEnv with the FULL
 * deployment key set (all keys required), while the guard only reads
 * APP_ENV plus the keys it checks — so the fixture bag crosses the typed
 * boundary once, here.
 */
type EnvBag = Record<string, string | undefined>;

function guard(env: EnvBag): void {
  assertProductionSecrets(env as unknown as NodeJS.ProcessEnv);
}

function prodEnv(overrides: EnvBag = {}): EnvBag {
  return {
    APP_ENV: "prod",
    SUPERADMIN_PASSWORD: "x",
    COOKIE_SECRET: "x",
    RAZORPAY_KEY_ID: "x",
    RAZORPAY_KEY_SECRET: "x",
    RAZORPAY_WEBHOOK_SECRET: "x",
    REDIS_PASSWORD: "x",
    DB_PASSWORD: "x",
    BBB_ENCRYPTION_KEY: "ab".repeat(32),
    BBB_DEFAULT_RATE_PAISE_PER_LEARNER_HOUR: "2000",
    BBB_PUBLIC_BASE_URL: "https://meeting.saa9vi.com",
    ...overrides,
  };
}

describe("assertProductionSecrets", () => {
  it("dev skips every requirement", () => {
    expect(() => guard({ APP_ENV: "dev" })).not.toThrow();
  });

  it("a complete non-dev environment passes", () => {
    expect(() => guard(prodEnv())).not.toThrow();
  });

  it("non-dev without BBB_PUBLIC_BASE_URL refuses to boot", () => {
    const env = prodEnv();
    delete env.BBB_PUBLIC_BASE_URL;
    expect(() => guard(env)).toThrow(/BBB_PUBLIC_BASE_URL/);
  });

  it.each([
    ["not-a-url"],
    ["/relative/path"],
    ["ftp://files.example.com"],
    ["meeting.saa9vi.com"], // missing scheme — would register garbage
    ["http://meeting.saa9vi.com"], // W4: plain http refused outside dev
  ])(
    "non-dev with invalid BBB_PUBLIC_BASE_URL %s refuses to boot",
    (value) => {
      expect(() =>
        guard(prodEnv({ BBB_PUBLIC_BASE_URL: value })),
      ).toThrow(/BBB_PUBLIC_BASE_URL must be an absolute https URL/);
    },
  );

  it.each([
    ["https://core.saa9vi.com/bbb/webhook/1"],    // exact incident value
    ["https://core.saa9vi.com/bbb/webhook/1/"],   // with trailing slash
    ["https://example.com/some/path"],
  ])(
    "non-dev with path in BBB_PUBLIC_BASE_URL %s refuses with origin-only error",
    (value) => {
      expect(() =>
        guard(prodEnv({ BBB_PUBLIC_BASE_URL: value })),
      ).toThrow(/must be the origin only/);
    },
  );

  it("a trailing slash on the origin is accepted (normalisation happens at use)", () => {
    expect(() =>
      guard(prodEnv({ BBB_PUBLIC_BASE_URL: "https://meeting.saa9vi.com/" })),
    ).not.toThrow();
  });

  it("a URL with a port but no path is accepted", () => {
    expect(() =>
      guard(prodEnv({ BBB_PUBLIC_BASE_URL: "https://my-vendure.example.com:3000" })),
    ).not.toThrow();
  });

  it("regression: the metered-rate guard still refuses", () => {
    const env = prodEnv();
    delete env.BBB_DEFAULT_RATE_PAISE_PER_LEARNER_HOUR;
    expect(() => guard(env)).toThrow(
      /BBB_DEFAULT_RATE_PAISE_PER_LEARNER_HOUR/,
    );
  });
});