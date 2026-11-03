import { Inject, OnApplicationBootstrap } from '@nestjs/common';
import { PluginCommonModule, VendurePlugin } from '@vendure/core';
import { LearnerAdmissionModule } from '../../platform/learner-admission.module';
import { CourseToolRegistryModule } from '../../platform/course-tool-registry.module';
import { CustomerDeletionModule } from '../../platform/customer-deletion/customer-deletion.module';
import { CustomerDeletionService } from '../../platform/customer-deletion/customer-deletion.service';
import {
  courseManagePermission,
  courseEnrollPermission,
  courseAnnouncementPermission,
} from '../../platform/course-permissions';
import { LearningCourse } from './entities/learning-course.entity';
import { CourseTemplate } from './entities/course-template.entity';
import { CourseTemplateTool } from './entities/course-template-tool.entity';
import { CourseTool } from './entities/course-tool.entity';
import { CourseEnrollment } from './entities/course-enrollment.entity';
import { CourseScheduledSession } from './entities/course-scheduled-session.entity';
import { CourseAnnouncement } from './entities/course-announcement.entity';
import { CourseToolRegistry } from './services/course-tool-registry';
import { LearningToolContributor } from './services/learning-tool-contributor';
import { LearningCourseService } from './services/learning-course.service';
import { CourseEnrollmentService } from './services/course-enrollment.service';
import { CourseAnnouncementService } from './services/course-announcement.service';
import { CourseScheduledSessionService } from './services/course-scheduled-session.service';
import { LearningDeletionService } from './services/learning-deletion.service';
import { adminApiExtensions, shopApiExtensions } from './api/api-extensions';
import { LearningAdminResolver } from './api/learning-admin.resolver';
import { LearningShopResolver } from './api/learning-shop.resolver';

/**
 * LearningPlugin — Chamilo-inspired course domain for Saa9vi.
 *
 * Entities: LearningCourse, CourseTemplate, CourseTemplateTool, CourseTool,
 * CourseEnrollment, CourseScheduledSession, CourseAnnouncement.
 *
 * C-22 scaffold → C-23 entities → C-24 tool registry → C-25 enrollment →
 * C-26 agenda → C-28 announcements.
 *
 * Imports LearnerAdmissionModule so CourseEnrollmentService can check
 * ACTIVE academy admission before enrolling a learner (C-25 invariant 1).
 */
@VendurePlugin({
  compatibility: '^3.7.0',
  imports: [PluginCommonModule, LearnerAdmissionModule, CourseToolRegistryModule, CustomerDeletionModule],
  entities: [
    LearningCourse,
    CourseTemplate,
    CourseTemplateTool,
    CourseTool,
    CourseEnrollment,
    CourseScheduledSession,
    CourseAnnouncement,
  ],
  providers: [
    LearningToolContributor,
    LearningCourseService,
    CourseEnrollmentService,
    CourseAnnouncementService,
    CourseScheduledSessionService,
    LearningDeletionService,
  ],
  adminApiExtensions: {
    schema: adminApiExtensions,
    resolvers: [LearningAdminResolver],
  },
  shopApiExtensions: {
    schema: shopApiExtensions,
    resolvers: [LearningShopResolver],
  },
  dashboard: './dashboard/index.tsx',
  configuration: (config) => {
    config.authOptions.customPermissions.push(
      courseManagePermission,
      courseEnrollPermission,
      courseAnnouncementPermission,
    );
    return config;
  },
})
export class LearningPlugin implements OnApplicationBootstrap {
  constructor(
    private readonly deletionService: LearningDeletionService,
    @Inject(CustomerDeletionService)
    private readonly customerDeletionService: CustomerDeletionService,
  ) {}

  async onApplicationBootstrap() {
    this.customerDeletionService.registerChannelScopedHandler(
      'learning-plugin',
      (ctx, customerId, channelId) =>
        this.deletionService.removeFromChannel(ctx, customerId, channelId),
    );
    this.customerDeletionService.registerFullDeleteHandler(
      'learning-plugin',
      (ctx, customerId) =>
        this.deletionService.fullDelete(ctx, customerId),
    );
  }
}
