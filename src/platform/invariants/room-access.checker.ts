import * as path from 'path';

import { CheckResult, Checker, readFileContent } from './runner';

/**
 * INV-027 (BUG-045) — structural checker.
 *
 * Proves the *shape* the invariant depends on still exists:
 *  1. the pure policy module enumerates all four room-access sources;
 *  2. `bbbRoomStatus` (preview) delegates to the shared evaluator and no
 *     longer hand-rolls its own source list;
 *  3. `joinRoom` (action) delegates to the same evaluator and evaluates it
 *     BEFORE `requestProvisioning`, with no re-implemented gate left behind;
 *  4. the evaluator is registered as a plugin provider (DI actually resolves).
 *
 * Pure source inspection — no database. Behavioral parity (same customer, same
 * room, same instant) is pinned by the infra-free policy spec
 * (`__tests__/room-access.policy.spec.ts`); runtime e2e lives with the BBB
 * suites.
 */
export class RoomAccessChecker implements Checker {
  name = 'room-access';

  async check(): Promise<CheckResult> {
    const checks: Promise<CheckResult>[] = [
      this.policyEnumeratesSources(),
      this.previewDelegates(),
      this.joinAuthorizesBeforeProvisioning(),
      this.evaluatorIsRegistered(),
    ];

    const results = await Promise.all(checks);
    const failures = results.filter(r => !r.passed);

    return {
      checker: this.name,
      name: 'room-access',
      passed: failures.length === 0,
      severity: failures.length > 0 ? 'error' : 'info',
      message:
        failures.length === 0
          ? 'INV-027 verified: preview and join share one room-access evaluation, authorized before provisioning'
          : `${failures.length} INV-027 room-access invariant(s) violated`,
      details: failures.map(f => `  [${f.name}] ${f.message}`).join('\n'),
    };
  }

  private repoRoot(): string {
    return path.join(__dirname, '../../..');
  }

  private read(rel: string): string | null {
    const abs = path.join(this.repoRoot(), rel);
    try {
      return readFileContent(abs);
    } catch {
      return null;
    }
  }

  /** Slice one method body out of a source file between two anchors. */
  private methodBody(source: string, startSig: string, endSig: string): string | null {
    const start = source.indexOf(startSig);
    if (start === -1) return null;
    const end = source.indexOf(endSig, start + startSig.length);
    return end === -1 ? source.slice(start) : source.slice(start, end);
  }

  private fail(name: string, message: string, details: string): CheckResult {
    return {
      checker: this.name,
      name,
      passed: false,
      severity: 'error',
      message,
      details,
    };
  }

  private pass(name: string, message: string, details: string): CheckResult {
    return {
      checker: this.name,
      name,
      passed: true,
      severity: 'info',
      message,
      details,
    };
  }

  private async policyEnumeratesSources(): Promise<CheckResult> {
    const src = this.read(
      'src/plugins/bigbluebutton-plugin/services/room-access.policy.ts',
    );
    if (!src) {
      return this.fail(
        'policy-enumerates-sources',
        'room-access.policy.ts is missing',
        'INV-027 requires a single pure policy module for room access',
      );
    }
    const required = [
      'membership',
      'legacy_member',
      'entitlement',
      'enrollment',
      'deriveRoomAccess',
      'isEntitlementValid',
      'isEnrollmentValid',
    ];
    // Plain substrings, deliberately unquoted: the source literals are written
    // as `"membership"` (double quotes) in the policy module, so quoted search
    // tokens must not assume one style.
    const missing = required.filter(token => !src.includes(token));
    return missing.length === 0
      ? this.pass(
          'policy-enumerates-sources',
          'Policy module enumerates all four sources and window helpers',
          'room-access.policy.ts',
        )
      : this.fail(
          'policy-enumerates-sources',
          `Policy module is missing: ${missing.join(', ')}`,
          'All four sources (membership, legacy_member, entitlement, enrollment) must live in room-access.policy.ts',
        );
  }

