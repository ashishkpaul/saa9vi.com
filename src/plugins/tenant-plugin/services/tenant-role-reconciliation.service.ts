import { Injectable, Logger } from '@nestjs/common';
import {
  ConfigService,
  Permission,
  RequestContext,
  RequestContextService,
  Role,
  TransactionalConnection,
  User,
} from '@vendure/core';
import { TENANT_ADMIN_ROLE_PERMISSIONS } from '../constants';

const loggerCtx = 'TenantRoleReconciliationService';

/**
 * Result of reconciling a single tenant admin role.
 */
export interface RoleReconciliationResult {
  roleId: string;
  roleCode: string;
  description: string;
  missing: Permission[];
  unexpected: Permission[];
  changed: boolean;
}

/**
 * Result of a full reconciliation run.
 */
export interface ReconciliationReport {
  dryRun: boolean;
  roles: RoleReconciliationResult[];
  totalRoles: number;
  rolesWithMissingPermissions: number;
  rolesWithUnexpectedPermissions: number;
  rolesChanged: number;
}

/**
 * Reconciles existing tenant admin roles identified by the channel-backed
 * tenant-admin role invariant: exactly one channel and code === `{channel.code}-admin`.
 * See TenantRegistrationService.registerTenant() for how roles are provisioned.
 * Reconciles them against the current `TENANT_ADMIN_ROLE_PERMISSIONS` definition.
 *
 * Background (BUG-028/BUG-029): `TENANT_ADMIN_ROLE_PERMISSIONS` was expanded in
 * Phase C (v1.11) to include BBB granular, CMS CRUD, and ReviewAdmin
 * permissions. Tenants created before that expansion have stale roles that
 * lack those permissions, so their dashboard menus (BBB, CMS, Reviews) are
 * hidden even though the provisioning code now grants them.
 *
 * This service is deliberately **add-only** by default:
 *   - It ADDS missing permissions that are in `TENANT_ADMIN_ROLE_PERMISSIONS`.
 *   - It does NOT remove permissions that are not in the template, because a
 *     tenant admin role may have been manually customized (e.g. a platform
 *     admin granting an extra permission to a specific tenant). Removing
 *     permissions automatically could break those customizations.
 *   - Unexpected permissions (present in the role but not in the template) are
 *     reported in the dry-run output for manual review, but are only removed
 *     when `removeUnexpected: true` is explicitly passed.
 *
 * The `BBBPlatformInfrastructure` permission is intentionally NOT in
 * `TENANT_ADMIN_ROLE_PERMISSIONS` (ADR-033 — platform infrastructure is
 * Portal/SuperAdmin-only). If an existing tenant role has it, it will be
 * reported as "unexpected" and can be removed with `removeUnexpected: true`.
 *
 * Usage (see scripts/tenant-role-reconcile.ts):
 *   npm run tenant:roles:check   → dry-run report
 *   npm run tenant:roles:repair  → add missing permissions
 *   npm run tenant:roles:repair -- --remove-unexpected → also remove unexpected
 */
@Injectable()
export class TenantRoleReconciliationService {
  constructor(
    private readonly connection: TransactionalConnection,
    private readonly configService: ConfigService,
    private readonly requestContextService: RequestContextService,
  ) {}

