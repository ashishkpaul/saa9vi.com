import type { DeepPartial } from "@vendure/common/lib/shared-types";
import { VendureEntity } from "@vendure/core";
import { Column, CreateDateColumn, Entity, Index } from "typeorm";

export type JuspayWebhookEventStatus = "PENDING" | "PROCESSING" | "PROCESSED" | "FAILED";

/**
 * Inbound Juspay webhook, persisted BEFORE processing (INV-004 — same shape
 * as BbbWebhookEvent, NOT BuyLits's processed-upfront PaymentEventLog).
 *
 * TWO IDEMPOTENCY LAYERS — they protect against DIFFERENT failure modes;
 * do not assume they are redundant and remove one:
 *
 *   1. THIS entity's PENDING→PROCESSED lifecycle: protects against a worker
 *      crash mid-processing (the HTTP delivery was durably persisted and
 *      must eventually be processed; queue retries + status drive that).
 *
 *   2. `dedupeKey` (unique): protects against Juspay redelivering the same
 *      LOGICAL event twice (common with all webhook providers, including
 *      lost-200-response redeliveries). Checked before processing.
 *
 * KEY SCHEMA — deliberately NOT BuyLits's `{gateway}:{event_type}:{order_id}`.
 * BuyLits's key is order-checkout-shaped; a subscription renewal has no Order
 * and recurs per billing period. Substituting subscriptionId for order_id
 * WITHOUT the billing period would collide across renewal periods and
 * silently drop the second month's charge event. Saa9vi key format:
 *
 *   subscription events:  juspay:{event_type}:{mandateId}:{billingPeriodStart}
 *   order-checkout events: juspay:{event_type}:{juspayOrderId}
 */
@Entity("juspay_webhook_event")
@Index(["status"])
export class JuspayWebhookEvent extends VendureEntity {
    constructor(input?: DeepPartial<JuspayWebhookEvent>) {
        super(input);
    }

    /** Redesigned dedupe key — see class doc. Unique across the table. */
    @Column({ length: 512, unique: true })
    dedupeKey: string;

    /** Raw Juspay event name (e.g. MANDATE_ACTIVATED, CHARGE_SUCCEEDED). */
    @Column({ length: 128 })
    eventName: string;

    @Column({
        type: "jsonb",
    })
    payload: unknown;

    @Column({ default: "PENDING" })
    status: JuspayWebhookEventStatus;

    @Column({ nullable: true })
    processedAt: Date;

    @Column({ nullable: true })
    failureReason: string;

    @CreateDateColumn()
    receivedAt: Date;
}
