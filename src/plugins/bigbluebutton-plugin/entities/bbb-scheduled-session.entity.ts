import type { DeepPartial } from "@vendure/common/lib/shared-types";
import { VendureEntity } from "@vendure/core";
import {
  Column,
  Entity,
  Index,
  ManyToOne,
  OneToOne,
  JoinColumn,
} from "typeorm";
import { BbbOrganization } from "./bbb-organization.entity";
import { BbbOrganizationMember } from "./bbb-organization-member.entity";
import { BbbMeeting } from "./bbb-meeting.entity";

/**
 * A business-level scheduled session representing the intent to meet.
 *
 * Students cannot trigger infrastructure provisioning — only a qualified
 * moderator (trainer/org-admin) can activate a session within its valid
 * time window, at which point a BbbMeeting is provisioned and linked.
 *
 * This separation ensures:
 * - Zero grant consumption for unactivated sessions
 * - Clear audit trail of planned vs actual meetings
 * - Historical record survives infrastructure teardown
 */
@Entity("bbb_scheduled_session")
export class BbbScheduledSession extends VendureEntity {
  constructor(input?: DeepPartial<BbbScheduledSession>) {
    super(input);
  }

  @Column()
  title: string;

  @Column({ type: "timestamp" })
  startTime: Date;

  @Column({ type: "timestamp" })
  endTime: Date;

  @Column({ default: "SCHEDULED" })
  status: string; // SCHEDULED | LIVE | FINISHED | CANCELLED

  @Index()
  @ManyToOne(() => BbbOrganization, (org) => org.id)
  organization: BbbOrganization;

  @ManyToOne(() => BbbOrganizationMember, (m) => m.id)
  trainer: BbbOrganizationMember;

  @OneToOne(() => BbbMeeting, { nullable: true })
  @JoinColumn()
  activeMeeting: BbbMeeting | null;

  @Column({ default: false })
  isTrial: boolean;

  @Column({ default: "PRIVATE" })
  visibility: string;

  @Column({ type: "int", nullable: true })
  maxAttendees: number | null;

  @Index({ unique: true })
  @Column({ type: "varchar", nullable: true })
  slug: string | null;

  @Column({ type: "varchar", nullable: true })
  productVariantId: string | null;
}