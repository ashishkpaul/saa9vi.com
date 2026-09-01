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
@Index(["organizationId", "slug"], { unique: true })
export class BbbScheduledSession extends VendureEntity {
  constructor(input?: DeepPartial<BbbScheduledSession>) {
    super(input);
  }

  @Column()
  title: string;

  @Column()
  startTime: Date;

  @Column()
  endTime: Date;

  @Column({ default: "SCHEDULED" })
  status: string; // SCHEDULED | LIVE | FINISHED | CANCELLED

  @Index()
  @ManyToOne(() => BbbOrganization, (org) => org.id)
  organization: BbbOrganization;

  /** Denormalized FK for composite index support */
  @Column()
  organizationId: string;

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

  /** Denormalized FK for tenant isolation — set at creation from ctx.channelId */
  @Index()
  @Column({ type: "varchar", nullable: true })
  channelId: string | null;

  /** Slug unique within organization (replaces global unique) */
  @Column({ type: "varchar", nullable: true })
  slug: string | null;

  /**
   * Subject tags for marketplace discovery (F4 / Gate 1.3).
   * Tenant-controlled at session creation/edit. Simple-array: comma-joined
   * in PG. Authoritative source for MarketplaceSessionDocument.subjectTags —
   * the marketplace category taxonomy (if later introduced) must derive
   * from this, never become a second source of truth.
   */
  @Column({ type: "simple-array", nullable: true })
  subjectTags: string[] | null;

  @Column({ type: "varchar", nullable: true })
  productVariantId: string | null;
}
