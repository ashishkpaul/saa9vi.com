import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { JobQueue, JobQueueService } from '@vendure/core';
import { MarketplaceBaselineService } from './marketplace-baseline.service';

const loggerCtx = 'BaselineRefreshQueueService';
const QUEUE_NAME = 'marketplace-baseline-refresh';

export interface BaselineRefreshJobData {
  /** Durable identity generated once per scheduled execution (Step 5 guard). */
  generation: string;
  /**
   * The authoritative baseline version captured at schedule time. Lets a
   * retry detect that a newer scheduled refresh advanced the baseline while
   * this job was pending, so an older job never overwrites a newer baseline.
   */
  claimedFromVersion?: number;
}

/**
 * Decoupled queue for the global Bayesian baseline refresh (Path B).
 *
 * The ScheduledTask (Step 6) does NOT do the heavy approved-review aggregation
 * inline — it only generates the durable refreshGeneration, reads the current
 * baseline version, and enqueues a refresh job here. The worker performs the
 * refresh (compute G → persist {G, V, computedAt, refreshGeneration}) using the
 * retry-generation guard established in Step 5.
 */
@Injectable()
export class BaselineRefreshQueueService implements OnModuleInit {
  private readonly logger = new Logger(loggerCtx);
  private jobQueue!: JobQueue<BaselineRefreshJobData>;

  constructor(
    private readonly jobQueueService: JobQueueService,
    private readonly baselineService: MarketplaceBaselineService,
  ) {}

  async onModuleInit(): Promise<void> {
    this.jobQueue = await this.jobQueueService.createQueue({
      name: QUEUE_NAME,
      process: async (job) => {
        const { generation, claimedFromVersion } = job.data;
        const ctx = await this.baselineService.createInternalContext();
        const result = await this.baselineService.refreshBaseline(ctx, generation, {
          ...(claimedFromVersion != null ? { claimedFromVersion } : {}),
        });
        this.logger.log(
          `Baseline refresh (${generation}): status=${result.status} ` +
            `version=${result.baselineVersion}` +
            (result.globalMean != null ? ` mean=${result.globalMean}` : ''),
        );
        // Step 7 (global target-version reindex) consumes a committed version
        // here to converge ES documents to the frozen baseline.
        return result;
      },
    });
    this.logger.log(`Baseline refresh queue initialized: ${QUEUE_NAME}`);
  }

  async addRefreshBaselineJob(
    generation: string,
    claimedFromVersion?: number,
  ): Promise<void> {
    await this.jobQueue.add(
      { generation, claimedFromVersion },
      { retries: 3 },
    );
  }
}