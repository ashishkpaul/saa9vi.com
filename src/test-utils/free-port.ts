/**
 * Free-port allocation for e2e suites.
 *
 * Every suite used to hardcode `apiOptions.port` (3070–3101). The vitest
 * `pool: 'forks'` battery boots suites in parallel, so two suites sharing a
 * port — or a leftover process holding one — failed inside `server.init()`
 * with EADDRINUSE (observed 2026-10-05: the parallel battery booted 3071
 * twice and the customer-deletion suite was skipped wholesale; several other
 * port pairs collided too: 3076, 3077, 3078 ×2, 3079).
 *
 * `getFreePort()` asks the OS for an ephemeral port (bind 127.0.0.1:0, read
 * it back, close). `startOnFreePort()` is the single call every suite uses in
 * `beforeAll` instead of `server.init(...)`; it
 *
 *   1. allocates a free port,
 *   2. writes it into `config.apiOptions.port` (the exact object
 *      `createTestEnvironment` received — `TestServer.vendureConfig` is
 *      `private` only in the typings, a plain field at runtime),
 *   3. re-points both GraphQL clients' URLs (they baked the placeholder port
 *      in at construction — `SimpleGraphQLClient.apiUrl`, also a plain field
 *      at runtime),
 *   4. calls `server.init(...)` and, if the port was stolen between
 *      allocation and listen, hard-fails with an explicit EADDRINUSE error
 *      naming the port instead of letting the suite fail cryptically or get
 *      skipped wholesale downstream.
 *
 * The CJS project cannot use top-level `await` (TS1309) and
 * `createTestEnvironment` reads the port synchronously, so allocation cannot
 * happen at module scope — hence the wrapper-in-beforeAll pattern.
 *
 * Residual race: the port is free between allocation and the server's
 * `listen()` (populate runs in between); another suite's `getFreePort()`
 * could theoretically pick it up in that window — that is exactly the case
 * the hard-fail surfaces, and a re-run clears it.
 */
import * as net from 'net';
import type { VendureConfig } from '@vendure/core';
import type {
  SimpleGraphQLClient,
  TestServer,
  TestServerOptions,
} from '@vendure/testing';

export interface FreePortTestEnvironment {
  server: TestServer;
  adminClient: SimpleGraphQLClient;
  shopClient: SimpleGraphQLClient;
}

/** The error `app.listen()` rejects with when the port is already taken. */
export function isAddrInUse(e: unknown): boolean {
  const err = e as { code?: string; message?: string } | null | undefined;
  if (err == null) return false;
  return err.code === 'EADDRINUSE' || /EADDRINUSE/.test(err.message ?? '');
}

/**
 * Ask the OS for a currently-free TCP port on `host` (default loopback):
 * bind an ephemeral port (port 0), read the assigned number, close, return.
 *
 * The port is free the moment this resolves; the caller must bind it
 * promptly (see `startOnFreePort`).
 */
export function getFreePort(host = '127.0.0.1'): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const probe = net.createServer();
    probe.unref();
    probe.once('error', reject);
    probe.listen(0, host, () => {
      const addr = probe.address();
      if (addr == null || typeof addr === 'string') {
        probe.close(() =>
          reject(
            new Error('getFreePort: probe socket reported no numeric port'),
          ),
        );
        return;
      }
      const { port } = addr;
      probe.close((err) => (err ? reject(err) : resolve(port)));
    });
  });
}

/**
 * Allocate a free port, re-point the config and both GraphQL clients at it,
 * then boot the test server — hard-failing on EADDRINUSE with the port named.
 * Returns the allocated port for suites that need it (e.g. webhook URLs).
 *
 * Use in `beforeAll` in place of `server.init(...)`:
 *
 * ```ts
 * const port = await startOnFreePort(
 *   { server, adminClient, shopClient },
 *   { initialData: E2E_INITIAL_DATA, customerCount: 0 },
 * );
 * ```
 */
export async function startOnFreePort(
  env: FreePortTestEnvironment,
  initOptions: TestServerOptions,
): Promise<number> {
  const port = await getFreePort();
  // `vendureConfig` is private in the typings but is the same object
  // createTestEnvironment received — mutating apiOptions.port here is what
  // `app.listen()` (inside server.init) binds.
  const config = (
    env.server as unknown as { vendureConfig: Required<VendureConfig> }
  ).vendureConfig;
  config.apiOptions.port = port;
  const base = `http://localhost:${port}`;
  // createTestEnvironment baked the placeholder port into both client URLs at
  // construction; re-point them at the port actually being bound (parity with
  // createTestEnvironment's own URL building).
  (env.adminClient as unknown as { apiUrl: string }).apiUrl = `${base}/${config.apiOptions.adminApiPath}`;
  (env.shopClient as unknown as { apiUrl: string }).apiUrl = `${base}/${config.apiOptions.shopApiPath}`;
  try {
    await env.server.init(initOptions);
  } catch (e) {
    if (isAddrInUse(e)) {
      throw new Error(
        `EADDRINUSE: could not bind ${base} during server.init() — the port was ` +
          `taken between getFreePort() allocation and listen (a parallel suite or ` +
          `a leftover process). Ports are allocated per boot: re-run this suite. ` +
          `Original error: ${(e as Error)?.message}`,
      );
    }
    throw e;
  }
  return port;
}
