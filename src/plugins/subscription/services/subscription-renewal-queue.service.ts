import { Injectable, Logger, OnModuleInit, Inject, forwardRef } from "@nestjs/common";
import { JobQueue, JobQueueService } from "@vendure/core";
import { SubscriptionRenewalService } from "./subscription-renewal.service";
import { RenewalResult } from "../types";

const loggerCtx = "SubscriptionRenewalQueueService";
const QUEUE_NAME = "subscription-renewal";

export interface SubscriptionRenewalJobData {
  subscriptionId: string;
}

/**
 * BullMQ job queue for processing subscription renewals.
 */
@Injectable()
export class SubscriptionRenewalQueueService implements OnModuleInit {
  private readonly logger = new Logger(loggerCtx);
  private jobQueue!: JobQueue<SubscriptionRenewalJobData>;

  constructor(
    private readonly jobQueueService: JobQueueService,
    @Inject(forwardRef(() => SubscriptionRenewalService))
    private readonly renewalService: SubscriptionRenewalService,
  ) {}

  async onModuleInit(): Promise<void> {
    this.jobQueue = await this.jobQueueService.createQueue({
      name: QUEUE_NAME,
      process: async (job) => {
        this.logger.log(`Processing renewal for subscription ${job.data.subscriptionId}`);
        const result = await this.renewalService.executeRenewal(job.data.subscriptionId);
        if (result === RenewalResult.CAS_CONFLICT) {
          this.logger.log(`Renewal for ${job.data.subscriptionId} skipped: CAS conflict (already processed)`);
        } else if (result !== RenewalResult.SUCCESS) {
          this.logger.warn(`Renewal for ${job.data.subscriptionId} finished with status: ${result}`);
        }
      },
    });
    this.logger.log(`Subscription renewal queue initialized: ${QUEUE_NAME}`);
  }

  /**
   * Adds a renewal job to the queue.
   */
  async addRenewalJob(subscriptionId: string): Promise<void> {
    await this.jobQueue.add(
      { subscriptionId },
      { retries: 5 },
    );
  }
}
