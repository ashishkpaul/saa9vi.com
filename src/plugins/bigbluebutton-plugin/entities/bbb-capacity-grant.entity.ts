import type { DeepPartial } from "@vendure/common/lib/shared-types";
import { VendureEntity } from "@vendure/core";
import { Column, Entity, ManyToOne } from "typeorm";
import { BbbOrganization } from "./bbb-organization.entity";

/**
 * Written when a customer purchases a BBB plan. Tracks what capacity the
 * organization is entitled to and how much has been consumed.
 *
 * The FulfillmentHandler writes this; meetings consume from it.
 * This is the separation between commerce (order) and infrastructure (meetings).
 */
@Entity()
export class BbbCapacityGrant extends VendureEntity {
  constructor(input?: DeepPartial<BbbCapacityGrant>) {
    super(input);
  }

  @ManyToOne(() => BbbOrganization, (org) => org.grants, { nullable: false })
  organization: BbbOrganization;

  /** FK to Vendure Order.id — nullable for admin-manual grants */
  @Column({ nullable: true })
  orderId: string;

  /** FK to Vendure OrderLine.id — nullable for admin-manual grants */
  @Column({ nullable: true })
  orderLineId: string;

  /** Total meeting minutes granted. UI divides by 60 for display. */
  @Column({ type: "int", default: 600 })
  grantedMinutes: number;

  /** Total meeting minutes consumed (updated by meeting-ended reconciliation). */
  @Column({ type: "int", default: 0 })
  consumedMinutes: number;

  @Column()
  validFrom: Date;

  @Column()
  validUntil: Date;

  @Column({ default: false })
  exhausted: boolean;
}
