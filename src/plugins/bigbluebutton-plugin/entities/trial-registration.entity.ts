import type { DeepPartial } from "@vendure/common/lib/shared-types";
import { VendureEntity } from "@vendure/core";
import { Column, Entity, Index, ManyToOne } from "typeorm";
import { BbbScheduledSession } from "./bbb-scheduled-session.entity";

export type TrialRegistrationStatus = "REGISTERED" | "ATTENDED" | "CANCELLED" | "NO_SHOW";

@Entity("bbb_trial_registration")
@Index(["scheduledSessionId", "customerId"], { unique: true })
export class BbbTrialRegistration extends VendureEntity {
  constructor(input?: DeepPartial<BbbTrialRegistration>) {
    super(input);
  }

  @ManyToOne(() => BbbScheduledSession, { nullable: false, onDelete: "CASCADE" })
  @Index()
  scheduledSession: BbbScheduledSession;

  @Column()
  scheduledSessionId: string;

  /** Vendure Customer.id */
  @Column()
  customerId: string;

  @Column({ type: "varchar", default: "REGISTERED" })
  status: TrialRegistrationStatus;

  @Column()
  registeredAt: Date;

  @Column({ type: 'timestamp', nullable: true })
  attendedAt: Date | null;
}
