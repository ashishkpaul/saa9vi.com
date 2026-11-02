import { Injectable, Logger } from '@nestjs/common';
import {
  ID,
  IllegalOperationError,
  RequestContext,
  TransactionalConnection,
} from '@vendure/core';
import { CourseAnnouncement, AnnouncementStatus } from '../entities/course-announcement.entity';
import { LearningCourse } from '../entities/learning-course.entity';

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

  /**
   * N-03 (L8 fix): verify the course belongs to this channel before creating.
   */
  async create(
    ctx: RequestContext,
    input: { courseId: ID; title: string; body: string },
  ): Promise<CourseAnnouncement> {
    const channelId = String(ctx.channelId);

    // Verify course exists in this channel
    const course = await this.connection
      .getRepository(ctx, LearningCourse)
      .findOne({ where: { id: String(input.courseId), channelId } });
    if (!course) {
      throw new IllegalOperationError('Course not found in this channel');
    }

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

  /**
   * N-03 (L8 fix): idempotent publish — keep the first publishedAt.
   */
  async publish(ctx: RequestContext, id: ID): Promise<CourseAnnouncement> {
    const announcement = await this.connection.getEntityOrThrow(ctx, CourseAnnouncement, id);
    if (announcement.channelId !== String(ctx.channelId)) {
      throw new IllegalOperationError('Cross-tenant announcement access denied');
    }
    // Idempotent: already published — keep the original publishedAt
    if (announcement.status === 'PUBLISHED') {
      return announcement;
    }
    announcement.status = 'PUBLISHED';
    if (announcement.publishedAt == null) {
      announcement.publishedAt = new Date();
    }
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
