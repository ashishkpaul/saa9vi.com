/**
 * W4 — BBB webhook hook registration and reconciliation.
 *
 * Hooks API contract (bbb-webhooks source, 2026-10-07):
 *   - GET-only: hooks/create, hooks/list, hooks/destroy
 *   - Checksum-only: no bearer mode
 *   - Checksum = sha<N>(callName + queryString + secret)
 *   - `permanentHook` parameter is ignored by api.js (item 4 fix) — hook
 *     permanence is controlled by `permanentURLs` in bbb-webhooks config,
 *     not by any API parameter. We rely on the 5-minute reconcile loop.
 *   - eventID parameter: comma-separated lowercase event names (confirmed
 *     from api.js source, item 5 fix).
 *
 * ensureWebhook() reconciliation:
 *   1. hooks/list — parse callbackURL, eventID, rawData for each hook
 *   2. If our hook is present AND has correct eventID and rawData → no-op
 *   3. If our hook is present BUT has wrong eventID or rawData → destroy + create
 *   4. If our hook is absent → create
 *   5. Stale hooks (callbackURL starts with our prefix but != expected) → destroy
 *
 * Trigger points (item 10):
 *   - Periodic: every 5 minutes via BbbHooksReconciliationTask
 *   - On server create: called from BbbServerService.create()
 *   - On server enable: called from BbbServerService.update() when enabled→true
 *   - On startup: called from BigBlueButtonPlugin.onApplicationBootstrap()
 *   - Scope: enabled+healthy servers AND disabled servers with active meetings
 *
 * Per-server alerts distinguish:
 *   - "bbb-webhooks not installed" (hooks/list returns 404)
 *   - "unreachable" (network / timeout)
 *   - "checksum rejected" (secret mismatch)
 */
import { Inject, Injectable, Logger, Optional } from "@nestjs/common";
import * as crypto from "crypto";
import { parseStringPromise } from "xml2js";
import { TransactionalConnection } from "@vendure/core";
import { BbbServer } from "../entities/bbb-server.entity";
import { BbbMeeting } from "../entities/bbb-meeting.entity";
import { BbbEncryptionService } from "./bbb-encryption.service";
import { BbbOpsAlertService } from "./bbb-ops-alert.service";
import { webhookCallbackUrl } from "../shared/bbb-webhook-url";
import { normalizeBbbApiUrl } from "../shared/bbb-api-url";
import { BBB_PLUGIN_OPTIONS, MEETING_STATE } from "../constants";
import type { BigBlueButtonPluginOptions } from "../types";

const loggerCtx = "BbbHooksService";

/**
 * Event types registered on hooks/create.
 * Confirmed from api.js: parameter name is `eventID`, comma-separated,
 * lowercase hyphenated event names.
 */
export const BBB_HOOK_EVENT_FILTER = "meeting-ended,rap-publish-ended";

/** getRaw=false: we want the normalised bbb-webhooks JSON, not raw BBB XML. */
const HOOK_GET_RAW = "false";

/** Prefix that identifies any hook belonging to this Saa9vi instance. */
function ourHookPathPrefix(publicBaseUrl: string): string {
  return `${publicBaseUrl.replace(/\/+$/, "")}/bbb/webhook/`;
}

interface BbbHook {
  hookID: string;
  callbackURL: string;
  /** Comma-separated event IDs registered on this hook. */
  eventID: string;
  /** Whether this hook is configured for raw (un-normalised) delivery. */
  rawData: boolean;
}

type HooksListOutcome =
  | { ok: true; hooks: BbbHook[] }
  | { ok: false; kind: "not-installed" | "unreachable" | "rejected"; message: string };

@Injectable()
export class BbbHooksService {
  private readonly checksumAlgorithm: "sha1" | "sha256";

  constructor(
    private readonly connection: TransactionalConnection,
    private readonly encryptionService: BbbEncryptionService,
    private readonly opsAlert: BbbOpsAlertService,
    @Optional()
    @Inject(BBB_PLUGIN_OPTIONS)
    private readonly options?: BigBlueButtonPluginOptions,
  ) {
    this.checksumAlgorithm =
      options?.checksumAlgorithm === "sha1" ? "sha1" : "sha256";
  }

