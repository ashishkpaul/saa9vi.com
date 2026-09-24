/**
 * BUG-036 — single source of truth for "which grant may serve a tenant session".
 *
 * The defect was a duplicated rule that had drifted into two disagreeing
 * implementations:
 *
 *  - `GrantReaderService.getRemainingMinutes()` treated `isUnbounded` grants as
 *    `Infinity` (their `grantedMinutes` is a sentinel, not a quantity);
 *  - `BbbProvisioningWorkerService.doProvisionMeeting()` never read
 *    `isUnbounded` at all, so the auto-created unbounded `internal_overhead`
 *    grant (`grantedMinutes: -1`) always failed the minutes check and threw
 *    "No minutes remaining on plan" — a tenant with no purchased capacity could
 *    not provision, and an *exhausted* allowance was reported as a *missing* one.
 *
 * Both call sites now use these helpers, so the semantics live in exactly one
 * place and cannot drift again.
 */

/** Mirrors `BbbCapacityGrant.sourceType` (FEAT-002 / ADR §8A OP-005). */
export type GrantSourceType = "order" | "subscription" | "internal_overhead";

/**
 * `internal_overhead` capacity is ops/internal headroom, never a
 * customer-facing allowance: it must not be selectable for tenant-session
 * provisioning. A tenant with no commercial grant must get the accurate
 * "no grant exists yet" outcome instead of silently borrowing overhead
 * capacity (and then failing on the `-1` sentinel).
 */
export const TENANT_SELECTABLE_SOURCE_TYPES: readonly GrantSourceType[] = [
  "order",
  "subscription",
];

export interface GrantMinutesLike {
  grantedMinutes: number;
  consumedMinutes: number;
  isUnbounded: boolean;
}

/** Whether this source type may serve a tenant session at all. */
export function isTenantSelectableSourceType(
  sourceType: GrantSourceType,
): boolean {
  return TENANT_SELECTABLE_SOURCE_TYPES.includes(sourceType);
}

/**
 * Remaining minutes for a single grant, with the `Infinity` semantics that
 * `GrantReaderService` already used for unbounded grants.
 */
export function remainingMinutesForGrant(grant: GrantMinutesLike): number {
  if (grant.isUnbounded) return Infinity;
  return (grant.grantedMinutes ?? 0) - (grant.consumedMinutes ?? 0);
}

/** A grant can serve a session when it has capacity left. */
export function hasProvisionableMinutes(grant: GrantMinutesLike): boolean {
  return remainingMinutesForGrant(grant) > 0;
}

/**
 * No *selectable* grant was found for the organization. The pre-BUG-036 text is
 * retained verbatim: it is accurate for this case (no usable commercial grant)
 * and is referenced by existing runbooks.
 */
export const PROVISIONING_NO_GRANT_ERROR =
  "No active capacity grant found for this organization. Please purchase or renew a plan.";

/**
 * A commercial grant exists in-window but has no minutes left. Without this
 * distinct outcome an exhausted allowance was indistinguishable from a missing
 * one, because selection silently dropped `exhausted` grants.
 */
export const PROVISIONING_ALLOWANCE_EXHAUSTED_ERROR =
  "Your plan's meeting minutes for this period are exhausted. Please purchase or renew a plan to continue.";

/** The accurate domain outcome for a failed grant resolution. */
export function grantUnavailableReason(
  hasUnavailableCommercialGrant: boolean,
): string {
  return hasUnavailableCommercialGrant
    ? PROVISIONING_ALLOWANCE_EXHAUSTED_ERROR
    : PROVISIONING_NO_GRANT_ERROR;
}
