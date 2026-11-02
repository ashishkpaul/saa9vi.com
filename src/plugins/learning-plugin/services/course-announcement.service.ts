import { Injectable, Logger } from '@nestjs/common';
import {
  ID,
  IllegalOperationError,
  RequestContext,
  TransactionalConnection,
} from '@vendure/core';
import { CourseAnnouncement, AnnouncementStatus } from '../entities/course-announcement.entity';

const loggerCtx = 'CourseAnnouncementService';

@Injectable()
export class CourseAnnouncementService {
  private readonly logger = new Logger(loggerCtx);

  constructor(private readonly connection: TransactionalConnection) {}

  async findAllByCourse(
    ctx: RequestContext,
    courseId: ID,
  ): Promise<CourseAnnouncement[]> {
    return this.connection.getRepository(ctx, CourseAnnouncement).find({
      where: { courseId: String(courseId), channelId: String(ctx.channelId) },
      order: { createdAt: 'DESC' },
    });
  }

  async create(
    ctx: RequestContext,
    input: { courseId: ID; title: string; body: string },
  ): Promise<CourseAnnouncement> {
    const channelId = String(ctx.channelId);
    const announcement = new CourseAnnouncement({
      courseId: String(input.courseId),
      channelId,
      title: input.title,
      body: input.body,
      status: 'DRAFT',
      authorId: ctx.activeUserId != null ? String(ctx.activeUserId) : null,
    });
    return this.connection.getRepository(ctx, CourseAnnouncement).save(announcement);
  }

  async publish(ctx: RequestContext, id: ID): Promise<CourseAnnouncement> {
    const announcement = await this.connection.getEntityOrThrow(ctx, CourseAnnouncement, id);
    if (announcement.channelId !== String(ctx.channelId)) {
      throw new IllegalOperationError('Cross-tenant announcement access denied');
    }
    announcement.status = 'PUBLISHED';
    announcement.publishedAt = new Date();
    return this.connection.getRepository(ctx, CourseAnnouncement).save(announcement);
  }

  async update(
    ctx: RequestContext,
    id: ID,
    input: { title?: string; body?: string },
  ): Promise<CourseAnnouncement> {
    const announcement = await this.connection.getEntityOrThrow(ctx, CourseAnnouncement, id);
    if (announcement.channelId !== String(ctx.channelId)) {
      throw new IllegalOperationError('Cross-tenant announcement access denied');
    }
    if (announcement.status === 'PUBLISHED') {
      throw new IllegalOperationError('Published announcements cannot be edited');
    }
    if (input.title !== undefined) announcement.title = input.title;
    if (input.body !== undefined) announcement.body = input.body;
    return this.connection.getRepository(ctx, CourseAnnouncement).save(announcement);
  }
}
