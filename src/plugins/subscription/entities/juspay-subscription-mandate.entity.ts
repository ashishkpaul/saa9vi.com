import type { DeepPartial } from "@vendure/common/lib/shared-types";
import { Channel, ChannelAware, VendureEntity } from "@vendure/core";
import { Column, Entity, Index, JoinTable, ManyToMany, ManyToOne } from "typeorm";
import { OrganizationSubscription } from "./organization-subscription.entity";

export type JuspayMandateStatus = "pending" | "active" | "paused" | "revoked";

/**
 * A Juspay recurring-payment mandate for one OrganizationSubscription.
 *
 * One CURRENT mandate per subscription (INV-001: Channel = Tenant):
 * a partial unique index on subscriptionId WHERE status != 'revoked'
 * enforces this at the DB level. Revoked mandates are retained as
 * history, so mandate replacement over a subscription's lifetime is
 * supported without a separate history model.
 * even against the BuyLits reference (reference/buylits/juspay-plugin),
 * which is one-off order checkout only — mandates, customer vault and
 * the mandate FSM do not exist there. Pattern ported, not the file.
 *
 * FSM (Step 2 of the Juspay plan; transitions driven ONLY by the
 * Juspay webhook processor — never by API callers):
 *   pending → active (mandate_activated webhook)
 *   active → paused / revoked (dashboard-driven mandate status webhooks)
 *   paused → active (re-activation webhook)
 *
 * Errors thrown here use Vendure's UserInputError/InternalServerError
 * directly (Saa9vi convention — no plugin-error module was ported from
 * BuyLits; decided in the Juspay Step-2 error-module decision).
 */
@Entity("juspay_subscription_mandate")
@Index(["channelId"])
@Index(["subscription"], { unique: true, where: '"status" != \'revoked\'' })
export class JuspaySubscriptionMandate extends VendureEntity implements ChannelAware {
    constructor(input?: DeepPartial<JuspaySubscriptionMandate>) {
        super(input);
    }

    /** The subscription this mandate bills. One active mandate per subscription. */
    @ManyToOne(() => OrganizationSubscription, { nullable: false })
    subscription: OrganizationSubscription;

    /**
     * Dual channels[] + scalar channelId per ADR-003.
     *
     * ⚠️ BUG-004 shape: the create path MUST populate BOTH the join table
     * (channelService.assignToCurrentChannel) AND the scalar — see the
     * OrganizationSubscription entity comment for the precedent where only
     * the scalar was set.
     */
    @ManyToMany(() => Channel)
    @JoinTable()
    channels: Channel[];

    @Column()
    channelId: string;

    /** Juspay customer vault reference (also mirrored on OrganizationSubscription.billingCustomerId). */
    @Column()
    juspayCustomerId: string;

    /** Juspay mandate token returned on successful mandate creation. Nullable until activated. */
    @Column({ nullable: true })
    mandateId: string;

    @Column({ default: "pending" })
    status: JuspayMandateStatus;

    @Column({ nullable: true })
    activatedAt: Date;

    @Column({ nullable: true })
    revokedAt: Date;
}
