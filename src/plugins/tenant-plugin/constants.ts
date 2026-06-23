import { CrudPermissionDefinition } from '@vendure/core';

export const TENANT_PLUGIN_OPTIONS = 'TENANT_PLUGIN_OPTIONS';

export const tenantProfilePermission = new CrudPermissionDefinition('TenantProfile');
export const instructorProfilePermission = new CrudPermissionDefinition('InstructorProfile');
export const mediaResourcePermission = new CrudPermissionDefinition('MediaResource');