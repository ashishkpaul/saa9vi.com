import type { DeepPartial } from "@vendure/common/lib/shared-types";
import { VendureEntity } from "@vendure/core";
import { Column, Entity, Index, ManyToOne } from "typeorm";
import { BbbRoom } from "./bbb-room.entity";

/**
 * Maps a Vendure ProductVariant to a BbbRoom so the fulfillment handler
 * knows which room to enroll the buyer into.
 *
 * Managed via admin API (createBbbProductAccess / deleteBbbProductAccess).
 * A variant can map to exactly one room per channel.
 */
@Entity()
@Index(["productVariantId"], { unique: true })
export class BbbProductAccess extends VendureEntity {
  constructor(input?: DeepPartial<BbbProductAccess>) {
    super(input);
  }

  @ManyToOne(() => BbbRoom, { nullable: false, onDelete: "CASCADE" })
  room: BbbRoom;

  @Column()
  productVariantId: string;

  /**
   * How long the enrollment stays active after fulfillment.
   * Null means no expiry (lifetime access).
   */
  @Column({ nullable: true })
  accessDays: number;
}
