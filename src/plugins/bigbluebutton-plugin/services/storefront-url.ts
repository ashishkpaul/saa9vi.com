/**
 * Storefront base URL and BBB `logoutURL` resolution.
 *
 * Three call sites used to build this string independently, and the `/create`
 * one was the odd one out: it concatenated `${STOREFRONT_URL}/bbb-logout`
 * WITHOUT stripping a trailing slash, so a config value ending in `/` produced
 * `https://host//bbb-logout`. It also never read the documented
 * `storefrontUrl` plugin option at all — that option was dead.
 *
 * Pure and dependency-free (mirrors `grant-selection.policy.ts`), so the rule
 * lives in exactly one place and is unit-testable.
 *
 * Scope note: this is deliberately a GLOBAL base URL. Per-tenant storefront
 * domains are not resolved here — there is currently no per-tenant storefront
 * URL source in the domain model, and inventing one (e.g. from
 * `Channel.customDomain`) is a separate follow-up, not part of this change.
 */

/**
 * Trim + strip trailing slashes. An empty/whitespace-only input resolves to
 * `undefined` rather than `""`, so callers can never build `"/bbb-logout"`.
 */
export function normaliseBaseUrl(base?: string | null): string | undefined {
  const trimmed = base?.trim();
  if (!trimmed) return undefined;
  const stripped = trimmed.replace(/\/+$/, "");
  return stripped.length > 0 ? stripped : undefined;
}

/**
 * The storefront origin to hand BBB: the plugin option first (explicit
 * configuration wins), then the `STOREFRONT_URL` environment variable.
 * Both are normalised, so either may be given with or without a trailing
 * slash. `undefined` means "no storefront configured" — BBB then falls back
 * to its own default redirect.
 */
export function resolveStorefrontBaseUrl(
  optionValue?: string | null,
  envValue?: string | null,
): string | undefined {
  return normaliseBaseUrl(optionValue) ?? normaliseBaseUrl(envValue);
}

/**
 * BBB's `logoutURL` — where the browser lands when a session ends.
 *
 * Always exactly one slash before `bbb-logout`, whatever the input looked
 * like. `undefined` when no storefront base is configured.
 */
export function resolveLogoutUrl(
  optionValue?: string | null,
  envValue?: string | null,
): string | undefined {
  const base = resolveStorefrontBaseUrl(optionValue, envValue);
  return base ? `${base}/bbb-logout` : undefined;
}
