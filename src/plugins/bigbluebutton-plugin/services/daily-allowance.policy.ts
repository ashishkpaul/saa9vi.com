/**
 * Slice 6 — daily live allowance policy (ADR-045, INV-026).
 *
 * The commercial matrix (plan §3.6, frozen 2026-09-22) separates two allowance
 * shapes, and they must never both apply to the same tenant:
 *
 *   Free Basic (provider-free)  → 60 live minutes PER SERVER DAY, no period pool
 *   Paid (provider-backed)      → a per-billing-period pool (`includedBbbMinutes`,
 *                                 written by the renewal path), no daily grant
 *
 * Plan §3.3 is explicit that the daily grant is a *different commercial policy*
 * than a billing-period pool, and that the three concepts stay separate:
 *
 *   BbbPlatformCapacityPolicy = infrastructure/packaging ceiling
 *   Commercial live policy    = tenant allowance (this module)
 *   BbbUsageLedger            = immutable usage fact (append-only)
 *
 * Everything here is pure — no Nest, no TypeORM, no Postgres — so the semantics
 * that the daily writer, the provisioning gate and the `myLiveUsage` read model
 * each depend on are pinned by an infrastructure-free spec and cannot drift.
 */

import { GrantSourceType } from "./grant-selection.policy";

/**
 * The frozen Free Basic daily runway — 60 minutes per server day
 * (plan §3.6 `Daily live minutes` row; D-1 frozen 2026-09-22).
 *
 * Deliberately a constant, not a `SubscriptionPlan` column: only the free tier
 * has a daily allowance at all (the paid column is `—`, see §3.6), so a new
 * column would be a migration whose only ever-value is 60. If a daily allowance
 * ever becomes a per-plan commercial dial, this export is the single place that
 * changes — the writer and the tests read it from here, never inline.
 */
export const DAILY_ALLOWANCE_MINUTES = 60;

/**
 * Daily grants reuse the discriminator already reserved for subscription-sourced
 * capacity (RFC-001 §4 v4 amendment / plan §3.3 item 4). They are NOT a second
 * grant kind: `BbbCapacityGrant(sourceType='subscription')` remains the one
 * table and the one union seam, which is what keeps slice 6 from becoming a
 * duplicate writer or a second entity.
 */
export const DAILY_ALLOWANCE_SOURCE_TYPE: GrantSourceType = "subscription";

/** The only plan fields this policy reads. Structural, so tests need no entity. */
export interface PlanProviderIdentity {
  providerPlanId?: string | null;
}

/**
 * `providerPlanId IS NULL` ⇔ the plan is provider-free (ADR-039, and the
 * discriminator ADR-044 §4 codifies as *definitive*).
 *
 * This is the ONLY supported "is this plan daily-only?" test. `status`,
 * `providerStatus` and the existence of a provider binding are all explicitly
 * unreliable (ADR-039:21 records legacy rows that are `active` with a null
 * provider status and no binding), so reusing this discriminator — rather than
 * introducing a `dailyAllowanceEnabled` flag — is what keeps plan identity
 * single-sourced.
 *
 * Load-bearing consequence: because the daily set and the period set are
 * **disjoint by plan**, the scheduled daily writer and the renewal writer can
 * never race on the same idempotency key. A single tenant is never both.
 */
export function isDailyOnlyPlan(
  plan: PlanProviderIdentity | null | undefined,
): boolean {
  if (!plan) return false;
  return !plan.providerPlanId;
}

/** Half-open-free day window: both bounds are inclusive, and consecutive days do not overlap. */
export interface DailyAllowanceWindow {
  /** Local (server-clock) midnight that starts the day. */
  start: Date;
  /** Last millisecond of the same local day. */
  end: Date;
}

/**
 * Local midnight for the server's own clock.
 *
 * D-7 fixes the timezone to the **Saa9vi server clock**, reusing ADR-042's rule
 * for the marketplace grace deadline ("evaluated using the Saa9vi server clock
 * only"). No per-tenant timezone is consulted, so the boundary a tenant sees is
 * the boundary the platform enforces — and the same clock that computes the
 * window evaluates `validFrom <= now AND validUntil >= now` in the read model
 * and in the provisioning gate.
 */
export function startOfServerDay(at: Date): Date {
  const start = new Date(at.getTime());
  start.setHours(0, 0, 0, 0);
  return start;
}

/**
 * The daily allowance window containing `at`.
 *
 * `end` is one millisecond *before* the next day's start, not the next start
 * itself. That makes consecutive windows strictly disjoint: both bounds are
 * tested inclusively (`validFrom <= now AND validUntil >= now`), so an `end`
 * equal to tomorrow's `start` would place two grants inside the window at that
 * instant and the `myLiveUsage` sum would report 120 minutes for a 60-minute
 * day. Disjointness is asserted in the infra-free spec.
 */
export function dailyAllowanceWindowFor(at: Date): DailyAllowanceWindow {
  const start = startOfServerDay(at);
  const nextStart = new Date(start.getTime());
  nextStart.setDate(nextStart.getDate() + 1);
  return { start, end: new Date(nextStart.getTime() - 1) };
}

/** Inclusive containment test — mirrors the SQL predicate used at read/provision time. */
export function isWithinAllowanceWindow(
  window: DailyAllowanceWindow,
  at: Date,
): boolean {
  const t = at.getTime();
  return t >= window.start.getTime() && t <= window.end.getTime();
}

/**
 * Stable key for the "(organization, validFrom = startOfDay, sourceType =
 * 'subscription')" idempotency rule of plan §3.3 — the same key the renewal
 * writer uses, expressed as the pair `validFrom` + sourceType.
 *
 * Used to serialize concurrent writers of one day's grant (per-key PostgreSQL
 * advisory lock; the advisory-lock-over-version-allocation pattern INV-025
 * established for `TenantTheme`). `validFrom` is taken as the millisecond value
 * so the key is exact and independent of the Date's string formatting.
 */
export function dailyAllowanceIdempotencyKey(
  organizationId: string | number,
  window: DailyAllowanceWindow,
): string {
  return `bbb-daily-allowance:${String(organizationId)}:${window.start.getTime()}:${DAILY_ALLOWANCE_SOURCE_TYPE}`;
}
