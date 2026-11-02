import { Injectable, Logger } from '@nestjs/common';
import {
  ID,
  IllegalOperationError,
  RequestContext,
  TransactionalConnection,
} from '@vendure/core';
import { CourseScheduledSession } from '../entities/course-scheduled-session.entity';
import { LearningCourse } from '../entities/learning-course.entity';

const loggerCtx = 'CourseScheduledSessionService';

/**
 * C-26: Manages the CourseScheduledSession join entity linking courses to
 * existing BBB scheduled sessions. BBB session lifecycle stays in the BBB
 * plugin; this only stores the association.
 */
@Injectable()
export class CourseScheduledSessionService {
  private readonly logger = new Logger(loggerCtx);

  constructor(private readonly connection: TransactionalConnection) {}

  async findSessionsByCourse(
    ctx: RequestContext,
    courseId: ID,
  ): Promise<CourseScheduledSession[]> {
    return this.connection.getRepository(ctx, CourseScheduledSession).find({
      where: { courseId: String(courseId), channelId: String(ctx.channelId) },
      order: { createdAt: 'DESC' },
    });
  }

  /**
   * N-04 (L3 fix): verify the BBB session belongs to the same channel.
   * LearningPlugin must not import BBB entities, so use a string-named
   * repository lookup (read-only, no cross-plugin type dependency).
   * The BBB plugin's BbbScheduledSession entity has a channelId column.
   */
  async addSession(
    ctx: RequestContext,
    courseId: ID,
    sessionId: ID,
  ): Promise<CourseScheduledSession> {
    const channelId = String(ctx.channelId);

    // Verify the course belongs to the caller's channel
    const course = await this.connection
      .getRepository(ctx, LearningCourse)
      .findOne({ where: { id: String(courseId), channelId } });
    if (!course) {
      throw new IllegalOperationError('Course not found in this channel');
    }

    // N-04: verify the BBB session belongs to the same channel
    const sessionRepo = this.connection.getRepository(ctx, 'BbbScheduledSession' as any);
    const session = await sessionRepo.findOne({ where: { id: sessionId as any } });
    if (!session) {
      throw new IllegalOperationError('Scheduled session not found');
    }
    const sessionChannelId = String((session as any).channelId ?? '');
    if (sessionChannelId !== channelId) {
      throw new IllegalOperationError('Session does not belong to this channel');
    }

    // Check for existing association (idempotent)
    const existing = await this.connection
      .getRepository(ctx, CourseScheduledSession)
      .findOne({
        where: { courseId: String(courseId), sessionId: String(sessionId) },
      });
    if (existing) {
      return existing;
    }

    const association = new CourseScheduledSession({
      courseId: String(courseId),
      sessionId: String(sessionId),
      channelId,
    });

    return this.connection.getRepository(ctx, CourseScheduledSession).save(association);
  }

  async removeSession(
    ctx: RequestContext,
    courseId: ID,
    sessionId: ID,
  ): Promise<boolean> {
    const result = await this.connection
      .getRepository(ctx, CourseScheduledSession)
      .delete({
        courseId: String(courseId),
        sessionId: String(sessionId),
        channelId: String(ctx.channelId),
      });
    return result.affected != null && result.affected > 0;
  }
}
