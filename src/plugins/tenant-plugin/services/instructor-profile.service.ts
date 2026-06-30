import { Injectable } from '@nestjs/common';
import {
  RequestContext,
  TransactionalConnection,
  ChannelService,
  EntityNotFoundError,
  EventBus,
} from '@vendure/core';
import { InstructorProfile } from '../entities/instructor-profile.entity';
import { InstructorIndexerService } from './instructor-indexer.service';
import { InstructorProfileCreatedEvent, InstructorProfileUpdatedEvent } from '../events/tenant-events';

@Injectable()
export class InstructorProfileService {
  constructor(
    private readonly connection: TransactionalConnection,
    private readonly channelService: ChannelService,
    private readonly indexerService: InstructorIndexerService,
    private readonly eventBus: EventBus,
  ) {}

  async findAll(ctx: RequestContext, options?: { skip?: number; take?: number }): Promise<{ items: InstructorProfile[]; totalItems: number }> {
    const take = Math.min(Math.max(options?.take ?? 25, 1), 100);
    const skip = Math.max(options?.skip ?? 0, 0);
    const channelId = ctx.channelId as string;

    const [items, totalItems] = await this.connection
      .getRepository(ctx, InstructorProfile)
      .findAndCount({
        where: { channelId },
        order: { displayOrder: 'ASC', fullName: 'ASC' },
        skip,
        take,
        relations: ['customer', 'createdBy'],
      });

    return { items, totalItems };
  }

  async findPublicByChannel(ctx: RequestContext, options?: { skip?: number; take?: number }): Promise<{ items: InstructorProfile[]; totalItems: number }> {
    const take = Math.min(Math.max(options?.take ?? 25, 1), 100);
    const skip = Math.max(options?.skip ?? 0, 0);
    const channelId = ctx.channelId as string;

    const [items, totalItems] = await this.connection
      .getRepository(ctx, InstructorProfile)
      .findAndCount({
        where: { channelId, isPublic: true, isActive: true },
        order: { displayOrder: 'ASC', fullName: 'ASC' },
        skip,
        take,
        relations: ['customer'],
      });

    return { items, totalItems };
  }

  async findOne(ctx: RequestContext, id: string): Promise<InstructorProfile | null> {
    return this.connection
      .getRepository(ctx, InstructorProfile)
      .findOne({ where: { id: id as string, channelId: ctx.channelId as string }, relations: ['customer', 'createdBy'] });
  }

  async findPublicBySlug(ctx: RequestContext, slug: string): Promise<InstructorProfile | null> {
    const channelId = ctx.channelId as string;
    return this.connection
      .getRepository(ctx, InstructorProfile)
      .findOne({
        where: { channelId, slug, isPublic: true, isActive: true },
        relations: ['customer', 'createdBy'],
      });
  }

  async create(ctx: RequestContext, input: Partial<InstructorProfile>): Promise<InstructorProfile> {
    const profile = new InstructorProfile(input);
    profile.channelId = ctx.channelId as string;
    profile.createdById = ctx.activeUserId as string;
    const saved = await this.connection.getRepository(ctx, InstructorProfile).save(profile);

    // Index in Elasticsearch if public
    if (saved.isPublic) {
      try {
        await this.indexerService.indexProfile(saved);
      } catch (err) {
        // Non-fatal: indexing failure should not break profile creation
        console.warn(`Failed to index instructor profile ${saved.id}: ${err}`);
      }
    }

    // Publish event for marketplace indexer and other subscribers
    try {
      this.eventBus.publish(new InstructorProfileCreatedEvent(
        String(saved.id),
        saved.channelId,
      ));
    } catch (err) {
      // Non-fatal: event publishing failure should not break profile creation
      console.warn(`Failed to publish InstructorProfileCreatedEvent for ${saved.id}: ${err}`);
    }

    return saved;
  }

  async update(ctx: RequestContext, id: string, input: Partial<InstructorProfile>): Promise<InstructorProfile> {
    const profile = await this.connection.getRepository(ctx, InstructorProfile).findOne({ where: { id: id as string } });
    if (!profile || profile.channelId !== ctx.channelId) {
      throw new EntityNotFoundError(InstructorProfile.name, id);
    }
    Object.assign(profile, input);
    const saved = await this.connection.getRepository(ctx, InstructorProfile).save(profile);

    // Re-index or delete from index based on isPublic status
    try {
      if (saved.isPublic) {
        await this.indexerService.indexProfile(saved);
      } else {
        await this.indexerService.deleteProfile(saved.id as string);
      }
    } catch (err) {
      console.warn(`Failed to update Elasticsearch index for profile ${saved.id}: ${err}`);
    }

    // Publish event for marketplace indexer and other subscribers
    try {
      this.eventBus.publish(new InstructorProfileUpdatedEvent(
        String(saved.id),
        saved.channelId,
        Object.keys(input),
      ));
    } catch (err) {
      console.warn(`Failed to publish InstructorProfileUpdatedEvent for ${saved.id}: ${err}`);
    }

    return saved;
  }

  async delete(ctx: RequestContext, id: string): Promise<void> {
    const profile = await this.connection.getRepository(ctx, InstructorProfile).findOne({ where: { id: id as string } });
    if (!profile || profile.channelId !== ctx.channelId) {
      throw new EntityNotFoundError(InstructorProfile.name, id);
    }
    await this.connection.getRepository(ctx, InstructorProfile).delete(id);

    // Remove from Elasticsearch
    try {
      await this.indexerService.deleteProfile(String(id));
    } catch (err) {
      console.warn(`Failed to delete instructor profile ${id} from Elasticsearch: ${err}`);
    }
  }
}
