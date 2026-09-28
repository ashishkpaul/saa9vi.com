import { Badge } from '@vendure/dashboard';

type Variant = 'success' | 'warning' | 'default' | 'destructive' | 'outline';

interface StatusStyle {
  variant: Variant;
  label: string;
  hint: string;
}

/**
 * ONE source of truth for every status badge in the BBB dashboard.
 *
 * WHY A REGISTRY PER DOMAIN
 * -------------------------
 * The BBB vocabularies are genuinely different: a room is
 * `Idle | Provisioning | Active | Failed`, a meeting walks
 * `Pending → … → Archived`, a trial registration is
 * `REGISTERED | ATTENDED | CANCELLED | NO_SHOW`. A single map would have to
 * invent a union no entity declares, so each domain owns a map here — colour,
 * label and plain-English hint — and every route renders through `StatusBadge`.
 * No screen may invent its own colour rule.
 *
 * Hints are not decoration: a bare "Stale" or "Exhausted" means nothing to an
 * academy admin, so the hint is exposed as the badge's `title` tooltip.
 */

/** Every status gets a label AND a plain-English hint (shown on hover). */
const MEETING: Record<string, StatusStyle> = {
  Pending: { variant: 'warning', label: 'Pending', hint: 'Queued; waiting to be created on a BBB server.' },
  Provisioning: {
    variant: 'warning',
    label: 'Provisioning',
    hint: 'Being created on the BBB server right now.',
  },
  Active: { variant: 'success', label: 'Active', hint: 'Created and joinable.' },
  Completed: { variant: 'default', label: 'Completed', hint: 'Ended normally.' },
  Stale: {
    variant: 'default',
    label: 'Stale',
    hint: 'Never used / no longer running on the server; safe to delete.',
  },
  Archived: { variant: 'default', label: 'Archived', hint: 'Kept for history only.' },
  Failed: {
    variant: 'destructive',
    label: 'Failed',
    hint: 'Could not be created. Use Retry, or check the server.',
  },
};

const ROOM: Record<string, StatusStyle> = {
  Idle: { variant: 'default', label: 'Ready', hint: 'No live meeting; the room is available.' },
  Provisioning: {
    variant: 'warning',
    label: 'Starting',
    hint: 'The room is being created on the BBB server.',
  },
  Active: { variant: 'success', label: 'Live', hint: 'A meeting is running in this room right now.' },
  Failed: {
    variant: 'destructive',
    label: 'Unavailable',
    hint: 'The last provisioning attempt failed. Use Reset to try again.',
  },
};

const SESSION: Record<string, StatusStyle> = {
  SCHEDULED: { variant: 'default', label: 'Scheduled', hint: 'Booked; not started yet.' },
  LIVE: { variant: 'success', label: 'Live', hint: 'The trainer has started this session.' },
  FINISHED: { variant: 'default', label: 'Finished', hint: 'The session ended normally.' },
  CANCELLED: {
    variant: 'destructive',
    label: 'Cancelled',
    hint: 'Called off; enrolled learners no longer have access to this slot.',
  },
};

const TRIAL: Record<string, StatusStyle> = {
  REGISTERED: { variant: 'outline', label: 'Registered', hint: 'Signed up; has not attended yet.' },
  ATTENDED: { variant: 'success', label: 'Attended', hint: 'Turned up — may be converted to a learner.' },
  CANCELLED: { variant: 'warning', label: 'Cancelled', hint: 'Withdrawn before the session.' },
  NO_SHOW: { variant: 'destructive', label: 'No Show', hint: 'Did not attend and did not cancel.' },
};

/** The primitive. Every badge in the dashboard goes through this. */
export function StatusBadge({ variant, label, hint }: { variant: Variant; label: string; hint?: string }) {
  return (
    <span title={hint}>
      <Badge variant={variant}>{label}</Badge>
    </span>
  );
}

function fromRegistry(registry: Record<string, StatusStyle>, value: string) {
  const style = registry[value] ?? { variant: 'default' as Variant, label: value, hint: '' };
  return <StatusBadge variant={style.variant} label={style.label} hint={style.hint} />;
}

export function MeetingStateBadge({ state }: { state: string }) {
  return fromRegistry(MEETING, state);
}

export function RoomStateBadge({ state }: { state: string }) {
  return fromRegistry(ROOM, state);
}

export function SessionStatusBadge({ status }: { status: string }) {
  return fromRegistry(SESSION, status);
}

export function TrialStatusBadge({ status }: { status: string }) {
  return fromRegistry(TRIAL, status);
}

export type AccessStatus = 'active' | 'exhausted' | 'expired' | 'upcoming' | 'invalid';

/**
 * Anything with a validity window. `exhausted` exists only on
 * `BbbCapacityGrant` — `BbbEntitlement` has no such column, which is exactly why
 * this derivation has to tolerate its absence instead of being duplicated.
 */
export interface AccessWindow {
  validFrom?: string | null;
  validUntil?: string | null;
  exhausted?: boolean;
}

/**
 * DISPLAY-ONLY status derivation. This does not validate data.
 * Date-range validity (validFrom <= validUntil) must be enforced at the
 * BbbEntitlementService / grant-creation boundary, not here.
 *
 * A missing bound means "unbounded on that side", not "invalid": an entitlement
 * with no `validUntil` never expires.
 */
export function accessStatus(w: AccessWindow): AccessStatus {
  const now = Date.now();
  const from = w.validFrom ? +new Date(w.validFrom) : null;
  const until = w.validUntil ? +new Date(w.validUntil) : null;
  if (from !== null && until !== null && from > until) return 'invalid';
  if (w.exhausted) return 'exhausted';
  if (until !== null && until < now) return 'expired';
  if (from !== null && from > now) return 'upcoming';
  return 'active';
}

const ACCESS_STYLE: Record<AccessStatus, { variant: Variant; label: string; hint: string }> = {
  active: { variant: 'success', label: 'Active', hint: 'Inside its validity window and usable now.' },
  exhausted: {
    variant: 'destructive',
    label: 'Exhausted',
    hint: 'Fully consumed — no minutes left on this grant.',
  },
  expired: { variant: 'warning', label: 'Expired', hint: 'Its validity window ended in the past.' },
  upcoming: { variant: 'default', label: 'Upcoming', hint: 'Starts in the future; not usable yet.' },
  invalid: {
    variant: 'destructive',
    label: 'Invalid dates',
    hint: 'The end date is before the start date — a data error. Fix the source record.',
  },
};

function accessBadge(window: AccessWindow) {
  const style = ACCESS_STYLE[accessStatus(window)];
  return <StatusBadge variant={style.variant} label={style.label} hint={style.hint} />;
}

/** Capacity grant: carries a finite minute budget, so `exhausted` applies. */
export function GrantStatusBadge({ grant }: { grant: AccessWindow }) {
  return accessBadge(grant);
}

/**
 * Entitlement row. Same window derivation as a grant, but `BbbEntitlement`
 * carries only a scalar channelId plus the date window, so "exhausted" is not a
 * reachable state and is never rendered here.
 */
export function EntitlementStatusBadge({ entitlement }: { entitlement: AccessWindow }) {
  return accessBadge(entitlement);
}
