import {
  Body,
  Controller,
  Headers,
  HttpCode,
  Logger,
  Post,
  Req,
} from "@nestjs/common";
import type { RawBodyRequest } from "@nestjs/common";
import { RequestContextService, TransactionalConnection } from "@vendure/core";
import * as crypto from "crypto";
import { BbbServer } from "../entities/bbb-server.entity";
import { BbbWebhookEvent } from "../entities/bbb-webhook-event.entity";
import { BbbWebhookProcessorService } from "../services/bbb-webhook-processor.service";
import { BbbEncryptionService } from "../services/bbb-encryption.service";

const loggerCtx = "BbbWebhookController";

/**
 * Receives BBB webhook events (meeting-ended, recording-ready, etc.).
 *
 * BBB sends webhooks from the `bbb-webhooks` module:
 * https://docs.bigbluebutton.org/development/webhooks
 *
 * All incoming requests are verified via HMAC-SHA256 before processing.
 * After validation, events are persisted immediately and enqueued for
 * async processing. This ensures that even if the processor crashes,
 * the event is safely stored in the DB and can be replayed.
 *
 * Mount point: POST /bbb/webhook
 */
@Controller("bbb")
export class BbbWebhookController {
  constructor(
    private readonly encryptionService: BbbEncryptionService,
    private readonly ctxService: RequestContextService,
    private readonly connection: TransactionalConnection,
    private readonly webhookProcessor: BbbWebhookProcessorService,
  ) {}

  @Post("webhook")
  @HttpCode(200)
  async handleWebhook(
    @Req() req: RawBodyRequest<any>,
    @Headers("x-hub-signature-256") signatureHeader: string,
    @Body() body: unknown,
  ): Promise<{ ok: boolean }> {
    const rawBody = req.rawBody;
    if (!rawBody) {
      Logger.warn(
        "Webhook received without raw body — check body-parser config",
        loggerCtx,
      );
      return { ok: false };
    }

    const isValid = await this.verifyWebhookSignature(rawBody, signatureHeader);
    if (!isValid) {
      Logger.warn(
        "Webhook HMAC verification failed — dropping event",
        loggerCtx,
      );
      return { ok: false };
    }

    let payload: Record<string, unknown>;
    try {
      payload =
        typeof body === "string"
          ? JSON.parse(body)
          : (body as Record<string, unknown>);
    } catch {
      Logger.warn("Webhook payload is not valid JSON", loggerCtx);
      return { ok: false };
    }

    // BBB webhooks can send events in two formats:
    // 1. Legacy: { event: "meeting-ended", ... }
    // 2. bbb-webhooks nested format: { event: { data: { id: "meeting-ended", ... } }, type: "..." }
    // The nested format puts an object in payload.event, so casting to string gives "[object Object]".
    const eventType =
      typeof payload.event === "string"
        ? (payload.event as string)
        : typeof (payload.event as any)?.data?.id === "string"
          ? ((payload.event as any).data.id as string)
          : (payload.type as string);
    if (!eventType) {
      Logger.warn("Webhook missing event type field", loggerCtx);
      return { ok: false };
    }

    // Extract BBB meeting ID for indexed lookup / replay
    const bbbMeetingId =
      typeof payload.meetingID === "string" && payload.meetingID
        ? (payload.meetingID as string)
        : typeof (payload.event as any)?.data?.attributes?.meeting
              ?.externalMeetingId === "string"
          ? ((payload.event as any).data.attributes.meeting
              .externalMeetingId as string)
          : null;

    // ─── Persist-first ─────────────────────────────────────────────────────
    // Write the event to the DB immediately, then enqueue for async processing.
    // This guarantees no data loss even if the queue or processor is down.
    const ctx = await this.ctxService.create({ apiType: "admin" });
    const eventRepo = this.connection.getRepository(ctx, BbbWebhookEvent);

    const savedEvent = await eventRepo.save(
      new BbbWebhookEvent({
        eventType,
        payload: payload as any,
        receivedAt: new Date(),
        status: "PENDING",
        bbbMeetingId,
      }),
    );

    Logger.debug(
      `Webhook event ${savedEvent.id} (${eventType}) persisted, enqueuing for processing`,
      loggerCtx,
    );

    // Enqueue for async processing (fire-and-forget — errors are logged by the processor)
    this.webhookProcessor.enqueueEvent(savedEvent.id as string, ctx).catch(
      (err) =>
        Logger.error(
          `Failed to enqueue webhook event ${savedEvent.id}: ${(err as Error).message}`,
          loggerCtx,
        ),
    );

    return { ok: true };
  }

  private async verifyWebhookSignature(
    rawBody: Buffer,
    signatureHeader: string,
  ): Promise<boolean> {
    if (!signatureHeader) return false;

    const servers = await this.connection.rawConnection
      .getRepository(BbbServer)
      .createQueryBuilder("server")
      .addSelect("server.encryptedApiSecret")
      .where("server.enabled = :enabled", { enabled: true })
      .getMany();

    for (const server of servers) {
      try {
        const secret = this.encryptionService.decrypt(
          server.encryptedApiSecret,
        );
        const expected =
          "sha256=" +
          crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
        if (
          crypto.timingSafeEqual(
            Buffer.from(expected),
            Buffer.from(signatureHeader),
          )
        ) {
          return true;
        }
      } catch {
        continue;
      }
    }
    return false;
  }
}