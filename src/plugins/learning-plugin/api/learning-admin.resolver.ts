import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';
import { Allow, Ctx, ID, Permission, RequestContext, Transaction } from '@vendure/core';
import { LearningCourseService } from '../services/learning-course.service';
import { CourseEnrollmentService } from '../services/course-enrollment.service';
import { CourseAnnouncementService } from '../services/course-announcement.service';
import { CourseScheduledSessionService } from '../services/course-scheduled-session.service';
import { courseManagePermission, courseEnrollPermission, courseAnnouncementPermission } from '../constants';

@Resolver()
export class LearningAdminResolver {
  constructor(
    private readonly courseService: LearningCourseService,
    private readonly enrollmentService: CourseEnrollmentService,
    private readonly announcementService: CourseAnnouncementService,
    private readonly scheduledSessionService: CourseScheduledSessionService,
  ) {}

  // ── Course queries ─────────────────────────────────────────────────────────

  @Query()
  @Allow(courseManagePermission.Read)
  async learningCourses(@Ctx() ctx: RequestContext, @Args() args?: { options?: any }) {
    return this.courseService.findAll(ctx, args?.options);
  }

  @Query()
  @Allow(courseManagePermission.Read)
  async learningCourse(@Ctx() ctx: RequestContext, @Args('id') id: ID) {
    return this.courseService.findOne(ctx, id);
  }

  // ── Course mutations ───────────────────────────────────────────────────────

  @Mutation()
  @Allow(courseManagePermission.Create)
  @Transaction()
  async createLearningCourse(@Ctx() ctx: RequestContext, @Args('input') input: any) {
    return this.courseService.create(ctx, input);
  }

  @Mutation()
  @Allow(courseManagePermission.Update)
  @Transaction()
  async updateLearningCourse(@Ctx() ctx: RequestContext, @Args('id') id: ID, @Args('input') input: any) {
    return this.courseService.update(ctx, id, input);
  }

  @Mutation()
  @Allow(courseManagePermission.Update)
  @Transaction()
  async publishLearningCourse(@Ctx() ctx: RequestContext, @Args('id') id: ID) {
    return this.courseService.publish(ctx, id);
  }

  @Mutation()
  @Allow(courseManagePermission.Update)
  @Transaction()
  async closeLearningCourse(@Ctx() ctx: RequestContext, @Args('id') id: ID) {
    return this.courseService.close(ctx, id);
  }

  @Mutation()
  @Allow(Permission.SuperAdmin)
  @Transaction()
  async archiveLearningCourse(@Ctx() ctx: RequestContext, @Args('id') id: ID) {
    return this.courseService.archive(ctx, id);
  }

  // ── Enrollment mutations ──────────────────────────────────────────────────

  @Query()
  @Allow(courseEnrollPermission.Read)
  async courseEnrollments(@Ctx() ctx: RequestContext, @Args('courseId') courseId: ID) {
    return this.enrollmentService.findAllByCourse(ctx, courseId);
  }

  @Mutation()
  @Allow(courseEnrollPermission.Create)
  @Transaction()
  async enrollLearner(@Ctx() ctx: RequestContext, @Args('input') input: any) {
    return this.enrollmentService.enroll(ctx, input.courseId, input.customerId, input.courseRole ?? 'LEARNER');
  }

  @Mutation()
  @Allow(courseEnrollPermission.Update)
  @Transaction()
  async suspendLearner(@Ctx() ctx: RequestContext, @Args('courseId') courseId: ID, @Args('customerId') customerId: ID) {
    return this.enrollmentService.suspend(ctx, courseId, customerId);
  }

  @Mutation()
  @Allow(courseEnrollPermission.Update)
  @Transaction()
  async completeLearner(@Ctx() ctx: RequestContext, @Args('courseId') courseId: ID, @Args('customerId') customerId: ID) {
    return this.enrollmentService.complete(ctx, courseId, customerId);
  }

  @Mutation()
  @Allow(courseEnrollPermission.Update)
  @Transaction()
  async withdrawLearner(@Ctx() ctx: RequestContext, @Args('courseId') courseId: ID, @Args('customerId') customerId: ID) {
    return this.enrollmentService.withdraw(ctx, courseId, customerId);
  }

  // ── Announcement mutations ─────────────────────────────────────────────────

  @Query()
  @Allow(courseAnnouncementPermission.Read)
  async courseAnnouncements(@Ctx() ctx: RequestContext, @Args('courseId') courseId: ID) {
    return this.announcementService.findAllByCourse(ctx, courseId);
  }

  @Mutation()
  @Allow(courseAnnouncementPermission.Create)
  @Transaction()
  async createCourseAnnouncement(@Ctx() ctx: RequestContext, @Args('input') input: any) {
    return this.announcementService.create(ctx, input);
  }

  @Mutation()
  @Allow(courseAnnouncementPermission.Update)
  @Transaction()
  async publishCourseAnnouncement(@Ctx() ctx: RequestContext, @Args('id') id: ID) {
    return this.announcementService.publish(ctx, id);
  }

  @Mutation()
  @Allow(courseAnnouncementPermission.Update)
  @Transaction()
  async updateCourseAnnouncement(@Ctx() ctx: RequestContext, @Args('id') id: ID, @Args('input') input: any) {
    return this.announcementService.update(ctx, id, input);
  }
}
