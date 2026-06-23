import type { DeepPartial } from "@vendure/common/lib/shared-types";
import { VendureEntity } from "@vendure/core";
import { Column, Entity, Index, ManyToOne, JoinColumn } from "typeorm";
import { BbbScheduledSession } from "./bbb-scheduled-session.entity";

export type InstructorRole = "primary" | "assistant";

@Entity("bbb_instructor_assignment")
@Index(["instructorProfileId", "scheduledSessionId"], { unique: true })
export class BbbInstructorAssignment extends VendureEntity {
  constructor(input?: DeepPartial<BbbInstructorAssignment>) {
    super(input);
  }

  @ManyToOne(() => BbbScheduledSession, { onDelete: "CASCADE" })
  @JoinColumn()
  scheduledSession: BbbScheduledSession;

  @Index()
  @Column()
  scheduledSessionId: string;

  /** TenantPlugin InstructorProfile.id */
  @Column()
  instructorProfileId: string;

  @Column({ default: "primary" })
  role: InstructorRole;

  @Column({ default: 0 })
  displayOrder: number;
}