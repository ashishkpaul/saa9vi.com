import { describe, expect, it } from 'vitest';
import * as net from 'net';
import type { FreePortTestEnvironment } from '../free-port';
import { getFreePort, isAddrInUse, startOnFreePort } from '../free-port';

function tryBind(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once('error', () => resolve(false));
    srv.listen(port, '127.0.0.1', () => srv.close(() => resolve(true)));
  });
}

describe('getFreePort', () => {
  it('returns a port that is bindable immediately', async () => {
    const port = await getFreePort();
    expect(port).toBeGreaterThan(0);
    await expect(tryBind(port)).resolves.toBe(true);
  });

  it('returns distinct ports on successive calls', async () => {
    const [a, b, c] = await Promise.all([
      getFreePort(),
      getFreePort(),
      getFreePort(),
    ]);
    expect(new Set([a, b, c]).size).toBe(3);
  });
});

describe('isAddrInUse', () => {
  it('matches a Node error carrying the EADDRINUSE code', () => {
    const err = Object.assign(new Error('listen EADDRINUSE: address'), {
      code: 'EADDRINUSE',
    });
    expect(isAddrInUse(err)).toBe(true);
  });

  it('matches an unwrapped message mentioning EADDRINUSE', () => {
    expect(isAddrInUse(new Error('bind failed: EADDRINUSE 127.0.0.1:1'))).toBe(
      true,
    );
  });

  it('rejects unrelated errors and nullish values', () => {
    expect(isAddrInUse(new Error('boom'))).toBe(false);
    expect(isAddrInUse(null)).toBe(false);
    expect(isAddrInUse(undefined)).toBe(false);
  });
});

describe('startOnFreePort', () => {
  // init is stubbed by each test, so the options object is never parsed —
  // TestServerOptions.initialData is required by the typings regardless.
  const NO_INIT_OPTIONS = {} as Parameters<typeof startOnFreePort>[1];

  function fakeEnv(init: () => Promise<void>) {
    const vendureConfig = {
      apiOptions: { port: 0, adminApiPath: 'admin-api', shopApiPath: 'shop-api' },
    };
    const adminClient: Record<string, unknown> = {};
    const shopClient: Record<string, unknown> = {};
    const env = {
      server: { vendureConfig, init },
      adminClient,
      shopClient,
    } as unknown as FreePortTestEnvironment;
    return { env, vendureConfig, adminClient, shopClient };
  }

  it('writes the allocated port into config and both client URLs before init', async () => {
    let portAtInit = -1;
    const { env, vendureConfig, adminClient, shopClient } = fakeEnv(
      async () => {
        portAtInit = vendureConfig.apiOptions.port;
      },
    );
    const port = await startOnFreePort(env, NO_INIT_OPTIONS);
    expect(port).toBeGreaterThan(0);
    expect(portAtInit).toBe(port);
    expect(adminClient.apiUrl).toBe(`http://localhost:${port}/admin-api`);
    expect(shopClient.apiUrl).toBe(`http://localhost:${port}/shop-api`);
  });

  it('hard-fails with the port named when init throws EADDRINUSE', async () => {
    const addrErr = Object.assign(
      new Error('listen EADDRINUSE: address already in use'),
      { code: 'EADDRINUSE' },
    );
    const { env } = fakeEnv(() => Promise.reject(addrErr));
    await expect(startOnFreePort(env, NO_INIT_OPTIONS)).rejects.toThrow(
      /EADDRINUSE: could not bind http:\/\/localhost:\d+/,
    );
  });

  it('rethrows non-EADDRINUSE init errors untouched', async () => {
    const { env } = fakeEnv(() => Promise.reject(new Error('schema bust')));
    await expect(startOnFreePort(env, NO_INIT_OPTIONS)).rejects.toThrow('schema bust');
  });
});

