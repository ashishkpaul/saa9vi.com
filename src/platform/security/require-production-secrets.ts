/**
 * V1.0.9 production hardening: refuse to start with a published default secret.
 *
 * `src/vendure-config.ts` falls back to the literals `"superadmin"` (SuperAdmin
 * password) and `"cookie-secret-dev-fallback"` (session-cookie signing secret)
 * when the corresponding environment variable is unset. Both literals are in
 * this repository, so in any non-dev deployment the fallback means the
 * SuperAdmin password is public knowledge and session cookies are forgeable —
 * a total authentication compromise.
 *
 * Production-readiness review extensions (critical items 1 + 5):
 *  - `BBB_DEFAULT_RATE_PAISE_PER_LEARNER_HOUR` — without it every `metered`
 *    organization bills at the clearly-marked ₹20/learner-hour PLACEHOLDER
 *    (`constants.ts` TODO(PRICE)), i.e. a price nobody approved. A valid
 *    non-negative integer is required; `0` is a legitimate "bill nothing"
 *    configuration and is accepted (mirrors `normaliseRate` in
 *    `services/metered-billing.policy.ts`).
 *  - `BBB_ENCRYPTION_KEY` — AES-256-GCM key for BBB passwords/API secrets.
 *    Checked for shape here (64 hex chars) because the runtime service can
 *    only fail lazily: the provisioning worker calls `createMeeting()` BEFORE
 *    `encrypt()`, so a missing key orphans a live meeting on the BBB server.
 *  - `BBB_PUBLIC_BASE_URL` — public base for the BBB webhook callbacks
 *    (W3/W4: `publicBaseUrl + /bbb/webhook/<serverId>`). BBB signs the URL
 *    that was REGISTERED, so the value must be an absolute HTTPS URL the
 *    BBB server can actually reach — a relative/schemeless base would
 *    register a callback that can never carry a valid checksum and every
 *    delivery would be rejected at verification. W4 amendment: non-dev
 *    requires `https://` — plain http would expose the registered callback
 *    (and the auth material W3 verifies) to interception.
 *  - Razorpay key/secret + webhook secret — an unset webhook secret fails
 *    closed (rejects all provider traffic = silent dunning outage); unset API
 *    keys fail at first checkout.
 *  - `DB_PASSWORD` / `REDIS_PASSWORD` — vendure-config falls back to the
 *    published literal `postgres` for the database password.
 *
 * Deliberately dependency-free (reads `process.env` only) and called from the
 * bootstrap entrypoints `src/index.ts` / `src/index-worker.ts`, NOT from
 * `vendure-config.ts`, so that config-only consumers keep working without
 * runtime secrets:
 *   - the Dashboard build (`vite` + `vendure:config-loader`) loads the config
 *     for plugin introspection, and a build host legitimately has no secrets;
 *   - `npx vendure migrate` loads the config but must not need secrets.
 *
 * `APP_ENV=dev` keeps the fallbacks (local development).
 */

/** Required in every non-dev deployment; presence-only checks. */
const REQUIRED_SECRETS = [
  'SUPERADMIN_PASSWORD',
  'COOKIE_SECRET',
  'RAZORPAY_KEY_ID',
  'RAZORPAY_KEY_SECRET',
  'RAZORPAY_WEBHOOK_SECRET',
  'REDIS_PASSWORD',
  'DB_PASSWORD',
  'BBB_ENCRYPTION_KEY',
  'BBB_DEFAULT_RATE_PAISE_PER_LEARNER_HOUR',
  'BBB_PUBLIC_BASE_URL',
] as const;

