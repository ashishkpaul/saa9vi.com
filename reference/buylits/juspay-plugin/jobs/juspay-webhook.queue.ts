import { Injectable, Inject, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { JUSPAY_PLUGIN_OPTIONS, JUSPAY_WEBHOOK_JOB } from '../constants';
import type { JuspayPluginOptions } from '../options';
import type { JuspayWebhookEvent } from '../types';
import { JobQueueService } from '@vendure/core';
import { JuspayService } from '../service/juspay.service';

@Injectable()
export class JuspayWebhookQueue implements OnApplicationBootstrap {
  private readonly logger = new Logger(JuspayWebhookQueue.name);
  private queue: any; // JobQueue<JuspayWebhookEvent>

  constructor(
    @Inject(JUSPAY_PLUGIN_OPTIONS) private readonly opts: JuspayPluginOptions,
    private readonly jobQueueService: JobQueueService,
    private readonly juspayService: JuspayService
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    // Create queue with name = JUSPAY_WEBHOOK_JOB
    this.queue = await this.jobQueueService.createQueue({
      name: JUSPAY_WEBHOOK_JOB,
      process: async (job) => {
        await this.juspayService.handleWebhookEvent(job.data as JuspayWebhookEvent);
      }
    });

    // Log 'Juspay webhook job queue ready' after creation
    this.logger.log('Juspay webhook job queue ready');
  }

  /**
   * Encapsulates all retry logic. Controllers call this only.
   */
  async enqueue(event: JuspayWebhookEvent): Promise<void> {
    // Calls this.queue.add(event, { retries: opts.webhookJobRetries ?? 3 })
    // This is the ONLY public method for adding jobs
    // Controllers must NOT call queue.add() directly
    await this.queue.add(event, { 
      retries: this.opts.webhookJobRetries ?? 3 
    });
  }
}