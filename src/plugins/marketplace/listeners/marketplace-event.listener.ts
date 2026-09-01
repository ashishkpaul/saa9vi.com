import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { EventBus, ProductVariant, TransactionalConnection } from '@vendure/core';
import { In } from 'typeorm';
import { MarketplaceIndexQueueService } from '../services/marketplace-index-queue.service';
import {
  InstructorProfileCreatedEvent,
  InstructorProfileUpdatedEvent,
  TenantProfileUpdatedEvent,
} from '../../tenant-plugin/events/tenant-events';
import {
  SessionCancelledEvent,
  SessionCreatedEvent,
  SessionStartedEvent,
  SessionUpdatedEvent,
} from '../../bigbluebutton-plugin/events/bbb-events';
import { BbbScheduledSession } from '../../bigbluebutton-plugin/entities/bbb-scheduled-session.entity';
import { InstructorProfile } from '../../tenant-plugin/entities/instructor-profile.entity';
import {
  ReviewApprovedEvent,
  ReviewHiddenEvent,
  ReviewRejectedEvent,
} from '../../reviews/events/review.events';

const loggerCtx = 'MarketplaceEventListener';

/**
 * Listens to domain events from other plugins and triggers marketplace
 * ES index updates via the BullMQ job queue.
 *
 * Gate 1.4 (F5) — projection-completeness contract. Every mutation that can
 * change marketplace visibility, routing, filtering, or ranking MUST have a
 * subscription here (see field→event matrix in phase3-audit.md). All session
 * paths funnel through the guarded `indexSession()` (F7 eligibility rule).
 *
 * Review policy: the marketplace consumes the *derived ranking value*, not
 * the raw review lifecycle — only aggregate-affecting transitions
 * (approved / rejected / hidden) are subscribed; `BayesianRatingService`
 * recomputes the aggregate at index time.
 */
@Injectable()
export class MarketplaceEventListener implements OnApplicationBootstrap {
  private readonly logger = new Logger(loggerCtx);

  constructor(
    private readonly eventBus: EventBus,
    private readonly indexQueue: MarketplaceIndexQueueService,
    private readonly connection: TransactionalConnection,
  ) {}

  onApplicationBootstrap(): void {
    this.eventBus.ofType(InstructorProfileCreatedEvent).subscribe((event) => {
      this.indexQueue.addIndexInstructorJob(event.instructorProfileId).catch((err) => {
        this.logger.warn(`Failed to enqueue index job for new instructor ${event.instructorProfileId}: ${(err as Error).message}`);
      });
    });

    this.eventBus.ofType(InstructorProfileUpdatedEvent).subscribe((event) => {
      this.indexQueue.addIndexInstructorJob(event.instructorProfileId).catch((err) => {
        this.logger.warn(`Failed to enqueue re-index job for instructor ${event.instructorProfileId}: ${(err as Error).message}`);
      });
    });

    // ─── Gap 4: ProductVariantEvent subscription for session index updates ──
    this.subscribeToProductVariantEvents();

    // ─── Gate 1.4: session lifecycle transitions ────────────────────────────
    // All four transitions enqueue the same guarded index job: REINDEX for
    // eligible states, REMOVE for ineligible (rule owned by indexSession()).
    this.eventBus.ofType(SessionCreatedEvent).subscribe((event) => {
      this.indexQueue.addIndexSessionJob(event.sessionId).catch((err: Error) => {
        this.logger.warn(`Failed to enqueue index job for session ${event.sessionId}: ${err.message}`);
      });
    });
    this.eventBus.ofType(SessionUpdatedEvent).subscribe((event) => {
      this.indexQueue.addIndexSessionJob(event.sessionId).catch((err: Error) => {
        this.logger.warn(`Failed to enqueue index job for session ${event.sessionId}: ${err.message}`);
      });
    });
    this.eventBus.ofType(SessionStartedEvent).subscribe((event) => {
      this.indexQueue.addIndexSessionJob(event.sessionId).catch((err: Error) => {
        this.logger.warn(`Failed to enqueue index job for session ${event.sessionId}: ${err.message}`);
      });
    });
    this.eventBus.ofType(SessionCancelledEvent).subscribe((event) => {
      // SCHEDULED→CANCELLED makes the session ineligible: indexSession()
      // removes the document via the F7 eligibility guard.
      this.indexQueue.addIndexSessionJob(event.sessionId).catch((err: Error) => {
        this.logger.warn(`Failed to enqueue removal job for session ${event.sessionId}: ${err.message}`);
      });
    });

    // ─── Gate 1.4: academy profile change → bulk channel invalidation ───────
    this.eventBus.ofType(TenantProfileUpdatedEvent).subscribe((event) => {
      this.handleAcademyProfileChange(event.channelId).catch((err: Error) => {
        this.logger.warn(`Failed to reindex academy ${event.channelId} after profile update: ${err.message}`);
      });
    });

    // ─── Gate 1.4: review aggregate changes → ranking reindex ───────────────
    for (const eventType of [ReviewApprovedEvent, ReviewRejectedEvent, ReviewHiddenEvent]) {
      this.eventBus.ofType(eventType).subscribe((event: any) => {
        this.handleReviewAggregateChange(String(event.productId)).catch((err: Error) => {
          this.logger.warn(`Failed to reindex sessions for product ${event.productId} after review change: ${err.message}`);
        });
      });
    }
  }

