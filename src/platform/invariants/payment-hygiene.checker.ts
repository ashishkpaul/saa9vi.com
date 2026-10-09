import * as fs from 'fs';
import * as path from 'path';

import { CheckResult, Checker } from './runner';

/**
 * Commit 1 hygiene — payment-method invariant (INV-030).
 *
 * Static source-shape assertions (no database, same class as
 * RoomAccessChecker / MeteredBillingChecker):
 *
 *   1. Tenant role keeps ReadPaymentMethod but NOT Create/Update/Delete.
 *   2. vendure-config gates dummyPaymentHandler behind dev/test.
 *   3. Tenant auto-provision filters to the Razorpay handler code.
 *   4. PaymentsProductionGuard refuses non-dev boot with dummy rows.
 *
 * Live per-channel state (every non-dev channel has an enabled Razorpay
 * method, none has dummy) is enforced at RUNTIME by
 * PaymentsProductionGuard.onApplicationBootstrap, not here — this CLI has
 * no database connection. In dev the runtime guard is intentionally
 * skipped; this checker reports that skip explicitly via checkRuntimeSkip().
 */
export class PaymentHygieneChecker implements Checker {
  name = 'payment-hygiene';

  async check(): Promise<CheckResult> {
    const checks: Array<{ name: string; passed: boolean; detail?: string }> = [
      this.tenantRoleReadOnly(),
      this.dummyGatedInConfig(),
      this.provisionFiltersToRazorpay(),
      this.productionGuardRegistered(),
    ];
    const failed = checks.filter((c) => !c.passed);
    const runtimeSkip = this.runtimeSkipNote();
    return {
      checker: 'payment-hygiene',
      name: 'INV-030 payment-method hygiene',
      passed: failed.length === 0,
      severity: failed.length === 0 ? 'info' : 'error',
      message:
        failed.length === 0
          ? `payment hygiene static checks pass (${checks.length}/${checks.length}). ${runtimeSkip}`
          : `payment hygiene violated: ${failed.map((f) => f.name).join(', ')}`,
      details: checks.map((c) => `${c.passed ? 'PASS' : 'FAIL'} ${c.name}${c.detail ? ` — ${c.detail}` : ''}`).join('\n'),
    };
  }

  /** Dev note: runtime per-channel enforcement is skipped in dev by design. */
  private runtimeSkipNote(): string {
    if (process.env.APP_ENV === 'dev' || !process.env.APP_ENV) {
      return 'Runtime per-channel check skipped (dev: PaymentsProductionGuard no-ops by design).';
    }
    return 'Runtime per-channel check active (PaymentsProductionGuard enforces at boot).';
  }

  private read(rel: string): string {
    try {
      return fs.readFileSync(path.join(process.cwd(), rel), 'utf8');
    } catch {
      return '';
    }
  }

  private tenantRoleReadOnly() {
    const src = this.read('src/plugins/tenant-plugin/constants.ts');
    const hasRead = src.includes('Permission.ReadPaymentMethod');
    const hasWrite =
      src.includes('Permission.CreatePaymentMethod') ||
      src.includes('Permission.UpdatePaymentMethod') ||
      src.includes('Permission.DeletePaymentMethod');
    return {
      name: 'tenant-role-payment-readonly',
      passed: hasRead && !hasWrite,
      detail: hasWrite ? 'tenant role still holds PaymentMethod write permission' : undefined,
    };
  }

  private dummyGatedInConfig() {
    const src = this.read('src/vendure-config.ts');
    const gated =
      src.includes('allowDummyPaymentHandler') &&
      (src.includes("process.env.NODE_ENV === 'test'") || src.includes('process.env.NODE_ENV === "test"'));
    return {
      name: 'dummy-handler-dev-test-gated',
      passed: gated,
      detail: gated ? undefined : 'vendure-config must gate dummyPaymentHandler behind IS_DEV || NODE_ENV=test',
    };
  }

  private provisionFiltersToRazorpay() {
    const src = this.read('src/plugins/tenant-plugin/services/tenant-registration.service.ts');
    const filtered = src.includes('RAZORPAY_HANDLER_CODE') && src.includes('razorpayMethods');
    return {
      name: 'auto-provision-razorpay-only',
      passed: filtered,
      detail: filtered ? undefined : 'autoProvisionChannelResources must filter to RAZORPAY_HANDLER_CODE',
    };
  }

  private productionGuardRegistered() {
    const src = this.read('src/plugins/payments/payments.plugin.ts');
    const guarded = src.includes('PaymentsProductionGuard') && src.includes('dummy-payment-handler');
    return {
      name: 'production-boot-guard',
      passed: guarded,
      detail: guarded ? undefined : 'PaymentsProductionGuard must refuse non-dev boot with dummy rows',
    };
  }
}
