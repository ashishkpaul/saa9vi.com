/**
 * Pure unit tests for 3D.1b Step 7 - global target-version reindex wiring.
 */
import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import { RequestContext } from '@vendure/core';
import { BaselineRefreshQueueService } from '../services/baseline-refresh-queue.service';
import { MarketplaceIndexerService } from '../services/marketplace-indexer.service';

const ctx = {} as RequestContext;

interface Harness {
  service: BaselineRefreshQueueService;
  bag: { processFn?: (job: any) => Promise<unknown>; addGlobalReindexCalls: number[] };
}

function makeRefreshQueueService(refreshResult: {
  status: 'committed' | 'resumed' | 'superseded';
  baselineVersion: number;
}): Harness {
  const bag: { processFn?: (job: any) => Promise<unknown>; addGlobalReindexCalls: number[] } = {
    addGlobalReindexCalls: [],
  };
  const baselineService = {
    createInternalContext: vi.fn(async () => ctx),
    refreshBaseline: vi.fn(async () => refreshResult),
  } as any;
  const indexQueueService = {
    addGlobalReindexJob: vi.fn(async (v: number) => {
      bag.addGlobalReindexCalls.push(v);
    }),
  } as any;
  const jobQueueService = {
    createQueue: vi.fn(async ({ process }: { process: (job: any) => Promise<unknown> }) => {
      bag.processFn = process;
      return { add: vi.fn() };
    }),
  } as any;
  const service = new BaselineRefreshQueueService(jobQueueService, baselineService, indexQueueService);
  return { service, bag };
}

async function initAndRun(
  refreshResult: { status: 'committed' | 'resumed' | 'superseded'; baselineVersion: number },
): Promise<number[]> {
  const { service, bag } = makeRefreshQueueService(refreshResult);
  await service.onModuleInit();
  await bag.processFn!({ data: { generation: 'gen-A', claimedFromVersion: 41 } });
  return bag.addGlobalReindexCalls;
}

describe('BaselineRefreshQueueService worker -> global reindex enqueue (Step 7)', () => {
  it('enqueues a global reindex target V on a committed refresh', async () => {
    expect(await initAndRun({ status: 'committed', baselineVersion: 42 })).toEqual([42]);
  });
  it('enqueues a global reindex on a resumed (crash-after-persist) retry', async () => {
    expect(await initAndRun({ status: 'resumed', baselineVersion: 42 })).toEqual([42]);
  });
  it('does NOT enqueue a global reindex when superseded', async () => {
    expect(await initAndRun({ status: 'superseded', baselineVersion: 43 })).toEqual([]);
  });
});

