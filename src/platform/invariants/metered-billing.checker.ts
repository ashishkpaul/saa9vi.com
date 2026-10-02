import * as fs from 'fs';
import * as path from 'path';

import { CheckResult, Checker } from './runner';

/**
 * INV-028 / INV-029 (ADR-047) — structural checker.
 *
 * **Phase 0 (original revision):** proves the *documentation and registration*
 * shape the invariants depend on — the canonical ADR exists, both invariants are
 * documented, the security entry exists, and the audit findings are registered as
 * bugs.
 *
 * **Phase 2 (this revision):** the same checker now ALSO asserts the code-level
 * shape from `docs/implementation/bbb-attendee-hour-billing-plan.md` Phase 2 —
 * the pure policy module is the single learner-math / monthly-rounding
 * implementation, no metered entity carries a money column, the provision gate
 * skips grants for `metered` orgs, and usage rows are written with
 * database-level idempotency. These are source-shape assertions (the same class
 * of check as `RoomAccessChecker`): they pin the structure reviewers would
 * otherwise have to eyeball on every edit.
 *
 * **H2/H3 remediation guard (added 2026-09-30, plan §7 go-ahead):** the same
 * checker also asserts the SEC-008 escalation fixes stay in place — the two
 * tenant-callable platform mutations (`createBbbCapacityGrant`,
 * `deleteBbbOrganization`) must be gated by a platform permission and *not* by a
 * tenant-held granular permission, and `bbbCapacityGrants` must assert channel
 * ownership before reading (BUG-047 sibling / BUG-049). Retargeting a gate back
 * to a tenant permission is a permission regression, so it must fail here rather
 * than pass review. The dashboard nav gates are deliberately *not* asserted: the
 * plan's Phase 6 restructures the nav (relabeling/moving `Capacity`,
 * `Trial Registrations`), so pinning ids here would only produce a false alarm.
 *
 * **S1 channel-isolation remediation (2026-09-30, BUG-046 / BUG-047-H1 / BUG-050):**
 * the same checker pins the isolation fixes: `meetingService.findAll` derives the
 * tenant no-argument organization set from `ctx.channelId`, both list reads share
 * the single `isPlatformCaller()` helper (Q5 anti-drift), organization updates are
 * gated by the `TENANT_EDITABLE_ORG_FIELDS` allowlist, and organization creation
 * cannot target a foreign channel.
 *
 * **S4 startRoom remediation (A22 / Phase 5.2 + 5.4):** the same checker pins the
 * Start contract — the mutation is INV-027-ordered (room channel assert before
 * the moderator evaluation before provisioning), `BbbRoomStartResult` carries a
 * tenant-safe `message` and NEVER the raw worker `failureReason`, and
 * `studentCount` is computed from the shared INV-027 validity windows (never
 * persisted, never a `trainerCount` (D5)).
 *
 * Pure source inspection — no database, consistent with `RoomAccessChecker`.
 */
export class MeteredBillingChecker implements Checker {
  name = 'metered-billing';

  async check(): Promise<CheckResult> {
    const checks: Promise<CheckResult>[] = [
      this.adrExists(),
      this.invariantsDocumented(),
      this.securityEntryExists(),
      this.auditBugsRegistered(),
      this.platformGuardsRemediated(),
      this.policyModuleIsPureAndSingle(),
      this.noMoneyColumnOnMeteredPath(),
      this.phase2BOperationalWiringPresent(),
      this.channelScopedReadsRemediated(),
      this.billingApiChannelScoped(),
      this.startRoomContractPresent(),
    ];

    const results = await Promise.all(checks);
    const failures = results.filter(r => !r.passed);

    return {
      checker: this.name,
      name: 'metered-billing',
      passed: failures.length === 0,
      severity: failures.length > 0 ? 'error' : 'info',
      message:
        failures.length === 0
          ? 'Metered billing documentation and registration present (INV-028, INV-029)'
          : failures.map(f => f.message).join('; '),
      details: failures.length === 0
        ? 'INV-028: BbbMeteredUsage is the metered billing fact; money derived once per month. INV-029: tenant-tier reads derive their organization from ctx.channelId. Phase 2 extends this checker with the code-level assertions.'
        : failures.map(f => `  [${f.name}] ${f.message}`).join('\n'),
    };
  }

  private rootDir(): string {
    return path.join(__dirname, '../../..');
  }

  private readOrEmpty(relativePath: string): string {
    const absolute = path.join(this.rootDir(), relativePath);
    return fs.existsSync(absolute) ? fs.readFileSync(absolute, 'utf-8') : '';
  }

