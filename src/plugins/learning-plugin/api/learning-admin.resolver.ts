import { Args, Mutation, Query, Resolver, ResolveField, Parent } from '@nestjs/graphql';
import {
  Allow, Ctx, ID, IllegalOperationError, Permission, RequestContext, Transaction, TransactionalConnection, UserInputError,
} from '@vendure/core';
import { LearningCourseService } from '../services/learning-course.service';
import { CourseEnrollmentService } from '../services/course-enrollment.service';
import { CourseAnnouncementService } from '../services/course-announcement.service';
import { CourseScheduledSessionService } from '../services/course-scheduled-session.service';
import { CourseToolRegistry } from '../services/course-tool-registry';
import {
  courseManagePermission,
  courseEnrollPermission,
  courseAnnouncementPermission,
} from '../../../platform/course-permissions';
import { LearningCourse } from '../entities/learning-course.entity';
import { CourseTool } from '../entities/course-tool.entity';
import { CourseEnrollment, CourseRole } from '../entities/course-enrollment.entity';
import {
  validateSlug, validateTitle, validateAnnouncementTitle,
  validateCourseRole, capTake,
} from '../services/learning-validation';

@Resolver()
export class LearningAdminResolver {
  constructor(
    private readonly courseService: LearningCourseService,
    private readonly enrollmentService: CourseEnrollmentService,
    private readonly announcementService: CourseAnnouncementService,
    private readonly scheduledSessionService: CourseScheduledSessionService,
    private readonly toolRegistry: CourseToolRegistry,
    private readonly connection: TransactionalConnection,
  ) {}

  // ── Course queries ─────────────────────────────────────────────────────────

  @Query()
  @Allow(courseManagePermission.Read)
  async learningCourses(@Ctx() ctx: RequestContext, @Args() args?: { options?: { skip?: number; take?: number } }) {
    const take = args?.options?.take != null ? capTake(args.options.take) : undefined;
    return this.courseService.findAll(ctx, { skip: args?.options?.skip, take });
  }

  @Query()
  @Allow(courseManagePermission.Read)
  async learningCourse(@Ctx() ctx: RequestContext, @Args('id') id: ID) {
    return this.courseService.findOne(ctx, id);
  }

  // ── Course mutations (N-06: typed inputs + validation) ─────────────────────

  @Mutation()
  @Allow(courseManagePermission.Create)
  @Transaction()
  async createLearningCourse(
    @Ctx() ctx: RequestContext,
    @Args('input') input: { slug: string; title: string; description?: string; templateId?: ID },
  ) {
    validateSlug(input.slug);
    validateTitle(input.title);
    return this.courseService.create(ctx, {
      slug: input.slug,
      title: input.title,
      description: input.description,
      templateId: input.templateId != null ? String(input.templateId) : undefined,
    });
  }

