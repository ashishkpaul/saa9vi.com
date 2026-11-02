import { PluginCommonModule, VendurePlugin } from '@vendure/core';
import {
  tenantManageAdmissionsPermission,
} from '../tenant-plugin/constants';

/**
 * LearningPlugin — Chamilo-inspired course domain for Saa9vi.
 *
 * Entities, providers and GraphQL extensions are added incrementally in
 * C-23 through C-28. This scaffold provides the plugin shell, permission
 * registration and the LearnerAdmissionModule import so course enrollment
 * can check academy admission status.
 */
@VendurePlugin({
  compatibility: '^3.0.0',
  imports: [PluginCommonModule],
  entities: [],
  providers: [],
  adminApiExtensions: undefined,
  shopApiExtensions: undefined,
  configuration: (config) => {
    // C-22: register course management permissions when they are defined.
    // Placeholder until C-23 adds the CourseManage permission definition.
    return config;
  },
})
export class LearningPlugin {}