  /**
   * Reconcile all tenant admin roles identified by the channel-backed
   * tenant-admin role invariant against the current `TENANT_ADMIN_ROLE_PERMISSIONS`.
   *
   * @param dryRun - if true, only report; do not persist any changes.
   * @param removeUnexpected - if true, also remove permissions present in the
   *   role but not in `TENANT_ADMIN_ROLE_PERMISSIONS`. Defaults to false.
   */
  async reconcile(
    dryRun = true,
    removeUnexpected = false,
  ): Promise<ReconciliationReport> {
    const superAdminCtx = await this.getSuperAdminContext();

    // Find candidate tenant admin roles. We don't rely only on the `*-admin`
    // code pattern because that would also match future roles like
    // `marketplace-admin` or `support-admin`. We require the stronger
    // channel-backed invariant: exactly one channel AND code === `{channel.code}-admin`,
    // which matches how TenantRegistrationService provisions roles.
    const candidates = await this.connection
      .getRepository(superAdminCtx, Role)
      .find({ relations: ['channels'] });

    const roles = candidates.filter(
      (role) =>
        role.channels.length === 1 &&
        role.code === `${role.channels[0].code}-admin`,
    );

    const results: RoleReconciliationResult[] = [];
    let rolesWithMissing = 0;
    let rolesWithUnexpected = 0;
    let rolesChanged = 0;

    for (const role of roles) {
      const current = new Set<string>(role.permissions);
      const desired = new Set<string>(TENANT_ADMIN_ROLE_PERMISSIONS);

      const missing = [...desired].filter(
        (p) => !current.has(p),
      ) as Permission[];
      const unexpected = [...current].filter(
        (p) => !desired.has(p) && p !== Permission.Authenticated,
      ) as Permission[];

      const result: RoleReconciliationResult = {
        roleId: String(role.id),
        roleCode: role.code,
        description: role.description,
        missing,
        unexpected,
        changed: false,
      };

      if (missing.length > 0) {
        rolesWithMissing++;
      }
      if (unexpected.length > 0) {
        rolesWithUnexpected++;
      }

      if (!dryRun && (missing.length > 0 || (removeUnexpected && unexpected.length > 0))) {
        // Add-only: union of current + missing. Preserve any unexpected
        // permissions unless removeUnexpected is explicitly requested.
        // IMPORTANT: `Authenticated` is always preserved even when
        // removeUnexpected is true — it is a framework-injected permission,
        // not part of the tenant role template, and removing it would break
        // the user's ability to authenticate at all.
        const newPermissions = (removeUnexpected
          ? [...new Set([Permission.Authenticated, ...desired])]
          : [...new Set([...current, ...missing])]) as Permission[];

        // Use direct repository access rather than RoleService.update().
        // RoleService.update() calls activeUserCanReadRole(), which requires
        // the active user to have all permissions on the role's channels.
        // The superadmin role is only assigned to the default channel, so it
        // cannot read a role scoped to a tenant channel. This is the same
        // limitation documented in TenantRegistrationService.registerTenant().
        // Direct repository access is safe here because we operate under the
        // superAdminCtx.
        const roleEntity = await this.connection
          .getRepository(superAdminCtx, Role)
          .findOneOrFail({ where: { id: role.id } });
        roleEntity.permissions = newPermissions;
        await this.connection.getRepository(superAdminCtx, Role).save(roleEntity);

        result.changed = true;
        rolesChanged++;
        Logger.log(
          `Reconciled role "${role.code}" (id=${role.id}): added ${missing.length} missing permission(s)` +
            (removeUnexpected && unexpected.length > 0
              ? `, removed ${unexpected.length} unexpected permission(s)`
              : ''),
          loggerCtx,
        );
      }

      results.push(result);
    }

    return {
      dryRun,
      roles: results,
      totalRoles: roles.length,
      rolesWithMissingPermissions: rolesWithMissing,
      rolesWithUnexpectedPermissions: rolesWithUnexpected,
      rolesChanged,
    };
  }

  private async getSuperAdminContext(): Promise<RequestContext> {
    const { superadminCredentials } = this.configService.authOptions;
    const superAdminUser = await this.connection
      .getRepository(undefined, User)
      .findOne({
        where: { identifier: superadminCredentials.identifier },
        relations: ['roles', 'roles.channels'],
      });
    if (!superAdminUser) {
      throw new Error(
        'Could not find superadmin user for tenant role reconciliation',
      );
    }
    return this.requestContextService.create({
      apiType: 'admin',
      user: superAdminUser,
    });
  }
}
