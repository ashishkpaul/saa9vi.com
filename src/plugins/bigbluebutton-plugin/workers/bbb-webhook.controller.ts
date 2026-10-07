/**
 * W3 — per-server BBB webhook receiver.
 *
 * Mount point: POST /bbb/webhook/:serverId
 *
 * Wire contract (bbb-webhooks source, 2026-10-07):
 *   - Content-Type: application/x-www-form-urlencoded
 *   - Fields: `domain`, `event` (JSON array string), `timestamp`
 *   - auth2_0: true  → Authorization: Bearer <raw shared secret>
 *   - auth2_0: false → ?checksum=sha<N>(callbackUrl + rawBody + secret)
 *   - Success: 2xx or 401 — BBB counts 401 as delivered, no retry, no hook removal
 *   - Timeout: 5 s — we must respond within ~2 s; only persist + enqueue here
 *   - Retries: 12 over ~5 min on any non-2xx/non-401 status
 *
 * Security contract:
 *   - Auth failure → 401 (never 403; 403 retries for 5 min then drops hook)
 *   - Infrastructure failure (bad decrypt, missing rawBody) → 500 + alert
 *     so BBB retries within its window
 *   - Neither checksum nor Authorization header value is ever logged,
 *     persisted, or attached to an OpenTelemetry span
 *   - Parse failure AFTER successful auth → 200 + PARSE_FAILED row + alert
 *     (a poison body must not kill the hook)
 *   - Deduplication: insert-with-conflict on dedupeKey (INV-002 safe)
 *   - Allow-list: only meeting-ended and rap-publish-ended are persisted;
 *     other event types (meeting-created, user-joined etc.) carry passwords
 *     and session tokens — they are dropped after auth succeeds
 */
import {
  Controller,
  HttpCode,
  HttpException,
  HttpStatus,
  Inject,
  Logger,
  Optional,
  Param,
  Post,
  Query,
  Req,
} from "@nestjs/common";
import type { RawBodyRequest } from "@nestjs/common";
import { RequestContextService, TransactionalConnection } from "@vendure/core";
import * as crypto from "crypto";
import { BbbServer } from "../entities/bbb-server.entity";
import { BbbWebhookEvent } from "../entities/bbb-webhook-event.entity";
import { BbbWebhookProcessorService } from "../services/bbb-webhook-processor.service";
import { BbbEncryptionService } from "../services/bbb-encryption.service";
import { BbbOpsAlertService } from "../services/bbb-ops-alert.service";
import { verifyWebhookAuth } from "./bbb-webhook-auth";
import { webhookCallbackUrl } from "../shared/bbb-webhook-url";
import { BBB_PUBLIC_BASE_URL } from "../constants";

const loggerCtx = "BbbWebhookController";

/**
 * Event types we allow through to persistence.
 * All others are dropped after authentication to avoid persisting payloads
 * that contain moderator/viewer passwords (meeting-created) or IP addresses
 * and session tokens (user-joined).
 */
const ALLOWED_EVENT_TYPES = new Set(["meeting-ended", "rap-publish-ended"]);

/**
 * Compute sha256(serverId + '\0' + rawBodyText) as the deduplication key.
 * The null separator prevents prefix-collision attacks.
 */
function buildDedupeKey(serverId: string, rawBodyText: string): string {
  return crypto
    .createHash("sha256")
    .update(serverId)
    .update("\x00")
    .update(rawBodyText)
    .digest("hex");
}

@Controller("bbb")
export class BbbWebhookController {
  constructor(
    private readonly encryptionService: BbbEncryptionService,
    private readonly ctxService: RequestContextService,
    private readonly connection: TransactionalConnection,
    private readonly webhookProcessor: BbbWebhookProcessorService,
    private readonly opsAlert: BbbOpsAlertService,
    @Optional()
    @Inject(BBB_PUBLIC_BASE_URL)
    private readonly publicBaseUrl: string = "",
  ) {}

  @Post("webhook/:serverId")
  @HttpCode(200)
  async handleWebhookForServer(
    @Param("serverId") serverId: string,
    @Query("checksum") checksumParam: string | undefined,
    @Req() req: RawBodyRequest<any>,
  ): Promise<{ ok: boolean }> {
    return this.processDelivery(req, serverId, checksumParam);
  }