  /** ADR-047 must exist as a full record, not only as an index entry. */
  private async adrExists(): Promise<CheckResult> {
    const full = this.readOrEmpty('docs/architecture/adr-047-bbb-attendee-hour-billing.md');
    const index = this.readOrEmpty('docs/architecture/platform-adr.md');

    const failures: string[] = [];
    if (!full) {
      failures.push(
        'docs/architecture/adr-047-bbb-attendee-hour-billing.md must exist (canonical path — docs/adr/ is the superseded archive)',
      );
    } else if (!/BbbMeteredUsage/.test(full) || !/learnerCount = max\(0, participantCount/.test(full)) {
      failures.push('ADR-047 must state the metered fact table and the learner formula');
    }
    if (!/## ADR-047/.test(index)) {
      failures.push('ADR-047 must have a summary section in docs/architecture/platform-adr.md');
    }

    return {
      checker: this.name,
      name: 'adr-047-registered',
      passed: failures.length === 0,
      severity: failures.length > 0 ? 'error' : 'info',
      message: failures.length === 0 ? 'ADR-047 present (full record + index entry)' : failures.join('; '),
    };
  }

  private async invariantsDocumented(): Promise<CheckResult> {
    const doc = this.readOrEmpty('docs/architecture/invariants.md');

    const failures: string[] = [];
    if (!/INV-028/.test(doc)) {
      failures.push('INV-028 must be documented in docs/architecture/invariants.md');
    }
    if (!/INV-029/.test(doc)) {
      failures.push('INV-029 must be documented in docs/architecture/invariants.md');
    }
    if (!/computeMonthChargePaise/.test(doc)) {
      failures.push('INV-028 must name the single rounding implementation (computeMonthChargePaise)');
    }

    return {
      checker: this.name,
      name: 'invariants-028-029',
      passed: failures.length === 0,
      severity: failures.length > 0 ? 'error' : 'info',
      message: failures.length === 0 ? 'INV-028 and INV-029 documented' : failures.join('; '),
    };
  }

  /** SEC-008 must exist, and must keep the un-fixed findings visible rather than silent. */
  private async securityEntryExists(): Promise<CheckResult> {
    const doc = this.readOrEmpty('docs/architecture/security.md');

    const failures: string[] = [];
    if (!/SEC-008/.test(doc)) {
      failures.push('SEC-008 must be documented in docs/architecture/security.md');
    }
    if (!/BUG-046/.test(doc)) {
      failures.push('SEC-008 must reference BUG-046 (the channel-isolation violation being remediated)');
    }

    return {
      checker: this.name,
      name: 'sec-008-registered',
      passed: failures.length === 0,
      severity: failures.length > 0 ? 'error' : 'info',
      message: failures.length === 0 ? 'SEC-008 documented with its open findings' : failures.join('; '),
    };
  }

  /** Every audit finding this ADR relies on must be registered, not just cited in prose. */
  private async auditBugsRegistered(): Promise<CheckResult> {
    const doc = this.readOrEmpty('docs/implementation/known-bugs.md');

    const required = ['BUG-046', 'BUG-047', 'BUG-048', 'BUG-049'];
    const missing = required.filter(id => !doc.includes(id));

    return {
      checker: this.name,
      name: 'audit-bugs-registered',
      passed: missing.length === 0,
      severity: missing.length > 0 ? 'error' : 'info',
      message:
        missing.length === 0
          ? 'A16/A17/A13/A18 findings registered as BUG-046…BUG-049'
          : `Missing bug registrations: ${missing.join(', ')}`,
    };
  }

  /**
   * H2/H3 (SEC-008 / BUG-047 sibling / BUG-049) — the escalation surfaces must
   * stay platform-gated, and grant reads must stay channel-asserted.
   *
   * Source inspection, not a runtime check: this is the shape a reviewer would
   * otherwise have to eyeball on every future edit to `bbb-admin.resolver.ts`.
   */
  private async platformGuardsRemediated(): Promise<CheckResult> {
    const source = this.readOrEmpty(
      'src/plugins/bigbluebutton-plugin/api/bbb-admin.resolver.ts',
    );

    const failures: string[] = [];
    if (!source) {
      failures.push(
        'src/plugins/bigbluebutton-plugin/api/bbb-admin.resolver.ts must exist (the H2/H3 gates live there)',
      );
    } else {
      // H2: platform-only capacity governance. Both were tenant-callable through
      // BbbManageOrganizations, which every tenant admin role holds.
      const platformGated: Array<[string, string]> = [
        ['createBbbCapacityGrant', 'async createBbbCapacityGrant('],
        ['deleteBbbOrganization', 'async deleteBbbOrganization('],
      ];
      for (const [name, signature] of platformGated) {
        const decorators = this.decoratorsFor(source, signature);
        if (!decorators) {
          failures.push(`${name} must be a decorated resolver method`);
          continue;
        }
        if (!/BbbPlatformInfrastructurePermission\.Permission/.test(decorators)) {
          failures.push(
            `${name} must be @Allow(…, BBBPlatformInfrastructurePermission.Permission) — H2/SEC-008`,
          );
        }
        if (/BbbManageOrganizationsPermission\.Permission/.test(decorators)) {
          failures.push(
            `${name} must NOT be reachable through BbbManageOrganizations (held by every tenant admin role) — H2/SEC-008`,
          );
        }
      }

      // H3: an arbitrary `organizationId` argument must be channel-asserted.
      const grantReadBody = this.bodyFor(source, 'async bbbCapacityGrants(');
      if (!grantReadBody) {
        failures.push('bbbCapacityGrants must be an async resolver method');
      } else if (!/assertOrganizationAccess\(/.test(grantReadBody)) {
        failures.push(
          'bbbCapacityGrants must call assertOrganizationAccess before reading — H3/BUG-049/INV-029',
        );
      }
    }

    return {
      checker: this.name,
      name: 'sec-008-platform-guards',
      passed: failures.length === 0,
      severity: failures.length > 0 ? 'error' : 'info',
      message:
        failures.length === 0
          ? 'H2/H3 remediation present: platform-only grant minting + org deletion, channel-asserted grant reads'
          : failures.join('; '),
    };
  }

  /**
   * Phase 2 code-level shape (plan Phase 2 item 1 / D2 / INV-028):
   * `services/metered-billing.policy.ts` is the single pure implementation of
   * learner math and monthly rounding.
   *
   * Pins three things a reviewer would otherwise have to eyeball:
   *   (a) the module exists and exports the canonical helpers;
   *   (b) it imports nothing operational (no ORM / connection / HTTP / config) —
   *       the unit spec must stay infrastructure-free;
   *   (c) no second implementation of the same rules exists elsewhere in the
   *       plugin (the spend-limit guard and the billing summary must share this
   *       module, otherwise the two money answers drift).
   */
  private async policyModuleIsPureAndSingle(): Promise<CheckResult> {
    const rel = "src/plugins/bigbluebutton-plugin/services/metered-billing.policy.ts";
    const source = this.readOrEmpty(rel);
    const failures: string[] = [];
    if (!source) {
      failures.push(`${rel} must exist (Phase 2 pure policy module)`);
    } else {
      for (const fn of ["learnerCountFrom", "monthOf", "computeMonthChargePaise"]) {
        if (!new RegExp(`export function ${fn}\\(`).test(source)) {
          failures.push(`${rel} must export ${fn} (single implementation — D2)`);
        }
      }
      const forbiddenImports = [
        "@vendure/core",
        "typeorm",
        "axios",
      ];
      const importLines = source
        .split("\n")
        .filter(line => /^import\s/.test(line.trim()));
      for (const token of forbiddenImports) {
        if (importLines.some(line => line.includes(token))) {
          failures.push(
            `${rel} must stay pure — found forbidden import ${JSON.stringify(token)}`,
          );
        }
      }
      // Bare operational tokens outside comments/docs would also break purity:
      // strip line comments, block comments and string literals, then look for
      // real references (not prose mentions in the module docblock).
      const codeOnly = source
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/(^|\s)\/\/.*$/gm, "$1")
        .replace(/`[^`]*`/g, '""')
        .replace(/"[^"\n]*"/g, '""')
        .replace(/'[^'\n]*'/g, "''");
      for (const token of ["TransactionalConnection", "process.env"]) {
        if (new RegExp(`\\b${token.replace(".", "\\.")}\\b`).test(codeOnly)) {
          failures.push(
            `${rel} must stay pure — found forbidden token ${JSON.stringify(token)}`,
          );
        }
      }
      // `BillingMode` is a *type-only* import of a string union: it carries no
      // runtime and cannot reach a database, so it is the one allowed import
      // beyond the module's own siblings.
      const runtimeImports = source
        .split("\n")
        .filter(
          line =>
            /^import\s/.test(line.trim()) && !/import\s+type\b/.test(line),
        );
      const nonConstantRuntime = runtimeImports.filter(
        line => !/from\s+["']\.\.\/constants["']/.test(line),
      );
      if (nonConstantRuntime.length > 0) {
        failures.push(
          `${rel} must import nothing operational at runtime ` +
            `(found: ${nonConstantRuntime.map(l => l.trim()).join(" | ")})`,
        );
      }
      const dupes = this.filesWithPattern(
        "src/plugins/bigbluebutton-plugin",
        /function\s+(learnerCountFrom|computeMonthChargePaise)\s*\(/,
        new Set([rel, "__tests__"]),
      );
      if (dupes.length > 0) {
        failures.push(
          `single rounding/learner implementation violated — also defined in: ${dupes.join(", ")} (D2)`,
        );
      }
    }

    return {
      checker: this.name,
      name: "metered-policy-pure-and-single",
      passed: failures.length === 0,
      severity: failures.length > 0 ? "error" : "info",
      message:
        failures.length === 0
          ? "metered-billing.policy.ts is the single pure learner-math/rounding implementation"
          : failures.join("; "),
    };
  }

  /**
   * Phase 2 code-level shape (D2 / INV-028): no money column on the metered
   * path. `BbbMeteredUsage` stores exact `learnerMinutes` + `ratePaisePerHour`;
   * the paise amount is derived once per month by `computeMonthChargePaise`.
   * A `chargePaise` / `amountPaise` column would invite a second rounding
   * implementation and a drifted invoice.
   */
  private async noMoneyColumnOnMeteredPath(): Promise<CheckResult> {
    const failures: string[] = [];
    for (const rel of [
      "src/plugins/bigbluebutton-plugin/entities/bbb-metered-usage.entity.ts",
      "src/plugins/bigbluebutton-plugin/entities/bbb-meeting-sample.entity.ts",
    ]) {
      const source = this.readOrEmpty(rel);
      if (!source) {
        failures.push(`${rel} must exist (Phase 1 data model)`);
        continue;
      }
      for (const col of ["chargePaise", "amountPaise", "totalPaise", "pricePaise"]) {
        if (new RegExp(`\\b${col}\\b`).test(source)) {
          failures.push(
            `${rel} must not declare a money column (${col}) — money is derived once per month (D2/INV-028)`,
          );
        }
      }
    }

    return {
      checker: this.name,
      name: "metered-no-money-column",
      passed: failures.length === 0,
      severity: failures.length > 0 ? "error" : "info",
      message:
        failures.length === 0
          ? "metered entities carry minutes + rate only, no money column (D2)"
          : failures.join("; "),
    };
  }

  /**
   * ADR-047 Phase 2B *operational* wiring (plan §§4-6, INV-028).
   *
   * The Phase 2 checks above pin the *data* shape (minutes + rate, no money
   * column) and the *single* rounding implementation. Those are necessary but
   * inert: they pass even when nothing ever writes a row. This check pins the
   * runtime wiring without which the Phase 2 tables stay empty forever —
   *
   *  1. the per-minute sampling tick exists and is registered, deduped by id
   *     (a service with no scheduled task is dead code),
   *  2. the tick only samples ACTIVE meetings of METERED orgs — sampling a
   *     grant org would create samples that are never billed,
   *  3. both writes carry DB-level idempotency (`ON CONFLICT ... DO NOTHING`),
   *     because the tick is at-least-once and an overlapping run must not
   *     double-count learner-minutes (INV-002),
   *  4. the recovery scan is wired into the reconciliation task, so a crash
   *     between completion and billing self-heals instead of stranding the
   *     session LIVE and the hours unbilled,
   *  5. provisioning skips grant selection for metered orgs and runs the
   *     postpaid guards instead (INV-028 — the grant path stays dormant), and
   *  6. the spend guard derives money through the single
   *     `computeMonthChargePaise` helper (D2).
   *
   * Source-shape assertions only, same class as `RoomAccessChecker`.
   */
  private async phase2BOperationalWiringPresent(): Promise<CheckResult> {
    const dir = "src/plugins/bigbluebutton-plugin";
    const files = {
      tick: `${dir}/jobs/bbb-metering.task.ts`,
      metering: `${dir}/services/bbb-metering.service.ts`,
      plugin: `${dir}/bigbluebutton.plugin.ts`,
      recon: `${dir}/services/bbb-reconciliation.service.ts`,
      reconTask: `${dir}/jobs/bbb-reconciliation.task.ts`,
      pruneTask: `${dir}/jobs/bbb-metering-prune.task.ts`,
      worker: `${dir}/services/bbb-provisioning-worker.service.ts`,
    };
    type Key = keyof typeof files;
    const keys = Object.keys(files) as Key[];
    const src = {} as Record<Key, string>;
    for (const key of keys) src[key] = this.readOrEmpty(files[key]);

    const failures: string[] = keys
      .filter(key => !src[key])
      .map(key => `${files[key]} must exist (Phase 2B operational wiring)`);

    // [file, required source pattern, what its absence would break]
    const required: Array<[Key, RegExp, string]> = [
      ["tick", /every\(1\)\.minutes\(\)/, "must schedule every 1 minute"],
      [
        "tick",
        /sampleActiveMeetings\(/,
        "must call BbbMeteringService.sampleActiveMeetings()",
      ],
      [
        "plugin",
        /existingIds\.has\(bbbMeteringTask\.id\)/,
        "must register bbbMeteringTask, deduped by id (scheduler registration pattern)",
      ],
      [
        "metering",
        /MEETING_STATE\.ACTIVE/,
        "sampling must be scoped to MEETING_STATE.ACTIVE",
      ],
      [
        "metering",
        /BILLING_MODE\.METERED/,
        "sampling must be scoped to BILLING_MODE.METERED (grant orgs are never sampled — INV-028)",
      ],
      [
        "metering",
        /ON CONFLICT \("meetingId", "bucketMinute"\) DO NOTHING/,
        'sample insert must be idempotent (ON CONFLICT ("meetingId", "bucketMinute") DO NOTHING)',
      ],
      [
        "metering",
        /ON CONFLICT \("meetingId"\) DO NOTHING/,
        'usage insert must be idempotent (ON CONFLICT ("meetingId") DO NOTHING — one usage row per meeting)',
      ],
      [
        "recon",
        /reconcilePendingMeteredBilling\(\)/,
        "must define reconcilePendingMeteredBilling() (metered recovery scan)",
      ],
      [
        "recon",
        /BbbMeteringService/,
        "must inject BbbMeteringService",
      ],
      [
        "recon",
        /findUnbilledCompletedMeetings\(/,
        "recovery scan must use BbbMeteringService.findUnbilledCompletedMeetings()",
      ],
      [
        "reconTask",
        /reconcilePendingMeteredBilling\(\)/,
        "must run reconcilePendingMeteredBilling() in its sweep",
      ],
      [
        "pruneTask",
        /pruneSamples\(/,
        "must call BbbMeteringService.pruneSamples() (plan item 8 — sample retention)",
      ],
      [
        "plugin",
        /existingIds\.has\(bbbMeteringPruneTask\.id\)/,
        "must register bbbMeteringPruneTask, deduped by id",
      ],
      [
        "worker",
        /assertMeteredProvisionable\(/,
        "must gate metered provisioning through assertMeteredProvisionable() (suspended + spend limit)",
      ],
      [
        "worker",
        /isMeteredOrganization\(meeting\.organization\)/,
        "must branch provisioning on isMeteredOrganization() so metered orgs read/consume no grant (INV-028)",
      ],
      [
        "worker",
        /computeMonthChargePaise\(/,
        "spend guard must derive money via computeMonthChargePaise() — no second rounding implementation (D2)",
      ],
    ];
    for (const [key, pattern, message] of required) {
      if (src[key] && !pattern.test(src[key])) {
        failures.push(`${files[key]} ${message}`);
      }
    }

    return {
      checker: this.name,
      name: "metered-phase2b-operational-wiring",
      passed: failures.length === 0,
      severity: failures.length > 0 ? "error" : "info",
      message:
        failures.length === 0
          ? "Phase 2B wiring present: sampling tick registered + metered-scoped, both writes idempotent, recovery scan wired, metered provision gate in place, sample retention scheduled"
          : failures.join("; "),
    };
  }

  /**
   * S1 channel-isolation remediation (BUG-046 / BUG-047-H1 / BUG-050, INV-029):
   * the list reads derive visibility from the shared platform helper, the
   * organization update stays on a tenant allowlist, and organization creation
   * cannot target a foreign channel. Source-shape pins for the security
   * boundaries a reviewer would otherwise have to re-eyeball on every edit.
   */
  private async channelScopedReadsRemediated(): Promise<CheckResult> {
    const meetingRel =
      "src/plugins/bigbluebutton-plugin/services/bbb-meeting.service.ts";
    const orgRel =
      "src/plugins/bigbluebutton-plugin/services/bbb-organization.service.ts";
    const accessRel =
      "src/plugins/bigbluebutton-plugin/services/bbb-channel-access.service.ts";
    const meetingSrc = this.readOrEmpty(meetingRel);
    const orgSrc = this.readOrEmpty(orgRel);
    const accessSrc = this.readOrEmpty(accessRel);
    const failures: string[] = [];

    const meetingFindAll = this.serviceBodyFor(meetingSrc, "async findAll(");
    if (!meetingFindAll) {
      failures.push(`${meetingRel} must define findAll()`);
    } else {
      if (!meetingFindAll.includes("isPlatformCaller")) {
        failures.push(
          "meeting findAll must gate the unrestricted path on isPlatformCaller() — BUG-046/INV-029",
        );
      }
      if (!meetingFindAll.includes("org.channels")) {
        failures.push(
          "meeting findAll must derive the tenant no-argument organization set from the org→channels join on ctx.channelId — BUG-046/INV-029",
        );
      }
      if (!meetingFindAll.includes("assertRoomAccess")) {
        failures.push(
          "meeting findAll must channel-assert an explicit roomId argument — INV-029",
        );
      }
    }

    const orgFindAll = this.serviceBodyFor(orgSrc, "async findAll(");
    if (!orgFindAll || !orgFindAll.includes("isPlatformCaller")) {
      failures.push(
        "organization findAll must gate platform visibility on the shared isPlatformCaller() helper — Q5 anti-drift",
      );
    }
    if (orgSrc.includes("userHasPermissions([Permission.SuperAdmin])")) {
      failures.push(
        "organization service must not keep its own SuperAdmin visibility check — use isPlatformCaller() (single shared definition)",
      );
    }

    const orgUpdate = this.serviceBodyFor(orgSrc, "async update(");
    if (!orgUpdate || !orgUpdate.includes("TENANT_EDITABLE_ORG_FIELDS")) {
      failures.push(
        "organization update must apply the TENANT_EDITABLE_ORG_FIELDS allowlist — BUG-047-H1/SEC-008",
      );
    }
    if (orgUpdate && !orgUpdate.includes("isPlatformCaller")) {
      failures.push(
        "organization update must branch on isPlatformCaller() before the allowlist — BUG-047-H1",
      );
    }

    const orgCreate = this.serviceBodyFor(orgSrc, "async create(");
    if (!orgCreate || !orgCreate.includes("isPlatformCaller")) {
      failures.push(
        "organization create must reject a non-platform caller whose input.channelId differs from ctx.channelId — BUG-050/INV-001",
      );
    }

    const helperDefs = (
      accessSrc.match(/isPlatformCaller\(ctx: RequestContext\): boolean/g) ?? []
    ).length;
    if (helperDefs !== 1) {
      failures.push(
        `isPlatformCaller() must be defined exactly once in ${accessRel} (found ${helperDefs}) — one shared definition (Q5)`,
      );
    }

    return {
      checker: this.name,
      name: "channel-scoped-reads-remediated",
      passed: failures.length === 0,
      severity: failures.length > 0 ? "error" : "info",
      message:
        failures.length === 0
          ? "S1 isolation present: channel-derived meeting list, platform-gated org list, tenant org-update allowlist, channel-safe org creation, single isPlatformCaller()"
          : failures.join("; "),
    };
  }

  /**
   * Body of a service method bounded by the next method declaration. Services
   * carry no `@Allow`/`@Query`/`@Mutation` decorators, so `bodyFor` would run
   * to EOF and produce false positives from sibling methods.
   */
  private serviceBodyFor(source: string, signature: string): string {
    const at = source.indexOf(signature);
    if (at === -1) return "";
    const rest = source.slice(at + signature.length);
    const next = rest.search(/\n  (?:async |private |public |protected )/);
    return next === -1
      ? source.slice(at)
      : source.slice(at, at + signature.length + next + 1);
  }

  /**
   * Phase 4 billing read API (D2 / D3 / Q2 / SEC-008): tenant billing reads
   * take no organization argument and derive scope from ctx.channelId, the
   * platform billing surfaces are platform-gated (never a tenant-held
   * `BbbManage*`), money flows only through `computeMonthChargePaise`, and the
   * placeholder rate resolution is wired into both the write and read paths.
   */
  private async billingApiChannelScoped(): Promise<CheckResult> {
    const resolverRel =
      "src/plugins/bigbluebutton-plugin/api/bbb-admin.resolver.ts";
    const billingRel =
      "src/plugins/bigbluebutton-plugin/services/bbb-billing.service.ts";
    const meteringRel =
      "src/plugins/bigbluebutton-plugin/services/bbb-metering.service.ts";
    const constantsRel = "src/plugins/bigbluebutton-plugin/constants.ts";
    const resolverSrc = this.readOrEmpty(resolverRel);
    const billingSrc = this.readOrEmpty(billingRel);
    const meteringSrc = this.readOrEmpty(meteringRel);
    const constantsSrc = this.readOrEmpty(constantsRel);
    const failures: string[] = [];

    // D3: tenant billing reads expose no organizationId argument or passthrough.
    for (const query of ["bbbBillingSummary(", "bbbMeteredMeetings("]) {
      const raw = this.bodyFor(resolverSrc, query);
      if (!raw) {
        failures.push(`${resolverRel} must declare ${query} (Phase 4 read)`);
        continue;
      }
      // bodyFor's slice can carry the NEXT member's leading docblock; strip
      // comments so prose mentioning `organizationId` cannot fail the check.
      const body = raw
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/\/\/[^\n]*/g, "");
      if (body.includes("organizationId")) {
        failures.push(
          `${query} must not accept or forward an organizationId — D3: the organization comes from ctx.channelId`,
        );
      }
    }

    // Platform billing surfaces must never be reachable via a tenant-held
    // permission (a BbbManage* in the gate would reopen BUG-047).
    for (const sig of ["bbbPlatformBillingSummary(", "setBbbOrganizationBilling("]) {
      const decorators = this.decoratorsFor(resolverSrc, sig);
      if (!decorators) {
        failures.push(`${resolverRel} must declare ${sig}`);
        continue;
      }
      if (!decorators.includes("BbbPlatformInfrastructurePermission")) {
        failures.push(
          `${sig} must be gated on BbbPlatformInfrastructurePermission (platform tier only)`,
        );
      }
      if (decorators.includes("BbbManage")) {
        failures.push(
          `${sig} must not be reachable through a tenant-held BbbManage* permission (BUG-047 regression)`,
        );
      }
    }

    // D2: money only through the policy helper — no local rounding anywhere in
    // the read path.
    if (!billingSrc.includes("computeMonthChargePaise(")) {
      failures.push(
        `${billingRel} must compute money via computeMonthChargePaise (D2)`,
      );
    }
    if (billingSrc.includes("Math.round")) {
      failures.push(
        `${billingRel} must not round locally — Math.round lives only in metered-billing.policy (D2)`,
      );
    }

    // Q2: one rate resolution shared by the summary and the snapshot write.
    if (
      !billingSrc.includes("resolveRatePaisePerLearnerHour(") ||
      !billingSrc.includes("platformDefaultRatePaisePerHour(")
    ) {
      failures.push(
        `${billingRel} must resolve the displayed rate through resolveRatePaisePerLearnerHour + platformDefaultRatePaisePerHour (Q2)`,
      );
    }
    if (!meteringSrc.includes("platformDefaultRatePaisePerHour(")) {
      failures.push(
        `${meteringRel} must resolve the snapshotted default rate through platformDefaultRatePaisePerHour (Q2 write-path parity)`,
      );
    }
    if (!constantsSrc.includes("DEFAULT_RATE_PLACEHOLDER_PAISE_PER_LEARNER_HOUR")) {
      failures.push(
        `${constantsRel} must define the clearly marked placeholder rate constant (Q2)`,
      );
    }

    // Production-readiness item 1: the placeholder must be unreachable in
    // production — the boot guard requires the explicit rate, and
    // vendure-config actually wires the plugin option from it. Without both,
    // a non-dev deployment bills every metered org the unapproved ₹20
    // placeholder (TODO(PRICE)).
    const guardRel = "src/platform/security/require-production-secrets.ts";
    const guardSrc = this.readOrEmpty(guardRel);
    if (!guardSrc.includes("BBB_DEFAULT_RATE_PAISE_PER_LEARNER_HOUR")) {
      failures.push(
        `${guardRel} must require BBB_DEFAULT_RATE_PAISE_PER_LEARNER_HOUR in non-dev (placeholder rate must be unreachable in production)`,
      );
    }
    const configRel = "src/vendure-config.ts";
    const configSrc = this.readOrEmpty(configRel);
    if (!/defaultRatePaisePerLearnerHour\s*:/.test(configSrc)) {
      failures.push(
        `${configRel} must pass defaultRatePaisePerLearnerHour into BigBlueButtonPlugin.init()`,
      );
    }

    return {
      checker: this.name,
      name: "billing-api-channel-scoped",
      passed: failures.length === 0,
      severity: failures.length > 0 ? "error" : "info",
      message:
        failures.length === 0
          ? "Phase 4 billing API present: D3 no-org tenant reads, platform-gated billing surfaces, D2 money via policy only, Q2 placeholder wired into write+read"
          : failures.join("; "),
    };
  }

  /**
   * S4 Start contract (A22 / Phase 5.2 + 5.4): the dashboard's "Start class"
   * is INV-027-ordered, tenant-safe on failure, and the room cards count
   * students from the SAME validity windows the room would admit (no N+1, no
   * persisted count, no trainerCount — D5 keeps trainers org-wide).
   */
  private async startRoomContractPresent(): Promise<CheckResult> {
    const meetingRel =
      "src/plugins/bigbluebutton-plugin/services/bbb-meeting.service.ts";
    const roomRel =
      "src/plugins/bigbluebutton-plugin/services/bbb-room.service.ts";
    const resolverRel =
      "src/plugins/bigbluebutton-plugin/api/bbb-admin.resolver.ts";
    const adminSchemaRel =
      "src/plugins/bigbluebutton-plugin/api/schema/bbb-admin.schema.ts";
    const meetingSrc = this.readOrEmpty(meetingRel);
    const roomSrc = this.readOrEmpty(roomRel);
    const resolverSrc = this.readOrEmpty(resolverRel);
    const adminSchemaSrc = this.readOrEmpty(adminSchemaRel);
    const failures: string[] = [];

    // 1. The mutation exists and is tenant-scoped (never platform-only: the
    //    tenant dashboard is its caller) — but the room channel assert runs
    //    inside the service (INV-029) before the moderator evaluation
    //    (INV-027) before provisioning.
    const startSig = "startRoomAsModerator(";
    const startBody = this.serviceBodyFor(meetingSrc, startSig);
    if (!startBody) {
      failures.push(`${meetingRel} must declare ${startSig} (S4 Start)`);
    } else {
      const roomAssert = startBody.indexOf("roomService.findById(");
      const modEval = startBody.indexOf("roomAccessService.evaluate(");
      const provision = startBody.indexOf("roomService.requestProvisioning(");
      if (roomAssert === -1) {
        failures.push(
          `${startSig} must load the room via roomService.findById (channel assert, INV-029)`,
        );
      }
      if (modEval === -1) {
        failures.push(
          `${startSig} must evaluate roomAccessService BEFORE provisioning (INV-027)`,
        );
      }
      if (provision === -1) {
        failures.push(
          `${startSig} must provision via roomService.requestProvisioning (lock + debounce idempotency)`,
        );
      }
      if (roomAssert !== -1 && modEval !== -1 && roomAssert > modEval) {
        failures.push(
          `${startSig} must assert the room BEFORE the moderator evaluation (INV-029 precedes INV-027)`,
        );
      }
      if (modEval !== -1 && provision !== -1 && modEval > provision) {
        failures.push(
          `${startSig} must evaluate access BEFORE requestProvisioning (INV-027 ordering)`,
        );
      }
      // 2. The synchronous metered gate mirrors the worker (suspended /
      //    spend-limit) and the tenant NEVER sees a raw failureReason.
      if (!startBody.includes("meteredGateRefusal(")) {
        failures.push(
          `${startSig} must consult the synchronous metered gate (meteredGateRefusal) before enqueueing`,
        );
      }
      // The Failed branch READS failedMeeting.failureReason only to map it
      // through tenantSafeFailureMessage — that read is legitimate. What is
      // forbidden is EMITTING it: a `failureReason:` / `failureReason,` /
      // `failureReason }` property on (or near) a returned result object.
      if (/failureReason\s*[:,}]/m.test(startBody)) {
        failures.push(
          `${startSig} must never surface the raw worker failureReason — use tenantSafeFailureMessage`,
        );
      }
      if (!startBody.includes("tenantSafeFailureMessage(")) {
        failures.push(
          `${startSig} must map worker failures through tenantSafeFailureMessage`,
        );
      }
      // waitMs is caller-bounded so the mutation cannot hold a request open.
      if (!meetingSrc.includes("START_ROOM_WAIT_MS_MAX")) {
        failures.push(
          `${meetingRel} must bound the caller waitMs with START_ROOM_WAIT_MS_MAX`,
        );
      }
    }

    // 3. SDL: the result carries a tenant-safe message, never internal ids.
    for (const token of [
      "type BbbRoomStartResult",
      "status: String!",
      "joinUrl: String",
      "roomState: String!",
      "message: String",
    ]) {
      if (!adminSchemaSrc.includes(token)) {
        failures.push(`${adminSchemaRel} must declare ${token} (S4 Start SDL)`);
      }
    }

    // 4. Room cards: studentCount computed from the shared INV-027 windows —
    //    never persisted on the entity, never N+1, never a trainerCount (D5).
    //    (The deliberate-NOT docblock in BbbRoomService mentions the word to
    //    explain its absence — that prose is fine; only an actual computed /
    //    returned / SDL field is forbidden.)
    if (!roomSrc.includes("withStudentCounts(")) {
      failures.push(
        `${roomRel} must attach studentCount via withStudentCounts (batched, no N+1)`,
      );
    }
    if (
      !roomSrc.includes("isEnrollmentValid(") ||
      !roomSrc.includes("isEntitlementValid(")
    ) {
      failures.push(
        `${roomRel} must reuse the shared INV-027 validity windows (isEnrollmentValid + isEntitlementValid)`,
      );
    }
    const codeOnly = (src: string) =>
      src
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/\/\/[^\n]*/g, "")
        .replace(/"""[\s\S]*?"""/g, "");
    if (
      /trainerCount\s*[:=?]/.test(codeOnly(roomSrc)) ||
      /trainerCount\s*[:=?]/.test(codeOnly(resolverSrc))
    ) {
      failures.push(
        `trainerCount must not exist on the room path — trainers are org-wide (D5)`,
      );
    }
    if (!resolverSrc.includes("findAllCards(") || !resolverSrc.includes("findCard(")) {
      failures.push(
        `${resolverRel} must read rooms through findAllCards/findCard (batched counts)`,
      );
    }

    return {
      checker: this.name,
      name: "start-room-contract",
      passed: failures.length === 0,
      severity: failures.length > 0 ? "error" : "info",
      message:
        failures.length === 0
          ? "S4 Start contract present: INV-027-ordered bbbStartRoom, synchronous metered gate, tenant-safe failure messages, batched studentCount from shared validity windows"
          : failures.join("; "),
    };
  }

  /** Text between the nearest preceding `@Allow(` and the method declaration. */
  private decoratorsFor(source: string, signature: string): string {
    const at = source.indexOf(signature);
    if (at === -1) return "";
    const before = source.slice(0, at);
    const allowAt = before.lastIndexOf('@Allow(');
    if (allowAt === -1) return '';
    // Bound the slice at the method declaration so a permission that appears
    // anywhere else in the file (e.g. the imports) cannot false-positive.
    return before.slice(allowAt, at);
  }

  /**
   * Body of a resolver method: from its declaration up to the decorator that
   * starts the next sibling method (`@Allow` / `@Query` / `@Mutation`).
   */
  private bodyFor(source: string, signature: string): string {
    const at = source.indexOf(signature);
    if (at === -1) return '';
    const rest = source.slice(at + 1);
    const next = rest.search(/^ {2}@(Allow|Query|Mutation)\(/m);
    return next === -1 ? source.slice(at) : source.slice(at, at + 1 + next);
  }

  /**
   * Relative paths under `dirRel` (recursively) whose content matches
   * `pattern`, skipping any path containing one of `excludeSubstrings`
   * (used to skip the policy module itself and its specs).
   */
  private filesWithPattern(
    dirRel: string,
    pattern: RegExp,
    excludeSubstrings: Set<string>,
  ): string[] {
    const hits: string[] = [];
    const walk = (dirAbs: string) => {
      for (const entry of fs.readdirSync(dirAbs, { withFileTypes: true })) {
        const abs = path.join(dirAbs, entry.name);
        const rel = path.relative(this.rootDir(), abs);
        if (excludeSubstrings.size > 0) {
          let excluded = false;
          excludeSubstrings.forEach(sub => {
            if (rel.includes(sub)) excluded = true;
          });
          if (excluded) continue;
        }
        if (entry.isDirectory()) {
          if (entry.name === 'node_modules' || entry.name === 'dist') continue;
          walk(abs);
        } else if (entry.isFile() && /\.(ts|tsx)$/.test(entry.name)) {
          try {
            if (pattern.test(fs.readFileSync(abs, 'utf-8'))) hits.push(rel);
          } catch {
            // Unreadable file — not a violation; other checks cover existence.
          }
        }
      }
    };
    walk(path.join(this.rootDir(), dirRel));
    return hits.sort();
  }
}
