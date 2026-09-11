import { Injectable, Logger, OnModuleInit, Inject } from '@nestjs/common';
import { JobQueue, JobQueueService, RequestContextService, TransactionalConnection } from '@vendure/core';
import { ProviderWebhookEvent } from '../entities/provider-webhook-event.entity';
import { RazorpayWebhookProcessor } from '../providers/razorpay/razorpay-webhook.processor';

const loggerCtx = 'ProviderWebhookQueueService';
const QUEUE_NAME = 'provider-webhook-processing';

export interface ProviderWebhookJobData {
    eventId: number;
}

/**
 * BullMQ job queue for processing provider webhooks.
 *
 * Architecture (INV-004):
 *   POST → verify → persist ProviderWebhookEvent → enqueue event ID → return 2xx
 *   Worker loads inbox record → resolves provider → processes → marks PROCESSED/FAILED
 *
 * The queue payload is ONLY the immutable inbox ID — never the transient HTTP payload.
 * This ensures replayability and auditability.
 */
@Injectable()
export class ProviderWebhookQueueService implements OnModuleInit {
    private jobQueue!: JobQueue<ProviderWebhookJobData>;

    constructor(
        private readonly jobQueueService: JobQueueService,
        @Inject('RAW_CONNECTION') private readonly connection: any,
        private readonly requestContextService: RequestContextService,
    ) {}

    async onModuleInit(): Promise<void> {
        this.jobQueue = await this.jobQueueService.createQueue({
            name: QUEUE_NAME,
            process: async (job) => {
                await this.processWebhookEvent(job.data.eventId);
            },
        });
        Logger.log(`Provider webhook processing queue initialized: ${QUEUE_NAME}`, loggerCtx);
    }

    /**
     * Enqueue a provider webhook event for async processing.
     * Only the inbox record ID is passed — the worker loads the full event.
     */
    async enqueueWebhookEvent(eventId: number): Promise<void> {
        await this.jobQueue.add(
            { eventId },
            { retries: 3 },
        );
    }

    /**
     * Process a webhook event from the immutable inbox.
     * Loads the record, resolves the provider, processes, and updates status.
     */
    private async processWebhookEvent(eventId: number): Promise<void> {
        const ctx = await this.requestContextService.create({ apiType: 'admin' });
        const repo = this.connection.getRepository(ctx, ProviderWebhookEvent);

        const event = await repo.findOne({ where: { id: eventId } });
        if (!event) {
            Logger.error(`ProviderWebhookEvent ${eventId} not found`, loggerCtx);
            return;
        }

        if (event.processingStatus === 'processed') {
            Logger.log(`Event ${eventId} already processed, skipping`, loggerCtx);
            return;
        }

        try {
            // Route to the appropriate provider processor
            if (event.provider === 'razorpay') {
                const processor = new RazorpayWebhookProcessor(this.connection);
                await processor.processInboxEvent(ctx, event);
            } else {
                Logger.warn(`Unknown provider: ${event.provider}`, loggerCtx);
                throw new Error(`Unsupported provider: ${event.provider}`);
            }

            // Mark as processed
            event.processingStatus = 'processed';
            event.processedAt = new Date();
            await repo.save(event);

            Logger.log(`Webhook event ${eventId} processed successfully`, loggerCtx);
        } catch (err: any) {
            // Mark as failed
            event.processingStatus = 'failed';
            event.processedAt = new Date();
            event.errorMessage = err?.message || 'Unknown error';
            await repo.save(event);

            Logger.error(`Webhook event ${eventId} failed: ${err?.message}`, loggerCtx);
            throw err; // Re-throw for BullMQ retry
        }
    }
}
