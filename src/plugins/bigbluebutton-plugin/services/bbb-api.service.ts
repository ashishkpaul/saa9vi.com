import { Injectable } from "@nestjs/common";
import { Logger } from "@vendure/core";
import * as crypto from "crypto";
import { trace, SpanStatusCode } from "@opentelemetry/api";
import { parseStringPromise } from "xml2js";
import { BbbEncryptionService } from "./bbb-encryption.service";
import { BbbServer } from "../entities/bbb-server.entity";

/**
 * Typed BBB API errors (W1).
 *
 * `getMeetingInfo()` used to return `null` for EVERY failure (timeout, DNS,
 * HTTP 5xx, bad checksum, real notFound) and reconciliation treated `null` as
 * "meeting destroyed" — a transient BBB outage during the reconciliation pass
 * therefore terminated live meetings AND forfeited their billing. These types
 * let callers distinguish "proven gone" from "cannot prove it is gone".
 */
export class BbbNotFoundError extends Error {
  readonly messageKey = "notFound";
  constructor(meetingID: string) {
    super(`BBB meeting not found: ${meetingID}`);
    this.name = "BbbNotFoundError";
  }
}

/** Transient transport failure (timeout, DNS, HTTP 5xx, malformed XML). */
export class BbbUnavailableError extends Error {
  readonly messageKey = "unavailable";
  constructor(
    method: string,
    readonly reason: string,
  ) {
    super(`BBB ${method} unavailable: ${reason}`);
    this.name = "BbbUnavailableError";
  }
}

/**
 * BBB explicitly rejected the call (checksum/auth/other FAILED) — a
 * configuration problem. Log and flag the server unhealthy, never treat as
 * "gone".
 */
export class BbbRejectedError extends Error {
  constructor(
    method: string,
    readonly messageKey: string,
    readonly detail: string,
  ) {
    super(`BBB ${method} rejected [${messageKey}]: ${detail}`);
    this.name = "BbbRejectedError";
  }
}

/**
 * Server record loaded without its secret (`encryptedApiSecret` is
 * `select:false`) or secret undecryptable (wrong `BBB_ENCRYPTION_KEY`).
 * A per-meeting config error — callers in per-meeting loops MUST catch it and
 * skip that meeting, never stale/complete it and never kill the pass.
 */
export class BbbMisconfiguredError extends Error {
  readonly messageKey = "misconfigured";
  constructor(reason: string) {
    super(`BBB misconfigured: ${reason}`);
    this.name = "BbbMisconfiguredError";
  }
}

/**
 * Build a sanitized `BbbRejectedError` from a BBB FAILED response — carries
 * only method + messageKey + truncated message, never the signed URL.
 */
export function bbbRejected(
  method: string,
  messageKey: string | undefined,
  message: string | undefined,
): BbbRejectedError | BbbNotFoundError {
  const key = messageKey ?? "unknown";
  const detail = String(message ?? "request rejected").substring(0, 200);
  if (key === "notFound") {
    // Meeting id is passed via message elsewhere; keep detail short.
    return new BbbNotFoundError(detail);
  }
  return new BbbRejectedError(method, key, detail);
}

const loggerCtx = "BbbApiService";

export interface CreateMeetingParams {
  meetingID: string;
  name: string;
  attendeePW?: string;
  moderatorPW?: string;
  record?: boolean;
  autoStartRecording?: boolean;
  allowStartStopRecording?: boolean;
  welcome?: string;
  maxParticipants?: number;
  /** JSON-encoded array of { url: string } — loaded per BBB 3.x plugin spec */
  pluginManifests?: string;
  [key: string]: string | number | boolean | undefined;
}

export interface JoinMeetingParams {
  fullName: string;
  meetingID: string;
  password: string;
  userID?: string;
  createTime?: number;
  logoutURL?: string;
}

export interface BbbMeetingInfo {
  meetingID: string;
  internalMeetingID: string;
  running: boolean;
  participantCount: number;
  moderatorCount: number;
  recording: boolean;
  startTime: number;
  endTime: number;
}

export interface BbbRecording {
  recordID: string;
  meetingID: string;
  name: string;
  published: boolean;
  state: string;
  startTime: number;
  endTime: number;
  participants: number;
  playbackUrl?: string;
}