  /**
   * Ensure the correct hook is registered on all relevant servers.
   *
   * "Relevant" = enabled+healthy servers PLUS disabled servers that still
   * have active meetings (their events must continue arriving until the
   * meeting ends).
   */
  async ensureAllWebhooks(): Promise<void> {
    const publicBaseUrl = this.resolvePublicBaseUrl();
    if (!publicBaseUrl) {
      Logger.warn(
        "BbbHooksService: publicBaseUrl not configured — skipping hook reconciliation",
        loggerCtx,
      );
      return;
    }

    const serverRepo = this.connection.rawConnection.getRepository(BbbServer);
    const meetingRepo = this.connection.rawConnection.getRepository(BbbMeeting);

    // Enabled+healthy servers (normal case).
    const enabledServers = await serverRepo
      .createQueryBuilder("server")
      .addSelect("server.encryptedApiSecret")
      .where("server.enabled = :enabled", { enabled: true })
      .andWhere("server.healthy = :healthy", { healthy: true })
      .getMany();

    // Disabled servers that still have active meetings.
    const activeStates = [MEETING_STATE.ACTIVE, MEETING_STATE.PROVISIONING];
    const activeMeetings = await meetingRepo
      .createQueryBuilder("meeting")
      .select("DISTINCT meeting.serverId", "serverId")
      .where("meeting.state IN (:...states)", { states: activeStates })
      .andWhere("meeting.serverId IS NOT NULL")
      .getRawMany<{ serverId: string }>();

    const activeServerIds = new Set(activeMeetings.map((r) => r.serverId));
    // Remove ids already covered by enabledServers.
    for (const s of enabledServers) activeServerIds.delete(s.id as string);

    let drainingServers: BbbServer[] = [];
    if (activeServerIds.size > 0) {
      drainingServers = await serverRepo
        .createQueryBuilder("server")
        .addSelect("server.encryptedApiSecret")
        .where("server.id IN (:...ids)", { ids: [...activeServerIds] })
        .getMany();
    }

    const allServers = [...enabledServers, ...drainingServers];

    await Promise.allSettled(
      allServers.map((server) =>
        this.ensureWebhook(server, publicBaseUrl).catch((err) => {
          Logger.error(
            `BbbHooksService: reconciliation error for server ${server.id}: ${(err as Error).message}`,
            loggerCtx,
          );
        }),
      ),
    );
  }

