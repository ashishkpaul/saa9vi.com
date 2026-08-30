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
 *   `juspay:{event_name}:{channelId}:{primaryProviderId}`
 *
 * where primaryProviderId is the provider-issued txn_id > order_id >
 * mandate_id, and channelId scopes the key per tenant (multi-tenant:
 * the same provider txn under two tenant endpoints is two logical
 * events). Crucially, the key NEVER uses a payload-declared billing
 * period: webhook payloads are untrusted, and the processor establishes
 * the attempt relationship through provider identifiers we issued/stored
 * (juspayOrderId on the attempt), failing reconciliation when uncertain
 * rather than guessing. Redelivery of the same logical Juspay event
 * carries the same provider txn/order id → same key → harmless 200.
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

    /** Owning tenant channel — stamped from the resolved endpoint at ingestion. */
    @Column()
    channelId: string;

    /** Raw Juspay event name (e.g. MANDATE_ACTIVATED, CHARGE_SUCCEEDED). */
    @Column({ length: 128 })
    eventName: string;

    @Column({
        type: "jsonb",
    })
    payload: unknown;

    @Column({ type: "varchar", default: "PENDING" })
    status: JuspayWebhookEventStatus;

    @Column({ nullable: true })
    processedAt: Date;

    @Column({ nullable: true })
    failureReason: string;

    @CreateDateColumn()
    receivedAt: Date;
}
