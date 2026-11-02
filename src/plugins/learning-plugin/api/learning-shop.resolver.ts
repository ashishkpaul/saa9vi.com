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
   * N-02 (L1 fix): resolve the Customer from the logged-in User, then return
   * published courses where the customer has an ENROLLED enrollment in the
   * current channel.
   */
  @Query()
  @Allow(Permission.Authenticated)
  async myCoursePages(@Ctx() ctx: RequestContext) {
    const customerId = await this.resolveCustomerId(ctx);
    if (!customerId) return [];

    const channelId = String(ctx.channelId);

    const enrollments = await this.connection
      .getRepository(ctx, CourseEnrollment)
      .find({
        where: { customerId: String(customerId), channelId, status: 'ENROLLED' },
      });

    if (enrollments.length === 0) return [];

    const courseIds = enrollments.map((e) => e.courseId);
    const courses = await this.connection
      .getRepository(ctx, LearningCourse)
      .find({ where: { channelId } });

    return courses.filter(
      (c) => c.status === 'PUBLISHED' && courseIds.includes(String(c.id)),
    );
  }

  /**
   * N-05 (L4, L5 fix): only enrolled + ACTIVE admission learners can view.
   */
  @Query()
  @Allow(Permission.Authenticated)
  async myCoursePage(@Ctx() ctx: RequestContext, @Args('slug') slug: string) {
    const customerId = await this.resolveCustomerId(ctx);
    if (!customerId) return null;

    const channelId = String(ctx.channelId);

    const course = await this.connection
      .getRepository(ctx, LearningCourse)
      .findOne({ where: { channelId, slug } });
    if (!course || course.status !== 'PUBLISHED') return null;

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
   * N-05: only enrolled + admitted learners see announcements.
   */
  @Query()
  @Allow(Permission.Authenticated)
  async coursePageAnnouncements(@Ctx() ctx: RequestContext, @Args('courseId') courseId: any) {
    const customerId = await this.resolveCustomerId(ctx);
    if (!customerId) return [];

    const channelId = String(ctx.channelId);

    const enrollment = await this.connection
      .getRepository(ctx, CourseEnrollment)
      .findOne({
        where: { courseId: String(courseId), customerId: String(customerId), channelId },
      });
    if (!enrollment || enrollment.status !== 'ENROLLED') return [];

    const announcements = await this.announcementService.findAllByCourse(ctx, courseId);
    return announcements.filter((a) => a.status === 'PUBLISHED');
  }

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
