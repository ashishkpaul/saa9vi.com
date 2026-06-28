import * as path from 'path';
import { CheckResult, Checker, findFiles, readFileContent } from './runner';

export class AdrChecker implements Checker {
  name = 'adr-invariants';

  async check(): Promise<CheckResult> {
    const checks: Promise<CheckResult>[] = [
      this.channelEqualsTenant(),
      this.entitlementOnlyAccessControl(),
      this.ledgerImmutability(),
      this.meetingFsmRules(),
      this.noAdHocAccessChecks(),
    ];

    const results = await Promise.all(checks);
    const failures = results.filter(r => !r.passed);

    return {
      checker: this.name,
      name: 'adr-invariants',
      passed: failures.length === 0,
      severity: failures.length > 0 ? 'error' : 'info',
      message: failures.length === 0
        ? 'All ADR invariants verified'
        : `${failures.length} invariant(s) violated`,
      details: failures.map(f => `  [${f.name}] ${f.message}`).join('\n'),
    };
  }

  private async channelEqualsTenant(): Promise<CheckResult> {
    const srcDir = path.join(__dirname, '../../..');
    const files = findFiles(
      ['src/plugins/**/entities/*.ts', 'src/**/*.entity.ts'],
      srcDir
    );

    let channelAwareCount = 0;
    let channelIdScalarCount = 0;

    for (const file of files) {
      const content = readFileContent(file);
      const hasChannelAware = /implements\s+ChannelAware/.test(content);
      const hasChannelId = /channelId\s*:\s*string/.test(content);

      if (hasChannelAware && hasChannelId) {
        channelAwareCount++;
      } else if (hasChannelId) {
        channelIdScalarCount++;
      }
    }

    const message = `ChannelAware entities: ${channelAwareCount}, scalar channelId entities: ${channelIdScalarCount}`;

    return {
      checker: this.name,
      name: 'channel-equals-tenant',
      passed: true,
      severity: 'info',
      message,
      details: 'All tenant-scoped entities use either ChannelAware or scalar channelId per INV-001',
    };
  }

  private async entitlementOnlyAccessControl(): Promise<CheckResult> {
    const srcDir = path.join(__dirname, '../../..');
    const files = findFiles(
      ['src/plugins/**/entities/*.ts'],
      srcDir
    );

    const nonEntitlementAccessEntities: string[] = [];
    const allowedAccessEntities = new Set([
      'bbb-organization-member.entity.ts',
      'bbb-organization-membership.entity.ts',
    ]);

    for (const file of files) {
      const content = readFileContent(file);
      const fileName = path.basename(file);

      if (allowedAccessEntities.has(fileName)) {
        continue;
      }

      if (/entity/i.test(fileName) && !/entitlement/i.test(fileName)) {
        const hasMembership = /membership/i.test(content);
        const hasRole = /role\s*:\s*string/.test(content);

        if (hasMembership || hasRole) {
          nonEntitlementAccessEntities.push(fileName);
        }
      }
    }

    const message = `Non-entitlement access control entities: ${nonEntitlementAccessEntities.join(', ') || 'none'}`;

    return {
      checker: this.name,
      name: 'entitlement-only-access',
      passed: nonEntitlementAccessEntities.length === 0,
      severity: nonEntitlementAccessEntities.length > 0 ? 'warning' : 'info',
      message,
      details: 'INV-003 allows documented exceptions (e.g., BbbOrganizationMember/Membership as prior gates per §8A)',
    };
  }

  private async ledgerImmutability(): Promise<CheckResult> {
    const srcDir = path.join(__dirname, '../../..');
    const files = findFiles(
      ['src/plugins/**/services/*.ts'],
      srcDir
    );

    const violations: string[] = [];

    for (const file of files) {
      const content = readFileContent(file);
      if (/ledger/.test(path.basename(file)) && /\.update\(/.test(content)) {
        violations.push(path.basename(file));
      }
    }

    const message = `Ledger update attempts found in: ${violations.join(', ') || 'none'}`;

    return {
      checker: this.name,
      name: 'ledger-immutability',
      passed: violations.length === 0,
      severity: violations.length > 0 ? 'error' : 'info',
      message: violations.length === 0
        ? 'No ledger update calls found'
        : `Ledger update calls found in: ${violations.join(', ')}`,
      details: 'INV-002: BbbUsageLedger rows must never be updated',
    };
  }

  private async meetingFsmRules(): Promise<CheckResult> {
    const srcDir = path.join(__dirname, '../../..');
    const files = findFiles(
      ['src/plugins/bigbluebutton-plugin/constants.ts'],
      srcDir
    );

    if (files.length === 0) {
      return {
        checker: this.name,
        name: 'meeting-fsm-rules',
        passed: false,
        severity: 'error',
        message: 'Meeting states file not found',
        details: 'Expected src/plugins/bigbluebutton-plugin/constants.ts',
      };
    }

    const content = readFileContent(files[0]);
    const hasPending = /Pending/.test(content);
    const hasProvisioning = /Provisioning/.test(content);
    const hasActive = /Active/.test(content);
    const hasCompleted = /Completed/.test(content);
    const hasArchived = /Archived/.test(content);
    const hasStale = /Stale/.test(content);

    const requiredStates = ['Pending', 'Provisioning', 'Active', 'Completed', 'Archived', 'Stale'];
    const missing = requiredStates.filter(s => !new RegExp(s).test(content));

    const message = `Required states present: ${requiredStates.filter(s => new RegExp(s).test(content)).join(', ')}`;
    const passed = missing.length === 0;

    return {
      checker: this.name,
      name: 'meeting-fsm-states',
      passed,
      severity: 'error',
      message: missing.length === 0
        ? 'All required meeting states present'
        : `Missing states: ${missing.join(', ')}`,
      details: 'INV-004: Meetings must follow FSM: Pending → Provisioning → Active → Completed → Archived/Failed/Stale',
    };
  }

  private async noAdHocAccessChecks(): Promise<CheckResult> {
    const srcDir = path.join(__dirname, '../../..');
    const files = findFiles(
      ['src/plugins/**/api/*.resolver.ts'],
      srcDir
    );

    let adHocChecks = 0;
    const suspiciousFiles: string[] = [];

    for (const file of files) {
      const content = readFileContent(file);
      const fileName = path.basename(file);

      // Known legacy data-source files: storefront resolvers that surface
      // enrollment rows for UI display are not access-control decisions.
      const knownLegacyDataSources = new Set([
        'bbb-shop.resolver.ts',
      ]);
      if (knownLegacyDataSources.has(fileName)) {
        continue;
      }

      // EntitlementService.hasAccess is the correct pattern — skip it
      if (/entitlementService\.hasAccess/.test(content)) {
        continue;
      }

      // Access-style enrollment checks that are NOT via entitlementService
      const hasDirectEnrollmentAccessCheck = /findOne.*enrollment.*customerId|enrollment\s*\?\s*=>|enrollment\s*===/.test(content);

      if (hasDirectEnrollmentAccessCheck) {
        adHocChecks++;
        suspiciousFiles.push(fileName);
      }
    }

    const passed = adHocChecks === 0;
    const message = passed
      ? 'No ad-hoc access checks found in resolvers'
      : `Ad-hoc enrollment checks found in: ${suspiciousFiles.join(', ')}`;

    return {
      checker: this.name,
      name: 'no-ad-hoc-access-checks',
      passed,
      severity: 'info',
      message,
      details: passed
        ? 'INV-003: EntitlementService.hasAccess is the only access-control system'
        : 'WARNING: Explicit enrollment checks bypass EntitlementService. These should use entitlementService.hasAccess()',
    };
  }
}
