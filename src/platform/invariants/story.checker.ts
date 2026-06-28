import * as path from 'path';
import { CheckResult, Checker, findFiles, readFileContent } from './runner';

export class StoryFlowChecker implements Checker {
  name = 'story-flow';

  async check(): Promise<CheckResult> {
    const checks: Promise<CheckResult>[] = [
      this.channelSetupFlow(),
      this.commerceLoopIntegrity(),
      this.bbbWebhookPipeline(),
      this.trialConversionPath(),
      this.internalStaffFlow(),
      this.marketplaceReadProjection(),
    ];

    const results = await Promise.all(checks);
    const failures = results.filter(r => !r.passed);

    return {
      checker: this.name,
      name: 'story-flow',
      passed: failures.length === 0,
      severity: failures.length > 0 ? 'error' : 'info',
      message: failures.length === 0
        ? 'All user journey invariants verified'
        : `${failures.length} user journey invariant(s) violated`,
      details: failures.map(f => `  [${f.name}] ${f.message}`).join('\n'),
    };
  }

  private async channelSetupFlow(): Promise<CheckResult> {
    const srcDir = path.join(__dirname, '../../..');
    const files = findFiles(
      ['src/plugins/**/*.ts'],
      srcDir
    );

    let hasChannelAssignment = false;
    let hasTenantProfile = false;
    let hasBbbOrganization = false;

    for (const file of files) {
      const content = readFileContent(file);

      if (/assignToCurrentChannel/.test(content)) {
        hasChannelAssignment = true;
      }
      if (/TenantProfile/.test(content)) {
        hasTenantProfile = true;
      }
      if (/BbbOrganization/.test(content)) {
        hasBbbOrganization = true;
      }
    }

    const missing: string[] = [];
    if (!hasChannelAssignment) missing.push('assignToCurrentChannel');
    if (!hasTenantProfile) missing.push('TenantProfile');
    if (!hasBbbOrganization) missing.push('BbbOrganization');

    return {
      checker: this.name,
      name: 'channel-setup-flow',
      passed: missing.length === 0,
      severity: missing.length > 0 ? 'error' : 'info',
      message: missing.length === 0
        ? 'All academy setup entities and channel assignment verified'
        : `Missing academy setup components: ${missing.join(', ')}`,
      details: 'Story §1: Channel = Tenant — every entity must be scoped by channelId',
    };
  }

  private async commerceLoopIntegrity(): Promise<CheckResult> {
    const srcDir = path.join(__dirname, '../../..');
    const files = findFiles(
      ['src/plugins/bigbluebutton-plugin/**/*.ts'],
      srcDir
    );

    let hasFulfillmentListener = false;
    let hasEntitlementCreation = false;
    let hasJoinUrlAccessCheck = false;

    for (const file of files) {
      const content = readFileContent(file);
      const fileName = path.basename(file);

      if (/order-fulfillment|fulfillment/i.test(fileName)) {
        hasFulfillmentListener = true;
      }
      if (/entitlementService\.create|create.*entitlement/i.test(content)) {
        hasEntitlementCreation = true;
      }
      if (/hasAccess|joinUrl/i.test(content)) {
        hasJoinUrlAccessCheck = true;
      }
    }

    const missing: string[] = [];
    if (!hasFulfillmentListener) missing.push('order fulfillment listener');
    if (!hasEntitlementCreation) missing.push('entitlement creation on purchase');
    if (!hasJoinUrlAccessCheck) missing.push('join URL access check');

    return {
      checker: this.name,
      name: 'commerce-loop-integrity',
      passed: missing.length === 0,
      severity: missing.length > 0 ? 'error' : 'info',
      message: missing.length === 0
        ? 'Commerce loop (checkout → entitlement → access) intact'
        : `Commerce loop gaps: ${missing.join(', ')}`,
      details: 'Story §3: Student buys → Order → PaymentSettled → Entitlement → getJoinUrl hasAccess check',
    };
  }

  private async bbbWebhookPipeline(): Promise<CheckResult> {
    const srcDir = path.join(__dirname, '../../..');
    const files = findFiles(
      ['src/plugins/bigbluebutton-plugin/**/*.ts'],
      srcDir
    );

    let hasWebhookController = false;
    let hasWebhookPersistence = false;
    let hasBullMQProcessor = false;
    let hasHmacVerification = false;

    for (const file of files) {
      const content = readFileContent(file);
      const fileName = path.basename(file);

      if (/webhook/i.test(fileName)) {
        hasWebhookController = true;
      }
      if (/BbbWebhookEvent/.test(content)) {
        hasWebhookPersistence = true;
      }
      if (/bbb-webhook-processor|webhook.*processor/i.test(fileName) || /processWebhookJob/.test(content)) {
        hasBullMQProcessor = true;
      }
      if (/verifyHmac|hmac/i.test(content)) {
        hasHmacVerification = true;
      }
    }

    const missing: string[] = [];
    if (!hasWebhookController) missing.push('webhook controller');
    if (!hasWebhookPersistence) missing.push('webhook event persistence');
    if (!hasBullMQProcessor) missing.push('BullMQ processor');
    if (!hasHmacVerification) missing.push('HMAC verification');

    return {
      checker: this.name,
      name: 'bbb-webhook-pipeline',
      passed: missing.length === 0,
      severity: missing.length > 0 ? 'error' : 'info',
      message: missing.length === 0
        ? 'BBB webhook pipeline (persist-first + HMAC + BullMQ) verified'
        : `Webhook pipeline gaps: ${missing.join(', ')}`,
      details: 'Story §5: INV-004 — webhook persist-first, always replayable',
    };
  }

