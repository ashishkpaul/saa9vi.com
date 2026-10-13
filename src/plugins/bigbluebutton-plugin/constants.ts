// src/plugins/bigbluebutton-plugin/constants.ts
// CHANGE: Added ORG_ROLE enum and OrgRole type (M2)

import { PermissionDefinition } from "@vendure/core";

export const BBB_PLUGIN_OPTIONS = Symbol("BBB_PLUGIN_OPTIONS");

/** Injection token for the publicBaseUrl string used by W3/W4 (BbbWebhookController + BbbHooksService). */
export const BBB_PUBLIC_BASE_URL = Symbol("BBB_PUBLIC_BASE_URL");

export const BBB_PROVISIONING_QUEUE = "bbb-meeting-provisioning";
export const BBB_WEBHOOK_QUEUE = "bbb-webhook-processor";

export const MEETING_STATE = {
  PENDING:      "Pending",
  PROVISIONING: "Provisioning",
  ACTIVE:       "Active",
  COMPLETED:    "Completed",
  ARCHIVED:     "Archived",
  FAILED:       "Failed",
  STALE:        "Stale",
} as const;

export type MeetingState = (typeof MEETING_STATE)[keyof typeof MEETING_STATE];

export const MEETING_STATE_TRANSITIONS: Record<MeetingState, MeetingState[]> = {
  Pending:      ["Provisioning", "Failed"],
  Provisioning: ["Active", "Failed"],
  Active:       ["Completed", "Failed", "Stale"],
  Completed:    ["Archived"],
  Archived:     [],
  Failed:       ["Pending"],
  Stale:        [],
};

// ─── Billing Mode (ADR-047) ──────────────────────────────────────────────────

/**
 * How an organization is billed.
 *
 * GRANT   — pre-purchased capacity grants (the shipped model). Kept as the DDL
 *           default so existing organizations are untouched by the metered
 *           rollout (`'grant'` is inherited, never backfilled — D7).
 * METERED — postpaid: `ratePaisePerLearnerHour × billable learner-hours`,
 *           metered by per-minute sampling into BbbMeteredUsage (ADR-047).
 *
 * INV-028: for a `metered` organization the metered fact table is the billing
 * truth and the grant path is dormant; the provisioning grant gate is skipped.
 */
export const BILLING_MODE = {
  GRANT: "grant",
  METERED: "metered",
} as const;

export type BillingMode = (typeof BILLING_MODE)[keyof typeof BILLING_MODE];

/**
 * PLACEHOLDER platform rate — 2000 paise = ₹20.00 per learner-hour (Q2).
 *
 * TODO(PRICE): Ashish to replace with the real launch price. Clearly marked so
 * it is never mistaken for a business decision: it applies ONLY when the
 * `defaultRatePaisePerLearnerHour` plugin option is omitted (an explicit `0`
 * still means "configured — bill nothing"), and a per-org
 * `ratePaisePerLearnerHour` override always wins over both. The single
 * resolution lives in `metered-billing.policy.ts#platformDefaultRatePaisePerHour`.
 */
export const DEFAULT_RATE_PLACEHOLDER_PAISE_PER_LEARNER_HOUR = 2000;

// ─── Tenant provisioning defaults (ADR-047 Phase 3) ─────────────────────────

/**
 * Default room names seeded for every newly provisioned organization when the
 * `defaultRooms` plugin option is omitted (ADR-047 Phase 3).
 *
 * A tenant must never be dropped into an empty back office: registration
 * provisions the organization and this room set together. Rooms are
 * organization-scoped and the organization's `concurrentMeetingLimit` remains
 * the sole concurrency enforcement surface (ADR-031), so the size of this list
 * is a UX choice, not a capacity one — multi-room needs no further code change.
 *
 * An explicit `defaultRooms: []` means "seed nothing" (opt-out).
 */
export const DEFAULT_SEEDED_ROOM_NAMES: readonly string[] = ["Main Classroom"];

// ─── A22 "Start class" (dashboard, Phase 5.2) ────────────────────────────────

/**
 * How long `bbbStartRoom` waits for the provisioning worker to flip the room to
 * `Active` before answering `status: 'starting'`. The UI then calls again —
 * repeats are cheap and idempotent (the Redis lock and the debounce inside
 * `requestProvisioning` absorb them).
 */
export const START_ROOM_WAIT_MS_DEFAULT = 6_000;

/** Upper bound applied to the caller-supplied `waitMs` argument. */
export const START_ROOM_WAIT_MS_MAX = 20_000;

/** Poll interval while waiting for the room state machine. */
export const START_ROOM_POLL_INTERVAL_MS = 400;

