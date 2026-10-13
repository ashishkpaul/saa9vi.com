import { Permission, RequestContext } from '@vendure/core';
import { describe, expect, it } from 'vitest';

import {
  BbbAdminPermission,
  BbbManageOrganizationsPermission,
  BbbPlatformInfrastructurePermission,
} from '../constants';
import { BbbChannelAccessService } from '../services/bbb-channel-access.service';

/**
 * S1 / Q5: `isPlatformCaller()` is the single definition of "platform"
 * visibility shared by `meetingService.findAll`, `orgService.findAll`, the
 * organization-update allowlist and the organization-create channel guard.
 *
 * The triple is BBBAdmin | BBBPlatformInfrastructure | SuperAdmin with OR
 * semantics — tenant roles hold only the granular `BbbManage*` set (never
 * either BBB permission, see TENANT_ADMIN_ROLE_PERMISSIONS / ADR-033), so a
 * tenant admin must never qualify.
 *
 * `userHasPermissions` is mocked with the same any-of semantics as the real
 * `RequestContext.userHasPermissions` (arraysIntersect).
 */
function ctxHolding(...held: Permission[]): RequestContext {
  return {
    userHasPermissions: (permissions: Permission[]) =>
      permissions.some(p => held.includes(p)),
  } as unknown as RequestContext;
}

describe('BbbChannelAccessService.isPlatformCaller (S1 / Q5)', () => {
  const service = new BbbChannelAccessService(null as never, null as never);

  it('is false for an unauthenticated/system context', () => {
    expect(service.isPlatformCaller(ctxHolding())).toBe(false);
  });

  it('is false for a tenant admin holding only granular BBB permissions', () => {
    expect(
      service.isPlatformCaller(
        ctxHolding(BbbManageOrganizationsPermission.Permission),
      ),
    ).toBe(false);
  });

  it('is true for BBBAdmin holders', () => {
    expect(
      service.isPlatformCaller(ctxHolding(BbbAdminPermission.Permission)),
    ).toBe(true);
  });

  it('is true for BBBPlatformInfrastructure holders', () => {
    expect(
      service.isPlatformCaller(
        ctxHolding(BbbPlatformInfrastructurePermission.Permission),
      ),
    ).toBe(true);
  });

  it('is true for SuperAdmin', () => {
    expect(service.isPlatformCaller(ctxHolding(Permission.SuperAdmin))).toBe(
      true,
    );
  });
});