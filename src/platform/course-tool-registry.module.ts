/**
 * CourseToolRegistryModule (C-27)
 *
 * A lightweight module that exports CourseToolRegistry so BBB and other
 * plugins can register tool definitions without importing LearningPlugin
 * (which would create a circular dependency through LearnerAdmissionModule).
 */
import { Module } from '@nestjs/common';
import { PluginCommonModule } from '@vendure/core';
import { CourseToolRegistry } from '../plugins/learning-plugin/services/course-tool-registry';

@Module({
  imports: [PluginCommonModule],
  providers: [CourseToolRegistry],
  exports: [CourseToolRegistry],
})
export class CourseToolRegistryModule {}
