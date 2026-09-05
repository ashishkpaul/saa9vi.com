/**
 * Pure unit tests for MarketplaceBaselineService (3D.1b Steps 1–5).
 * (Named *.e2e-spec.ts to match the vitest include pattern; see SponsoredBoostConfigService.)*
 *
 * No server boot, no ES, no DB — verifies the fail-closed baseline contract
 * and the Step 5 refresh/retry-generation guard with mocked
 * SettingsStoreService + TransactionalConnection:
 *   1. getCurrentBaseline THROWS when no baseline was ever established
 *      (no placeholder {G:0,V:0} → no false "converged" ES document)
 *   2. getCurrentBaseline returns the exact stored snapshot {G,V,computedAt}
 *   3. registerFields registers the four global-scope fields
 *   4. refreshBaseline crash/retry state transitions (committed / resumed /
 *      superseded)
 */
import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import { RequestContext, SettingsStoreScopes } from '@vendure/core';
import { MarketplaceBaselineService } from '../services/marketplace-baseline.service';

function makeService(
  stored: Record<string, unknown>,
  opts?: { globalMeanFromReviews?: number },
): {
  service: MarketplaceBaselineService;
  setManyCalls: Array<Record<string, unknown>>;
  setKeyOrder: string[][];
} {
  const setManyCalls: Array<Record<string, unknown>> = [];
  const setKeyOrder: string[][] = [];
  const settingsStoreService = {
    get: vi.fn(async (_ctx: unknown, key: string) => stored[key]),
    set: vi.fn(async (_ctx: unknown, key: string, value: unknown) => {
      stored[key] = value;
      setKeyOrder.push([key]);
    }),
    setMany: vi.fn(async (_ctx: unknown, values: Record<string, unknown>) => {
      setManyCalls.push(values);
      setKeyOrder.push(Object.keys(values));
      Object.assign(stored, values);
    }),
    register: vi.fn(),
  } as any;
  const requestContextService = { create: vi.fn() } as any;
  const qbChain = {
    select: vi.fn().mockReturnThis(),
    addSelect: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    andWhere: vi.fn().mockReturnThis(),
    getRawOne: vi.fn(async () => ({
      average: String(opts?.globalMeanFromReviews ?? 0),
    })),
  };
  const connection = {
    rawConnection: {
      getRepository: vi.fn(() => ({
        createQueryBuilder: vi.fn(() => qbChain),
      })),
    },
  } as any;
  return {
    service: new MarketplaceBaselineService(settingsStoreService, requestContextService, connection),
    setManyCalls,
    setKeyOrder,
  };
}

const ctx = {} as RequestContext;