describe('MarketplaceIndexerService.globalReindex target-version guard (Step 7)', () => {
  function makeIndexer(baselineVersion: number) {
    const indexSessionCalls: string[] = [];
    const baselineService = {
      getCurrentBaseline: vi.fn(async () => ({
        globalMean: 4.3,
        baselineVersion,
        computedAt: new Date(),
      })),
    } as any;
    const allSessions: Array<{ id: string; visibility: string; status: string }> = [
      { id: '1', visibility: 'PUBLIC', status: 'SCHEDULED' },
      { id: '2', visibility: 'PUBLIC', status: 'LIVE' },
      { id: '3', visibility: 'PRIVATE', status: 'SCHEDULED' },
      { id: '4', visibility: 'PUBLIC', status: 'CANCELLED' },
    ];
    const repo = {
      find: vi.fn(async (opts: any) => {
        // In([...]) yields a TypeORM FindOperator with a private `_value`.
        const rawStatus = opts.where.status;
        const statuses: string[] =
          Array.isArray(rawStatus) ? rawStatus : (rawStatus?._value ?? []);
        return allSessions.filter(
          (s) =>
            s.visibility === opts.where.visibility &&
            statuses.includes(s.status),
        );
      }),
    };
    const connection = {
      rawConnection: { getRepository: vi.fn(() => repo) },
    } as any;
    const indexer = new MarketplaceIndexerService(
      connection,
      {} as any,
      {} as any,
      baselineService,
      {} as any,
      {} as any,
    );
    (indexer as any).indexSession = vi.fn(async (id: string) => {
      indexSessionCalls.push(id);
    });
    return { indexer, indexSessionCalls, repo };
  }

  it('reindexes only eligible PUBLIC+SCHEDULED/LIVE sessions when target matches', async () => {
    const { indexer, indexSessionCalls, repo } = makeIndexer(42);
    await indexer.globalReindex(42, ctx);
    expect(repo.find).toHaveBeenNthCalledWith(1, {
      where: {
        visibility: 'PUBLIC',
        status: expect.objectContaining({ _value: ['SCHEDULED', 'LIVE'] }),
      },
    });
    expect(indexSessionCalls).toEqual(['1', '2']);
  });

  it('aborts WITHOUT reindexing when the authoritative baseline advanced past the target', async () => {
    const { indexer, indexSessionCalls } = makeIndexer(43);
    await indexer.globalReindex(42, ctx);
    expect(indexSessionCalls).toEqual([]);
  });
});
describe('MarketplaceIndexerService.measureConvergence (Step 8)', () => {
  function makeIndexerForConvergence(esDocs: Array<{ id: string; baselineVersion: number }>) {
    const allSessions: Array<{ id: string; visibility: string; status: string }> = [
      { id: '1', visibility: 'PUBLIC', status: 'SCHEDULED' },
      { id: '2', visibility: 'PUBLIC', status: 'LIVE' },
      { id: '3', visibility: 'PUBLIC', status: 'SCHEDULED' }, // eligible, missing from ES
      { id: '4', visibility: 'PRIVATE', status: 'SCHEDULED' }, // not eligible
      { id: '5', visibility: 'PUBLIC', status: 'CANCELLED' }, // not eligible
    ];
    const repo = {
      find: vi.fn(async () =>
        allSessions.filter(
          (s) =>
            s.visibility === 'PUBLIC' &&
            (s.status === 'SCHEDULED' || s.status === 'LIVE'),
        ),
      ),
    };
    const connection = {
      rawConnection: { getRepository: vi.fn(() => repo) },
    } as any;
    const configService = {
      entityIdStrategy: { encodeId: (id: any) => String(id) },
    } as any;
    const baselineService = { getCurrentBaseline: vi.fn() } as any;
    const indexer = new MarketplaceIndexerService(
      connection,
      {} as any,
      {} as any,
      baselineService,
      configService,
      {} as any,
    );
    (indexer as any).client = {
      search: vi.fn(async () => ({ hits: { hits: esDocs.map((d) => ({ _source: d })) } })),
      index: vi.fn(),
      delete: vi.fn(),
    };
    return { indexer, repo };
  }

  it('counts converged only against docs with the target baselineVersion; missing docs are stale', async () => {
    const { indexer, repo } = makeIndexerForConvergence([
      { id: '1', baselineVersion: 42 },
      { id: '2', baselineVersion: 41 }, // stale (wrong version)
    ]);
    const report = await indexer.measureConvergence(42, ctx);
    // Eligible public sessions are 1, 2, 3 (PRIVATE 4 and CANCELLED 5 excluded).
    expect(repo.find).toHaveBeenCalledTimes(1);
    expect(report).toEqual({ total: 3, converged: 1, stale: 2 });
  });

  it('is read-only: only queries ES, never writes/deletes', async () => {
    const { indexer } = makeIndexerForConvergence([{ id: '1', baselineVersion: 42 }]);
    await indexer.measureConvergence(42, ctx);
    expect((indexer as any).client.search).toHaveBeenCalledTimes(1);
    expect((indexer as any).client.index).not.toHaveBeenCalled();
    expect((indexer as any).client.delete).not.toHaveBeenCalled();
  });
});

describe('MarketplaceIndexerService.globalReindex mid-run version-advance guard (Step 8)', () => {
  it('stops reindexing when the baseline advances to a newer version mid-run', async () => {
    const indexSessionCalls: string[] = [];
    const sessions = [
      { id: '1', visibility: 'PUBLIC', status: 'SCHEDULED' },
      { id: '2', visibility: 'PUBLIC', status: 'SCHEDULED' },
      { id: '3', visibility: 'PUBLIC', status: 'SCHEDULED' },
    ];
    const repo = { find: vi.fn(async () => sessions) };
    const connection = { rawConnection: { getRepository: vi.fn(() => repo) } } as any;
    // Baseline is V42 for the initial guard + first iteration, then advances to
    // V43 on the second iteration's mid-run check.
    const baselineService = {
      getCurrentBaseline: vi
        .fn()
        .mockResolvedValueOnce({ globalMean: 4.3, baselineVersion: 42, computedAt: new Date() })
        .mockResolvedValueOnce({ globalMean: 4.3, baselineVersion: 42, computedAt: new Date() })
        .mockResolvedValue({ globalMean: 4.5, baselineVersion: 43, computedAt: new Date() }),
    } as any;
    const indexer = new MarketplaceIndexerService(
      connection,
      {} as any,
      {} as any,
      baselineService,
      {} as any,
      {} as any,
    );
    (indexer as any).indexSession = vi.fn(async (id: string) => {
      indexSessionCalls.push(id);
    });
    (indexer as any).client = { index: vi.fn(), delete: vi.fn() };

    await indexer.globalReindex(42, ctx);
    // Only session '1' is written before the V43 advance is detected; the rest
    // are left to the newer generation's reindex (no mixed-version writes).
    expect(indexSessionCalls).toEqual(['1']);
  });
});
