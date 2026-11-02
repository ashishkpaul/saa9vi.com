import { Args, Query, Resolver } from '@nestjs/graphql';
import { Allow, Ctx, Permission, RequestContext } from '@vendure/core';
import { LearningCourseService } from '../services/learning-course.service';
import { CourseEnrollmentService } from '../services/course-enrollment.service';
import { CourseAnnouncementService } from '../services/course-announcement.service';

@Resolver()
export class LearningShopResolver {
  constructor(
    private readonly courseService: LearningCourseService,
    private readonly enrollmentService: CourseEnrollmentService,
    private readonly announcementService: CourseAnnouncementService,
  ) {}

  @Query()
  @Allow(Permission.Authenticated)
  async myCourses(@Ctx() ctx: RequestContext) {
    // List PUBLISHED courses in the caller's channel where they are ENROLLED
    const courses = await this.courseService.findAll(ctx);
    const enrolled: any[] = [];
    for (const course of courses.items) {
      if (course.status !== 'PUBLISHED') continue;
      const isEnrolled = await this.enrollmentService.isEnrolled(ctx, course.id, ctx.activeUserId as any);
      if (isEnrolled) {
        enrolled.push(course);
      }
    }
    return enrolled;
  }

  @Query()
  @Allow(Permission.Authenticated)
  async myCourse(@Ctx() ctx: RequestContext, @Args('slug') slug: string) {
    const course = await this.courseService.findBySlug(ctx, slug);
    if (!course || course.status !== 'PUBLISHED') return null;
    return course;
  }

  @Query()
  @Allow(Permission.Authenticated)
  async courseAnnouncements(@Ctx() ctx: RequestContext, @Args('courseId') courseId: any) {
    const announcements = await this.announcementService.findAllByCourse(ctx, courseId);
    // Shop API only sees PUBLISHED announcements
    return announcements.filter((a) => a.status === 'PUBLISHED');
  }
}
