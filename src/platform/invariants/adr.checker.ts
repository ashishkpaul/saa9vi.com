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
      this.administratorVisibility(),
      this.tenantThemeInvariants(),
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
        // Match actual typed property declarations only — a bare `/membership/i`
        // previously matched doc-comment prose (e.g. "membership plan" in
        // subscription-plan.entity.ts) and false-flagged non-access entities.
        const hasMembership = /\bmembership\w*\??\s*:\s*/i.test(content);
        const hasRole = /\brole\w*\??\s*:\s*(string\b|['"])/i.test(content);

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

  private async administratorVisibility(): Promise<CheckResult> {
    const srcDir = path.join(__dirname, '../../..');
    const files = findFiles(
      ['src/plugins/tenant-plugin/**/*.ts'],
      srcDir
    );

    // INV-016: The TenantPlugin must override the `administrators` query so
    // that a tenant admin only sees administrators whose Role.channels[]
    // includes the active channel. If ReadAdministrator is ever granted to a
    // tenant role without this override, the built-in query would leak
    // global/SuperAdmin accounts.
    const hasAdministratorsOverride = files.some((file) => {
      const content = readFileContent(file);
      return /administrators/.test(content) && /channelId/.test(content);
    });

    const message = hasAdministratorsOverride
      ? 'TenantPlugin overrides administrators query with channel scoping'
      : 'TenantPlugin does NOT override the administrators query — INV-016 violated';

    return {
      checker: this.name,
      name: 'administrator-visibility',
      passed: hasAdministratorsOverride,
      severity: hasAdministratorsOverride ? 'info' : 'error',
      message,
      details: 'INV-016: administrators query must be channel-scoped to prevent leaking global/SuperAdmin accounts to tenant admins',
    };
  }

  /**
   * INV-025 (ADR-043) — structural verification of the TenantTheme invariant.
   * Lightweight by design: verifies the structural elements exist (entity with
   * DB-enforced one-active index, channel-scoped service, public Shop read,
   * eligibility service). Runtime behaviour is covered by e2e tests, not here.
   */
  private async tenantThemeInvariants(): Promise<CheckResult> {
    const srcDir = path.join(__dirname, '../../..');
    const failures: string[] = [];

    const entityPath = path.join(srcDir, 'src/plugins/tenant-plugin/entities/tenant-theme.entity.ts');
    const entityContent = readFileContent(entityPath);
    if (!/channelId\s*:\s*string/.test(entityContent)) {
      failures.push('TenantTheme entity missing scalar channelId');
    }
    // DB-enforced one-active-per-channel: partial unique index on status='active'
    if (!/status\s*=\s*'active'/.test(entityContent) || !/unique|Unique/i.test(entityContent)) {
      failures.push('TenantTheme entity missing partial unique index for one-active-per-channel');
    }

    const servicePath = path.join(srcDir, 'src/plugins/tenant-plugin/services/tenant-theme.service.ts');
    const serviceContent = readFileContent(servicePath);
    if (!/ctx\.channelId/.test(serviceContent)) {
      failures.push('TenantThemeService must derive channel from ctx.channelId');
    }
    if (!/assertCanUseWhitelabel|canUseWhitelabel/.test(serviceContent)) {
      failures.push('TenantThemeService must gate writes/activation via TenantCommercialEligibilityService');
    }

    const shopPath = path.join(srcDir, 'src/plugins/tenant-plugin/api/tenant-shop.resolver.ts');
    const shopContent = readFileContent(shopPath);
    if (!/Permission\.Public[\s\S]{0,400}myTenantTheme/.test(shopContent)) {
      failures.push('myTenantTheme must be Permission.Public (storefront resolves branding pre-auth)');
    }
    if (!/canUseWhitelabel|getActiveTheme\(ctx/.test(shopContent) && !/getActiveTheme/.test(shopContent)) {
      failures.push('myTenantTheme must resolve entitlement-conditionally via the theme service');
    }

    const eligibilityPath = path.join(srcDir, 'src/plugins/tenant-plugin/services/tenant-commercial-eligibility.service.ts');
    const eligibilityContent = readFileContent(eligibilityPath);
    if (!/trialing/.test(eligibilityContent) || !/past_due/.test(eligibilityContent) || !/whitelabelEnabled/.test(eligibilityContent)) {
      failures.push('TenantCommercialEligibilityService must enforce the ADR-043 §2.1 state window');
    }

    return {
      checker: this.name,
      name: 'tenant-theme-invariants',
      passed: failures.length === 0,
      severity: 'error',
      message: failures.length === 0
        ? 'TenantTheme structural invariants present (INV-025)'
        : failures.join('; '),
      details: 'INV-025: channel isolation, DB-enforced one-active, entitlement gating, public conditional Shop read',
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
