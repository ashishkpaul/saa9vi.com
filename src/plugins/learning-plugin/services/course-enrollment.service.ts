import { Injectable, Logger } from '@nestjs/common';
import {
  ForbiddenError,
  ID,
  IllegalOperationError,
  PaginatedList,
  RequestContext,
  TransactionalConnection,
} from '@vendure/core';
import { Inject } from '@nestjs/common';
import { CourseEnrollment, CourseRole, EnrollmentStatus } from '../entities/course-enrollment.entity';
import { LearningCourse } from '../entities/learning-course.entity';
import { LEARNER_ADMISSION_PORT, LearnerAdmissionPort } from '../../../platform/learner-admission.port';

const loggerCtx = 'CourseEnrollmentService';

@Injectable()
export class CourseEnrollmentService {
  private readonly logger = new Logger(loggerCtx);

  constructor(
    private readonly connection: TransactionalConnection,
    @Inject(LEARNER_ADMISSION_PORT)
    private readonly admissionPort: LearnerAdmissionPort,
  ) {}

  // ── Enrollment CRUD ────────────────────────────────────────────────────────

  async findAllByCourse(
    ctx: RequestContext,
    courseId: ID,
  ): Promise<{ items: CourseEnrollment[]; totalItems: number }> {
    const [items, totalItems] = await this.connection
      .getRepository(ctx, CourseEnrollment)
      .findAndCount({
        where: { courseId: String(courseId), channelId: String(ctx.channelId) },
        order: { createdAt: 'DESC' },
      });
    return { items, totalItems };
  }

  async findOne(
    ctx: RequestContext,
    courseId: ID,
    customerId: ID,
  ): Promise<CourseEnrollment | null> {
    return this.connection.getRepository(ctx, CourseEnrollment).findOne({
      where: { courseId: String(courseId), customerId: String(customerId) },
    });
  }

  /**
   * Enroll a customer in a course. Requires ACTIVE academy admission.
   * C-25: enrollment eligibility check via LearnerAdmissionPort.
   * N-03 (L2 fix): every lookup verifies the course belongs to ctx.channelId.
   */
  async enroll(
    ctx: RequestContext,
    courseId: ID,
    customerId: ID,
    role: CourseRole = 'LEARNER',
  ): Promise<CourseEnrollment> {
    const channelId = String(ctx.channelId);

    // N-03: verify course exists in THIS channel
    const course = await this.connection
      .getRepository(ctx, LearningCourse)
      .findOne({ where: { id: String(courseId), channelId } });
    if (!course) {
      throw new IllegalOperationError('Course not found');
    }
    if (course.status === 'CLOSED' || course.status === 'ARCHIVED') {
      throw new IllegalOperationError('Course is not accepting enrollments');
    }

    // C-25: require ACTIVE academy admission
    const isAdmitted = await this.admissionPort.isActiveMember(ctx, customerId, channelId);
    if (!isAdmitted) {
      throw new ForbiddenError();
    }

    // N-03: check for existing enrollment (channel-scoped via course ownership)
    const existing = await this.connection
      .getRepository(ctx, CourseEnrollment)
      .findOne({ where: { courseId: String(courseId), customerId: String(customerId) } });
    if (existing) {
      if (existing.channelId !== channelId) {
        throw new IllegalOperationError('Cross-tenant enrollment access denied');
      }
      if (existing.status === 'ENROLLED') {
        return existing; // idempotent
      }
      if (existing.status === 'WITHDRAWN' || existing.status === 'COMPLETED') {
        throw new IllegalOperationError('Customer has a terminal enrollment; re-enroll not supported');
      }
      // Re-activate from SUSPENDED or INVITED
      existing.status = 'ENROLLED';
      existing.courseRole = role;
      existing.enrolledAt = new Date();
      return this.connection.getRepository(ctx, CourseEnrollment).save(existing);
    }

    const enrollment = new CourseEnrollment({
      courseId: String(courseId),
      customerId: String(customerId),
      channelId,
      courseRole: role,
      status: 'ENROLLED',
      invitedByUserId: ctx.activeUserId != null ? String(ctx.activeUserId) : null,
      enrolledAt: new Date(),
    });

    return this.connection.getRepository(ctx, CourseEnrollment).save(enrollment);
  }

  async suspend(ctx: RequestContext, courseId: ID, customerId: ID): Promise<CourseEnrollment> {
    return this.transition(ctx, courseId, customerId, 'SUSPENDED');
  }

  async complete(ctx: RequestContext, courseId: ID, customerId: ID): Promise<CourseEnrollment> {
    return this.transition(ctx, courseId, customerId, 'COMPLETED');
  }

  async withdraw(ctx: RequestContext, courseId: ID, customerId: ID): Promise<CourseEnrollment> {
    return this.transition(ctx, courseId, customerId, 'WITHDRAWN');
  }

  private async transition(
    ctx: RequestContext,
    courseId: ID,
    customerId: ID,
    target: EnrollmentStatus,
  ): Promise<CourseEnrollment> {
    const channelId = String(ctx.channelId);

    // N-03 (L2 fix): verify the course belongs to this channel before
    // transitioning an enrollment. Without this, a tenant admin could
    // change another tenant's enrollment by guessing the courseId.
    const course = await this.connection
      .getRepository(ctx, LearningCourse)
      .findOne({ where: { id: String(courseId), channelId } });
    if (!course) {
      throw new IllegalOperationError('Course not found in this channel');
    }

    const enrollment = await this.connection
      .getRepository(ctx, CourseEnrollment)
      .findOne({ where: { courseId: String(courseId), customerId: String(customerId) } });
    if (!enrollment) {
      throw new IllegalOperationError('Enrollment not found');
    }

    // N-03: verify the enrollment's channel matches
    if (enrollment.channelId !== channelId) {
      throw new IllegalOperationError('Cross-tenant enrollment access denied');
    }

    const transitions: Record<EnrollmentStatus, EnrollmentStatus[]> = {
      INVITED: ['ENROLLED', 'WITHDRAWN'],
      ENROLLED: ['SUSPENDED', 'COMPLETED', 'WITHDRAWN'],
      SUSPENDED: ['ENROLLED', 'WITHDRAWN', 'COMPLETED'],
      COMPLETED: [],
      WITHDRAWN: [],
    };

    const allowed = transitions[enrollment.status] ?? [];
    if (!allowed.includes(target)) {
      throw new IllegalOperationError(
        `Cannot transition enrollment from ${enrollment.status} to ${target}`,
      );
    }

    enrollment.status = target;
    return this.connection.getRepository(ctx, CourseEnrollment).save(enrollment);
  }

  /**
   * Check if a customer is actively enrolled in a course.
   */
  async isEnrolled(ctx: RequestContext, courseId: ID, customerId: ID): Promise<boolean> {
    const enrollment = await this.findOne(ctx, courseId, customerId);
    return enrollment?.status === 'ENROLLED';
  }
}
