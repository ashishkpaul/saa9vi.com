import type { DeepPartial } from "@vendure/common/lib/shared-types";
import { VendureEntity } from "@vendure/core";
import { Column, Entity, ManyToOne } from "typeorm";
import { BbbOrganization } from "./bbb-organization.entity";

/**
 * Written when a customer purchases a BBB plan, or auto-created as an
 * 'internal_overhead' grant when a BbbOrganization is first provisioned.
 *
 * sourceType discriminator (FEAT-002 / ADR §8A OP-005):
 * - 'order'             — created by BbbOrderFulfillmentListener on purchase
 * - 'subscription'      — Phase 2: created by RecurringCapacityGrant renewal
 * - 'internal_overhead' — auto-created per org; isUnbounded=true; never exhausted
 */
@Entity("bbb_capacity_grant")
export class BbbCapacityGrant extends VendureEntity {
  constructor(input?: DeepPartial<BbbCapacityGrant>) {
    super(input);
  }

  @ManyToOne(() => BbbOrganization, (org) => org.grants, { nullable: false })
  organization: BbbOrganization;

  /** FK to Vendure Order.id — nullable for admin-manual and overhead grants */
  @Column({ nullable: true })
  orderId: string;

  /** FK to Vendure OrderLine.id — nullable for admin-manual and overhead grants */
  @Column({ nullable: true })
  orderLineId: string;

  /** FK to Vendure ProductVariant.id — enables product→capacity analytics without Order joins */
  @Column({ nullable: true })
  productVariantId: string;

  /** Total meeting minutes granted. Ignored when isUnbounded = true. */
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

  /**
   * Source discriminator — controls billing path in consumeGrantHours().
   * 'internal_overhead' grants skip exhaustion checks and capacity alerts.
   */
  @Column({ default: "order" })
  sourceType: "order" | "subscription" | "internal_overhead";

  /**
   * When true, grantedMinutes is ignored and the grant never exhausts.
   * Set to true for all 'internal_overhead' grants.
   */
  @Column({ default: false })
  isUnbounded: boolean;
}
