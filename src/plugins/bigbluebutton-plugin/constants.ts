// src/plugins/bigbluebutton-plugin/constants.ts
// CHANGE: Added ORG_ROLE enum and OrgRole type (M2)

import { PermissionDefinition } from "@vendure/core";

export const BBB_PLUGIN_OPTIONS = Symbol("BBB_PLUGIN_OPTIONS");

export const BBB_PROVISIONING_QUEUE = "bbb-meeting-provisioning";

export const MEETING_STATE = {
  PENDING: "Pending",
  PROVISIONING: "Provisioning",
  ACTIVE: "Active",
  COMPLETED: "Completed",
  ARCHIVED: "Archived",
  FAILED: "Failed",
} as const;

export type MeetingState = (typeof MEETING_STATE)[keyof typeof MEETING_STATE];

export const MEETING_STATE_TRANSITIONS: Record<MeetingState, MeetingState[]> = {
  Pending: ["Provisioning", "Failed"],
  Provisioning: ["Active", "Failed"],
  Active: ["Completed", "Failed"],
  Completed: ["Archived"],
  Archived: [],
  Failed: ["Pending"],
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

export const BbbAdminPermission = new PermissionDefinition({
  name: BBB_PERMISSION_NAME,
  description:
    "Permission to manage BigBlueButton servers, organizations, and meetings",
});
