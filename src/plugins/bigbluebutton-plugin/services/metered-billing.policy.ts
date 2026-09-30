import { BILLING_MODE, DEFAULT_RATE_PLACEHOLDER_PAISE_PER_LEARNER_HOUR } from "../constants";
import type { BillingMode } from "../constants";

/** Month key used by `BbbMeteredUsage.periodMonth` — `YYYY-MM` (D4). */
export type PeriodMonth = string;

/** One meeting's contribution to a monthly total (D2). */
export interface MonthChargeRow {
  learnerMinutes: number;
  ratePaisePerHour: number;
}

/**
 * Pure metered-billing policy helpers (ADR-047 / INV-028).
 *
 * Dependency-free by design (mirrors `grant-selection.policy.ts`): every rule here
 * is unit-testable without a database, a `RequestContext`, or a plugin instance,
 * and each rule exists in exactly ONE place so the summary screens and the
 * spend-limit guard cannot drift (D2).
 *
 * Phase 2 of `docs/implementation/bbb-attendee-hour-billing-plan.md` adds the
 * remaining pure rules to this same module — `learnerCountFrom(...)`,
 * `monthOf(...)` and `computeMonthChargePaise(...)` (the single monthly rounding
 * implementation). Rate resolution lives here from Phase 1 so that the
 * provisioning guard, the billing write, and the recovery scan all share one
 * answer.
 */

/** The organization fields this policy depends on. */
export interface RateSource {
  billingMode?: BillingMode | string | null;
  ratePaisePerLearnerHour?: number | null;
}

/** True when the organization is billed per learner-hour instead of by grants. */
export function isMeteredOrganization(org: RateSource | null | undefined): boolean {
  return org?.billingMode === BILLING_MODE.METERED;
}

/**
 * Billable learners observed at one sampling instant (D1).
 *
 * Trainers (moderators) are never billable, and a moderator-heavy instant
 * (e.g. setup call before learners join) bills zero — never a negative count.
 * Non-finite or non-integer counts are treated as "no observation" (0) so a
 * malformed BBB payload cannot produce a negative or fractional learner count.
 */
export function learnerCountFrom(
  participantCount: number | null | undefined,
  moderatorCount: number | null | undefined,
): number {
  const participants = normaliseCount(participantCount);
  const moderators = normaliseCount(moderatorCount);
  return Math.max(0, participants - moderators);
}

/**
 * `YYYY-MM` month key for a completion instant, in UTC (D4).
 *
 * The key is snapshotted onto `BbbMeteredUsage.periodMonth` at write time so
 * monthly queries need no timezone arithmetic. UTC is the single reference —
 * callers must not substitute a local zone, otherwise the same instant lands in
 * two different months depending on where the server runs.
 *
 * Throws on an invalid date rather than inventing a month key: a malformed
 * key would scatter one meeting's minutes across the wrong invoice.
 */
export function monthOf(date: Date): PeriodMonth {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    throw new Error("monthOf requires a valid Date");
  }
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

/**
 * The SINGLE monthly rounding implementation (D2 / INV-028).
 *
 * Money is rounded exactly once per month:
 * `round( Σ(learnerMinutes × ratePaisePerHour) / 60 )`.
 * Rounding is **half-up to the nearest paisa** (Q2): `Math.round` on the
 * non-negative total moves an exact `.5` upward (1.5 → 2, 0.5 → 1).
 * Per-meeting rounding is forbidden — summing rounded rows drifts from the
 * auditable total, and two implementations of the same rule always diverge.
 *
 * Rows with malformed minutes/rates are ignored (never coerced into a price);
 * a missing or empty input charges 0.
 */
export function computeMonthChargePaise(
  rows: ReadonlyArray<MonthChargeRow | null | undefined> | null | undefined,
): number {
  if (!rows) return 0;
  let totalLearnerMinutePaise = 0;
  for (const row of rows) {
    const minutes = normaliseChargeAmount(row?.learnerMinutes);
    const rate = normaliseChargeAmount(row?.ratePaisePerHour);
    if (minutes === undefined || rate === undefined) continue;
    totalLearnerMinutePaise += minutes * rate;
  }
  return Math.round(totalLearnerMinutePaise / 60);
}

/**
 * Resolve the learner-hour rate in paise for an organization.
 *
 * Precedence: organization override → platform default → 0.
 *
 * Invalid overrides (non-integer, negative, non-finite) are **ignored rather than
 * coerced**: a malformed rate must never silently become a price. `0` means "no
 * rate configured" and bills nothing — missing configuration is not a licence to
 * invent a price for real usage.
 */
export function resolveRatePaisePerLearnerHour(
  org: RateSource | null | undefined,
  defaultRatePaisePerLearnerHour?: number | null,
): number {
  return (
    normaliseRate(org?.ratePaisePerLearnerHour) ??
    normaliseRate(defaultRatePaisePerLearnerHour) ??
    0
  );
}

/**
 * Effective platform default rate: the `defaultRatePaisePerLearnerHour` plugin
 * option when it is a valid non-negative integer (an explicit `0` counts as
 * "configured — bill nothing"), otherwise the clearly marked PLACEHOLDER price
 * (Q2 / `DEFAULT_RATE_PLACEHOLDER_PAISE_PER_LEARNER_HOUR`).
 *
 * Per-org overrides never flow through here — they win first via
 * `resolveRatePaisePerLearnerHour(org, platformDefaultRatePaisePerHour(options))`,
 * which is how both the billing write (metering) and the billing read API
 * (summary) derive the same answer.
 */
export function platformDefaultRatePaisePerHour(
  options: { defaultRatePaisePerLearnerHour?: number } | null | undefined,
): number {
  return (
    normaliseRate(options?.defaultRatePaisePerLearnerHour) ??
    DEFAULT_RATE_PLACEHOLDER_PAISE_PER_LEARNER_HOUR
  );
}

function normaliseRate(rate: number | null | undefined): number | undefined {
  if (typeof rate !== "number" || !Number.isFinite(rate)) return undefined;
  if (!Number.isInteger(rate) || rate < 0) return undefined;
  return rate;
}

/** Whole, non-negative observation counts only; anything else means "no data". */
function normaliseCount(value: number | null | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  if (!Number.isInteger(value) || value < 0) return 0;
  return value;
}

/** Whole, non-negative money inputs only; anything else means "skip this row". */
function normaliseChargeAmount(value: number | null | undefined): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  if (!Number.isInteger(value) || value < 0) return undefined;
  return value;
}
