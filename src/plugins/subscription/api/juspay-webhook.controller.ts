import { Body, Controller, ForbiddenException, Headers, HttpCode, Logger, Param, Post, RawBodyRequest, Req, ServiceUnavailableException } from "@nestjs/common";
import { RequestContextService, TransactionalConnection } from "@vendure/core";
import { JuspayWebhookAuthService } from "../auth/juspay-webhook-auth.service";
import { JuspayWebhookQueueService } from "../services/juspay-webhook-queue.service";
import { JuspayWebhookEvent } from "../entities/juspay-webhook-event.entity";
import { JuspayWebhookEndpoint } from "../entities/juspay-webhook-endpoint.entity";
import type { JuspayWebhookPayload } from "../types";

const loggerCtx = "JuspayWebhookController";

/**
 * Juspay webhook ingestion — POST /payments/juspay/webhook/:token
 *
 * MULTI-TENANT (Pinelab vendure-plugin-webhook per-channel pattern applied
 * to inbound webhooks): each tenant channel owns a JuspayWebhookEndpoint
 * with a unique URL token and its own Juspay credentials (the academy may
 * run its own merchant account). Tenant resolution at ingestion is a single
 * unique-index lookup on the token — never an unscoped scan. The ingested
 * event is stamped with the endpoint's channelId, so all downstream
 * reconciliation is channel-scoped from the start.
 *
 * Pipeline (INV-004 persist-before-process; NO business processing here):
 *
 *   resolve endpoint by token (fail-closed: unknown/disabled → 403)
 *   → raw bytes → Basic Auth (per-endpoint, fail-closed)
 *   → HMAC-SHA256 (per-endpoint, fail-closed)
 *   → JSON parse → dedupeKey derive → persist JuspayWebhookEvent(PENDING)
 *   → enqueue event ID → 200 { ok: true }
 *
 * dedupeKey uses PROVIDER-issued identifiers only (txn_id / order_id /
 * mandate_id) plus the tenant scope — never payload-declared billing
 * periods, which are untrusted (Step 3 review requirement).
 */
@Controller("payments")
export class JuspayWebhookController {
    constructor(
        private readonly authService: JuspayWebhookAuthService,
        private readonly queueService: JuspayWebhookQueueService,
        private readonly ctxService: RequestContextService,
        private readonly connection: TransactionalConnection,
    ) {}

