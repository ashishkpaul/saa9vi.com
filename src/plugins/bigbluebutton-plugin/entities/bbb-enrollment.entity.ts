import type { DeepPartial } from "@vendure/common/lib/shared-types";
import { VendureEntity } from "@vendure/core";
import { Column, Entity, Index, ManyToOne } from "typeorm";
import { BbbRoom } from "./bbb-room.entity";

export type EnrollmentSource = "purchase" | "admin" | "invite" | "import" | "trial_conversion";

@Entity("bbb_enrollment")
@Index(["roomId", "customerId"], { unique: true })
@Index(["customerId"])
export class BbbEnrollment extends VendureEntity {
  constructor(input?: DeepPartial<BbbEnrollment>) {
    super(input);
  }

  @ManyToOne(() => BbbRoom, { nullable: false, onDelete: "CASCADE" })
  room: BbbRoom;

  /** Denormalized FK for efficient lookup without join */
  @Column()
  roomId: string;

  /** Vendure Customer.id */
  @Column()
  customerId: string;

  /** Vendure Order.id that triggered this enrollment, for audit */
  @Column({ nullable: true })
  orderId: string;

  @Column({ default: true })
  active: boolean;

  /**
   * Enrollment window. null on either end means unlimited in that direction.
   * Use these instead of calculating from accessDays — supports course date
   * changes without invalidating existing enrollments.
   */
  @Column({ nullable: true })
  validFrom: Date;

  @Column({ type: 'timestamp', nullable: true })
  validUntil: Date | null;

  /** @deprecated Use validUntil = createdAt + accessDays. Kept for migration. */
  @Column({ type: 'timestamp', nullable: true })
  expiresAt: Date | null;

  /**
   * @deprecated Legacy access control. Future replacement: Entitlement entity.
   * Continue using for paid fulfillments only.
   */
  /** How the enrollment was created — for audit and future filtering */
  @Column({ type: "varchar", default: "purchase" })
  source: EnrollmentSource;
}
