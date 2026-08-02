// src/plugins/bigbluebutton-plugin/constants.ts
// CHANGE: Added ORG_ROLE enum and OrgRole type (M2)

import { PermissionDefinition } from "@vendure/core";

export const BBB_PLUGIN_OPTIONS = Symbol("BBB_PLUGIN_OPTIONS");

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
