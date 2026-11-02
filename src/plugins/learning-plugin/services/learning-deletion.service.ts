import { Injectable, Logger } from '@nestjs/common';
import { ID, RequestContext, TransactionalConnection } from '@vendure/core';
import { CourseEnrollment } from '../entities/course-enrollment.entity';
import { CourseAnnouncement } from '../entities/course-announcement.entity';
import { LearningCourse } from '../entities/learning-course.entity';
import { decodeEntityId } from '../../../platform/id-utils';
import { ConfigService } from '@vendure/core';

const loggerCtx = 'LearningDeletionService';

/**
 * N-09 (L11 fix): Handles LearningPlugin data cleanup during customer
 * deletion. Registered through CustomerDeletionService's handler registry.
 *
 * INV-013: no hard deletes — anonymize author/creator fields, deactivate
 * enrollments. Immutable data (orders) is not touched.
 */
@Injectable()
export class LearningDeletionService {
  private readonly logger = new Logger(loggerCtx);

  constructor(
    private readonly connection: TransactionalConnection,
    private readonly configService: ConfigService,
  ) {}

  private rawId(id: ID): string {
    return decodeEntityId(id, this.configService);
  }

  /**
   * Flow A (leave_channel): deactivate enrollments and anonymize
   * announcements in this channel.
   */
  async removeFromChannel(
    ctx: RequestContext,
    customerId: ID,
    channelId: string,
  ): Promise<void> {
    const cid = this.rawId(customerId);

    // Deactivate enrollments in this channel
    const enrollments = await this.connection
      .getRepository(ctx, CourseEnrollment)
      .find({ where: { customerId: cid, channelId } });
    for (const e of enrollments) {
      e.status = 'WITHDRAWN';
      await this.connection.getRepository(ctx, CourseEnrollment).save(e);
    }

    // Anonymize announcement author in this channel
    const announcements = await this.connection
      .getRepository(ctx, CourseAnnouncement)
      .find({ where: { authorId: cid, channelId } });
    for (const a of announcements) {
      a.authorId = null;
      await this.connection.getRepository(ctx, CourseAnnouncement).save(a);
    }

    // Anonymize course creator in this channel
    const courses = await this.connection
      .getRepository(ctx, LearningCourse)
      .find({ where: { createdByUserId: cid, channelId } });
    for (const c of courses) {
      c.createdByUserId = null;
      await this.connection.getRepository(ctx, LearningCourse).save(c);
    }
  }

  /**
   * Flow B (full_delete): deactivate all enrollments and anonymize
   * authorship across all channels.
   */
  async fullDelete(ctx: RequestContext, customerId: ID): Promise<void> {
    const cid = this.rawId(customerId);

    // Deactivate all enrollments
    const enrollments = await this.connection
      .getRepository(ctx, CourseEnrollment)
      .find({ where: { customerId: cid } });
    for (const e of enrollments) {
      e.status = 'WITHDRAWN';
      await this.connection.getRepository(ctx, CourseEnrollment).save(e);
    }

    // Anonymize announcement authors
    const announcements = await this.connection
      .getRepository(ctx, CourseAnnouncement)
      .find({ where: { authorId: cid } });
    for (const a of announcements) {
      a.authorId = null;
      await this.connection.getRepository(ctx, CourseAnnouncement).save(a);
    }

    // Anonymize course creators
    const courses = await this.connection
      .getRepository(ctx, LearningCourse)
      .find({ where: { createdByUserId: cid } });
    for (const c of courses) {
      c.createdByUserId = null;
      await this.connection.getRepository(ctx, LearningCourse).save(c);
    }
  }
}
