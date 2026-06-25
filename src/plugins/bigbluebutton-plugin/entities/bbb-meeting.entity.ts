import type { DeepPartial } from "@vendure/common/lib/shared-types";
import { VendureEntity } from "@vendure/core";
import { Column, Entity, ManyToOne, JoinColumn } from "typeorm";
import { BbbOrganization } from "./bbb-organization.entity";
import { BbbServer } from "./bbb-server.entity";
import { MEETING_STATE } from "../constants";
import type { MeetingState } from "../constants";

@Entity("bbb_meeting")
export class BbbMeeting extends VendureEntity {
  constructor(input?: DeepPartial<BbbMeeting>) {
    super(input);
  }

  @ManyToOne(() => BbbOrganization, (org) => org.meetings, { nullable: false })
  organization: BbbOrganization;

  /** Human-readable title shown in BBB join screen */
  @Column()
  title: string;

  /**
   * BBB's external meeting identifier. Not sensitive — used in join URLs.
   */
  @Column({ nullable: true })
  bbbMeetingId: string;

  /**
   * BBB internal meeting ID (returned by createMeeting response).
   * Used for webhook correlation — never exposed via GraphQL.
   */
  @Column({ nullable: true })
  bbbInternalMeetingId: string;

  // ─── Encryption Key Versioning ────────────────────────────────────────────

  /**
   * Tracks which encryption key version was used to encrypt the passwords below.
   * Incremented via zero-downtime key rotation (see DA-003).
   */
  @Column({ default: 1 })
  encryptionKeyVersion: number;

  // ─── Encrypted Passwords (select: false — never leak through GraphQL) ────

  /**
   * AES-256-GCM encrypted attendee password.
   * Join URLs are derived from these; we never store URLs as primary state.
   * Load explicitly with .addSelect("meeting.encryptedAttendeePassword")
   */
  @Column({ nullable: true, select: false })
  encryptedAttendeePassword: string;

  /**
   * AES-256-GCM encrypted moderator password.
   * Required for endMeeting via BBB API and moderator join URLs.
   * Load explicitly with .addSelect("meeting.encryptedModeratorPassword")
   */
  @Column({ nullable: true, select: false })
  encryptedModeratorPassword: string;

  // ─── Server Relation ────────────────────────────────────────────────────

  /**
   * Relational FK to BbbServer — which server this meeting was provisioned on.
   * Used for webhook correlation, load tracking, and analytics.
   */
  @ManyToOne(() => BbbServer, { nullable: true })
  @JoinColumn({ name: "serverId" })
  server: BbbServer;

  @Column({ nullable: true })
  serverId: string;

  // ─── Immutable Grant Linkage ──────────────────────────────────────────────

  /**
   * FK to BbbCapacityGrant.id — stored at provisioning time.
   * This makes billing resolution immutable: the grant billed is the one
   * that was active WHEN the meeting was provisioned, not when it ended.
   * This eliminates the race condition of org-level grant changes during
   * a meeting's lifetime.
   */
  @Column({ nullable: true })
  grantId: string;

  // ─── Deprecated: kept for backward compatibility ────────────────────────

  /** @deprecated Use dynamic join from encrypted password */
  @Column({ type: "varchar", nullable: true })
  attendeeJoinUrl: string | null;

  @Column({ type: "timestamp", nullable: true })
  attendeeJoinUrlExpiresAt: Date | null;

  // ─── FSM State ──────────────────────────────────────────────────────────

  @Column({ type: "varchar", default: MEETING_STATE.PENDING })
  state: MeetingState;

  @Column({ nullable: true })
  failureReason: string;

  @Column({ default: 0 })
  retryCount: number;

  @Column({ nullable: true })
  provisionedAt: Date;

  @Column({ nullable: true })
  completedAt: Date;

  @Column({ default: false })
  recordingEnabled: boolean;

  // ─── Recording Metadata ─────────────────────────────────────────────────

  @Column({ nullable: true })
  bbbRecordingId: string;

  @Column({ nullable: true })
  recordingUrl: string;

  // ─── Room Linkage (nullable — legacy meetings have no room) ────────────

  @Column({ nullable: true })
  roomId: string;

  // ─── Billing Ceiling ────────────────────────────────────────────────────

  /**
   * Set to true when reconciliation force-completes a meeting that exceeded
   * maxMeetingDurationMs. Billing is capped at the ceiling value.
   */
  @Column({ default: false })
  billingCapped: boolean;

  /** Human-readable reason for billing cap — for audit and support. */
  @Column({ nullable: true })
  billingCapReason: string;

  // ─── Reconciliation Audit ────────────────────────────────────────────────

  /** Timestamp of the last reconciliation pass that touched this meeting. */
  @Column({ nullable: true })
  lastReconciledAt: Date;

  /** Number of reconciliation attempts (for detecting stuck meetings). */
  @Column({ default: 0 })
  reconciliationAttemptCount: number;

  // ─── BBB Plugin Manifests ───────────────────────────────────────────────

  @Column({ type: "text", nullable: true })
  pluginManifestsJson: string;

  get pluginManifests(): Array<{ url: string }> {
    if (!this.pluginManifestsJson) return [];
    try {
      return JSON.parse(this.pluginManifestsJson);
    } catch {
      return [];
    }
  }
}