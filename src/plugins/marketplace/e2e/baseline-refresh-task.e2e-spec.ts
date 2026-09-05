/**
 * Pure unit tests for the 3D.1b Step 6 Bayesian baseline refresh task wiring.
 * (Named *.e2e-spec.ts to match the vitest include pattern.)
 *
 * Verifies that the ScheduledTask orchestrates rather than doing heavy work:
 *   1. generates a durable refreshGeneration (UUID) per execution
 *   2. captures the current baseline version as claimedFromVersion (undefined
 *      when the baseline has never been established)
 *   3. enqueues exactly one refresh job through the BaselineRefreshQueueService
 *   4. does NOT perform the refresh itself (no Settings Store writes here)
 */
import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import { RequestContext } from '@vendure/core';
import { MarketplaceBaselineService } from '../services/marketplace-baseline.service';
import { BaselineRefreshQueueService } from '../services/baseline-refresh-queue.service';
import { bayesianBaselineRefreshTask } from '../jobs/bayesian-baseline-refresh.task';

const ctx = {} as RequestContext;

function makeInjector(currentVersion: number | undefined): {
  injector: any;
  addCalls: Array<{ generation: string; claimedFromVersion?: number }>;
} {
  const addCalls: Array<{ generation: string; claimedFromVersion?: number }> = [];
  const refreshQueue = {
    addRefreshBaselineJob: vi.fn(
      async (generation: string, claimedFromVersion?: number) => {
        addCalls.push({ generation, claimedFromVersion });
      },
    ),
  };
  const baselineService = {
    getCurrentVersion: vi.fn(async () => currentVersion),
  };
  const injector = {
    get: vi.fn((token: unknown) => {
      if (token === MarketplaceBaselineService) return baselineService;
      if (token === BaselineRefreshQueueService) return refreshQueue;
      throw new Error(`unexpected token ${token}`);
    }),
  };
  return { injector, addCalls };
}

describe('bayesianBaselineRefreshTask (3D.1b Step 6 ScheduledTask wiring)', () => {
  it('is registered with the expected id', () => {
    expect(bayesianBaselineRefreshTask.id).toBe('marketplace-bayesian-baseline-refresh');
    expect(bayesianBaselineRefreshTask.options.schedule).toBe(
      process.env.MARKETPLACE_BASELINE_INTERVAL || '0 2 * * *',
    );
  });

  it('enqueues one refresh job with a UUID generation and the claimed version', async () => {
    const { injector, addCalls } = makeInjector(42);
    const result = await bayesianBaselineRefreshTask.options.execute({
      injector,
      scheduledContext: ctx,
      params: {},
    });
    expect(addCalls).toHaveLength(1);
    expect(addCalls[0].claimedFromVersion).toBe(42);
    // Durable identity is a UUID, generated per execution.
    expect(addCalls[0].generation).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
    expect(result).toMatchObject({ claimedFromVersion: 42 });
  });

  it('does not perform the baseline refresh itself — only enqueues', async () => {
    const { injector, addCalls } = makeInjector(42);
    await bayesianBaselineRefreshTask.options.execute({
      injector,
      scheduledContext: ctx,
      params: {},
    });
    // The refresh/persistence is delegated to the queue worker;
    // the task only enqueues.
    expect(addCalls).toHaveLength(1);
    const baselineSvc = (injector.get as any).mock.results[0].value;
    expect(Object.keys(baselineSvc)).toEqual(['getCurrentVersion']);
  });

  it('passes undefined claimedFromVersion when no baseline has been established', async () => {
    const { injector, addCalls } = makeInjector(undefined);
    await bayesianBaselineRefreshTask.options.execute({
      injector,
      scheduledContext: ctx,
      params: {},
    });
    expect(addCalls).toHaveLength(1);
    expect(addCalls[0].claimedFromVersion).toBeUndefined();
  });

  it('reads the claimed version through the baseline service with the scheduled context', async () => {
    const { injector } = makeInjector(7);
    await bayesianBaselineRefreshTask.options.execute({
      injector,
      scheduledContext: ctx,
      params: {},
    });
    const baselineSvc = (injector.get as any).mock.results[0].value;
    expect(baselineSvc.getCurrentVersion).toHaveBeenCalledWith(ctx);
  });
});