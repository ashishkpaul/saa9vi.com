/**
 * Pure unit tests for MarketplaceBaselineService (3D.1b Steps 1–4).
 * (Named *.e2e-spec.ts to match the vitest include pattern; see SponsoredBoostConfigService.)*
 *
 * No server boot, no ES, no DB — this verifies the fail-closed baseline
 * contract with a mocked SettingsStoreService:
 *   1. getCurrentBaseline THROWS when no baseline was ever established
 *      (no placeholder {G:0,V:0} → no false "converged" ES document)
 *   2. getCurrentBaseline returns the exact stored snapshot {G,V,computedAt}
 *   3. registerFields registers the three global-scope fields
 */
import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import { RequestContext, SettingsStoreScopes } from '@vendure/core';
import { MarketplaceBaselineService } from '../services/marketplace-baseline.service';

function makeService(stored: Record<string, unknown>): {
  service: MarketplaceBaselineService;
  setCalls: Array<[string, unknown]>;
} {
  const setCalls: Array<[string, unknown]> = [];
  const settingsStoreService = {
    get: vi.fn(async (_ctx: unknown, key: string) => stored[key]),
    set: vi.fn(async (_ctx: unknown, key: string, value: unknown) => {
      setCalls.push([key, value]);
    }),
    register: vi.fn(),
  } as any;
  const requestContextService = { create: vi.fn() } as any;
  return {
    service: new MarketplaceBaselineService(settingsStoreService, requestContextService),
    setCalls,
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

  it('registers the three baseline fields in global scope', () => {
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
    ]);
    for (const f of config.fields) {
      expect(f.scope).toBe(SettingsStoreScopes.global);
    }
  });
});