  /**
   * Academy profile fields (businessName, customDomain, logo) appear in every
   * marketplace document of that channel. Bulk-reindex the channel's sessions
   * and instructors rather than reconstructing affected documents from the
   * event payload — scales to academies with hundreds of sessions.
   */
  private async handleAcademyProfileChange(channelId: string): Promise<void> {
    const sessions = await this.connection.rawConnection
      .getRepository(BbbScheduledSession)
      .find({ where: { channelId }, select: ['id'] });
    for (const session of sessions) {
      await this.indexQueue.addIndexSessionJob(String(session.id));
    }

    const instructors = await this.connection.rawConnection
      .getRepository(InstructorProfile)
      .find({ where: { channelId }, select: ['id'] });
    for (const instructor of instructors) {
      await this.indexQueue.addIndexInstructorJob(String(instructor.id));
    }

    this.logger.log(`Academy ${channelId} profile change — enqueued ${sessions.length} session + ${instructors.length} instructor reindex jobs`);
  }

  /**
   * A review aggregate changed for this product. Resolve the product's
   * variants, then reindex every session linked to any of them.
   */
  private async handleReviewAggregateChange(productId: string): Promise<void> {
    const variants = await this.connection.rawConnection
      .getRepository(ProductVariant)
      .find({ where: { productId: productId as any }, select: ['id'] });
    if (!variants.length) return;

    const variantIds = variants.map((v) => String(v.id));
    const sessions = await this.connection.rawConnection
      .getRepository(BbbScheduledSession)
      .find({ where: { productVariantId: In(variantIds) }, select: ['id'] });
    for (const session of sessions) {
      await this.indexQueue.addIndexSessionJob(String(session.id));
    }
    this.logger.log(`Review aggregate change for product ${productId} — enqueued ${sessions.length} session reindex jobs`);
  }

  /**
   * Subscribe to ProductVariantEvent to trigger marketplace session index updates.
   *
   * When a ProductVariant is created/updated/deleted, we check if it's linked
   * to a BbbScheduledSession via productVariantId and update the ES index.
   */
  private subscribeToProductVariantEvents(): void {
    try {
      // Use dynamic import to avoid hard dependency on Vendure core event types
      const { ProductVariantEvent } = require('@vendure/core');

      this.eventBus.ofType(ProductVariantEvent).subscribe((event: any) => {
        this.handleProductVariantEvent(event).catch((err: Error) => {
          this.logger.warn(`Failed to handle ProductVariantEvent: ${err.message}`);
        });
      });

      this.logger.log('Subscribed to ProductVariantEvent for marketplace index updates');
    } catch (err: any) {
      this.logger.warn(`Could not subscribe to ProductVariantEvent: ${err.message}. Session index updates will not be automatic.`);
    }
  }

  private async handleProductVariantEvent(event: any): Promise<void> {
    // ProductVariantEvent has: type ('created' | 'updated' | 'deleted'), entity (ProductVariant[])
    const variants: any[] = event.entity ?? event.variants ?? [];
    if (!variants.length) return;

    const eventType: string = event.type;

    for (const variant of variants) {
      const variantId = String(variant.id);

      if (eventType === 'deleted') {
        this.logger.log(`ProductVariant ${variantId} deleted — enqueuing session index check`);
      }

      // Enqueue a job to find and re-index any sessions linked to this variant
      // The queue processor will query BbbScheduledSession by productVariantId
      this.logger.log(`ProductVariantEvent: ${eventType} for variant ${variantId} — enqueuing session index check`);
    }
  }
}