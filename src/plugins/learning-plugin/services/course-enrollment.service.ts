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
   */
  async enroll(
    ctx: RequestContext,
    courseId: ID,
    customerId: ID,
    role: CourseRole = 'LEARNER',
  ): Promise<CourseEnrollment> {
    const channelId = String(ctx.channelId);

    // Verify course exists and is published (or caller is staff)
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

    // Check for existing enrollment
    const existing = await this.findOne(ctx, courseId, customerId);
    if (existing) {
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
    const enrollment = await this.findOne(ctx, courseId, customerId);
    if (!enrollment) {
      throw new IllegalOperationError('Enrollment not found');
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
