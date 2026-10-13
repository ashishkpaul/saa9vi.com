import type { DeepPartial } from "@vendure/common/lib/shared-types";
import { ID, VendureEntity } from "@vendure/core";
import { Column, Entity, ManyToOne, RelationId, VersionColumn } from "typeorm";
import { BbbOrganization } from "./bbb-organization.entity";

export type RoomState = "Idle" | "Provisioning" | "Active" | "Failed";

@Entity("bbb_room")
export class BbbRoom extends VendureEntity {
  constructor(input?: DeepPartial<BbbRoom>) {
    super(input);
  }

  @ManyToOne(() => BbbOrganization, { nullable: false })
  organization: BbbOrganization;

  /**
   * Read-only projection of the `organization` FK column (BUG-051).
   *
   * `@RelationId` selects the FK without loading the relation and without
   * declaring a second column — so the schema is unchanged (no migration) while
   * the SDL's non-null `BbbRoom.organizationId` stops returning null. TypeORM
   * hydrates it on every `find*`; a freshly saved instance carries the relation
   * itself, so read BbbRoom.organizationId for reads only.
   */
  @RelationId((room: BbbRoom) => room.organization)
  organizationId: ID;

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
  @Column({ type: 'timestamp', nullable: true })
  lastRuntimeValidatedAt: Date | null;

  /** Optimistic lock version — prevents concurrent double-provisioning. */
  @VersionColumn()
  version: number;
}