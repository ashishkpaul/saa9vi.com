import { Permission } from '@vendure/core';
import { describe, expect, it } from 'vitest';

import { TENANT_ADMIN_ROLE_PERMISSIONS } from '../../tenant-plugin/constants';
import {
  BbbAdminPermission,
  BbbManageEntitlementsPermission,
  BbbManageMeetingsPermission,
  BbbManageMembersPermission,
  BbbManageOrganizationsPermission,
  BbbManageRoomsPermission,
  BbbManageSessionsPermission,
  BbbPlatformInfrastructurePermission,
} from '../constants';

/**
 * Tenant/platform tier ratchet (ADR-033 / BUG-029) — infrastructure-free.
 *
 * `BBBAdmin` and `BBBPlatformInfrastructure` are the "platform" keys:
 * `BbbChannelAccessService.isPlatformCaller()` treats either (or SuperAdmin) as
 * cross-tenant, and every platform nav item + resolver is gated on them. The
 * tenant/platform split therefore holds ONLY while the tenant-admin role
 * template never contains them. This spec makes that a failing test instead of
 * a convention.
 *
 * Run with the rest of the unit specs:  npx vitest run --config vitest.config.mts \
 *   src/plugins/bigbluebutton-plugin/__tests__/tenant-role-bbb-boundary.spec.ts
 */

const template = TENANT_ADMIN_ROLE_PERMISSIONS as readonly string[];

const PLATFORM_KEYS = [
  BbbAdminPermission.Permission,
  BbbPlatformInfrastructurePermission.Permission,
  Permission.SuperAdmin,
] as const;

const TENANT_GRANULAR = [
  BbbManageOrganizationsPermission.Permission,
  BbbManageRoomsPermission.Permission,
  BbbManageSessionsPermission.Permission,
  BbbManageMeetingsPermission.Permission,
  BbbManageEntitlementsPermission.Permission,
  BbbManageMembersPermission.Permission,
] as readonly string[];

describe('TENANT_ADMIN_ROLE_PERMISSIONS — BBB tier boundary', () => {
  it.each(PLATFORM_KEYS)('never contains the platform key %s', key => {
    expect(template).not.toContain(key);
  });

  it('contains all six granular BbbManage* permissions', () => {
    for (const granular of TENANT_GRANULAR) {
      expect(template, `missing ${granular}`).toContain(granular);
    }
  });

  it('grants no other BBB* permission without a deliberate decision', () => {
    // A new BBB permission added to the tenant template (e.g. a dedicated
    // billing-read permission) must be added to TENANT_GRANULAR above on
    // purpose — this stops one slipping into every tenant role unnoticed.
    const unexpected = template.filter(
      p => /^bbb/i.test(p) && !TENANT_GRANULAR.includes(p),
    );
    expect(unexpected).toEqual([]);
  });

  it('has no duplicate entries', () => {
    expect(new Set(template).size).toBe(template.length);
  });
});
