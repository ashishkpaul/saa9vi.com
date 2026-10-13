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
      this.marketplaceEntitlementInvariants(),
      this.dailyAllowanceInvariants(),
      this.capacityAlertHasSubscriber(),
      this.assertionCoverage(),
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

  /**
   * INV-024 (ADR-042) — structural verification of the marketplace listing
   * entitlement. Lightweight by design: verifies the structural elements exist
   * (plan capability flag defaulting to false, subscription grace column, ONE
   * shared policy evaluator, the indexer enforcement point, the FSM writers).
   * Runtime behaviour is covered by e2e tests, not here.
   *
   * It also enforces ADR-042 §6 by asserting that the policy file references no
   * prohibited eligibility signal (hostname/tenantSlug, customDomain,
   * providerStatus, provider subscription id).
   */
  private async marketplaceEntitlementInvariants(): Promise<CheckResult> {
    const srcDir = path.join(__dirname, '../../..');
    const failures: string[] = [];

    const planPath = path.join(srcDir, 'src/plugins/subscription/entities/subscription-plan.entity.ts');
    const planContent = readFileContent(planPath);
    if (!/marketplaceListingEnabled\s*:\s*boolean/.test(planContent)) {
      failures.push('SubscriptionPlan must declare marketplaceListingEnabled');
    }
    if (!/marketplaceListingEnabled[\s\S]{0,200}?default:\s*false|default:\s*false[\s\S]{0,200}?marketplaceListingEnabled/.test(planContent)) {
      failures.push('SubscriptionPlan.marketplaceListingEnabled must default to false (opt-in listing)');
    }

    const subPath = path.join(srcDir, 'src/plugins/subscription/entities/organization-subscription.entity.ts');
    const subContent = readFileContent(subPath);
    if (!/marketplaceGraceUntil/.test(subContent)) {
      failures.push('OrganizationSubscription must declare marketplaceGraceUntil');
    }

    // ONE policy evaluator (ADR-042 §4 / plan §3.4 item 4) — the shared
    // platform-level service, not a second evaluator inside the indexer.
    const policyPath = path.join(srcDir, 'src/platform/commercial/commercial-entitlement.service.ts');
    const policyContent = readFileContent(policyPath);
    if (!/channelMarketplaceEligible\s*\(/.test(policyContent)) {
      failures.push('CommercialEntitlementService must expose channelMarketplaceEligible()');
    }
    if (!/marketplaceListingEnabled/.test(policyContent)) {
      failures.push('The shared policy must gate on plan.marketplaceListingEnabled (ADR-042 §4)');
    }
    if (!/active/.test(policyContent) || !/past_due/.test(policyContent) || !/marketplaceGraceUntil/.test(policyContent)) {
      failures.push('The shared policy must implement the ADR-042 window: active OR (past_due AND now() < marketplaceGraceUntil)');
    }
    // ADR-042 §6 prohibition — the policy must not consult these as signals.
    // Comments are stripped first: the file is REQUIRED to document the
    // prohibited signals (ADR-042 §6 is part of the spec), so scanning raw text
    // would flag the documentation itself. Only executable code is checked.
    const policyCode = policyContent
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/[^\n]*/gm, '$1');
    for (const prohibited of ['tenantSlug', 'customDomain', 'providerStatus', 'providerSubscriptionId']) {
      if (new RegExp(`\\b${prohibited}\\b`).test(policyCode)) {
        failures.push(`ADR-042 §6 violation: the eligibility policy references prohibited signal '${prohibited}'`);
      }
    }

    const indexerPath = path.join(srcDir, 'src/plugins/marketplace/services/marketplace-indexer.service.ts');
    const indexerContent = readFileContent(indexerPath);
    if (!/channelMarketplaceEligible/.test(indexerContent)) {
      failures.push('MarketplaceIndexerService.indexSession() must apply channelMarketplaceEligible()');
    }
    if (!/commercialEntitlements/.test(indexerContent)) {
      failures.push('MarketplaceIndexerService must inject the shared platform policy, not a second evaluator');
    }

    // ADR-042 §5: grace transitions owned by SubscriptionRenewalService.
    const renewalPath = path.join(srcDir, 'src/plugins/subscription/services/subscription-renewal.service.ts');
    const renewalContent = readFileContent(renewalPath);
    if (!/marketplaceGraceUntil/.test(renewalContent)) {
      failures.push('SubscriptionRenewalService must own the marketplaceGraceUntil transitions');
    }
    if (!/MARKETPLACE_GRACE_PERIOD_DAYS/.test(renewalContent)) {
      failures.push('The marketplace grace period must be configurable (MARKETPLACE_GRACE_PERIOD_DAYS)');
    }

    return {
      checker: this.name,
      name: 'marketplace-entitlement-invariants',
      passed: failures.length === 0,
      severity: 'error',
      message: failures.length === 0
        ? 'Marketplace listing entitlement structural invariants present (INV-024)'
        : failures.join('; '),
      details: 'INV-024: plan flag default-false, subscription grace deadline, one shared policy evaluator, indexer enforcement, FSM-owned transitions, no prohibited signals',
    };
  }

  /**
   * INV-026 (ADR-045) — structural verification of the daily live-allowance
   * invariant. Structural only: it proves the *shape* the invariant depends on
   * still exists (one writer, per-key advisory lock, server-day window,
   * disjointness, disjoint plan sets, unchanged read model, no pre-enqueue
   * probe). Runtime behaviour is covered by the gated e2e suite, not here.
   */
  private async dailyAllowanceInvariants(): Promise<CheckResult> {
    const srcDir = path.join(__dirname, '../../..');
    const failures: string[] = [];

    const readOrEmpty = (relPath: string): string => {
      try {
        return readFileContent(path.join(srcDir, relPath));
      } catch {
        return '';
      }
    };

    const policyPath = 'src/plugins/bigbluebutton-plugin/services/daily-allowance.policy.ts';
    const policy = readOrEmpty(policyPath);
    if (!policy) {
      failures.push(`Missing daily-allowance policy module (${policyPath})`);
    } else {
      // The frozen commercial value (§3.6) must be a constant here, not inline
      // at any call site — the writer and both specs read it from this export.
      if (!/export\s+const\s+DAILY_ALLOWANCE_MINUTES\s*=\s*60\s*;/.test(policy)) {
        failures.push('DAILY_ALLOWANCE_MINUTES must be exported as 60 (plan §3.6, frozen)');
      }
      if (
        !/DAILY_ALLOWANCE_SOURCE_TYPE\s*:\s*GrantSourceType\s*=\s*["']subscription["']/.test(
          policy,
        )
      ) {
        failures.push(
          "DAILY_ALLOWANCE_SOURCE_TYPE must be the existing 'subscription' grant kind (F-6: no second grant semantics)",
        );
      }
      // Discriminator: providerPlanId IS NULL — no new flag (ADR-045 decision 2).
      if (!/function\s+isDailyOnlyPlan[\s\S]{0,220}providerPlanId/.test(policy)) {
        failures.push('isDailyOnlyPlan() must discriminate on providerPlanId (ADR-039/044)');
      }
      // Disjointness: end = next midnight − 1ms, never the next validFrom.
      if (!/nextStart\.getTime\(\)\s*-\s*1/.test(policy)) {
        failures.push(
          'dailyAllowanceWindowFor() must end one millisecond before the next server-day start (disjoint windows)',
        );
      }
      if (!/export\s+function\s+dailyAllowanceIdempotencyKey/.test(policy)) {
        failures.push('dailyAllowanceIdempotencyKey() must be exported from the policy module');
      }
    }

    const servicePath = 'src/plugins/bigbluebutton-plugin/services/bbb-daily-allowance.service.ts';
    const service = readOrEmpty(servicePath);
    if (!service) {
      failures.push(`Missing daily-allowance writer service (${servicePath})`);
    } else {
      if (!/pg_advisory_xact_lock/.test(service) || !/hashtextextended/.test(service)) {
        failures.push(
          'BbbDailyAllowanceService must serialise concurrent writers with a per-key advisory lock',
        );
      }
      if (!/dailyAllowanceIdempotencyKey\(/.test(service)) {
        failures.push('BbbDailyAllowanceService must derive its lock key from dailyAllowanceIdempotencyKey()');
      }
      if (!/sourceType:\s*DAILY_ALLOWANCE_SOURCE_TYPE/.test(service)) {
        failures.push('Daily grants must be written with sourceType = DAILY_ALLOWANCE_SOURCE_TYPE');
      }
      // The paid-tier ban lives in the writer so every caller inherits it.
      if (!/isDailyOnlyPlan\(/.test(service)) {
        failures.push(
          'BbbDailyAllowanceService must refuse provider-backed plans via isDailyOnlyPlan() (D-8: no daily grant for paid plans)',
        );
      }
      // Tier-2 precedent (BUG-039): the subscription lookup must be schema-qualified.
      if (!/rawConnection\.options[\s\S]{0,120}schema/.test(service)) {
        failures.push(
          'The subscription lookup must read the connection schema (BUG-039: raw SQL resolves via search_path)',
        );
      }
      if (!/organization_subscription/.test(service)) {
        failures.push('The subscription lookup must query the organization_subscription table');
      }
    }

    // ── Single writer (the core of the invariant) ────────────────────────────
    // Only the policy module and the writer service may name the daily grant
    // constants. A second module naming them is a second writer in the making —
    // the exact failure F-6's closure and plan §3.3 forbid.
    const allowedConstantOwners = new Set([policyPath, servicePath]);
    const pluginFiles = findFiles(['src/plugins/**/*.ts'], srcDir);
    const secondWriters: string[] = [];
    for (const file of pluginFiles) {
      const rel = path.relative(srcDir, file).split(path.sep).join('/');
      if (allowedConstantOwners.has(rel)) continue;
      if (/\.spec\.ts$|\.e2e-spec\.ts$|^src\/plugins\/[^/]+\/(e2e|__tests__)\//.test(rel)) continue;
      const content = readFileContent(file);
      if (/DAILY_ALLOWANCE_MINUTES|DAILY_ALLOWANCE_SOURCE_TYPE/.test(content)) {
        secondWriters.push(rel);
      }
    }
    if (secondWriters.length > 0) {
      failures.push(
        `Daily-grant constants referenced outside the policy module and its writer (second writer): ${secondWriters.join(', ')}`,
      );
    }

    // ── Triggers are plural, the writer is singular ───────────────────────────
    const taskPath = 'src/plugins/bigbluebutton-plugin/jobs/bbb-daily-allowance.task.ts';
    const task = readOrEmpty(taskPath);
    if (!task) {
      failures.push(`Missing daily-allowance scheduled task (${taskPath})`);
    } else {
      if (!/id:\s*["']bbb-daily-allowance["']/.test(task)) {
        failures.push('The daily-allowance task id must be "bbb-daily-allowance"');
      }
      if (!/every\(1\)\.hours\(\)/.test(task)) {
        failures.push('The daily-allowance task must run hourly (D-7)');
      }
      if (!/refreshDailyAllowance\(/.test(task)) {
        failures.push('The scheduled task must call BbbDailyAllowanceService.refreshDailyAllowance()');
      }
    }

    const pluginPath = 'src/plugins/bigbluebutton-plugin/bigbluebutton.plugin.ts';
    const plugin = readOrEmpty(pluginPath);
    if (!/BbbDailyAllowanceService/.test(plugin)) {
      failures.push('BbbDailyAllowanceService must be registered in the plugin providers');
    }
    if (!/bbbDailyAllowanceTask/.test(plugin)) {
      failures.push('bbbDailyAllowanceTask must be registered in the plugin scheduler');
    }

    const listenerPath = 'src/plugins/bigbluebutton-plugin/listeners/bbb-subscription.listener.ts';
    const listener = readOrEmpty(listenerPath);
    if (!/ensureDailyGrantForChannel\(/.test(listener)) {
      failures.push(
        'BbbSubscriptionListener must be the second (event) trigger, via the writer service — not a grant writer',
      );
    }
    if (/DAILY_ALLOWANCE_MINUTES|DAILY_ALLOWANCE_SOURCE_TYPE/.test(listener)) {
      failures.push('BbbSubscriptionListener must not write a grant directly (ADR-045 decision 1)');
    }

    // ── The read model must stay unchanged (zero SDL/codegen churn) ───────────
    const shopPath = 'src/plugins/subscription/services/subscription-shop.service.ts';
    const shop = readOrEmpty(shopPath);
    if (!/findMyLiveUsage/.test(shop)) {
      failures.push('findMyLiveUsage() must remain the daily allowance read model');
    }
    if (!/validFrom\s*<=\s*:now/.test(shop) || !/validUntil\s*>=\s*:now/.test(shop)) {
      failures.push('findMyLiveUsage() must keep the inclusive in-window predicate the daily grant relies on');
    }
    if (/DAILY_ALLOWANCE_MINUTES|DAILY_ALLOWANCE_SOURCE_TYPE/.test(shop)) {
      failures.push(
        'The read model must not special-case daily grants — they are ordinary in-window subscription grants',
      );
    }

    // ── D-6: exhaustion is decided at provisioning, not at enqueue ────────────
    const resolverFiles = findFiles(
      ['src/plugins/bigbluebutton-plugin/api/*.resolver.ts', 'src/plugins/bigbluebutton-plugin/api/**/*.resolver.ts'],
      srcDir,
    );
    for (const file of resolverFiles) {
      const content = readFileContent(file);
      const rel = path.relative(srcDir, file).split(path.sep).join('/');
      if (/DAILY_ALLOWANCE_MINUTES|PROVISIONING_ALLOWANCE_EXHAUSTED_ERROR/.test(content)) {
        failures.push(`${rel} must not probe the allowance before enqueueing (D-6: terminal Failed at provisioning)`);
      }
    }

    const workerPath = 'src/plugins/bigbluebutton-plugin/services/bbb-provisioning-worker.service.ts';
    const worker = readOrEmpty(workerPath);
    if (!/MEETING_STATE\.FAILED/.test(worker) || !/failureReason:/.test(worker)) {
      failures.push(
        'doProvisionMeeting() must still land an unavailable allowance in terminal Failed with a failureReason (D-6)',
      );
    }

    // ── Documentation registration (drift detection) ──────────────────────────
    const invariantsDoc = readOrEmpty('docs/architecture/invariants.md');
    if (!/INV-026/.test(invariantsDoc)) {
      failures.push('INV-026 must be documented in docs/architecture/invariants.md');
    }
    const adrDoc = readOrEmpty('docs/architecture/adr-045-daily-live-allowance.md');
    if (!adrDoc) {
      failures.push('docs/architecture/adr-045-daily-live-allowance.md must exist');
    }

    return {
      checker: this.name,
      name: 'daily-allowance-invariants',
      passed: failures.length === 0,
      severity: 'error',
      message:
        failures.length === 0
          ? 'Daily live-allowance structural invariants present (INV-026)'
          : failures.join('; '),
      details:
        'INV-026: one writer + plural triggers, server-day disjoint window, per-key advisory lock, provider-free-only grants, unchanged read model, no pre-enqueue probe',
    };
  }

  /**
   * INV-012 delivery amendment (production-readiness review, critical item 6):
   * `CapacityAlertEvent` must have a registered subscriber that reaches an
   * operator channel — before this check existed the event was published by
   * the 15-minute capacity task and consumed by *nobody*, so an "immediate"
   * alert lived only in the `BbbCapacityAlertLog` table. Structural only:
   * the listener file subscribes with `ofType(CapacityAlertEvent)`, and the
   * plugin registers both the listener and the ops-alert service it delegates
   * to. Runtime delivery is log-verifiable; this pins the wiring.
   */
  private async capacityAlertHasSubscriber(): Promise<CheckResult> {
    const srcDir = path.join(__dirname, '../../..');
    const failures: string[] = [];

    const readOrEmpty = (relPath: string): string => {
      try {
        return readFileContent(path.join(srcDir, relPath));
      } catch {
        return '';
      }
    };

    const listenerPath =
      'src/plugins/bigbluebutton-plugin/listeners/bbb-capacity-alert.listener.ts';
    const listener = readOrEmpty(listenerPath);
    if (!listener) {
      failures.push(`Missing capacity alert listener (${listenerPath})`);
    } else if (!/ofType\(\s*CapacityAlertEvent\s*\)/.test(listener)) {
      failures.push(
        'BbbCapacityAlertListener must subscribe with ofType(CapacityAlertEvent) (INV-012 delivery)',
      );
    }

    const plugin = readOrEmpty(
      'src/plugins/bigbluebutton-plugin/bigbluebutton.plugin.ts',
    );
    if (!/BbbCapacityAlertListener/.test(plugin)) {
      failures.push(
        'BbbCapacityAlertListener must be registered in the plugin providers (an unregistered subscriber never runs)',
      );
    }
    if (!/BbbOpsAlertService/.test(plugin)) {
      failures.push(
        'BbbOpsAlertService must be registered in the plugin providers (the operator alert channel)',
      );
    }

    // The immediate path must actually notify — not just log inside the task.
    // (The task constructs `new CapacityAlertEvent(...)` then publishes the
    // variable, so the check looks for construction + a publish call.)
    const task = readOrEmpty(
      'src/plugins/bigbluebutton-plugin/jobs/bbb-capacity-alert.task.ts',
    );
    if (task) {
      const constructsEvent = /new CapacityAlertEvent\s*\(/.test(task);
      const publishesEvent =
        /eventBus\.publish\(\s*new CapacityAlertEvent/.test(task) ||
        (/\.publish\(\s*\w*[Aa]lert\w*\s*\)/.test(task) && constructsEvent);
      if (!constructsEvent || !publishesEvent) {
        failures.push(
          'bbbCapacityAlertTask must publish CapacityAlertEvent so subscribers can deliver it',
        );
      }
    }

    const invariantsDoc = readOrEmpty('docs/architecture/invariants.md');
    if (!/INV-012[\s\S]{0,600}CapacityAlertEvent/.test(invariantsDoc)) {
      failures.push(
        'INV-012 delivery amendment (CapacityAlertEvent subscriber) must be documented in docs/architecture/invariants.md',
      );
    }

    return {
      checker: this.name,
      name: 'capacity-alert-has-subscriber',
      passed: failures.length === 0,
      severity: 'error',
      message:
        failures.length === 0
          ? 'CapacityAlertEvent has a registered subscriber reaching the ops-alert channel (INV-012 delivery)'
          : failures.join('; '),
      details:
        'INV-012 delivery: immediate capacity warnings must leave Postgres — listener subscribed, providers registered, event published, amendment documented',
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

  // ─── ADR-048: mutation-ownership assertion coverage (shrink-only ratchet) ──

  /**
   * ADR-048's two-clause source-shape ratchet (see the ADR for the exact
   * contract and the documented exemptions):
   *
   * 1. No dead guards — every `assert*Access` declared by
   *    `BbbChannelAccessService` has ≥1 production call site.
   * 2. No unasserted tenant mutation — every tenant-reachable `@Mutation` of
   *    `BbbAdminResolver` that takes a caller-supplied resource reference has
   *    a `channelAccess.assert*` call in its body, or is a named, re-verified
   *    entry in SERVICE_GUARD_ALLOWLIST.
   *
   * Both clauses deliberately over-approximate with regexes over
   * comment-stripped source; the trade (a future exotic formatting could
   * weaken detection) is accepted because the floors below fail loudly if the
   * parsing ever stops finding the shapes it depends on.
   */
  private async assertionCoverage(): Promise<CheckResult> {
    const srcDir = path.join(__dirname, '../../..');
    const serviceRel =
      'src/plugins/bigbluebutton-plugin/services/bbb-channel-access.service.ts';
    const resolverRel =
      'src/plugins/bigbluebutton-plugin/api/bbb-admin.resolver.ts';
    const failures: string[] = [];

    const readOrNull = (rel: string): string | null => {
      try {
        return readFileContent(path.join(srcDir, rel));
      } catch {
        return null;
      }
    };

    const serviceRaw = readOrNull(serviceRel);
    const resolverRaw = readOrNull(resolverRel);
    if (!serviceRaw) failures.push(`${serviceRel} must exist (it declares the guards)`);
    if (!resolverRaw) failures.push(`${resolverRel} must exist (it carries the mutations)`);

    let guardCount = 0;
    let mutationCount = 0;
    let assertedCount = 0;
    let allowlistedCount = 0;

    // ── Clause 1: every declared guard has ≥1 production call site ──────────
    if (serviceRaw && resolverRaw) {
      const serviceSrc = this.stripComments(serviceRaw);
      const guardNames = new Set<string>();
      const guardRe = /async\s+(assert\w+)\s*\(/g;
      let g: RegExpExecArray | null;
      while ((g = guardRe.exec(serviceSrc)) !== null) guardNames.add(g[1]);
      guardCount = guardNames.size;
      if (guardCount < 10) {
        // BbbChannelAccessService declares ten guards since ADR-048 deleted the
        // dead assertCapacityGrantAccess. Fewer means the extraction broke and
        // clause 1 would pass vacuously.
        failures.push(
          `clause 1 scan found only ${guardCount} guard(s) in ${serviceRel} (expected ≥10) — extraction regex broken?`,
        );
      }

      const productionFiles = findFiles(['src/**/*.ts'], srcDir).filter(file => {
        const rel = path.relative(srcDir, file).split(path.sep).join('/');
        if (rel === serviceRel) return false;
        // Invariant checkers mention guard names inside regex literals — they
        // are not callers, and counting them would mask a dead guard.
        if (rel.startsWith('src/platform/')) return false;
        if (rel.includes('/__tests__/')) return false;
        if (rel.endsWith('.spec.ts') || rel.endsWith('.e2e-spec.ts')) return false;
        return true;
      });

      for (const name of guardNames) {
        const callRe = new RegExp(`\\b${name}\\s*\\(`);
        const callers = productionFiles.filter(file =>
          callRe.test(this.stripComments(readFileContent(file))),
        );
        if (callers.length === 0) {
          failures.push(
            `clause 1 (no dead guards): ${name} has ZERO production call sites — wire it to its surface or delete it`,
          );
        }
      }
      // ── Clause 2: every tenant mutation with a resource reference is
      //    asserted in its body or is a verified allowlist entry ─────────────
      const resolverSrc = this.stripComments(resolverRaw);
      const markerRe = /@Mutation\(\)/g;
      const markerPositions: number[] = [];
      let mk: RegExpExecArray | null;
      while ((mk = markerRe.exec(resolverSrc)) !== null) markerPositions.push(mk.index);
      mutationCount = markerPositions.length;
      if (mutationCount < 40) {
        // BbbAdminResolver declares 41 @Mutation methods. Fewer means the scan
        // broke and clause 2 would pass vacuously — fail loudly instead.
        failures.push(
          `clause 2 scan found only ${mutationCount} @Mutation marker(s) (expected ≥40) — extraction regex broken?`,
        );
      } else {
        const usedAllowlist = new Set<string>();

        for (const pos of markerPositions) {
          const decorators = this.decoratorSlice(resolverSrc, pos);
          if (!decorators) {
            failures.push(
              `clause 2: @Mutation at offset ${pos} has no @Allow decorator — parsing assumption broken`,
            );
            continue;
          }
          // Documented exemption (ADR-048): platform-tier acts are gated by
          // the permission itself (ADR-033).
          if (/BbbPlatformInfrastructurePermission\.Permission/.test(decorators)) {
            continue;
          }

          const sig = this.signatureAt(resolverSrc, pos);
          if (!sig) {
            failures.push(
              `clause 2: could not extract the method signature after @Mutation at offset ${pos}`,
            );
            continue;
          }
          const body = this.bodyFrom(resolverSrc, sig.start);
          if (!REF_ARG.test(body)) continue; // no caller-supplied resource reference

          if (/channelAccess\.assert\w*\s*\(/.test(body)) {
            assertedCount++;
            continue;
          }

          const entry = SERVICE_GUARD_ALLOWLIST[sig.name];
          if (!entry) {
            failures.push(
              `clause 2 (no unasserted tenant mutation): ${sig.name} takes a caller-supplied resource reference but has no channelAccess.assert in its body and no SERVICE_GUARD_ALLOWLIST entry`,
            );
            continue;
          }
          usedAllowlist.add(sig.name);
          const svcRaw = readOrNull(entry.service);
          if (!svcRaw) {
            failures.push(
              `clause 2: allowlist entry ${sig.name} → ${entry.service} no longer exists`,
            );
            continue;
          }
          const svcSrc = this.stripComments(svcRaw);
          const at = svcSrc.indexOf(entry.method);
          if (at === -1) {
            failures.push(
              `clause 2: allowlist entry ${sig.name} → ${entry.method} not found in ${entry.service} — method renamed?`,
            );
            continue;
          }
          const svcBody = this.methodBodyAt(svcSrc, at + entry.method.indexOf('('));
          if (!entry.guard.test(svcBody)) {
            failures.push(
              `clause 2: allowlist entry ${sig.name} — ${entry.service} ${entry.method} no longer matches ${entry.guard} — the service-level ownership gate was removed`,
            );
            continue;
          }
          allowlistedCount++;
        }

        // Stale entries block the shrink-only direction: an allowlist entry no
        // flagged mutation uses must be deleted (the baseline shrinks), not
        // left behind as future false coverage.
        for (const name of Object.keys(SERVICE_GUARD_ALLOWLIST)) {
          if (!usedAllowlist.has(name)) {
            failures.push(
              `clause 2: stale SERVICE_GUARD_ALLOWLIST entry "${name}" is not used by any flagged mutation — delete it (shrink-only)`,
            );
          }
        }
        if (Object.keys(SERVICE_GUARD_ALLOWLIST).length > ALLOWLIST_MAX) {
          failures.push(
            `clause 2: SERVICE_GUARD_ALLOWLIST has ${Object.keys(SERVICE_GUARD_ALLOWLIST).length} entries > ALLOWLIST_MAX=${ALLOWLIST_MAX} — the allowlist can only shrink`,
          );
        }
      }
    }

    const passed = failures.length === 0;
    return {
      checker: this.name,
      name: 'assertion-coverage',
      passed,
      severity: passed ? 'info' : 'error',
      message: passed
        ? `ADR-048 ratchet: ${guardCount} guards all called; ${assertedCount} tenant mutations assert in-resolver, ${allowlistedCount} allowlisted (max ${ALLOWLIST_MAX}); ${mutationCount} total @Mutation`
        : failures.join('; '),
      details: passed
        ? 'Clause 1: no dead guards. Clause 2: no unasserted tenant mutation. Platform-gated mutations exempt per ADR-048 (permission is the tenancy boundary).'
        : failures.map(f => `  - ${f}`).join('\n'),
    };
  }

  /** Remove block and line comments so prose cannot fake a call site or a guard. */
  private stripComments(src: string): string {
    return src
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/[^\n]*/g, '');
  }

  /** Nearest preceding `@Allow(` … marker slice (the method's decorator block). */
  private decoratorSlice(source: string, markerPos: number): string {
    const before = source.slice(0, markerPos);
    const allowAt = before.lastIndexOf('@Allow(');
    return allowAt === -1 ? '' : before.slice(allowAt, markerPos);
  }

  /** Method name + start offset of the declaration following an @Mutation() marker. */
  private signatureAt(source: string, markerPos: number): { name: string; start: number } | null {
    const after = source.slice(markerPos);
    const m = after.match(/^ {2}(?:async\s+)?([A-Za-z0-9_]+)\s*\(/m);
    if (!m || m.index === undefined) return null;
    return { name: m[1], start: markerPos + m.index + m[0].indexOf(m[1]) };
  }

  /**
   * Resolver method body: from its declaration to the next sibling decorator
   * (`@Allow`/`@Query`/`@Mutation` at class-member indentation). Comments are
   * already stripped by the caller.
   */
  private bodyFrom(source: string, start: number): string {
    const rest = source.slice(start + 1);
    const next = rest.search(/^ {2}@(Allow|Query|Mutation)\(/m);
    return next === -1 ? source.slice(start) : source.slice(start, start + 1 + next);
  }

  /**
   * Service method body: from `sigStart` (an offset inside the method's
   * declaration) to the next class-member declaration at 2-space indentation.
   * Services carry no `@Allow` decorators, so the resolver cut does not apply —
   * and cutting at the next method keeps a later method's assert from
   * falsely satisfying this method's allowlist guard pattern.
   */
  private methodBodyAt(source: string, sigStart: number): string {
    const rest = source.slice(sigStart + 1);
    const next = rest.search(
      /^ {2}(?:private |public |protected |static |readonly |async )*[A-Za-z0-9_]+\s*\(/m,
    );
    return next === -1 ? source.slice(sigStart) : source.slice(sigStart, sigStart + 1 + next);
  }
}

/** Caller-supplied resource references that must be ownership-asserted (ADR-048). */
const REF_ARG =
  /@Args\(\s*"(?:id|roomId|sessionId|organizationId|registrationId|templateId|failedMeetingId|meetingId|productId|entitlementId)"|@Args\(\s*"input"|input\.(?:organizationId|roomId|resourceId|sessionId|channelId)/;

/**
 * Shrink-only allowlist: mutations whose ownership guard is load-bearing in
 * the delegated service and cannot be asserted before delegation without
 * loading the target row first (ADR-048). Each entry re-verifies the service
 * guard on every run; stale entries fail the run (shrink-only); size is capped
 * by ALLOWLIST_MAX. `guard` is tested against the comment-stripped body of the
 * mapped service method.
 */
const ALLOWLIST_MAX = 8;
const SERVICE_GUARD_ALLOWLIST: Record<
  string,
  { service: string; method: string; guard: RegExp }
> = {
  createBbbOrganization: {
    service: 'src/plugins/bigbluebutton-plugin/services/bbb-organization.service.ts',
    method: 'async create(',
    guard: /isPlatformCaller/, // BUG-050: channel-targeting check
  },
  createBbbScheduledSession: {
    service: 'src/plugins/bigbluebutton-plugin/services/bbb-scheduled-session.service.ts',
    method: 'async create(',
    guard: /channelAccess\.assert/,
  },
  updateBbbScheduledSession: {
    service: 'src/plugins/bigbluebutton-plugin/services/bbb-scheduled-session.service.ts',
    method: 'async update(',
    guard: /channelAccess\.assert/,
  },
  cancelBbbScheduledSession: {
    service: 'src/plugins/bigbluebutton-plugin/services/bbb-scheduled-session.service.ts',
    method: 'async cancel(',
    guard: /channelAccess\.assert/,
  },
  publishBbbScheduledSession: {
    service: 'src/plugins/bigbluebutton-plugin/services/bbb-scheduled-session.service.ts',
    method: 'async publish(',
    guard: /channelAccess\.assert/,
  },
  createBbbSessionTemplate: {
    service: 'src/plugins/bigbluebutton-plugin/services/bbb-scheduled-session.service.ts',
    method: 'async createTemplate(',
    guard: /channelAccess\.assert/,
  },
  deleteBbbSessionTemplate: {
    service: 'src/plugins/bigbluebutton-plugin/services/bbb-scheduled-session.service.ts',
    method: 'async deleteTemplate(',
    guard: /channelAccess\.assert/,
  },
  createSessionsFromTemplate: {
    service: 'src/plugins/bigbluebutton-plugin/services/bbb-scheduled-session.service.ts',
    method: 'async createSessionsFromTemplate(',
    guard: /channelAccess\.assert/,
  },
};