/**
 * Thin adapter for the BigBlueButton API.
 *
 * Checksum contract:
 *   checksum = SHA256(methodName + queryString + apiSecret)
 *
 * Algorithm note: this adapter signs with **SHA-256**, so the connected BBB
 * server must have SHA-256 enabled in its accepted checksum algorithms — treat
 * that as a deployment requirement of this integration, not as a property of
 * BBB in general. BBB's accepted algorithm set is a server-side configuration
 * (its published API documentation still uses SHA-1 in the canonical example),
 * so do not read "BBB uses SHA-256" into this code: verify against the actually
 * deployed BBB version before declaring provider compatibility complete — see
 * `docs/implementation/production-readiness.md` §11.
 *
 * Reference: https://docs.bigbluebutton.org/development/api
 */
@Injectable()
export class BbbApiService {
  constructor(private readonly encryptionService: BbbEncryptionService) {}

  // ─── Checksum ────────────────────────────────────────────────────────────────

  private buildChecksum(
    methodName: string,
    params: Record<string, string>,
    apiSecret: string,
  ): string {
    const queryString = new URLSearchParams(params).toString();
    return crypto
      .createHash("sha256")
      .update(methodName + queryString + apiSecret)
      .digest("hex");
  }

  private buildApiUrl(
    server: BbbServer,
    apiSecret: string,
    methodName: string,
    params: Record<string, string>,
  ): string {
    const checksum = this.buildChecksum(methodName, params, apiSecret);
    const qs = new URLSearchParams({ ...params, checksum }).toString();
    const baseUrl = server.apiUrl.replace(/\/$/, "");
    return `${baseUrl}/api/${methodName}?${qs}`;
  }

  private async callApi(
    url: string,
    describe: { method: string; serverHost: string },
  ): Promise<Record<string, unknown>> {
    // 1. Add an explicit AbortController to fail fast
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second hard timeout (increased from 4s)

    // W2: errors carry method + host + status/messageKey ONLY — never the
    // signed URL (which embeds attendeePW/moderatorPW + checksum).
    const { method, serverHost } = describe;
    try {
      const res = await fetch(url, { signal: controller.signal });
      if (!res.ok) {
        throw new BbbUnavailableError(
          method,
          `HTTP ${res.status} from ${serverHost}`,
        );
      }
      let parsed: any;
      try {
        const xml = await res.text();
        parsed = await parseStringPromise(xml, { explicitArray: false });
      } catch {
        throw new BbbUnavailableError(
          method,
          `malformed XML response from ${serverHost}`,
        );
      }
      const response = parsed?.response;

      if (!response) {
        throw new BbbUnavailableError(
          method,
          `unexpected XML envelope from ${serverHost}`,
        );
      }
      if (response.returncode !== "SUCCESS") {
        throw bbbRejected(
          method,
          response.messageKey as string | undefined,
          response.message as string | undefined,
        );
      }
      return response;
    } catch (err: any) {
      if (err instanceof BbbNotFoundError) throw err;
      if (err instanceof BbbRejectedError) throw err;
      if (err instanceof BbbUnavailableError) throw err;
      if (err?.name === "AbortError") {
        throw new BbbUnavailableError(method, `timed out after 10s (${serverHost})`);
      }
      // Network/DNS/fetch-level failure — sanitize (node fetch errors can
      // embed the URL, which carries passwords + checksum).
      throw new BbbUnavailableError(method, `request failed (${serverHost})`);
    } finally {
      clearTimeout(timeoutId);
    }
  }
  private decryptSecret(server: BbbServer): string {
    // Gate-2 audit: a server loaded via `findById` (no `.addSelect`) carries
    // `encryptedApiSecret === undefined` (select:false). Previously `decrypt`
    // threw a raw TypeError deep in the checksum step; now it is a typed
    // config error the per-meeting loops catch and skip on.
    if (!server?.encryptedApiSecret) {
      throw new BbbMisconfiguredError(
        `server ${server?.id ?? "?"} loaded without encryptedApiSecret (use findByIdWithSecret/selectServer)`,
      );
    }
    try {
      return this.encryptionService.decrypt(server.encryptedApiSecret);
    } catch (err) {
      throw new BbbMisconfiguredError(
        `server ${server?.id ?? "?"} secret undecryptable: ${(err as Error).message}`.substring(0, 200),
      );
    }
  }

