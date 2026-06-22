import type { DeepPartial } from "@vendure/common/lib/shared-types";
import { VendureEntity } from "@vendure/core";
import { Column, Entity, ManyToOne, VersionColumn } from "typeorm";
import { BbbOrganization } from "./bbb-organization.entity";

export type RoomState = "Idle" | "Provisioning" | "Active" | "Failed";

@Entity("bbb_room")
export class BbbRoom extends VendureEntity {
  constructor(input?: DeepPartial<BbbRoom>) {
    super(input);
  }

  @ManyToOne(() => BbbOrganization, { nullable: false })
  organization: BbbOrganization;

  @Column()
  name: string;

  @Column({ nullable: true })
  description: string;

  @Column({ nullable: true, unique: true })
  slug: string;

  @Column({ nullable: true })
  createdByCustomerId: string;

  @Column({ default: false })
  recordingEnabled: boolean;

  @Column({ nullable: true })
  maxParticipants: number;

  @Column({ type: "varchar", default: "Idle" })
  state: RoomState;

  /** FK to the currently active BbbMeeting. Null when Idle/Failed. */
  @Column({ type: "varchar", nullable: true })
  currentMeetingId: string | null;

  @Column({ default: 0 })
  retryCount: number;

  @Column({ nullable: true })
  lastProvisionRequestedAt: Date;

  /**
   * Last time BBB runtime was positively validated for the linked active meeting.
   * Used as a short TTL cache to avoid hammering isMeetingRunning() under load.
   */
  @Column({ type: "timestamp", nullable: true })
  lastRuntimeValidatedAt: Date | null;

  /** Optimistic lock version — prevents concurrent double-provisioning. */
  @VersionColumn()
  version: number;
}