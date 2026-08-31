import type { DeepPartial } from "@vendure/common/lib/shared-types";
import { Channel, ChannelAware, VendureEntity } from "@vendure/core";
import { Column, Entity, Index, JoinTable, ManyToMany, ManyToOne } from "typeorm";
import { SubscriptionPlan } from "./subscription-plan.entity";

export type OrganizationSubscriptionStatus =
  | "trialing"
  | "active"
  | "past_due"
  | "cancelled";

/**
 * The tenant academy's subscription to a SaaS tier.
 *
 * One row per tenant (Channel = Tenant, INV-001): the dual channels[] +
 * scalar channelId pattern follows ADR-003. The channel uniquely identifies
 * the organization via the 1:1 Channel ↔ TenantProfile ↔ BbbOrganization
 * chain, so no separate organizationId column is needed.
 *
 * Status FSM (legacy ADR §AC-004):
 *   trialing → active → past_due → cancelled
 * Dunning/retry mechanics reuse RFC-001 §4.2 patterns at org level.
 */
@Entity("organization_subscription")
@Index(["channelId"], { unique: true, where: '"status" != \'cancelled\'' })
export class OrganizationSubscription extends VendureEntity implements ChannelAware {
  constructor(input?: DeepPartial<OrganizationSubscription>) {
    super(input);
  }

  /** String FK to SubscriptionPlan.id — string-FK pattern (cf. BbbCapacityGrant.orderId). */
  @ManyToOne(() => SubscriptionPlan, { nullable: false })
  plan: SubscriptionPlan;

  /**
   * Dual channels[] + scalar channelId per ADR-003.
   *
   * ⚠️ BUG-004 shape: when the create path lands, populate BOTH the join table
   * (channelService.assignToCurrentChannel) AND the scalar — see
   * BbbOrganizationService.create() precedent where only the scalar was set.
   */
  @ManyToMany(() => Channel)
  @JoinTable()
  channels: Channel[];

  @Column()
  channelId: string;

  @Column({ type: "varchar", default: "trialing" })
  status: OrganizationSubscriptionStatus;

  @Column({ nullable: true })
  currentPeriodStart: Date;

  @Column({ nullable: true })
  currentPeriodEnd: Date;

  /** Cancel at end of current period rather than immediately. */
  @Column({ default: false })
  cancelAtPeriodEnd: boolean;

  @Column({ nullable: true })
  cancelledAt: Date;

  /**
   * Dunning retry count — incremented by the dunning job each time a
   * past_due subscription is re-enqueued for payment retry (RFC-001 §4.2).
   * Null = never been dunning-retried.
   */
  @Column({ type: "int", nullable: true })
  dunningRetryCount: number | null;

  /**
   * Timestamp of the last dunning retry attempt. Used by the dunning job
   * to enforce the retry interval (DUNNING_RETRY_INTERVAL_DAYS).
   */
  @Column({ type: "timestamp", nullable: true })
  lastDunningAttemptAt: Date | null;

  /** Juspay customer reference for recurring charges. */
  @Column({ nullable: true })
  billingCustomerId: string;

  /**
   * Optimistic-lock token for renewal compare-and-swap.
   *
   * ⚠️ NOT auto-locking: this is a plain integer column. TypeORM's automatic
   * mechanism would be @VersionColumn(), but the decided mechanism (to be
   * implemented in the same PR as the renewal job) is an explicit CAS:
   *   UPDATE organization_subscription
   *      SET version = version + 1, ...
   *    WHERE id = ? AND version = ?
   * and the worker must check affected-rows === 1 before proceeding to charge.
   * A worker that fails the CAS must re-read and retry, never double-renew.
   * (RFC-001 §2.2 applied at org level; billing money via Juspay — no
   * DL-026-style grace tolerance applies here.)
   */
  @Column({ default: 1 })
  version: number;
}