  private serverHost(server: BbbServer): string {
    try {
      return new URL(server.apiUrl).host;
    } catch {
      return "bbb-server";
    }
  }

  /**
   * W2: record only a sanitized summary on the span — never the signed URL
   * (passwords + checksum) and never the raw error (node fetch errors can
   * embed the URL).
   */
  private noteSpanError(span: any, err: unknown): void {
    const e = err as
      | BbbNotFoundError
      | BbbUnavailableError
      | BbbRejectedError
      | Error;
    const messageKey =
      (e as BbbNotFoundError).messageKey ??
      (e as BbbRejectedError).messageKey ??
      "unknown";
    span.setStatus({
      code: SpanStatusCode.ERROR,
      message: `${e.name ?? "Error"} [${messageKey}]`,
    });
    span.recordException({
      name: e.name ?? "Error",
      message: `${e.name ?? "Error"} [${messageKey}]: ${(e as Error).message}`.substring(0, 300),
    } as Error);
  }

  // ─── API Methods ─────────────────────────────────────────────────────────────

  async createMeeting(
    server: BbbServer,
    params: CreateMeetingParams,
  ): Promise<{ internalMeetingID: string; meetingID: string }> {
    const tracer = trace.getTracer("bbb-api");
    return tracer.startActiveSpan("bbb.createMeeting", async (span) => {
      span.setAttribute("bbb.server", server.apiUrl);
      span.setAttribute("bbb.meetingId", params.meetingID);
      try {
        const secret = this.decryptSecret(server);
        const strParams: Record<string, string> = {};
        for (const [k, v] of Object.entries(params)) {
          if (v !== undefined && v !== null) {
            strParams[k] = String(v);
          }
        }
        const url = this.buildApiUrl(server, secret, "create", strParams);
        Logger.debug(`createMeeting → ${params.meetingID}`, loggerCtx);
        const response = await this.callApi(url, {
          method: "create",
          serverHost: this.serverHost(server),
        });
        span.setStatus({ code: SpanStatusCode.OK });
        return {
          internalMeetingID: response.internalMeetingID as string,
          meetingID: response.meetingID as string,
        };
      } catch (err) {
        this.noteSpanError(span, err);
        throw err;
      } finally {
        span.end();
      }
    });
  }

  /**
   * Returns a signed join URL. This is NOT an API call — it constructs a URL
   * that the browser navigates to directly.
   */
  buildJoinUrl(
    server: BbbServer,
    params: JoinMeetingParams & { password: string },
  ): string {
    const secret = this.decryptSecret(server);
    const strParams: Record<string, string> = {
      fullName: params.fullName,
      meetingID: params.meetingID,
      password: params.password,
    };
    if (params.userID) strParams.userID = params.userID;
    if (params.createTime) strParams.createTime = String(params.createTime);
    if (params.logoutURL) strParams.logoutURL = params.logoutURL;
    const baseUrl = server.apiUrl.replace(/\/$/, "");
    const checksum = this.buildChecksum("join", strParams, secret);
    const qs = new URLSearchParams({ ...strParams, checksum }).toString();
    return `${baseUrl}/api/join?${qs}`;
  }