export function assertProductionSecrets(env: NodeJS.ProcessEnv = process.env): void {
  if (env.APP_ENV === 'dev') {
    return;
  }
  const missingSecrets = REQUIRED_SECRETS.filter((key) => !env[key]);
  if (missingSecrets.length > 0) {
    throw new Error(
      `Refusing to start: APP_ENV is "${env.APP_ENV ?? 'unset'}" (not "dev") ` +
        `but these required secrets are unset: ${missingSecrets.join(', ')}. ` +
        `The previous behaviour fell back to a published default, which would make ` +
        `the SuperAdmin password public and session cookies forgeable. ` +
        `Set them in the environment (see .env.example) and rotate any deployment ` +
        `that ever ran with the defaults.`,
    );
  }

  // Format checks — presence alone is not enough for values whose failure mode
  // is silent corruption rather than an auth bypass.
  const formatFailures: string[] = [];

  // Metered rate: a valid non-negative integer in paise (0 = "bill nothing").
  // Anything else would silently resolve to the unapproved placeholder rate.
  const rate = env.BBB_DEFAULT_RATE_PAISE_PER_LEARNER_HOUR!.trim();
  if (!/^\d+$/.test(rate)) {
    formatFailures.push(
      `BBB_DEFAULT_RATE_PAISE_PER_LEARNER_HOUR must be a non-negative integer ` +
        `(paise per learner-hour; got "${env.BBB_DEFAULT_RATE_PAISE_PER_LEARNER_HOUR}")`,
    );
  }

  // AES-256-GCM key: exactly 32 bytes as 64 hex characters. The runtime
  // service validates the same shape, but only lazily at first use.
  const encKey = env.BBB_ENCRYPTION_KEY!.trim();
  if (!/^[0-9a-fA-F]{64}$/.test(encKey)) {
    formatFailures.push(
      `BBB_ENCRYPTION_KEY must be a 64-character hex string (32 bytes); ` +
        `generate with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`,
    );
  }

  // Public callback base: must be an absolute HTTPS URL with no path beyond
  // the origin (scheme + host + optional port). BBB signs the URL that was
  // REGISTERED — `publicBaseUrl + /bbb/webhook/<serverId>` — so a value like
  // `https://core.saa9vi.com/bbb/webhook/1` would produce a doubled path
  // `/bbb/webhook/1/bbb/webhook/1` at registration. Trailing slash is allowed;
  // normalisation strips it at use. W4 amendment: https only.
  const publicBaseUrl = env.BBB_PUBLIC_BASE_URL!.trim();
  let baseUrlOk = false;
  let baseUrlPathError = false;
  try {
    const parsed = new URL(publicBaseUrl);
    baseUrlOk = parsed.protocol === "https:";
    // pathname must be empty, "/", or only trailing slashes — no real path segments.
    const pathname = parsed.pathname.replace(/\/+$/, "");
    if (pathname !== "" && pathname !== "/") {
      baseUrlPathError = true;
      baseUrlOk = false;
    }
  } catch {
    baseUrlOk = false;
  }
  if (!baseUrlOk) {
    formatFailures.push(
      baseUrlPathError
        ? `BBB_PUBLIC_BASE_URL must be the origin only (scheme + host, no path). ` +
            `The path /bbb/webhook/<serverId> is appended automatically. ` +
            `Got "${publicBaseUrl}" — remove the path segment.`
        : `BBB_PUBLIC_BASE_URL must be an absolute https URL (public host ` +
            `the BBB server can reach, e.g. https://core.saa9vi.com; ` +
            `plain http is refused outside dev); got "${publicBaseUrl}"`,
    );
  }

  // Commit 2: the one-time payments webhook secret resolves with `||`
  // fallback (RAZORPAY_PAYMENTS_WEBHOOK_SECRET → RAZORPAY_WEBHOOK_SECRET).
  // An empty resolution fails closed at runtime (every webhook rejected =
  // silent dunning outage), so non-dev boot refuses when it is blank.
  const paymentsSecret = (
    env.RAZORPAY_PAYMENTS_WEBHOOK_SECRET ||
    env.RAZORPAY_WEBHOOK_SECRET ||
    ''
  ).trim();
  if (!paymentsSecret) {
    formatFailures.push(
      `RAZORPAY_PAYMENTS_WEBHOOK_SECRET (or fallback RAZORPAY_WEBHOOK_SECRET) must be set — ` +
        `an empty one-time webhook secret rejects ALL provider traffic`,
    );
  }

  if (formatFailures.length > 0) {
    throw new Error(
      `Refusing to start: APP_ENV is "${env.APP_ENV ?? 'unset'}" (not "dev") ` +
        `but these secrets have an invalid format:\n  - ${formatFailures.join('\n  - ')}`,
    );
  }
}
