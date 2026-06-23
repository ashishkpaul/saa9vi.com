import { Injectable } from '@nestjs/common';
import {
  RequestContext,
  TransactionalConnection,
  ChannelService,
  EntityNotFoundError,
} from '@vendure/core';
import { InstructorProfile } from '../entities/instructor-profile.entity';

@Injectable()
export class InstructorProfileService {
  constructor(
    private readonly connection: TransactionalConnection,
    private readonly channelService: ChannelService,
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
      .findOne({ where: { id: id as string }, relations: ['customer', 'createdBy'] });
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
    return this.connection.getRepository(ctx, InstructorProfile).save(profile);
  }

  async update(ctx: RequestContext, id: string, input: Partial<InstructorProfile>): Promise<InstructorProfile> {
    const profile = await this.connection.getEntityOrThrow(ctx, InstructorProfile, id);
    if (profile.channelId !== ctx.channelId) {
      throw new EntityNotFoundError(InstructorProfile.name, id);
    }
    Object.assign(profile, input);
    return this.connection.getRepository(ctx, InstructorProfile).save(profile);
  }

  async delete(ctx: RequestContext, id: string): Promise<void> {
    await this.connection.getRepository(ctx, InstructorProfile).delete(id);
  }
}