  /**
   * Reconcile the webhook hook for a single server.
   * Safe to call directly from BbbServerService on create/enable.
   */
  async ensureWebhook(server: BbbServer, publicBaseUrl?: string): Promise<void> {
    const base = publicBaseUrl ?? this.resolvePublicBaseUrl();
    if (!base) {
      Logger.warn(
        `BbbHooksService: publicBaseUrl not configured, skipping server ${server.id}`,
        loggerCtx,
      );
      return;
    }

    const secret = this.decryptSecret(server);
    const expectedCallbackUrl = webhookCallbackUrl(base, server.id as string);
    const prefix = ourHookPathPrefix(base);

    // ── 1. List current hooks ─────────────────────────────────────────────
    const listOutcome = await this.safeListHooks(server, secret);

    if (!listOutcome.ok) {
      // Distinguish alert kinds for ops.
      const alertKind =
        listOutcome.kind === "not-installed"
          ? "bbb-hooks-not-installed"
          : listOutcome.kind === "rejected"
            ? "bbb-hooks-checksum-rejected"
            : "bbb-hooks-unreachable";

      this.opsAlert.notify(
        alertKind,
        server.id as string,
        `BBB hooks/list failed on server ${server.id} [${listOutcome.kind}]: ${listOutcome.message}`,
        { serverId: server.id, kind: listOutcome.kind },
      );
      Logger.warn(
        `BbbHooksService: hooks/list failed on server ${server.id} [${listOutcome.kind}]: ${listOutcome.message}`,
        loggerCtx,
      );
      return;
    }

    const hooks = listOutcome.hooks;

    // ── 2. Find our hook and classify it ──────────────────────────────────
    const ours = hooks.find((h) => h.callbackURL === expectedCallbackUrl);
    const stale = hooks.filter(
      (h) =>
        h.callbackURL.startsWith(prefix) &&
        h.callbackURL !== expectedCallbackUrl,
    );

    // Check if our hook has the correct event filter and raw setting.
    //
    // eventID mismatch logic:
    //   - hooks/list omits <eventID> when no filter was set at creation time.
    //     That means ours.eventID === "" (our parser uses ?? "").
    //   - An empty eventID means "all events" — that is a superset of what we
    //     want but functionally incorrect (we'd receive meeting-created etc.).
    //   - We only skip recreation when the filter exactly matches ours.
    //   - getRaw=false is also required; true means raw un-normalised XML.
    const oursEventIDNormalised = ours ? normaliseEventFilter(ours.eventID) : "";
    const expectedEventIDNormalised = normaliseEventFilter(BBB_HOOK_EVENT_FILTER);
    const hookNeedsRecreate =
      ours !== undefined &&
      (oursEventIDNormalised !== expectedEventIDNormalised || ours.rawData !== false);

    // ── 3. Destroy stale and misconfigured hooks ──────────────────────────
    for (const hook of stale) {
      Logger.log(
        `BbbHooksService: destroying stale hook ${hook.hookID} (${hook.callbackURL}) on server ${server.id}`,
        loggerCtx,
      );
      await this.destroyHook(server, secret, hook.hookID);
    }

    if (hookNeedsRecreate && ours) {
      Logger.log(
        `BbbHooksService: destroying misconfigured hook ${ours.hookID} on server ${server.id} ` +
          `(eventID="${ours.eventID}" want="${BBB_HOOK_EVENT_FILTER}" rawData=${ours.rawData})`,
        loggerCtx,
      );
      await this.destroyHook(server, secret, ours.hookID);
    }

    // ── 4. Create hook if missing or just destroyed ───────────────────────
    if (!ours || hookNeedsRecreate) {
      Logger.log(
        `BbbHooksService: creating hook for server ${server.id} → ${expectedCallbackUrl}`,
        loggerCtx,
      );
      await this.createHook(server, secret, expectedCallbackUrl);
    } else {
      Logger.debug(
        `BbbHooksService: hook already correct on server ${server.id} (hookID ${ours.hookID})`,
        loggerCtx,
      );
    }
  }

  // ─── Hooks API calls ─────────────────────────────────────────────────────

  /**
   * List hooks, returning a typed outcome rather than throwing.
   * Callers can act on the kind without catching exceptions.
   */
  private async safeListHooks(
    server: BbbServer,
    secret: string,
  ): Promise<HooksListOutcome> {
    const url = this.buildHooksUrl(server, secret, "hooks/list", {});
    try {
      const response = await this.getXml(server, url, "hooks/list");
      return { ok: true, hooks: this.parseHooksList(response) };
    } catch (err) {
      const msg = (err as Error).message;
      if (msg.includes("HTTP 404") || msg.includes("not installed")) {
        return { ok: false, kind: "not-installed", message: msg };
      }
      if (msg.includes("checksum") || msg.includes("rejected")) {
        return { ok: false, kind: "rejected", message: msg };
      }
      return { ok: false, kind: "unreachable", message: msg };
    }
  }

  private async createHook(
    server: BbbServer,
    secret: string,
    callbackURL: string,
  ): Promise<void> {
    // Note: `permanentHook` is NOT sent — api.js ignores it (item 4 fix).
    // Permanence is set via `permanentURLs` in bbb-webhooks config.
    const url = this.buildHooksUrl(server, secret, "hooks/create", {
      callbackURL,
      getRaw: HOOK_GET_RAW,
      eventID: BBB_HOOK_EVENT_FILTER,
    });
    await this.getXml(server, url, "hooks/create");
    Logger.log(`BbbHooksService: hook created for ${callbackURL}`, loggerCtx);
  }

  private async destroyHook(
    server: BbbServer,
    secret: string,
    hookID: string,
  ): Promise<void> {
    const url = this.buildHooksUrl(server, secret, "hooks/destroy", { hookID });
    await this.getXml(server, url, "hooks/destroy");
    Logger.log(`BbbHooksService: hook ${hookID} destroyed`, loggerCtx);
  }

