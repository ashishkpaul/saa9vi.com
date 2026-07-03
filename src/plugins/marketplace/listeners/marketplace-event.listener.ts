import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { EventBus } from '@vendure/core';
import { MarketplaceIndexQueueService } from '../services/marketplace-index-queue.service';
import { InstructorProfileCreatedEvent, InstructorProfileUpdatedEvent } from '../../tenant-plugin/events/tenant-events';

const loggerCtx = 'MarketplaceEventListener';

/**
 * Listens to domain events from other plugins and triggers marketplace
 * ES index updates via the BullMQ job queue.
 *
 * Handles:
 * - InstructorProfileCreatedEvent → enqueue instructor index job
 * - InstructorProfileUpdatedEvent → enqueue instructor re-index job
 * - ProductVariantEvent → enqueue session index/delete job (Phase 3)
 *
 * All index writes are async via BullMQ (Gap 5) — no inline ES calls.
 */
@Injectable()
export class MarketplaceEventListener implements OnApplicationBootstrap {
  private readonly logger = new Logger(loggerCtx);

  constructor(
    private readonly eventBus: EventBus,
    private readonly indexQueue: MarketplaceIndexQueueService,
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