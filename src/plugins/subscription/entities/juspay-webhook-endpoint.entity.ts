import type { DeepPartial } from "@vendure/common/lib/shared-types";
import { VendureEntity } from "@vendure/core";
import { Column, CreateDateColumn, Entity, Index } from "typeorm";

/**
 * A per-tenant Juspay webhook endpoint (multi-tenant support, modeled on the
 * Pinelab vendure-plugin-webhook per-channel pattern: each channel carries
 * its own webhook configuration).
 *
 * One endpoint per tenant channel (unique channelId). Each endpoint:
 *   - has a unique URL-safe `token` embedded in its URL:
 *       POST /payments/juspay/webhook/{token}
 *     so tenant resolution at ingestion is a single unique-index lookup,
 *     never an unscoped scan;
 *   - carries that tenant's own Juspay webhook credentials (Basic Auth +
 *     HMAC secret) — because each academy may run its own Juspay merchant
 *     account. Verification is therefore per-endpoint, fail-closed.
 *
 * Events ingested through an endpoint are stamped with its channelId, so
 * the processor reconciles channel-scoped from the very first lookup.
 *
 * DL-010-style exception: scalar channelId without the dual channels[] join
 * — the endpoint is a high-frequency lookup keyed by channel, and the
 * webhook URL is channel-unique by construction.
 *
 * ⚠️ HARDENING NOTE (Step 6): hmacSecret/basicAuthPassword are stored
 * plaintext pending per-endpoint AES-256-GCM encryption with
 * encryptionKeyVersion, mirroring the BBB password discipline (ADR platform
 * security decisions). Tracked in the roadmap.
 */
@Entity("juspay_webhook_endpoint")
@Index(["token"], { unique: true })
@Index(["channelId"], { unique: true })
export class JuspayWebhookEndpoint extends VendureEntity {
    constructor(input?: DeepPartial<JuspayWebhookEndpoint>) {
        super(input);
    }

    /** URL-safe unique token identifying this endpoint in the webhook URL. */
    @Column({ length: 64 })
    token: string;

    /** Owning tenant channel (unique — one endpoint per channel). */
    @Column()
    channelId: string;

    /** Per-endpoint Basic Auth username (configured in the tenant's Juspay dashboard). */
    @Column({ length: 128 })
    basicAuthUsername: string;

    /** Per-endpoint Basic Auth password. ⚠️ plaintext pending Step 6 encryption. */
    @Column({ length: 256 })
    basicAuthPassword: string;

    /** Per-endpoint HMAC-SHA256 secret for x-jp-signature. ⚠️ plaintext pending Step 6 encryption. */
    @Column({ length: 256 })
    hmacSecret: string;

    /** Optional version tag for the endpoint's HMAC secret (rotation bookkeeping). */
    @Column({ length: 16, nullable: true })
    hmacSecretVersion: string;

    @Column({ default: true })
    enabled: boolean;

    @CreateDateColumn()
    createdAt: Date;
}