  private async previewDelegates(): Promise<CheckResult> {
    const src = this.read('src/plugins/bigbluebutton-plugin/api/bbb-shop.resolver.ts');
    const body = src
      ? this.methodBody(src, 'async bbbRoomStatus(', 'async bbbJoinRoom(')
      : null;
    if (!body) {
      return this.fail(
        'preview-delegates',
        'bbbRoomStatus method not found in bbb-shop.resolver.ts',
        'INV-027: the preview must exist and delegate to the shared evaluator',
      );
    }
    const handRolled: string[] = [];
    if (body.includes('getRepository(ctx, BbbEnrollment)')) handRolled.push('BbbEnrollment');
    if (body.includes('getRepository(ctx, BbbEntitlement)')) handRolled.push('BbbEntitlement');
    if (body.includes('memberService.findActiveMembership')) handRolled.push('BbbOrganizationMember');

    if (handRolled.length > 0) {
      return this.fail(
        'preview-delegates',
        `bbbRoomStatus hand-rolls its own sources again: ${handRolled.join(', ')}`,
        'INV-027: bbbRoomStatus must call roomAccessService.evaluate only — two source lists are how BUG-045 happened',
      );
    }
    if (!body.includes('roomAccessService.evaluate')) {
      return this.fail(
        'preview-delegates',
        'bbbRoomStatus does not call roomAccessService.evaluate',
        'INV-027: preview denial ⇔ join denial requires the shared evaluation',
      );
    }
    if (!body.includes('access.allowed')) {
      return this.fail(
        'preview-delegates',
        'bbbRoomStatus does not gate on the shared decision (access.allowed)',
        'The evaluator result must actually be enforced with ForbiddenError',
      );
    }
    return this.pass(
      'preview-delegates',
      'bbbRoomStatus delegates to the shared evaluator with no hand-rolled sources',
      'api/bbb-shop.resolver.ts',
    );
  }

  private async joinAuthorizesBeforeProvisioning(): Promise<CheckResult> {
    const src = this.read(
      'src/plugins/bigbluebutton-plugin/services/bbb-meeting.service.ts',
    );
    const body = src
      ? this.methodBody(src, 'async joinRoom(', '// ─── Update')
      : null;
    if (!body) {
      return this.fail(
        'join-authorizes-before-provisioning',
        'joinRoom method not found in bbb-meeting.service.ts',
        'INV-027: joinRoom must exist and delegate to the shared evaluator',
      );
    }

    // Call-site tokens only — comments in joinRoom deliberately discuss
    // `requestProvisioning` (the INV-027 ordering note), so bare identifiers
    // would match prose before the actual code anchors.
    const evalIdx = body.indexOf('this.roomAccessService.evaluate');
    if (evalIdx === -1) {
      return this.fail(
        'join-authorizes-before-provisioning',
        'joinRoom does not call roomAccessService.evaluate',
        'INV-027: join must use the same evaluation as the preview',
      );
    }
    if (!body.slice(evalIdx).includes('access.allowed')) {
      return this.fail(
        'join-authorizes-before-provisioning',
        'joinRoom does not gate on access.allowed after evaluating',
        'A denied decision must throw before any provisioning work',
      );
    }

    const provisioningIdx = body.indexOf('this.roomService.requestProvisioning');
    if (provisioningIdx === -1) {
      return this.fail(
        'join-authorizes-before-provisioning',
        'joinRoom no longer requests provisioning (anchor changed — update this checker)',
        'The ordering check needs the requestProvisioning call site',
      );
    }
    if (evalIdx > provisioningIdx) {
      return this.fail(
        'join-authorizes-before-provisioning',
        'joinRoom authorizes AFTER requestProvisioning (BUG-045 #3 reintroduced)',
        'INV-027 corollary: a denied customer must never enqueue a meeting or acquire a grant linkage',
      );
    }

    const reimpl: string[] = [];
    if (body.includes('getRepository(ctx, BbbEnrollment)')) reimpl.push('BbbEnrollment query');
    if (body.includes('entitlementService.hasAccess')) reimpl.push('entitlement hasAccess gate');
    if (body.includes('membershipService.findActiveMembership')) reimpl.push('membership gate');
    if (reimpl.length > 0) {
      return this.fail(
        'join-authorizes-before-provisioning',
        `joinRoom re-implements sources itself: ${reimpl.join(', ')}`,
        'INV-027: all room-access sources live behind roomAccessService.evaluate',
      );
    }

    return this.pass(
      'join-authorizes-before-provisioning',
      'joinRoom delegates to the shared evaluator before requestProvisioning',
      'services/bbb-meeting.service.ts',
    );
  }

  private async evaluatorIsRegistered(): Promise<CheckResult> {
    const src = this.read('src/plugins/bigbluebutton-plugin/bigbluebutton.plugin.ts');
    if (!src) {
      return this.fail(
        'evaluator-is-registered',
        'bigbluebutton.plugin.ts not found',
        'The shared evaluator must be a registered provider',
      );
    }
    const hasImport = src.includes('BbbRoomAccessService');
    const hasProvider = /providers:\s*\[[\s\S]*?BbbRoomAccessService/.test(src);
    return hasImport && hasProvider
      ? this.pass(
          'evaluator-is-registered',
          'BbbRoomAccessService is imported and registered as a provider',
          'bigbluebutton.plugin.ts',
        )
      : this.fail(
          'evaluator-is-registered',
          `BbbRoomAccessService registration incomplete (import=${hasImport}, provider=${hasProvider})`,
          'Without a provider entry, neither surface can resolve the shared evaluator',
        );
  }
}
