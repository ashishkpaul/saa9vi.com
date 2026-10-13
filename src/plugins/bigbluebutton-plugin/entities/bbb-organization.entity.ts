import type { DeepPartial } from "@vendure/common/lib/shared-types";
import { VendureEntity, Channel, ChannelAware } from "@vendure/core";
import { Column, Entity, Index, ManyToMany, JoinTable, OneToMany } from "typeorm";
import { BbbMeeting } from "./bbb-meeting.entity";
import { BbbCapacityGrant } from "./bbb-capacity-grant.entity";
import { BbbOrganizationMember } from "./bbb-organization-member.entity";
import { BbbRoom } from "./bbb-room.entity";
import { BILLING_MODE } from "../constants";
import type { BillingMode } from "../constants";

@Entity("bbb_organization")
export class BbbOrganization extends VendureEntity implements ChannelAware {
  constructor(input?: DeepPartial<BbbOrganization>) {
    super(input);
  }

  @ManyToMany(() => Channel)
  @JoinTable()
  channels: Channel[];

  @Index({ unique: true })
  @Column()
  channelId: string;

  /**
   * Legacy column (BUG-053): nullable, never written by any code path — the
   * tenant link is `channelId` (Channel=Tenant, INV-001). Retained only so no
   * migration is required; do not read it as a TenantProfile reference.
   */
  @Column({ nullable: true })
  tenantProfileId: string;

  /**
   * The Vendure User.id that owns this organization.
   * Treated as first-class ownership — required for org transfers,
   * co-admin flows, and reseller-created orgs.
   */
  @Column({ nullable: true })
  ownerUserId: string;

  @Index({ unique: true })
  @Column()
  slug: string;

  @Column()
  name: string;

  @Column({ default: 5 })
  concurrentMeetingLimit: number;

  @Column({ default: 30 })
  maxParticipantsPerMeeting: number;

  /**
   * Maximum number of scheduled sessions (in any non-terminal state) allowed
   * for this organization. 0 = unlimited. Enforced at creation time by
   * BbbScheduledSessionService.create(). Tenant admins cannot exceed this
   * limit; platform operators set it via updateBbbOrganization().
   */
  @Column({ default: 0 })
  maxSessionsPerOrg: number;

  @Column({ default: false })
  recordingEnabled: boolean;

  @Column({ default: false })
  suspended: boolean;

  // ─── Billing (ADR-047) ───────────────────────────────────────────────────

  /**
   * 'grant' (pre-purchased capacity) or 'metered' (postpaid attendee-hours).
   *
   * The entity default MUST stay identical to the DDL default so a re-generated
   * migration is a no-op (D7); existing rows inherit 'grant' — never backfilled.
   * New organizations are created as 'metered' in BbbOrganizationService.create()
   * (the single, testable place).
   */
  @Column({ type: "varchar", default: BILLING_MODE.GRANT })
  billingMode: BillingMode;

  /**
   * Learner-hour rate in paise for this organization.
   * null → the platform default (`defaultRatePaisePerLearnerHour` plugin option).
   *
   * Snapshotted onto each BbbMeteredUsage row when the meeting completes, so a
   * later rate change never re-prices historical usage (ADR-047 / INV-028).
   */
  @Column({ type: "int", nullable: true })
  ratePaisePerLearnerHour: number | null;

  /**
   * Postpaid credit ceiling in paise. null = unlimited.
   *
   * Together with `suspended`, this is the only v1 guard against metered credit
   * exposure; both are settable ONLY through the platform-gated
   * `setBbbOrganizationBilling` mutation (ADR-047, security register H1) — never
   * through the tenant-callable `updateBbbOrganization`.
   */
  @Column({ type: "int", nullable: true })
  monthlySpendLimitPaise: number | null;

  @OneToMany(() => BbbMeeting, (m) => m.organization)
  meetings: BbbMeeting[];

  @OneToMany(() => BbbCapacityGrant, (g) => g.organization)
  grants: BbbCapacityGrant[];

  @OneToMany(() => BbbOrganizationMember, (m) => m.organization)
  members: BbbOrganizationMember[];

  @OneToMany(() => BbbRoom, (r) => r.organization)
  rooms: BbbRoom[];
}