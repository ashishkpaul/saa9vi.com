import { ScheduledTask } from '@vendure/core';
import { Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { MarketplaceBaselineService } from '../services/marketplace-baseline.service';
import { BaselineRefreshQueueService } from '../services/baseline-refresh-queue.service';

const loggerCtx = 'BayesianBaselineRefreshTask';

/**
 * Daily global Bayesian baseline refresh (Path B of the 3D.1b contract).
 *
 * Vendure's ScheduledTask guarantees single execution across all server/worker
 * instances via locking (preventOverlap defaults to true) — unlike a raw NestJS
 * @Cron(), which would fire on every instance.
 *
 * This task only orchestrates: it generates the durable refreshGeneration
 * (once per scheduled execution) and enqueues a refresh job. The heavy
 * approved-review aggregation and the {G,V,generation} persistence happen in
 * the BaselineRefreshQueueService worker, which owns the retry-generation guard
 * (a crash between persist and the enqueue of the global reindex does not
 * manufacture V+2).
 *
 * The schedule is configurable at deployment level:
 *   MARKETPLACE_BASELINE_INTERVAL  default '0 2 * * *' (daily 2am)
 * Changing the interval (24h → 6h → 1h) is an operational tuning decision — it
 * does not change the meaning of the Bayesian score (3D.1a: periodic frozen
 * baseline).
 */
export const bayesianBaselineRefreshTask = new ScheduledTask({
  id: 'marketplace-bayesian-baseline-refresh',
  description: 'Refresh global Bayesian baseline and trigger ranking convergence',
  schedule: process.env.MARKETPLACE_BASELINE_INTERVAL || '0 2 * * *',
  async execute({ injector, scheduledContext }) {
    const baselineService = injector.get(MarketplaceBaselineService);
    const refreshQueue = injector.get(BaselineRefreshQueueService);

    // Durable operation identity — generated once per scheduled execution and
    // persisted with the baseline so a retried job can distinguish "my previous
    // persist" from "a later refresh advanced the baseline".
    const generation = randomUUID();

    // Capture the current baseline version so a retry of this job can detect
    // that a newer scheduled execution advanced the baseline in the meantime.
    const claimedFromVersion = await baselineService.getCurrentVersion(scheduledContext);

    await refreshQueue.addRefreshBaselineJob(generation, claimedFromVersion);

    Logger.log(
      `Enqueued Bayesian baseline refresh (generation=${generation}, ` +
        `claimedFromVersion=${claimedFromVersion ?? 'none'})`,
      loggerCtx,
    );
    return { generation, claimedFromVersion };
  },
});