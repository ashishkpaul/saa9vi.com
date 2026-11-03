export const LEARNING_PLUGIN_OPTIONS = 'LEARNING_PLUGIN_OPTIONS';

/**
 * Course management permissions, defined in src/platform/course-permissions.ts
 * so the TenantPlugin can reference them without a tenant→learning import cycle.
 * Re-exported here for backward compatibility within the learning plugin.
 */
export {
  courseManagePermission,
  courseEnrollPermission,
  courseAnnouncementPermission,
} from '../../platform/course-permissions';
