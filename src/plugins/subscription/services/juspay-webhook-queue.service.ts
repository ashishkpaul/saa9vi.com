import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { JobQueue, JobQueueService } from "@vendure/core";
import { JuspayWebhookProcessorService } from "./juspay-webhook-processor.service";

const loggerCtx = "JuspayWebhookQueueService";
const QUEUE_NAME = "juspay-webhook-process";

export interface JuspayWebhookJobData {
    eventId: string;
}

/**
 * BullMQ queue for Juspay webhook processing. The controller enqueues only
 * the persisted event ID (the row itself is the durable record — INV-004).
 *
 * Retry semantics: failed jobs are retried by BullMQ. Re-processing is safe
 * because every financial transition in the processor is guarded (dedupeKey,
 * terminal-attempt protection, idempotent mandate FSM) — retries cannot
 * duplicate financial effects.
 */
@Injectable()
export class JuspayWebhookQueueService implements OnModuleInit {
    private readonly logger = new Logger(loggerCtx);
    private jobQueue!: JobQueue<JuspayWebhookJobData>;

    constructor(
        private readonly jobQueueService: JobQueueService,
        private readonly processor: JuspayWebhookProcessorService,
    ) {}

    async onModuleInit(): Promise<void> {
        this.jobQueue = await this.jobQueueService.createQueue({
            name: QUEUE_NAME,
            process: async (job) => {
                await this.processor.processEvent(job.data.eventId);
            },
        });
        this.logger.log(`Juspay webhook queue initialized: ${QUEUE_NAME}`);
    }

    async enqueueEventId(eventId: string): Promise<void> {
        await this.jobQueue.add({ eventId }, { retries: 5 });
    }
}
