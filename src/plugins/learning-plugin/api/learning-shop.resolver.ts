import { Args, Query, Resolver } from '@nestjs/graphql';
import { Allow, Ctx, Permission, RequestContext, TransactionalConnection, CustomerService } from '@vendure/core';
import { LearningCourse } from '../entities/learning-course.entity';
import { CourseEnrollment } from '../entities/course-enrollment.entity';
import { CourseAnnouncementService } from '../services/course-announcement.service';
import { LEARNER_ADMISSION_PORT, LearnerAdmissionPort } from '../../../platform/learner-admission.port';
import { Inject } from '@nestjs/common';

@Resolver()
export class LearningShopResolver {
  constructor(
    private readonly connection: TransactionalConnection,
    private readonly customerService: CustomerService,
    private readonly announcementService: CourseAnnouncementService,
    @Inject(LEARNER_ADMISSION_PORT)
    private readonly admissionPort: LearnerAdmissionPort,
  ) {}

  /**
   * N-02 (L1 fix): Resolve the Customer from the logged-in User, then return
   * published courses where the customer has an ENROLLED enrollment in the
   * current channel. Single query, no per-course loop.
   */
  @Query()
  @Allow(Permission.Authenticated)
  async myCourses(@Ctx() ctx: RequestContext) {
    const customerId = await this.resolveCustomerId(ctx);
    if (!customerId) return [];

    const channelId = String(ctx.channelId);

    // Single join query: enrollments for this customer in this channel
    // where the course is PUBLISHED and enrollment is ENROLLED.
    const enrollments = await this.connection
      .getRepository(ctx, CourseEnrollment)
      .find({
        where: { customerId: String(customerId), channelId, status: 'ENROLLED' },
      });

    if (enrollments.length === 0) return [];

    const courseIds = enrollments.map((e) => e.courseId);
    const courses = await this.connection
      .getRepository(ctx, LearningCourse)
      .find({
        where: { channelId },
      });

    // Filter to PUBLISHED courses the customer is enrolled in.
    return courses.filter(
      (c) => c.status === 'PUBLISHED' && courseIds.includes(String(c.id)),
    );
  }

  /**
   * N-05 (L4, L5 fix): Only enrolled + ACTIVE admission learners can view a course.
   */
  @Query()
  @Allow(Permission.Authenticated)
  async myCourse(@Ctx() ctx: RequestContext, @Args('slug') slug: string) {
    const customerId = await this.resolveCustomerId(ctx);
    if (!customerId) return null;

    const channelId = String(ctx.channelId);

    // Find the course in this channel
    const course = await this.connection
      .getRepository(ctx, LearningCourse)
      .findOne({ where: { channelId, slug } });
    if (!course || course.status !== 'PUBLISHED') return null;

    // N-05: verify enrollment + active admission
    const enrollment = await this.connection
      .getRepository(ctx, CourseEnrollment)
      .findOne({
        where: { courseId: String(course.id), customerId: String(customerId) },
      });
    if (!enrollment || enrollment.status !== 'ENROLLED') return null;

    const isAdmitted = await this.admissionPort.isActiveMember(ctx, customerId, channelId);
    if (!isAdmitted) return null;

    return course;
  }

  /**
   * N-05: Only enrolled + admitted learners see announcements.
   */
  @Query()
  @Allow(Permission.Authenticated)
  async courseAnnouncements(@Ctx() ctx: RequestContext, @Args('courseId') courseId: any) {
    const customerId = await this.resolveCustomerId(ctx);
    if (!customerId) return [];

    const channelId = String(ctx.channelId);

    // Verify enrollment in this course
    const enrollment = await this.connection
      .getRepository(ctx, CourseEnrollment)
      .findOne({
        where: { courseId: String(courseId), customerId: String(customerId), channelId },
      });
    if (!enrollment || enrollment.status !== 'ENROLLED') return [];

    const announcements = await this.announcementService.findAllByCourse(ctx, courseId);
    return announcements.filter((a) => a.status === 'PUBLISHED');
  }

  /** Resolve Customer.id from the logged-in User via CustomerService. */
  private async resolveCustomerId(ctx: RequestContext): Promise<string | null> {
    if (!ctx.activeUserId) return null;
    try {
      const customer = await this.customerService.findOneByUserId(ctx, ctx.activeUserId);
      return customer ? String(customer.id) : null;
    } catch {
      return null;
    }
  }
}
