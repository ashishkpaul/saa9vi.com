import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { JobQueue, JobQueueService } from '@vendure/core';
import { MarketplaceIndexerService } from './marketplace-indexer.service';

const loggerCtx = 'MarketplaceIndexQueueService';
const QUEUE_NAME = 'marketplace-index';

export interface IndexSessionJobData {
  type: 'index-session';
  sessionId: string;
}

export interface DeleteSessionJobData {
  type: 'delete-session';
  sessionId: string;
}

export interface IndexInstructorJobData {
  type: 'index-instructor';
  profileId: string;
}

export interface DeleteInstructorJobData {
  type: 'delete-instructor';
  profileId: string;
}

export type MarketplaceIndexJobData =
  | IndexSessionJobData
  | DeleteSessionJobData
  | IndexInstructorJobData
  | DeleteInstructorJobData;

/**
 * BullMQ job queue for async marketplace ES index writes.
 *
 * Previously, index writes were inline in event handlers. This queue
 * decouples event processing from ES writes, providing:
 * - Retry on ES failures (3 attempts with exponential backoff)
 * - No blocking of event handlers on ES latency
 * - Audit trail of failed index operations
 */
@Injectable()
export class MarketplaceIndexQueueService implements OnModuleInit {
  private readonly logger = new Logger(loggerCtx);
  private jobQueue!: JobQueue<MarketplaceIndexJobData>;

  constructor(
    private readonly jobQueueService: JobQueueService,
    private readonly indexerService: MarketplaceIndexerService,
  ) {}

  async onModuleInit(): Promise<void> {
    this.jobQueue = await this.jobQueueService.createQueue({
      name: QUEUE_NAME,
      process: async (job) => {
        const data = job.data;
        this.logger.log(`Processing index job: ${data.type}`);

        switch (data.type) {
          case 'index-session':
            await this.indexerService.indexSession(data.sessionId);
            break;
          case 'delete-session':
            await this.indexerService.deleteSession(data.sessionId);
            break;
          case 'index-instructor':
            await this.indexerService.indexInstructor(data.profileId);
            break;
          case 'delete-instructor':
            await this.indexerService.deleteInstructor(data.profileId);
            break;
        }
      },
    });
    this.logger.log(`Marketplace index queue initialized: ${QUEUE_NAME}`);
  }

  async addIndexSessionJob(sessionId: string): Promise<void> {
    await this.jobQueue.add(
      { type: 'index-session', sessionId },
      { retries: 3 },
    );
  }

  async addDeleteSessionJob(sessionId: string): Promise<void> {
    await this.jobQueue.add(
      { type: 'delete-session', sessionId },
      { retries: 3 },
    );
  }

  async addIndexInstructorJob(profileId: string): Promise<void> {
    await this.jobQueue.add(
      { type: 'index-instructor', profileId },
      { retries: 3 },
    );
  }

  async addDeleteInstructorJob(profileId: string): Promise<void> {
    await this.jobQueue.add(
      { type: 'delete-instructor', profileId },
      { retries: 3 },
    );
  }
}