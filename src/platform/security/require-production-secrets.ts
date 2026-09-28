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
export function assertProductionSecrets(env: NodeJS.ProcessEnv = process.env): void {
  if (env.APP_ENV === 'dev') {
    return;
  }
  const missingSecrets = ['SUPERADMIN_PASSWORD', 'COOKIE_SECRET'].filter(
    (key) => !env[key],
  );
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
}
