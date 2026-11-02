import { Injectable, Logger } from '@nestjs/common';
import { ID, RequestContext, TransactionalConnection, CustomerService } from '@vendure/core';
import { CourseEnrollment } from '../entities/course-enrollment.entity';
import { decodeEntityId } from '../../../platform/id-utils';
import { ConfigService } from '@vendure/core';

const loggerCtx = 'LearningDeletionService';

/**
 * N-09 (L11 fix): Handles LearningPlugin data cleanup during customer
 * deletion. Registered through CustomerDeletionService's handler registry.
 *
 * NF1 fix: authorId and createdByUserId columns store User IDs (ctx.activeUserId),
 * not Customer IDs. The previous code matched against the Customer ID, which
 * would never match. Since authors/creators are academy staff (not the deleted
 * customer), anonymizing them is unnecessary — the customer's data is the
 * enrollment, not the authorship. The authorship blocks are removed.
 *
 * INV-013: no hard deletes — deactivate enrollments only. Immutable data
 * (orders, courses, announcements) is not touched.
 */
@Injectable()
export class LearningDeletionService {
  private readonly logger = new Logger(loggerCtx);

  constructor(
    private readonly connection: TransactionalConnection,
    private readonly configService: ConfigService,
    private readonly customerService: CustomerService,
  ) {}

  private rawId(id: ID): string {
    return decodeEntityId(id, this.configService);
  }

  /**
   * Flow A (leave_channel): deactivate enrollments in this channel.
   * Authorship blocks removed (NF1): authorId/createdByUserId store User
   * IDs, not the Customer ID being deleted.
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
  }

  /**
   * Flow B (full_delete): deactivate all enrollments across all channels.
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
  }
}