  private async processDelivery(
    req: RawBodyRequest<any>,
    serverId: string,
    checksumParam: string | undefined,
  ): Promise<{ ok: boolean }> {
    // ── 1. Raw body ────────────────────────────────────────────────────────
    // Missing rawBody is an infrastructure misconfiguration — return 500 so
    // BBB retries within its 5-minute window rather than swallowing the event.
    const rawBody: Buffer | undefined = req.rawBody;
    if (!rawBody || rawBody.length === 0) {
      Logger.error(
        "BBB webhook received without raw body — check rawBody: true config",
        loggerCtx,
      );
      this.opsAlert.notify(
        "bbb-webhook-no-raw-body",
        serverId,
        `BBB webhook received without raw body for server ${serverId}`,
        { serverId },
      );
      return this.respond500();
    }

    // ── 2. Load server ─────────────────────────────────────────────────────
    // Query by ID only — do NOT filter on `enabled`. A server disabled for
    // draining still has live meetings whose events must arrive; only a
    // completely unknown serverId (no row at all) returns 404.
    const serverRepo = this.connection.rawConnection.getRepository(BbbServer);
    const server = await serverRepo
      .createQueryBuilder("server")
      .addSelect("server.encryptedApiSecret")
      .where("server.id = :id", { id: serverId })
      .getOne();

    if (!server) {
      // 404: BBB will retry and eventually drop the hook. That is correct
      // behaviour for a server we have no record of — the hook should not exist.
      Logger.warn(
        `BBB webhook for unknown serverId: ${serverId} — returning 404`,
        loggerCtx,
      );
      return this.respond404();
    }

    // ── 3. Decrypt secret ──────────────────────────────────────────────────
    // Decrypt failure is an infrastructure problem — return 500 + alert.
    let secret: string;
    try {
      secret = this.encryptionService.decrypt(server.encryptedApiSecret);
    } catch (err) {
      Logger.error(
        `BBB webhook: failed to decrypt secret for server ${serverId}: ${(err as Error).message}`,
        loggerCtx,
      );
      this.opsAlert.notify(
        "bbb-webhook-decrypt-failure",
        serverId,
        `BBB webhook: secret decrypt failed for server ${serverId}`,
        { serverId },
      );
      return this.respond500();
    }

    // ── 4. Authenticate ────────────────────────────────────────────────────
    // Reconstruct the EXACT callback URL BBB signed at registration time —
    // never trust incoming Host / X-Forwarded-Host headers.
    const callbackUrl = webhookCallbackUrl(this.publicBaseUrl, serverId);

    const authResult = verifyWebhookAuth({
      authorizationHeader: req.headers["authorization"] as string | undefined,
      checksum: checksumParam,
      callbackUrl,
      rawBody,
      secret,
    });

    if (!authResult.ok) {
      // 401 = BBB counts as delivered, no retry, no hook removal.
      // Never log checksum or Authorization header value.
      Logger.warn(
        `BBB webhook auth failed for server ${serverId} — returning 401`,
        loggerCtx,
      );
      this.opsAlert.notify(
        "bbb-webhook-auth-failure",
        serverId,
        `BBB webhook authentication failed for server ${serverId}`,
        { serverId },
      );
      return this.respond401();
    }

    if (authResult.isBearerMode) {
      this.opsAlert.notify(
        "bbb-webhook-bearer-mode",
        serverId,
        `BBB webhook using bearer auth for server ${serverId} — set auth2_0: false on BBB`,
        { serverId, recommendation: "Set auth2_0: false on BBB and rotate the shared secret" },
      );
    }

    // ── 5. Parse body ──────────────────────────────────────────────────────
    const rawBodyText = rawBody.toString("utf8");
    const dedupeKey = buildDedupeKey(serverId, rawBodyText);

    // Parse all elements in the array (BBB sends one today, may send more).
    type BbbEventData = { id: string; attributes?: Record<string, unknown> };
    let parsedElements: Array<BbbEventData> = [];
    let parseFailed = false;
    let parseError = "";

    try {
      const params = new URLSearchParams(rawBodyText);
      const eventStr = params.get("event");
      if (!eventStr) throw new Error("Missing `event` field");
      const arr = JSON.parse(eventStr) as Array<{ data: BbbEventData }>;
      if (!Array.isArray(arr) || arr.length === 0)
        throw new Error("`event` is not a non-empty JSON array");
      if (arr.length > 1) {
        Logger.warn(
          `BBB webhook for server ${serverId}: event array has ${arr.length} elements — processing all`,
          loggerCtx,
        );
        this.opsAlert.notify(
          "bbb-webhook-multi-event",
          dedupeKey,
          `BBB webhook sent ${arr.length} elements in one delivery for server ${serverId}`,
          { serverId, count: arr.length },
        );
      }
      parsedElements = arr.map((el) => el.data).filter(Boolean);
    } catch (err) {
      parseFailed = true;
      parseError = (err as Error).message;
      Logger.warn(
        `BBB webhook parse failure for server ${serverId}: ${parseError}`,
        loggerCtx,
      );
      this.opsAlert.notify(
        "bbb-webhook-parse-failure",
        dedupeKey,
        `BBB webhook body parse failed for server ${serverId}: ${parseError}`,
        { serverId },
      );
    }

    // ── 6. Allow-list filter ───────────────────────────────────────────────
    // Drop events we don't handle before persisting — some carry sensitive
    // data (passwords in meeting-created, IP + session token in user-joined).
    // Only apply when parse succeeded.
    if (!parseFailed) {
      const before = parsedElements.length;
      parsedElements = parsedElements.filter((el) =>
        ALLOWED_EVENT_TYPES.has(el.id),
      );
      const dropped = before - parsedElements.length;
      if (dropped > 0) {
        Logger.debug(
          `BBB webhook server ${serverId}: dropped ${dropped} non-allow-listed event(s) after auth`,
          loggerCtx,
        );
      }
      // If ALL elements were non-allow-listed, acknowledge silently (200).
      if (parsedElements.length === 0 && !parseFailed) {
        return { ok: true };
      }
    }

    // Take the primary element for the single-row persist (first allow-listed).
    const primary = parsedElements[0] ?? null;
    const eventType = primary?.id ?? null;
    const attrs = ((primary?.attributes ?? {}) as Record<string, unknown>);
    const meetingAttrs = (attrs?.meeting ?? {}) as Record<string, unknown>;
    const bbbMeetingId =
      (meetingAttrs["external-meeting-id"] as string | undefined) ??
      (meetingAttrs["internal-meeting-id"] as string | undefined) ??
      null;
    const payload = primary as Record<string, unknown> | null;

    // ── 7. Persist (insert-with-conflict dedupe, INV-002) ──────────────────
    const ctx = await this.ctxService.create({ apiType: "admin" });
    const eventRepo = this.connection.getRepository(ctx, BbbWebhookEvent);

    let savedEvent: BbbWebhookEvent | null = null;
    try {
      const row = Object.assign(new BbbWebhookEvent(), {
        serverId,
        rawBody: rawBodyText,
        dedupeKey,
        eventType,
        payload: payload ?? null,
        receivedAt: new Date(),
        status: parseFailed ? "PARSE_FAILED" : "PENDING",
        bbbMeetingId,
      } satisfies Partial<BbbWebhookEvent>);

      // Insert via raw query with ON CONFLICT DO NOTHING for atomic deduplication
      // (INV-002). TypeORM's .save() does a SELECT then INSERT which has a TOCTOU
      // race; a raw INSERT...ON CONFLICT is the only safe option.
      const tableName = eventRepo.metadata.tableName;
      const result = await eventRepo.query(
        `INSERT INTO "${tableName}"
           ("serverId","rawBody","dedupeKey","eventType","payload","receivedAt","status","bbbMeetingId","createdAt","updatedAt")
         VALUES ($1,$2,$3,$4,$5::json,$6,$7,$8,NOW(),NOW())
         ON CONFLICT ("dedupeKey") WHERE "dedupeKey" IS NOT NULL
         DO NOTHING
         RETURNING "id"`,
        [
          row.serverId,
          row.rawBody,
          row.dedupeKey,
          row.eventType,
          row.payload !== null ? JSON.stringify(row.payload) : null,
          row.receivedAt,
          row.status,
          row.bbbMeetingId,
        ],
      ) as Array<{ id: string }>;

      if (!result.length) {
        Logger.debug(
          `BBB webhook duplicate delivery for server ${serverId} (dedupeKey conflict), returning 200`,
          loggerCtx,
        );
        return { ok: true };
      }

      savedEvent = await eventRepo.findOne({ where: { id: result[0]!.id } });
    } catch (err) {
      Logger.error(
        `BBB webhook persistence failed for server ${serverId}: ${(err as Error).message}`,
        loggerCtx,
      );
      return this.respond500();
    }

    // ── 8. Enqueue ─────────────────────────────────────────────────────────
    if (!parseFailed && savedEvent && eventType) {
      this.webhookProcessor.enqueueEvent(savedEvent.id as string, ctx).catch(
        (err) =>
          Logger.error(
            `BBB webhook: failed to enqueue event ${savedEvent!.id}: ${(err as Error).message}`,
            loggerCtx,
          ),
      );
    }

    return { ok: true };
  }

  private respond401(): never {
    throw new HttpException({ ok: false }, HttpStatus.UNAUTHORIZED);
  }

  private respond404(): never {
    throw new HttpException({ ok: false }, HttpStatus.NOT_FOUND);
  }

  private respond500(): never {
    throw new HttpException({ ok: false }, HttpStatus.INTERNAL_SERVER_ERROR);
  }
}