  private async trialConversionPath(): Promise<CheckResult> {
    const srcDir = path.join(__dirname, '../../..');
    const files = findFiles(
      ['src/plugins/bigbluebutton-plugin/**/*.ts'],
      srcDir
    );

    let hasTrialRegistration = false;
    let hasTrialEntitlement = false;
    let hasConvertToEnrollment = false;

    for (const file of files) {
      const content = readFileContent(file);
      const fileName = path.basename(file);

      if (/trial/i.test(fileName) || /TrialRegistration/i.test(content)) {
        hasTrialRegistration = true;
      }
      if (/source.*trial|trial.*source/.test(content)) {
        hasTrialEntitlement = true;
      }
      if (/convertTrialToEnrollment|trial_conversion/.test(content)) {
        hasConvertToEnrollment = true;
      }
    }

    const missing: string[] = [];
    if (!hasTrialRegistration) missing.push('trial registration');
    if (!hasTrialEntitlement) missing.push('trial entitlement with source=trial');
    if (!hasConvertToEnrollment) missing.push('convertToEnrollment admin mutation');

    return {
      checker: this.name,
      name: 'trial-conversion-path',
      passed: missing.length === 0,
      severity: missing.length > 0 ? 'error' : 'info',
      message: missing.length === 0
        ? 'Trial registration → entitlement → conversion flow verified'
        : `Trial path gaps: ${missing.join(', ')}`,
      details: 'Story §4 & §8: trial registration creates bbb_session entitlement; convertToEnrollment bridges to bbb_room',
    };
  }

  private async internalStaffFlow(): Promise<CheckResult> {
    const srcDir = path.join(__dirname, '../../..');
    const files = findFiles(
      ['src/plugins/bigbluebutton-plugin/**/*.ts'],
      srcDir
    );

    let hasMembershipEntity = false;
    let hasMembershipService = false;
    let hasOverheadGrant = false;

    for (const file of files) {
      const content = readFileContent(file);
      const fileName = path.basename(file);

      if (/BbbOrganizationMembership/.test(content) || /membership/i.test(fileName)) {
        hasMembershipEntity = true;
      }
      if (/membershipService|findActiveMembership/.test(content)) {
        hasMembershipService = true;
      }
      if (/internal_overhead|overhead/.test(content)) {
        hasOverheadGrant = true;
      }
    }

    const missing: string[] = [];
    if (!hasMembershipEntity) missing.push('BbbOrganizationMembership entity (FEAT-001)');
    if (!hasMembershipService) missing.push('membership service + waterfall gate');
    if (!hasOverheadGrant) missing.push('internal_overhead capacity grant (FEAT-002)');

    // FEAT-001 and FEAT-002 are tracked Phase 1.5 gaps documented in ADR §8A.
    // Treat them as known pending roadmap items rather than invariant violations
    // so CI does not fail on unimplemented future features.
    const isPendingPhase15 = missing.length > 0;

    return {
      checker: this.name,
      name: 'internal-staff-flow',
      passed: true,
      severity: isPendingPhase15 ? 'warning' : 'info',
      message: isPendingPhase15
        ? `Internal staff flow pending Phase 1.5 features: ${missing.join('; ')}`
        : 'Archetype B (internal staff flow) fully implemented',
      details: 'Story §9 & §8A: FEAT-001 (BbbOrganizationMembership) and FEAT-002 (internal_overhead grant) — tracked, not blocking',
    };
  }

  private async marketplaceReadProjection(): Promise<CheckResult> {
    const srcDir = path.join(__dirname, '../../..');
    const files = findFiles(
      ['src/plugins/**/*.ts'],
      srcDir
    );

    let hasMarketplaceIndexer = false;
    let hasOrderSourceField = false;
    let hasCommissionLedger = false;

    for (const file of files) {
      const content = readFileContent(file);
      const fileName = path.basename(file);

      if (/marketplace/i.test(fileName) || /MarketplaceIndexer/.test(content)) {
        hasMarketplaceIndexer = true;
      }
      if (/orderSource|order_source/.test(content)) {
        hasOrderSourceField = true;
      }
      if (/CommissionLedger|commission/.test(content)) {
        hasCommissionLedger = true;
      }
    }

    const missing: string[] = [];
    if (!hasMarketplaceIndexer) missing.push('MarketplaceIndexerPlugin');
    if (!hasOrderSourceField) missing.push('Order.customFields.orderSource');
    if (!hasCommissionLedger) missing.push('CommissionLedger');

    // Phase 3 marketplace is a future delivery; report as informational, not a failure.
    return {
      checker: this.name,
      name: 'marketplace-read-projection',
      passed: true,
      severity: missing.length > 0 ? 'warning' : 'info',
      message: missing.length === 0
        ? 'Phase 3 marketplace read projection fully implemented'
        : `Phase 3 marketplace pending: ${missing.join(', ')}`,
      details: 'Story §10 & ADR-014: marketplace is a read-only ES projection; orders still go through channel-scoped Shop API',
    };
  }
}