  @Mutation()
  @Allow(courseManagePermission.Update)
  @Transaction()
  async updateLearningCourse(
    @Ctx() ctx: RequestContext,
    @Args('id') id: ID,
    @Args('input') input: { title?: string; description?: string },
  ) {
    if (input.title !== undefined) validateTitle(input.title);
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

  // ── Enrollment mutations (N-06: role control) ──────────────────────────────

  @Query()
  @Allow(courseEnrollPermission.Read)
  async courseEnrollments(@Ctx() ctx: RequestContext, @Args('courseId') courseId: ID) {
    return this.enrollmentService.findAllByCourse(ctx, courseId);
  }

  @Mutation()
  @Allow(courseEnrollPermission.Create)
  @Transaction()
  async enrollLearner(
    @Ctx() ctx: RequestContext,
    @Args('input') input: { courseId: ID; customerId: ID; courseRole?: string },
  ) {
    // N-06: validate role enum. TRAINER/ASSISTANT require CourseManage.Update.
    const role = input.courseRole ? validateCourseRole(input.courseRole) : 'LEARNER';
    if (role !== 'LEARNER') {
      // Only callers with CourseManage.Update may assign TRAINER or ASSISTANT.
      if (!ctx.userHasPermissions([courseManagePermission.Update as any])) {
        throw new IllegalOperationError(
          'Only callers with CourseManage.Update may assign TRAINER or ASSISTANT roles',
        );
      }
    }
    return this.enrollmentService.enroll(ctx, input.courseId, input.customerId, role as CourseRole);
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

  // ── Announcement mutations (N-06: typed inputs + validation) ──────────────

  @Query()
  @Allow(courseAnnouncementPermission.Read)
  async courseAnnouncements(@Ctx() ctx: RequestContext, @Args('courseId') courseId: ID) {
    return this.announcementService.findAllByCourse(ctx, courseId);
  }

  @Mutation()
  @Allow(courseAnnouncementPermission.Create)
  @Transaction()
  async createCourseAnnouncement(
    @Ctx() ctx: RequestContext,
    @Args('input') input: { courseId: ID; title: string; body: string },
  ) {
    validateAnnouncementTitle(input.title);
    if (!input.body || input.body.trim().length === 0) {
      throw new UserInputError('body is required');
    }
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
  async updateCourseAnnouncement(
    @Ctx() ctx: RequestContext,
    @Args('id') id: ID,
    @Args('input') input: { title?: string; body?: string },
  ) {
    if (input.title !== undefined) validateAnnouncementTitle(input.title);
    return this.announcementService.update(ctx, id, input);
  }

  // ── N-08: Session/Tool/Template operations ────────────────────────────────

  @Query()
  @Allow(courseManagePermission.Read)
  async courseTools(@Ctx() ctx: RequestContext, @Args('courseId') courseId: ID) {
    return this.courseService.getCourseTools(ctx, courseId);
  }

  @Mutation()
  @Allow(courseManagePermission.Update)
  @Transaction()
  async updateCourseTool(
    @Ctx() ctx: RequestContext,
    @Args('id') id: ID,
    @Args('input') input: { visibility?: string; order?: number },
  ) {
    const tool = await this.connection.getEntityOrThrow(ctx, CourseTool, id);
    // NF9: verify the parent course belongs to this channel before allowing writes.
    // CourseTool has no channelId column, so the channel check goes through the course.
    const course = await this.connection.getEntityOrThrow(ctx, LearningCourse, tool.courseId);
    if (!ctx.userHasPermissions(['SuperAdmin' as any]) && String(course.channelId) !== String(ctx.channelId)) {
      throw new IllegalOperationError('Cross-tenant course tool access denied');
    }
    // Validate tool key still exists in registry
    if (!this.toolRegistry.has(tool.toolKey)) {
      throw new UserInputError(`Unknown tool key: ${tool.toolKey}`);
    }
    if (input.visibility !== undefined) {
      if (!['VISIBLE', 'HIDDEN'].includes(input.visibility)) {
        throw new UserInputError('visibility must be VISIBLE or HIDDEN');
      }
      tool.visibility = input.visibility as any;
    }
    if (input.order !== undefined) {
      tool.order = input.order;
    }
    return this.connection.getRepository(ctx, CourseTool).save(tool);
  }

  @Query()
  @Allow(courseManagePermission.Read)
  async courseScheduledSessions(@Ctx() ctx: RequestContext, @Args('courseId') courseId: ID) {
    return this.scheduledSessionService.findSessionsByCourse(ctx, courseId);
  }

  @Mutation()
  @Allow(courseManagePermission.Update)
  @Transaction()
  async addCourseSession(
    @Ctx() ctx: RequestContext,
    @Args('courseId') courseId: ID,
    @Args('sessionId') sessionId: ID,
  ) {
    return this.scheduledSessionService.addSession(ctx, courseId, sessionId);
  }

  @Mutation()
  @Allow(courseManagePermission.Update)
  @Transaction()
  async removeCourseSession(
    @Ctx() ctx: RequestContext,
    @Args('courseId') courseId: ID,
    @Args('sessionId') sessionId: ID,
  ) {
    await this.scheduledSessionService.removeSession(ctx, courseId, sessionId);
    return true;
  }

  @Query()
  @Allow(courseManagePermission.Read)
  async courseToolDefinitions(@Ctx() ctx: RequestContext) {
    return this.toolRegistry.list();
  }
}

// ── NF2: Field resolvers for LearningCourseAdmin ────────────────────────────
// Must live in a separate @Resolver('LearningCourseAdmin') class so Vendure
// wires them to the LearningCourseAdmin type. A bare @Resolver() class only
// handles root queries/mutations; its @ResolveField() methods are ignored.

@Resolver('LearningCourseAdmin')
export class LearningCourseAdminFieldResolver {
  constructor(private readonly connection: TransactionalConnection) {}

  @ResolveField()
  async tools(@Ctx() ctx: RequestContext, @Parent() course: LearningCourse): Promise<CourseTool[]> {
    return this.connection.getRepository(ctx, CourseTool).find({
      where: { courseId: String(course.id) },
      order: { order: 'ASC' },
    });
  }

  @ResolveField()
  async enrollments(@Ctx() ctx: RequestContext, @Parent() course: LearningCourse): Promise<CourseEnrollment[]> {
    return this.connection.getRepository(ctx, CourseEnrollment).find({
      where: { courseId: String(course.id), channelId: String(course.channelId) },
      order: { createdAt: 'DESC' },
    });
  }
}
