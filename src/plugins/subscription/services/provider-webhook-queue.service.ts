import { Injectable, Logger, OnModuleInit, Inject } from '@nestjs/common';
import { JobQueue, JobQueueService, RequestContextService, TransactionalConnection } from '@vendure/core';
import { ProviderWebhookEvent } from '../entities/provider-webhook-event.entity';
import { SubscriptionProviderBinding } from '../entities/subscription-provider-binding.entity';
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
        private readonly connection: TransactionalConnection,
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

            // Resolve authoritative channel from provider binding (INV-001)
            const resolvedChannelId = await this.resolveChannelFromBinding(ctx, event);
            if (resolvedChannelId) {
                event.channelId = resolvedChannelId;
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

    /**
     * Resolve the authoritative channel from the provider binding.
     * The binding's channel is the source of truth for tenant identity (INV-001).
     */
    private async resolveChannelFromBinding(ctx: any, event: ProviderWebhookEvent): Promise<string | null> {
        try {
            const payload = event.rawPayload as any;
            const subscriptionId = payload?.subscription?.entity?.id
                || payload?.subscription_id
                || payload?.entity?.id;

            if (!subscriptionId) {
                Logger.warn(`No subscription ID in event ${event.payloadHash} to resolve channel`, loggerCtx);
                return null;
            }

            const binding = await this.connection.getRepository(ctx, SubscriptionProviderBinding)
                .findOne({ where: { provider: event.provider, providerSubscriptionId: subscriptionId } });

            if (!binding) {
                Logger.warn(`No provider binding found for subscription ${subscriptionId}`, loggerCtx);
                return null;
            }

            return binding.channelId;
        } catch (err: any) {
            Logger.error(`Failed to resolve channel from binding: ${err?.message}`, loggerCtx);
            return null;
        }
    }
}