  /**
   * Existence check, NOT a "running" check: success means the BBB meeting
   * record exists (even with zero participants). W1: throws typed errors —
   * only `BbbNotFoundError` means "proven gone"; `BbbUnavailableError` /
   * `BbbRejectedError` mean "cannot prove it is gone" and callers MUST skip,
   * never stale/complete. Removed `isMeetingRunning` (W1.3): `running` is
   * false until the first participant joins, so it caused split-class
   * re-provisioning on API blips.
   *
   * Why the third parameter: the API-Mate capture you provided shows
   * `getMeetingInfo` WITH the moderator password —
   * `.../getMeetingInfo?meetingID=...&password=mp&checksum=...` — and the old
   * password-less call never matched a real server request. Every caller that
   * can load the meeting secret supplies it (reconciliation, room runtime,
   * both join validators). Metering is the deliberate exception: it lists
   * meetings via a secret-less query, so it probes without the password —
   * whether the server REQUIRES it (checksumError → skip + alert) or treats
   * it as optional (success → sample) is observable per deployment, and the
   * skip path is safe either way. This feeds W6: if live verification shows
   * password-less metering works, keep it; if the server rejects it, the
   * metering caller can load the secret too (no schema change either way).
   */
  async getMeetingInfo(
    server: BbbServer,
    meetingID: string,
    moderatorPW?: string,
  ): Promise<BbbMeetingInfo> {
    const tracer = trace.getTracer("bbb-api");
    return tracer.startActiveSpan("bbb.getMeetingInfo", async (span) => {
      span.setAttribute("bbb.server", server.apiUrl);
      span.setAttribute("bbb.meetingId", meetingID);
      try {
        const secret = this.decryptSecret(server);
        const params: Record<string, string> = { meetingID };
        // BBB requires the moderator password on getMeetingInfo (see
        // API-Mate capture). Omitted only for callers that cannot load the
        // meeting secret (metering, which uses findById without secrets).
        if (moderatorPW) params.password = moderatorPW;
        const url = this.buildApiUrl(server, secret, "getMeetingInfo", params);
        const response = await this.callApi(url, {
          method: "getMeetingInfo",
          serverHost: this.serverHost(server),
        });
        span.setStatus({ code: SpanStatusCode.OK });
        return {
          meetingID: response.meetingID as string,
          internalMeetingID: response.internalMeetingID as string,
          running: response.running === "true",
          participantCount: Number(response.participantCount ?? 0),
          moderatorCount: Number(response.moderatorCount ?? 0),
          recording: response.recording === "true",
          startTime: Number(response.startTime ?? 0),
          endTime: Number(response.endTime ?? 0),
        };
      } catch (err) {
        this.noteSpanError(span, err);
        throw err;
      } finally {
        span.end();
      }
    });
  }

  async endMeeting(
    server: BbbServer,
    meetingID: string,
    moderatorPW: string,
  ): Promise<void> {
    const tracer = trace.getTracer("bbb-api");
    return tracer.startActiveSpan("bbb.endMeeting", async (span) => {
      span.setAttribute("bbb.meetingId", meetingID);
      try {
        const secret = this.decryptSecret(server);
        const params = { meetingID, password: moderatorPW };
        const url = this.buildApiUrl(server, secret, "end", params);
        await this.callApi(url, {
          method: "end",
          serverHost: this.serverHost(server),
        });
        span.setStatus({ code: SpanStatusCode.OK });
        Logger.info(`Meeting ended: ${meetingID}`, loggerCtx);
      } catch (err) {
        this.noteSpanError(span, err);
        throw err;
      } finally {
        span.end();
      }
    });
  }

  /**
   * W1.4: no longer swallows errors — callers decide (metering skips the
   * sample; recording-repair logs and retries later). Errors are the same
   * typed W1 errors (sanitized, no URLs).
   */
  async getRecordings(
    server: BbbServer,
    meetingID?: string,
  ): Promise<BbbRecording[]> {
    const secret = this.decryptSecret(server);
    const params: Record<string, string> = {};
    if (meetingID) params.meetingID = meetingID;
    const url = this.buildApiUrl(server, secret, "getRecordings", params);
    const response = await this.callApi(url, {
      method: "getRecordings",
      serverHost: this.serverHost(server),
    });
    const recordings = response.recordings as Record<string, unknown>;
    if (!recordings || recordings.recording === undefined) return [];
      const list = Array.isArray(recordings.recording)
        ? recordings.recording
        : [recordings.recording];
      return (list as Record<string, unknown>[]).map((r) => ({
        recordID: r.recordID as string,
        meetingID: r.meetingID as string,
        name: r.name as string,
        published: r.published === "true",
        state: r.state as string,
        startTime: Number(r.startTime ?? 0),
        endTime: Number(r.endTime ?? 0),
        participants: Number(r.participants ?? 0),
        playbackUrl: (r.playback as Record<string, unknown>)?.format
          ? ((
              (r.playback as Record<string, unknown>).format as Record<
                string,
                unknown
              >
            )?.url as string)
          : undefined,
      }));
  }
}
