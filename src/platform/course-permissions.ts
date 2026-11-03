import { CrudPermissionDefinition } from '@vendure/core';

/**
 * Course management permissions for the LearningPlugin.
 *
 * Defined in src/platform (not src/plugins/learning-plugin) so that the
 * TenantPlugin can reference them without creating a tenant→learning import
 * cycle. The learning plugin imports the same definitions from here.
 */
export const courseManagePermission = new CrudPermissionDefinition('CourseManage');
export const courseEnrollPermission = new CrudPermissionDefinition('CourseEnroll');
export const courseAnnouncementPermission = new CrudPermissionDefinition('CourseAnnouncement');