    @Post("juspay/webhook/:token")
    @HttpCode(200)
    async handleWebhook(
        @Param("token") token: string,
        @Req() req: RawBodyRequest<any>,
        @Headers("authorization") basicAuthHeader: string | undefined,
        @Headers("x-jp-signature") signatureHeader: string | undefined,
        @Body() body: unknown,
    ): Promise<{ ok: boolean }> {
        const rawBody: Buffer | undefined = req.rawBody;
        if (!rawBody || rawBody.length === 0) {
            Logger.warn(`Webhook ${token} received without raw body — check body-parser config`, loggerCtx);
            throw new ForbiddenException("Invalid webhook credentials");
        }

        // Tenant resolution: unique-index lookup by URL token.
        const endpointRepo = this.connection.rawConnection.getRepository(JuspayWebhookEndpoint);
        const endpoint = await endpointRepo.findOne({ where: { token } });
        if (!endpoint || !endpoint.enabled) {
            Logger.warn(`Webhook request for unknown or disabled endpoint token=${token}`, loggerCtx);
            throw new ForbiddenException("Invalid webhook credentials");
        }

        // Fail-closed per-endpoint verification (Basic Auth + HMAC).
        if (!this.authService.verify(basicAuthHeader, signatureHeader, rawBody, endpoint)) {
            Logger.warn(`Webhook authentication failed for channel ${endpoint.channelId}`, loggerCtx);
            throw new ForbiddenException("Invalid webhook credentials");
        }

        let payload: JuspayWebhookPayload;
        try {
            payload = typeof body === "string" ? JSON.parse(body) : (body as JuspayWebhookPayload);
        } catch {
            Logger.warn(`Webhook payload is not valid JSON (channel ${endpoint.channelId})`, loggerCtx);
            throw new ForbiddenException("Invalid webhook payload");
        }

        const eventName = payload.event_name;
        if (!eventName) {
            Logger.warn(`Webhook missing event_name (channel ${endpoint.channelId})`, loggerCtx);
            throw new ForbiddenException("Invalid webhook payload");
        }

        // Provider-issued primary identifier: txn_id > order_id > mandate_id.
        const providerId =
            payload.content?.order?.txn_id ??
            payload.content?.order?.order_id ??
            payload.content?.mandate?.mandate_id;
        if (!providerId) {
            Logger.warn(`Webhook ${eventName} carries no provider identifier (channel ${endpoint.channelId})`, loggerCtx);
            throw new ForbiddenException("Invalid webhook payload");
        }

        // Tenant-scoped dedupe key: the same provider txn under a different
        // tenant's endpoint is a different logical event.
        const dedupeKey = `juspay:${eventName}:${endpoint.channelId}:${providerId}`;

        const ctx = await this.ctxService.create({ apiType: "admin" });
        const eventRepo = this.connection.getRepository(ctx, JuspayWebhookEvent);

        // INV-004: persist PENDING before any processing/enqueue. The event
        // is stamped with the endpoint's channelId — tenant context is fixed
        // at ingestion time. The DB unique constraint on dedupeKey is the
        // FINAL authority for idempotency: a concurrent concurrent delivery
        // that loses the insert race surfaces here as a unique violation and
        // is treated as the existing row (the findOne check alone would race).
        let event: JuspayWebhookEvent;
        try {
            event = await eventRepo.save(
                new JuspayWebhookEvent({
                    dedupeKey,
                    eventName,
                    channelId: endpoint.channelId,
                    payload: payload as any,
                    status: "PENDING",
                }),
            );
        } catch (err) {
            if (!this.isUniqueViolation(err)) {
                throw err;
            }
            Logger.log(`Concurrent insert raced on dedupeKey=${dedupeKey} — using existing row`, loggerCtx);
            event = await eventRepo.findOneOrFail({ where: { dedupeKey } });
        }

        // Already fully processed → harmless duplicate, acknowledge only.
        // (Juspay DOCUMENTED: resends webhooks until it sees a 200, and may
        // deliver a given event more than once due to network fluctuation —
        // a PROCESSED row is exactly that case.)
        if (event.status === "PROCESSED") {
            Logger.log(`Duplicate webhook event ignored (dedupeKey=${dedupeKey}, already PROCESSED)`, loggerCtx);
            return { ok: true };
        }

        // PENDING / FAILED / stale PROCESSING → (re)enqueue. This is the key
        // recovery path: if a previous enqueue FAILED, the row sat PENDING and
        // Juspay's non-200 retry now lands here and re-enqueues it.
        //
        // ENQUEUE FAILURE HANDLING (Step 3 review 🔴): if enqueueing fails we
        // return NON-2xx (503) so Juspay retries the HTTP delivery. The row is
        // durably persisted (PENDING), and the provider retry re-enters here
        // and re-enqueues — no event can be lost or sit PENDING forever.
        try {
            await this.queueService.enqueueEventId(event.id as string);
        } catch (err) {
            Logger.error(`Failed to enqueue webhook event ${event.id}: ${(err as Error).message} — returning 503 for Juspay retry`, loggerCtx);
            throw new ServiceUnavailableException("Webhook queue unavailable; retry delivery");
        }

        Logger.log(`Webhook event ${event.id} (${eventName}, channel ${endpoint.channelId}) persisted PENDING`, loggerCtx);
        return { ok: true };
    }

    /** Postgres/TypeORM unique-constraint violation detection. */
    private isUniqueViolation(err: unknown): boolean {
        const e = err as any;
        return e?.code === "23505" || (typeof e?.message === "string" && e.message.includes("duplicate key"));
    }
}