// ─── `joinRoom` statuses (Shop `bbbJoinRoom.status`) ─────────────────────────

/**
 * Saa9vi product invariant, enforced at the service boundary:
 * **Tenant Admin / Trainer start a class; learners only join a class that has
 * already been started.**
 *
 * Returned by `BbbMeetingService.joinRoom` when an *authorized non-moderator*
 * asks to join a room that is not `Active`. It is a SUCCESS outcome (access
 * was granted) — not an error — and it is returned BEFORE
 * `requestProvisioning`, so the caller causes no meeting row, no room state
 * flip and no provisioning job.
 */
export const JOIN_STATUS_WAITING_FOR_TRAINER = "waiting_for_trainer";

// ─── Organisation Member Roles ───────────────────────────────────────────────

/**
 * Roles within a BbbOrganization.
 * Students are no longer modeled as org members — they use BbbEnrollment.
 *
 * ORG_ADMIN  — Can buy plans, manage members, create meetings, join as moderator.
 * TRAINER    — Can join as moderator (presenter controls in BBB), create meetings.
 */
export const ORG_ROLE = {
  ORG_ADMIN: "org-admin",
  TRAINER: "trainer",
} as const;

export type OrgRole = (typeof ORG_ROLE)[keyof typeof ORG_ROLE];

/** All org roles receive a BBB moderator join URL */
export const MODERATOR_ROLES: OrgRole[] = [
  ORG_ROLE.ORG_ADMIN,
  ORG_ROLE.TRAINER,
];

export const BBB_PERMISSION_NAME = "BBBAdmin";

/**
 * Legacy coarse-grained permission. Kept for backward compatibility — any
 * user holding BBBAdmin retains access to all BBB admin operations even
 * without the granular permissions below.
 */
export const BbbAdminPermission = new PermissionDefinition({
  name: BBB_PERMISSION_NAME,
  description:
    "Permission to manage BigBlueButton servers, organizations, and meetings",
});

// ─── Granular BBB Permissions (Phase B) ─────────────────────────────────────
// These replace the single BBBAdmin permission with scoped access. Each
// resolver method is decorated with @Allow(BbbAdminPermission.Permission,
// <granular>.Permission) so BBBAdmin remains backward compatible while
// allowing finer-grained roles.

export const BBB_PLATFORM_INFRASTRUCTURE = "BBBPlatformInfrastructure";
export const BBB_MANAGE_ORGANIZATIONS = "BBBManageOrganizations";
export const BBB_MANAGE_ROOMS = "BBBManageRooms";
export const BBB_MANAGE_SESSIONS = "BBBManageSessions";
export const BBB_MANAGE_MEETINGS = "BBBManageMeetings";
export const BBB_MANAGE_ENTITLEMENTS = "BBBManageEntitlements";
export const BBB_MANAGE_MEMBERS = "BBBManageMembers";

export const BbbPlatformInfrastructurePermission = new PermissionDefinition({
  name: BBB_PLATFORM_INFRASTRUCTURE,
  description: "Manage BBB servers and platform capacity infrastructure",
});

export const BbbManageOrganizationsPermission = new PermissionDefinition({
  name: BBB_MANAGE_ORGANIZATIONS,
  description: "Create, read, update and delete BBB organizations",
});

export const BbbManageRoomsPermission = new PermissionDefinition({
  name: BBB_MANAGE_ROOMS,
  description: "Manage BBB rooms, product access and enrollments",
});

export const BbbManageSessionsPermission = new PermissionDefinition({
  name: BBB_MANAGE_SESSIONS,
  description: "Manage BBB scheduled sessions and trial registrations",
});

export const BbbManageMeetingsPermission = new PermissionDefinition({
  name: BBB_MANAGE_MEETINGS,
  description: "Manage BBB meetings, retry, end and moderator join",
});

export const BbbManageEntitlementsPermission = new PermissionDefinition({
  name: BBB_MANAGE_ENTITLEMENTS,
  description: "Manage BBB access entitlements",
});

export const BbbManageMembersPermission = new PermissionDefinition({
  name: BBB_MANAGE_MEMBERS,
  description: "Manage BBB organization members and memberships",
});

/** All granular BBB permission definitions for registration in the plugin. */
export const BBB_GRANULAR_PERMISSIONS = [
  BbbPlatformInfrastructurePermission,
  BbbManageOrganizationsPermission,
  BbbManageRoomsPermission,
  BbbManageSessionsPermission,
  BbbManageMeetingsPermission,
  BbbManageEntitlementsPermission,
  BbbManageMembersPermission,
];