describe('MarketplaceBaselineService (3D.1b Steps 1–4)', () => {
  it('throws when no baseline has ever been established (fail-closed)', async () => {
    const { service } = makeService({});
    await expect(service.getCurrentBaseline(ctx)).rejects.toThrow(
      /baseline has not been established/i,
    );
  });

  it('throws when only some baseline fields exist (fail-closed)', async () => {
    const { service } = makeService({ 'marketplace.bayesianGlobalMean': { v: 4.2 } });
    await expect(service.getCurrentBaseline(ctx)).rejects.toThrow(
      /baseline has not been established/i,
    );
  });

  it('returns the exact stored snapshot {G, V, computedAt} when established', async () => {
    const computedAt = '2026-09-05T00:00:00.000Z';
    const { service } = makeService({
      'marketplace.bayesianGlobalMean': { v: 4.2 },
      'marketplace.bayesianBaselineVersion': { v: 7 },
      'marketplace.bayesianGlobalMeanComputedAt': { v: computedAt },
    });
    const baseline = await service.getCurrentBaseline(ctx);
    expect(baseline).toEqual({
      globalMean: 4.2,
      baselineVersion: 7,
      computedAt: new Date(computedAt),
    });
  });

  it('reads all three fields through the settings store with the given context', async () => {
    const { service } = makeService({
      'marketplace.bayesianGlobalMean': { v: 4.0 },
      'marketplace.bayesianBaselineVersion': { v: 1 },
      'marketplace.bayesianGlobalMeanComputedAt': { v: '2026-09-05T00:00:00.000Z' },
    });
    await service.getCurrentBaseline(ctx);
    expect(service['settingsStoreService']['get']).toHaveBeenCalledWith(
      ctx,
      'marketplace.bayesianGlobalMean',
    );
    expect(service['settingsStoreService']['get']).toHaveBeenCalledWith(
      ctx,
      'marketplace.bayesianBaselineVersion',
    );
    expect(service['settingsStoreService']['get']).toHaveBeenCalledWith(
      ctx,
      'marketplace.bayesianGlobalMeanComputedAt',
    );
  });

  it('registers the four baseline fields in global scope', () => {
    const { service } = makeService({});
    service.registerFields();
    const register = (service as any).settingsStoreService.register;
    expect(register).toHaveBeenCalledTimes(1);
    const config = register.mock.calls[0][0];
    expect(config.namespace).toBe('marketplace');
    expect(config.fields.map((f: any) => f.name).sort()).toEqual([
      'bayesianBaselineVersion',
      'bayesianGlobalMean',
      'bayesianGlobalMeanComputedAt',
      'bayesianRefreshGeneration',
    ]);
    for (const f of config.fields) {
      expect(f.scope).toBe(SettingsStoreScopes.global);
    }
  });

  it('returns the persisted refreshGeneration in the baseline snapshot', async () => {
    const { service } = makeService({
      'marketplace.bayesianGlobalMean': { v: 4.2 },
      'marketplace.bayesianBaselineVersion': { v: 7 },
      'marketplace.bayesianGlobalMeanComputedAt': { v: '2026-09-05T00:00:00.000Z' },
      'marketplace.bayesianRefreshGeneration': { v: 'gen-7' },
    });
    const baseline = await service.getCurrentBaseline(ctx);
    expect(baseline.refreshGeneration).toBe('gen-7');
  });
});
describe('MarketplaceBaselineService.refreshBaseline (3D.1b Step 5 retry-generation guard)', () => {
  const M = 'marketplace.';

  it('commits V+1 on first refresh from an unset baseline (no reviews → G=0)', async () => {
    const { service, setManyCalls } = makeService({}, { globalMeanFromReviews: 0 });
    const result = await service.refreshBaseline(ctx, 'gen-A');
    expect(result.status).toBe('committed');
    expect(result.baselineVersion).toBe(1);
    expect(result.globalMean).toBe(0);
    expect(setManyCalls).toHaveLength(1);
    // Generation identity is persisted WITH the baseline, written last.
    const keys = Object.keys(setManyCalls[0]);
    expect(keys[keys.length - 1]).toBe(`${M}bayesianRefreshGeneration`);
    // Baseline is now authoritative and readable by Path A.
    const baseline = await service.getCurrentBaseline(ctx);
    expect(baseline).toMatchObject({ globalMean: 0, baselineVersion: 1 });
  });

  it('retry with the same persisted generation resumes the SAME version (no V+2)', async () => {
    const stored: Record<string, unknown> = {
      [`${M}bayesianGlobalMean`]: { v: 4.31 },
      [`${M}bayesianBaselineVersion`]: { v: 42 },
      [`${M}bayesianGlobalMeanComputedAt`]: { v: '2026-09-05T02:00:00.000Z' },
      [`${M}bayesianRefreshGeneration`]: { v: 'gen-A' },
    };
    const { service, setManyCalls } = makeService(stored, { globalMeanFromReviews: 4.5 });
    const result = await service.refreshBaseline(ctx, 'gen-A');
    expect(result.status).toBe('resumed');
    expect(result.baselineVersion).toBe(42);
    expect(setManyCalls).toHaveLength(0); // no writes — crash-after-persist retry
  });

  it('a newer generation cannot be overwritten by an older retry (superseded)', async () => {
    // gen-A crashed after claiming from version 42; a later scheduled refresh
    // (gen-B) already advanced the baseline to version 43.
    const stored: Record<string, unknown> = {
      [`${M}bayesianGlobalMean`]: { v: 4.46 },
      [`${M}bayesianBaselineVersion`]: { v: 43 },
      [`${M}bayesianGlobalMeanComputedAt`]: { v: '2026-09-06T02:00:00.000Z' },
      [`${M}bayesianRefreshGeneration`]: { v: 'gen-B' },
    };
    const { service, setManyCalls } = makeService(stored, { globalMeanFromReviews: 4.5 });
    const result = await service.refreshBaseline(ctx, 'gen-A', { claimedFromVersion: 42 });
    expect(result.status).toBe('superseded');
    expect(result.baselineVersion).toBe(43);
    expect(setManyCalls).toHaveLength(0); // authoritative state untouched
  });

  it('a retry before persistence safely establishes the next generation (committed V+1)', async () => {
    // gen-A crashed BEFORE persisting; state still shows the previous
    // generation. The retry legitimately commits V+1 with its own generation.
    const stored: Record<string, unknown> = {
      [`${M}bayesianGlobalMean`]: { v: 4.31 },
      [`${M}bayesianBaselineVersion`]: { v: 42 },
      [`${M}bayesianGlobalMeanComputedAt`]: { v: '2026-09-05T02:00:00.000Z' },
      [`${M}bayesianRefreshGeneration`]: { v: 'gen-previous' },
    };
    const { service, setManyCalls } = makeService(stored, { globalMeanFromReviews: 4.4 });
    const result = await service.refreshBaseline(ctx, 'gen-A');
    expect(result.status).toBe('committed');
    expect(result.baselineVersion).toBe(43);
    expect(result.globalMean).toBe(4.4);
    expect(setManyCalls).toHaveLength(1);
    const baseline = await service.getCurrentBaseline(ctx);
    expect(baseline.refreshGeneration).toBe('gen-A');
  });

  it('re-running the same generation produces the same authoritative version', async () => {
    const stored: Record<string, unknown> = {};
    const first = makeService(stored, { globalMeanFromReviews: 4.3 });
    const r1 = await first.service.refreshBaseline(ctx, 'gen-A');
    expect(r1.status).toBe('committed');
    expect(r1.baselineVersion).toBe(1);
    // Simulate the retry: same store, same generation.
    const second = makeService(stored, { globalMeanFromReviews: 4.9 });
    const r2 = await second.service.refreshBaseline(ctx, 'gen-A');
    expect(r2.status).toBe('resumed');
    expect(r2.baselineVersion).toBe(1);
    expect(r2.globalMean).toBe(4.3); // the FIRST computed G, not the retry's
  });

  it('post-write supersede check reports the authoritative version when raced', async () => {
    // setMany commits gen-A, but a concurrent refresh overwrites gen-A before
    // the post-write read — the refresh must NOT claim convergence.
    const stored: Record<string, unknown> = {};
    const { service, setManyCalls } = makeService(stored, { globalMeanFromReviews: 4.1 });
    (service as any).settingsStoreService.setMany.mockImplementationOnce(
      async (_c: unknown, values: Record<string, unknown>) => {
        setManyCalls.push(values);
        Object.assign(stored, values);
        Object.assign(stored, {
          [`${M}bayesianGlobalMean`]: { v: 9.9 },
          [`${M}bayesianBaselineVersion`]: { v: 99 },
          [`${M}bayesianRefreshGeneration`]: { v: 'gen-B' },
        });
      },
    );
    const result = await service.refreshBaseline(ctx, 'gen-A');
    expect(setManyCalls).toHaveLength(1);
    expect(result.status).toBe('superseded');
    expect(result.baselineVersion).toBe(99);
  });

  it('G is computed from the approved-review population with state filter', async () => {
    const { service } = makeService({}, { globalMeanFromReviews: 4.7 });
    const g = await service.computeGlobalMeanFromReviews(ctx);
    expect(g).toBe(4.7);
    const repo = (service as any).connection.rawConnection.getRepository();
    const qb = repo.createQueryBuilder();
    expect(qb.where).toHaveBeenCalledWith('review.state = :state', { state: 'approved' });
  });
});