  // ─── URL builder ─────────────────────────────────────────────────────────

  private buildHooksUrl(
    server: BbbServer,
    secret: string,
    callName: string,
    params: Record<string, string>,
  ): string {
    const qs = new URLSearchParams(params).toString();
    const checksum = crypto
      .createHash(this.checksumAlgorithm)
      .update(callName + qs + secret)
      .digest("hex");
    const baseUrl = normalizeBbbApiUrl(server.apiUrl);
    const qsFull = new URLSearchParams({ ...params, checksum }).toString();
    return `${baseUrl}/api/${callName}?${qsFull}`;
  }

  private async getXml(
    server: BbbServer,
    url: string,
    callName: string,
  ): Promise<Record<string, unknown>> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10_000);
    let xml: string;
    try {
      const res = await fetch(url, { signal: controller.signal });
      if (res.status === 404) {
        throw new Error(
          `HTTP 404 — bbb-webhooks not installed on server ${server.id}`,
        );
      }
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      xml = await res.text();
    } catch (err) {
      throw new Error(
        `hooks API ${callName} on server ${server.id} failed: ${(err as Error).message}`,
      );
    } finally {
      clearTimeout(timeoutId);
    }
    let parsed: any;
    try {
      parsed = await parseStringPromise(xml, { explicitArray: false });
    } catch {
      throw new Error(`hooks API ${callName} on server ${server.id}: malformed XML`);
    }
    const response = parsed?.response;
    if (!response) {
      throw new Error(
        `hooks API ${callName} on server ${server.id}: unexpected XML envelope`,
      );
    }
    if (response.returncode !== "SUCCESS") {
      const key = String(response.messageKey ?? "unknown");
      const msg = String(response.message ?? "request rejected").substring(0, 200);
      // Surface checksum failures distinctly.
      const detail = key.includes("checksum") ? "checksum rejected" : msg;
      throw new Error(
        `hooks API ${callName} on server ${server.id} rejected [${key}]: ${detail}`,
      );
    }
    return response;
  }

  // ─── XML parsing ─────────────────────────────────────────────────────────

  private parseHooksList(response: Record<string, unknown>): BbbHook[] {
    // hooks/list XML shape:
    // <response>
    //   <returncode>SUCCESS</returncode>
    //   <hooks>
    //     <hook>
    //       <hookID>1</hookID>
    //       <callbackURL>https://…</callbackURL>
    //       <eventID>meeting-ended,rap-publish-ended</eventID>
    //       <rawData>false</rawData>
    //     </hook>
    //   </hooks>
    // </response>
    const hooks = (response as any)?.hooks?.hook;
    if (!hooks) return [];
    const arr = Array.isArray(hooks) ? hooks : [hooks];
    return arr
      .filter(Boolean)
      .map((h: any): BbbHook => ({
        hookID: String(h.hookID ?? ""),
        callbackURL: String(h.callbackURL ?? ""),
        eventID: String(h.eventID ?? ""),
        rawData: h.rawData === "true" || h.rawData === true,
      }))
      .filter((h) => h.hookID && h.callbackURL);
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────

  resolvePublicBaseUrl(): string | null {
    const fromOptions = this.options?.publicBaseUrl;
    if (fromOptions) return fromOptions.replace(/\/+$/, "");
    const fromEnv = process.env.BBB_PUBLIC_BASE_URL;
    if (fromEnv) return fromEnv.replace(/\/+$/, "");
    return null;
  }

  private decryptSecret(server: BbbServer): string {
    if (!server?.encryptedApiSecret) {
      throw new Error(
        `Server ${server?.id ?? "?"} loaded without encryptedApiSecret`,
      );
    }
    return this.encryptionService.decrypt(server.encryptedApiSecret);
  }
}

/**
 * Normalise an eventID string for comparison: sort comma-separated names,
 * trim whitespace, lowercase. Makes order-independent equality checks safe.
 */
function normaliseEventFilter(raw: string): string {
  return raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
    .sort()
    .join(",");
}
