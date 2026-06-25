import { Injectable, Logger } from "@nestjs/common";
import {
  JobQueue,
  JobQueueService,
  RequestContext,
  RequestContextService,
  SerializedRequestContext,
  TransactionalConnection,
} from "@vendure/core";
import { BbbWebhookEvent } from "../entities/bbb-webhook-event.entity";
import { BbbMeetingService } from "./bbb-meeting.service";
import { BBB_WEBHOOK_QUEUE } from "../constants";

const loggerCtx = "BbbWebhookProcessorService";

export interface WebhookProcessorJobData {
  eventId: string;
  serializedCtx: SerializedRequestContext;
}

/**
 * Processes persisted BBB webhook events via a dedicated job queue.
 *
 * The queue processor:
 * 1. Loads the persisted BbbWebhookEvent by ID
 * 2. Creates an admin RequestContext
 * 3. Delegates to BbbMeetingService.handleWebhookEvent()
 * 4. Updates event status to PROCESSED or FAILED
 *
 * Failed events remain in the DB for replay/audit — they are never auto-deleted.
 */
@Injectable()
export class BbbWebhookProcessorService {
  private queue: JobQueue<WebhookProcessorJobData> | null = null;

  constructor(
    private readonly jobQueueService: JobQueueService,
    private readonly connection: TransactionalConnection,
    private readonly ctxService: RequestContextService,
    private readonly meetingService: BbbMeetingService,
  ) {}

  async init(): Promise<void> {
    if (this.queue) return; // Guard: prevent double-initialization

    this.queue = await this.jobQueueService.createQueue<WebhookProcessorJobData>(
      {
        name: BBB_WEBHOOK_QUEUE,
        process: async (job) => {
          const { eventId, serializedCtx } = job.data;
          const ctx = RequestContext.deserialize(serializedCtx);
          await this.processEvent(ctx, eventId, job.id as string);
        },
      },
    );

    Logger.log("BBB webhook processor queue initialized", loggerCtx);
  }

  /**
   * Enqueues a webhook event for async processing.
   * Called by BbbWebhookController after persisting the event.
   */
  async enqueueEvent(eventId: string, ctx: RequestContext): Promise<void> {
    if (!this.queue) {
      Logger.error(
        `Cannot enqueue webhook event ${eventId}: queue not initialized`,
        loggerCtx,
      );
      return;
    }

    await this.queue.add({
      eventId,
      serializedCtx: ctx.serialize(),
    });

    Logger.debug(`Webhook event ${eventId} enqueued for processing`, loggerCtx);
  }

  /**
   * Loads the persisted event, delegates to BbbMeetingService, and updates status.
   */
  private async processEvent(
    ctx: RequestContext,
    eventId: string,
    _jobId: string,
  ): Promise<void> {
    const repo = this.connection.getRepository(ctx, BbbWebhookEvent);

    const event = await repo.findOne({ where: { id: eventId as string } });
    if (!event) {
      Logger.error(
        `Webhook event ${eventId} not found in DB for processing`,
        loggerCtx,
      );
      return;
    }

    if (event.status !== "PENDING") {
      Logger.warn(
        `Webhook event ${eventId} is in status ${event.status}, skipping processing`,
        loggerCtx,
      );
      return;
    }

    try {
      await this.meetingService.handleWebhookEvent(
        ctx,
        event.eventType,
        event.payload,
      );

      event.status = "PROCESSED";
      event.processedAt = new Date();
      await repo.save(event);

      Logger.debug(
        `Webhook event ${eventId} (${event.eventType}) processed successfully`,
        loggerCtx,
      );
    } catch (err) {
      const errorMessage = (err as Error).message;

      Logger.error(
        `Webhook event ${eventId} (${event.eventType}) processing failed: ${errorMessage}`,
        loggerCtx,
      );

      event.status = "FAILED";
      event.processedAt = new Date();
      event.errorMessage = errorMessage;
      await repo.save(event);

      // Re-throw so the BullMQ job infrastructure marks this job as failed
      // and applies any configured retry logic.
      throw err;
    }
  }
}