import { Injectable } from '@nestjs/common';
import { RequestContext, TransactionalConnection } from '@vendure/core';
import { MediaResource } from '../entities/media-resource.entity';

@Injectable()
export class MediaResourceService {
  constructor(private readonly connection: TransactionalConnection) {}

  async findAll(
    ctx: RequestContext,
    options?: { skip?: number; take?: number; ownerType?: string; ownerId?: string },
  ): Promise<{ items: MediaResource[]; totalItems: number }> {
    const take = Math.min(Math.max(options?.take ?? 25, 1), 100);
    const skip = Math.max(options?.skip ?? 0, 0);
    const channelId = ctx.channelId as string;

    const where: any = { channelId };
    if (options?.ownerType) where.ownerType = options.ownerType;
    if (options?.ownerId) where.ownerId = options.ownerId;

    const [items, totalItems] = await this.connection
      .getRepository(ctx, MediaResource)
      .findAndCount({
        where,
        order: { displayOrder: 'ASC', createdAt: 'ASC' },
        skip,
        take,
      });

    return { items, totalItems };
  }

  async findOne(ctx: RequestContext, id: string): Promise<MediaResource | null> {
    return this.connection
      .getRepository(ctx, MediaResource)
      .findOne({ where: { id: id as string } });
  }

  async create(ctx: RequestContext, input: Partial<MediaResource>): Promise<MediaResource> {
    const resource = new MediaResource(input);
    resource.channelId = ctx.channelId as string;
    return this.connection.getRepository(ctx, MediaResource).save(resource);
  }

  async update(ctx: RequestContext, id: string, input: Partial<MediaResource>): Promise<MediaResource> {
    const resource = await this.connection.getEntityOrThrow(ctx, MediaResource, id);
    Object.assign(resource, input);
    return this.connection.getRepository(ctx, MediaResource).save(resource);
  }

  async delete(ctx: RequestContext, id: string): Promise<void> {
    await this.connection.getRepository(ctx, MediaResource).delete(id);
  }
}