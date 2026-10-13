import { describe, expect, it, vi } from 'vitest';

/**
 * Commit 1 checklist item 1 — PaymentsProductionGuard boot behaviour.
 *
 *   - APP_ENV != dev + dummy handler row present → throws (non-zero boot).
 *   - APP_ENV == dev → never throws (dev fixtures keep dummy).
 *   - NODE_ENV == test → never throws (e2e suites create their own dummy).
 */
async function loadGuard() {
  const mod = await import('../payments.plugin.js');
  return mod.PaymentsProductionGuard;
}

function guardWith(methods: Array<{ id: unknown; code: string; enabled?: boolean; handler: unknown }>, env: Record<string, string | undefined>) {
  const connection = {
    rawConnection: { getRepository: () => ({ find: async () => methods }) },
  };
  return { connection, env };
}

describe('PaymentsProductionGuard (Commit 1)', () => {
  it('throws outside dev/test when an ENABLED dummy-handler method exists', async () => {
    const Guard = await loadGuard();
    const { connection } = guardWith(
      [{ id: 1, code: 'dummy', enabled: true, handler: { code: 'dummy-payment-handler', args: [] } }],
      {},
    );
    const guard = new Guard(connection as never);
    vi.stubEnv('APP_ENV', 'prod');
    vi.stubEnv('NODE_ENV', '');
    await expect(guard.onApplicationBootstrap()).rejects.toThrow(/dummy-payment-handler/);
    vi.unstubAllEnvs();
  });

  it('passes outside dev/test when the dummy-handler method is DISABLED', async () => {
    const Guard = await loadGuard();
    const { connection } = guardWith(
      [{ id: 1, code: 'dummy', enabled: false, handler: { code: 'dummy-payment-handler', args: [] } }],
      {},
    );
    const guard = new Guard(connection as never);
    vi.stubEnv('APP_ENV', 'prod');
    vi.stubEnv('NODE_ENV', '');
    await expect(guard.onApplicationBootstrap()).resolves.toBeUndefined();
    vi.unstubAllEnvs();
  });

  it('passes outside dev/test when no dummy-handler method exists', async () => {
    const Guard = await loadGuard();
    const { connection } = guardWith(
      [{ id: 2, code: 'razorpay', handler: { code: 'razorpay', args: [] } }],
      {},
    );
    const guard = new Guard(connection as never);
    vi.stubEnv('APP_ENV', 'prod');
    vi.stubEnv('NODE_ENV', '');
    await expect(guard.onApplicationBootstrap()).resolves.toBeUndefined();
    vi.unstubAllEnvs();
  });

  it('never throws in dev even with dummy present', async () => {
    const Guard = await loadGuard();
    const { connection } = guardWith(
      [{ id: 1, code: 'dummy', handler: { code: 'dummy-payment-handler', args: [] } }],
      {},
    );
    const guard = new Guard(connection as never);
    vi.stubEnv('APP_ENV', 'dev');
    await expect(guard.onApplicationBootstrap()).resolves.toBeUndefined();
    vi.unstubAllEnvs();
  });

  it('never throws under NODE_ENV=test even with dummy present', async () => {
    const Guard = await loadGuard();
    const { connection } = guardWith(
      [{ id: 1, code: 'dummy', handler: { code: 'dummy-payment-handler', args: [] } }],
      {},
    );
    const guard = new Guard(connection as never);
    vi.stubEnv('APP_ENV', '');
    vi.stubEnv('NODE_ENV', 'test');
    await expect(guard.onApplicationBootstrap()).resolves.toBeUndefined();
    vi.unstubAllEnvs();
  });
});
