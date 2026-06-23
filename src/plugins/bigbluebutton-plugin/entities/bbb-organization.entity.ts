import type { DeepPartial } from "@vendure/common/lib/shared-types";
import { VendureEntity, Channel, ChannelAware } from "@vendure/core";
import { Column, Entity, Index, ManyToMany, JoinTable, OneToMany } from "typeorm";
import { BbbMeeting } from "./bbb-meeting.entity";
import { BbbCapacityGrant } from "./bbb-capacity-grant.entity";
import { BbbOrganizationMember } from "./bbb-organization-member.entity";
import { BbbRoom } from "./bbb-room.entity";

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

  @Column({ default: false })
  recordingEnabled: boolean;

  @Column({ default: false })
  suspended: boolean;

  @OneToMany(() => BbbMeeting, (m) => m.organization)
  meetings: BbbMeeting[];

  @OneToMany(() => BbbCapacityGrant, (g) => g.organization)
  grants: BbbCapacityGrant[];

  @OneToMany(() => BbbOrganizationMember, (m) => m.organization)
  members: BbbOrganizationMember[];

  @OneToMany(() => BbbRoom, (r) => r.organization)
  rooms: BbbRoom[];
}