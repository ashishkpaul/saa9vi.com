import { CrudPermissionDefinition } from '@vendure/core';

export const LEARNING_PLUGIN_OPTIONS = 'LEARNING_PLUGIN_OPTIONS';

export const courseManagePermission = new CrudPermissionDefinition('CourseManage');
export const courseEnrollPermission = new CrudPermissionDefinition('CourseEnroll');
export const courseAnnouncementPermission = new CrudPermissionDefinition('CourseAnnouncement');
