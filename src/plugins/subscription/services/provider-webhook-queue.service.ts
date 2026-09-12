import { Injectable, Logger, OnModuleInit, Inject } from '@nestjs/common';
import { JobQueue, JobQueueService, RequestContextService, TransactionalConnection } from '@vendure/core';
import { ProviderWebhookEvent } from '../entities/provider-webhook-event.entity';
import { SubscriptionProviderBinding } from '../entities/subscription-provider-binding.entity';
import { RazorpayWebhookProcessor } from '../providers/razorpay/razorpay-webhook.processor';

const loggerCtx = 'ProviderWebhookQueueService';
const QUEUE_NAME = 'provider-webhook-processing';

/**
 * Total processing attempts before terminal failure.
 *
 * BullMQ `retries: N` means N retries AFTER the initial attempt, giving N+1 total executions.
 * We want exactly 3 total attempts, so we set `retries: 2`.
 *
 * State machine:
 *   attempt 1 fails → pending (BullMQ retry 1)
 *   attempt 2 fails → pending (BullMQ retry 2)
 *   attempt 3 fails → failed (terminal, no more retries)
 */
const MAX_ATTEMPTS = 3;
const BULLMQ_RETRIES = MAX_ATTEMPTS - 1;

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
            { retries: BULLMQ_RETRIES },
        );
    }

    /**
     * Process a webhook event from the immutable inbox.
     * Loads the record, resolves the provider, processes, and updates status.
     *
     * State transitions:
     *   pending + attempt → increment attemptCount, keep pending (retry visibility)
     *   success → processed + processedAt (terminal)
     *   failure + attempts left → keep pending, rethrow for BullMQ retry
     *   failure + no attempts left → failed + failedAt (terminal)
     *
     * Channel resolution order (INV-001):
     *   1. Load inbox event
     *   2. Extract provider subscription ID from payload
     *   3. Resolve binding from provider subscription ID
     *   4. Resolve channel from binding
     *   5. Process event
     *   6. Persist resolved channel + processed status
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

        // Increment attempt count for visibility (does not change status yet)
        event.attemptCount += 1;
        await repo.save(event);

        // Resolve channel from binding BEFORE processing (INV-001)
        const resolvedChannelId = await this.resolveChannelFromBinding(ctx, event);

        try {
            // Route to the appropriate provider processor
            if (event.provider === 'razorpay') {
                const processor = new RazorpayWebhookProcessor(this.connection);
                await processor.processInboxEvent(ctx, event);
            } else {
                Logger.warn(`Unknown provider: ${event.provider}`, loggerCtx);
                throw new Error(`Unsupported provider: ${event.provider}`);
            }

            // Persist resolved channel
            if (resolvedChannelId) {
                event.channelId = resolvedChannelId;
            }

            // Mark as processed (terminal success)
            event.processingStatus = 'processed';
            event.processedAt = new Date();
            event.failedAt = null;
            event.errorMessage = null;
            await repo.save(event);

            Logger.log(`Webhook event ${eventId} processed successfully`, loggerCtx);
        } catch (err: any) {
            // Update error message for operational visibility
            event.errorMessage = err?.message || 'Unknown error';

            if (event.attemptCount >= MAX_ATTEMPTS) {
                // Terminal failure: all retries exhausted
                event.processingStatus = 'failed';
                event.failedAt = new Date();
                await repo.save(event);
                Logger.error(`Webhook event ${eventId} terminal failure after ${event.attemptCount} attempts: ${err?.message}`, loggerCtx);
            } else {
                // Retryable: keep pending, save error for visibility
                await repo.save(event);
                Logger.warn(`Webhook event ${eventId} attempt ${event.attemptCount} failed (will retry): ${err?.message}`, loggerCtx);
            }

            // Re-throw so BullMQ knows the job failed (triggers retry or dead-letter)
            throw err;
        }
    }

    /**
     * Resolve the authoritative channel from the provider binding.
     * The binding's channel is the source of truth for tenant identity (INV-001).
     *
     * Error handling:
     *   - No subscription ID in payload → return null (controlled, no binding possible)
     *   - Binding not found → return null (controlled, may be for different provider)
     *   - Database error → throws (must not be silently converted to "no binding")
     */
    private async resolveChannelFromBinding(ctx: any, event: ProviderWebhookEvent): Promise<string | null> {
        const payload = event.rawPayload as any;
        const subscriptionId = payload?.subscription?.entity?.id
            || payload?.subscription_id
            || payload?.entity?.id;

        if (!subscriptionId) {
            Logger.warn(`No subscription ID in event ${event.payloadHash} to resolve channel`, loggerCtx);
            return null;
        }

        try {
            const binding = await this.connection.getRepository(ctx, SubscriptionProviderBinding)
                .findOne({ where: { provider: event.provider, providerSubscriptionId: subscriptionId } });

            if (!binding) {
                Logger.warn(`No provider binding found for subscription ${subscriptionId}`, loggerCtx);
                return null;
            }

            return binding.channelId;
        } catch (err: any) {
            // Database error — must NOT be silently converted to "no binding"
            Logger.error(`Database error resolving channel from binding for subscription ${subscriptionId}: ${err?.message}`, loggerCtx);
            throw err;
        }
    }
}
