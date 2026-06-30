import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { EventBus } from '@vendure/core';
import { MarketplaceIndexerService } from '../services/marketplace-indexer.service';
import { InstructorProfileCreatedEvent, InstructorProfileUpdatedEvent } from '../../tenant-plugin/events/tenant-events';

const loggerCtx = 'MarketplaceEventListener';

/**
 * Listens to domain events from other plugins and triggers marketplace
 * ES index updates.
 *
 * Currently handles:
 * - InstructorProfileCreatedEvent → index instructor in marketplace
 * - InstructorProfileUpdatedEvent → re-index instructor in marketplace
 *
 * Phase 3 additions:
 * - ProductVariantEvent → index/update session in marketplace
 * - InstructorProfileDeletedEvent → remove from marketplace index
 */
@Injectable()
export class MarketplaceEventListener implements OnApplicationBootstrap {
  private readonly logger = new Logger(loggerCtx);

  constructor(
    private readonly eventBus: EventBus,
    private readonly indexerService: MarketplaceIndexerService,
  ) {}

  onApplicationBootstrap(): void {
    this.eventBus.ofType(InstructorProfileCreatedEvent).subscribe((event) => {
      this.handleInstructorCreated(event).catch((err) => {
        this.logger.warn(`Failed to index new instructor ${event.instructorProfileId}: ${(err as Error).message}`);
      });
    });

    this.eventBus.ofType(InstructorProfileUpdatedEvent).subscribe((event) => {
      this.handleInstructorUpdated(event).catch((err) => {
        this.logger.warn(`Failed to re-index instructor ${event.instructorProfileId}: ${(err as Error).message}`);
      });
    });
  }

  private async handleInstructorCreated(event: InstructorProfileCreatedEvent): Promise<void> {
    await this.indexerService.indexInstructor(event.instructorProfileId);
    this.logger.log(`Marketplace index updated for new instructor: ${event.instructorProfileId}`);
  }

  private async handleInstructorUpdated(event: InstructorProfileUpdatedEvent): Promise<void> {
    await this.indexerService.indexInstructor(event.instructorProfileId);
    this.logger.log(`Marketplace index updated for instructor: ${event.instructorProfileId}`);
  }
}
