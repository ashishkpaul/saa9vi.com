/**
 * CLI entry point for tenant admin role reconciliation.
 *
 * Usage:
 *   npm run tenant:roles:check                    → dry-run report (no changes)
 *   npm run tenant:roles:repair                   → add missing permissions
 *   npm run tenant:roles:repair -- --remove-unexpected
 *                                                 → also remove unexpected permissions
 *
 * This is a data-reconciliation tool, not a schema migration. It updates
 * existing tenant admin roles (code pattern `*-admin`) to match the current
 * `TENANT_ADMIN_ROLE_PERMISSIONS` definition. See
 * src/plugins/tenant-plugin/services/tenant-role-reconciliation.service.ts
 * for the reconciliation algorithm and safety guarantees.
 */
import 'reflect-metadata';
import 'dotenv/config';
import { bootstrapWorker } from '@vendure/core';
import { config } from '../src/vendure-config';
import { TenantRoleReconciliationService } from '../src/plugins/tenant-plugin/services/tenant-role-reconciliation.service';

async function main() {
  const args = process.argv.slice(2);
  const dryRun = !args.includes('--apply');
  const removeUnexpected = args.includes('--remove-unexpected');

  // Bootstrap a standalone application context (no HTTP server, no job queue).
  const worker = await bootstrapWorker(config, {
    nestApplicationContextOptions: {
      logger: false,
    },
  });

  const service = worker.app.get(TenantRoleReconciliationService);
  const report = await service.reconcile(dryRun, removeUnexpected);

  console.log('=== Tenant Admin Role Reconciliation ===');
  console.log(`Mode: ${dryRun ? 'DRY-RUN (no changes)' : 'APPLY'}`);
  console.log(`Total tenant admin roles: ${report.totalRoles}`);
  console.log(`Roles with missing permissions: ${report.rolesWithMissingPermissions}`);
  console.log(`Roles with unexpected permissions: ${report.rolesWithUnexpectedPermissions}`);
  console.log(`Roles changed: ${report.rolesChanged}`);
  console.log('');

  for (const role of report.roles) {
    console.log(`Role: ${role.roleCode} (id=${role.roleId})`);
    console.log(`  Description: ${role.description}`);
    if (role.missing.length > 0) {
      console.log(`  Missing (${role.missing.length}):`);
      for (const p of role.missing) {
        console.log(`    + ${p}`);
      }
    } else {
      console.log('  Missing: none');
    }
    if (role.unexpected.length > 0) {
      console.log(`  Unexpected (${role.unexpected.length}):`);
      for (const p of role.unexpected) {
        console.log(`    - ${p}`);
      }
    } else {
      console.log('  Unexpected: none');
    }
    console.log(`  Changed: ${role.changed}`);
    console.log('');
  }

  if (dryRun) {
    console.log('Dry-run complete. No changes were made.');
    console.log('To apply changes, run: npm run tenant:roles:repair');
    if (report.rolesWithUnexpectedPermissions > 0) {
      console.log('To also remove unexpected permissions, add -- --remove-unexpected');
    }
  } else {
    console.log('Apply complete.');
  }

  await worker.app.close();
  process.exit(0);
}

main().catch((err) => {
  console.error('Tenant role reconciliation failed:', err);
  process.exit(1);
});
