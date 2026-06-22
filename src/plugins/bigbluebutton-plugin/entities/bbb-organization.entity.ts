// src/plugins/bigbluebutton-plugin/entities/bbb-organization.entity.ts
// CHANGE: Added members OneToMany relation (required by M1)

import type { DeepPartial } from "@vendure/common/lib/shared-types";
import { VendureEntity } from "@vendure/core";
import { Column, Entity, OneToMany } from "typeorm";
import { BbbMeeting } from "./bbb-meeting.entity";
import { BbbCapacityGrant } from "./bbb-capacity-grant.entity";
import { BbbOrganizationMember } from "./bbb-organization-member.entity";
import { BbbRoom } from "./bbb-room.entity";

@Entity("bbb_organization")
export class BbbOrganization extends VendureEntity {
  constructor(input?: DeepPartial<BbbOrganization>) {
    super(input);
  }

  @Column({ unique: true })
  channelId: string;

  /**
   * The Vendure User.id that owns this organization.
   * Treated as first-class ownership — required for org transfers,
   * co-admin flows, and reseller-created orgs.
   */
  @Column({ nullable: true })
  ownerUserId: string;

  @Column({ unique: true })
  slug: string;

  @Column()
  name: string;

  @Column({ default: 5 })
  concurrentMeetingLimit: number;

  @Column({ default: 30 })
  maxParticipantsPerMeeting: number;

  @Column({ default: false })
  recordingEnabled: boolean;

  @Column({ default: false })
  suspended: boolean;

  @OneToMany(() => BbbMeeting, (m) => m.organization)
  meetings: BbbMeeting[];

  @OneToMany(() => BbbCapacityGrant, (g) => g.organization)
  grants: BbbCapacityGrant[];

  // ─── ADDED (M1) ─────────────────────────────────────────────────────────────
  @OneToMany(() => BbbOrganizationMember, (m) => m.organization)
  members: BbbOrganizationMember[];

  @OneToMany(() => BbbRoom, (r) => r.organization)
  rooms: BbbRoom[];
}
