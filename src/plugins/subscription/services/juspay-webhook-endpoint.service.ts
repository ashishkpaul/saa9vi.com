import { Injectable, Logger, OnApplicationBootstrap } from "@nestjs/common";
import { TransactionalConnection } from "@vendure/core";
import * as crypto from "crypto";
import { Inject } from "@nestjs/common";
import { JuspayWebhookEndpoint } from "../entities/juspay-webhook-endpoint.entity";
import { SUBSCRIPTION_PLUGIN_OPTIONS } from "../constants";
import type { PluginInitOptions } from "../types";

const loggerCtx = "JuspayWebhookEndpointService";

/**
 * Manages per-tenant Juspay webhook endpoints (multi-tenant support —
 * Pinelab vendure-plugin-webhook per-channel pattern applied to inbound
 * webhooks). Admin CRUD surface lands in Step 5; today endpoints are
 * created programmatically and the platform-default endpoint can be
 * seeded from env (JUSPAY_WEBHOOK_* on the default channel).
 */
@Injectable()
export class JuspayWebhookEndpointService implements OnApplicationBootstrap {
    private readonly logger = new Logger(loggerCtx);

    constructor(
        private readonly connection: TransactionalConnection,
        @Inject(SUBSCRIPTION_PLUGIN_OPTIONS) private readonly options: PluginInitOptions,
    ) {}

    /**
     * Creates an endpoint for a tenant channel. One endpoint per channel
     * (unique index) — recreating returns the existing row.
     */
    async ensureEndpoint(channelId: string, credentials: { basicAuthUsername: string; basicAuthPassword: string; hmacSecret: string; hmacSecretVersion?: string }, token?: string): Promise<JuspayWebhookEndpoint> {
        const repo = this.connection.rawConnection.getRepository(JuspayWebhookEndpoint);
        const existing = await repo.findOne({ where: { channelId } });
        if (existing) {
            return existing;
        }
        const created = (await repo.save(
            repo.create({
                token: token ?? crypto.randomBytes(24).toString("hex"),
                channelId,
                basicAuthUsername: credentials.basicAuthUsername,
                basicAuthPassword: credentials.basicAuthPassword,
                hmacSecret: credentials.hmacSecret,
                hmacSecretVersion: credentials.hmacSecretVersion ?? undefined,
                enabled: true,
            } as any),
        )) as unknown as JuspayWebhookEndpoint;
        const endpoint = Array.isArray(created) ? created[0] : created;
        this.logger.log(`Juspay webhook endpoint created for channel ${channelId} (token=${endpoint.token})`);
        return endpoint;
    }

    /**
     * Seeds the platform-default endpoint from env (JUSPAY_WEBHOOK_* on the
     * default channel) when configured. Tenant endpoints are created via the
     * admin surface (Step 5) or this service.
     */
    async onApplicationBootstrap(): Promise<void> {
        const seed = this.options.webhook;
        if (!seed?.username || !seed.password || !seed.hmacSecret) {
            // Fail-closed posture: without seed credentials no default endpoint
            // exists, and every webhook request is rejected until an operator
            // provisions one.
            this.logger.warn("No JUSPAY_WEBHOOK_* seed credentials configured — no default endpoint; webhook requests will be rejected until endpoints are provisioned");
            return;
        }
        try {
            const defaultChannel = await this.connection.rawConnection.query(
                `SELECT id FROM channel WHERE code = '__default_channel__' LIMIT 1`,
            );
            if (defaultChannel?.length) {
                await this.ensureEndpoint(
                    String(defaultChannel[0].id),
                    {
                        basicAuthUsername: seed.username,
                        basicAuthPassword: seed.password,
                        hmacSecret: seed.hmacSecret,
                        hmacSecretVersion: seed.hmacSecretVersion,
                    },
                    process.env.JUSPAY_WEBHOOK_TOKEN,
                );
            }
        } catch (err) {
            this.logger.error(`Failed to seed default webhook endpoint: ${(err as Error).message}`, loggerCtx);
        }
    }
}
