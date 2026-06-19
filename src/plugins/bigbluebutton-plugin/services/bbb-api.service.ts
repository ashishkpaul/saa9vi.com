import { Injectable } from "@nestjs/common";
import { Logger } from "@vendure/core";
import * as crypto from "crypto";
import { trace, SpanStatusCode } from "@opentelemetry/api";
import { parseStringPromise } from "xml2js";
import { BbbEncryptionService } from "./bbb-encryption.service";
import { BbbServer } from "../entities/bbb-server.entity";

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
 * BBB 3.x uses SHA-256 for API checksums:
 *   checksum = SHA256(methodName + queryString + apiSecret)
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

  private async callApi(url: string): Promise<Record<string, unknown>> {
    // 1. Add an explicit AbortController to fail fast
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second hard timeout (increased from 4s)

    try {
      const res = await fetch(url, { signal: controller.signal });
      if (!res.ok) {
        throw new Error(`BBB API HTTP error ${res.status}: ${url}`);
      }
      const xml = await res.text();
      const parsed = await parseStringPromise(xml, { explicitArray: false });
      const response = parsed?.response;

      if (!response) {
        throw new Error(
          `BBB API returned unexpected XML: ${xml.substring(0, 200)}`,
        );
      }
      if (response.returncode !== "SUCCESS") {
        throw new Error(
          `BBB API error [${response.messageKey}]: ${response.message}`,
        );
      }
      return response;
    } catch (err: any) {
      if (err.name === "AbortError") {
        throw new Error(
          `BBB API connection timed out after 10 seconds. Server unreachable: ${url}`,
        );
      }
      throw err;
    } finally {
      clearTimeout(timeoutId);
    }
  }
  private decryptSecret(server: BbbServer): string {
    return this.encryptionService.decrypt(server.encryptedApiSecret);
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
        const response = await this.callApi(url);
        span.setStatus({ code: SpanStatusCode.OK });
        return {
          internalMeetingID: response.internalMeetingID as string,
          meetingID: response.meetingID as string,
        };
      } catch (err) {
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: (err as Error).message,
        });
        span.recordException(err as Error);
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

  async isMeetingRunning(
    server: BbbServer,
    meetingID: string,
  ): Promise<boolean> {
    const secret = this.decryptSecret(server);
    const params = { meetingID };
    const url = this.buildApiUrl(server, secret, "isMeetingRunning", params);
    try {
      const response = await this.callApi(url);
      return response.running === "true";
    } catch {
      return false;
    }
  }

  async getMeetingInfo(
    server: BbbServer,
    meetingID: string,
  ): Promise<BbbMeetingInfo | null> {
    const tracer = trace.getTracer("bbb-api");
    return tracer.startActiveSpan("bbb.getMeetingInfo", async (span) => {
      span.setAttribute("bbb.server", server.apiUrl);
      span.setAttribute("bbb.meetingId", meetingID);
      try {
        const secret = this.decryptSecret(server);
        const params = { meetingID };
        const url = this.buildApiUrl(server, secret, "getMeetingInfo", params);
        const response = await this.callApi(url);
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
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: (err as Error).message ?? "getMeetingInfo failed",
        });
        span.recordException(err as Error);
        return null;
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
        await this.callApi(url);
        span.setStatus({ code: SpanStatusCode.OK });
        Logger.info(`Meeting ended: ${meetingID}`, loggerCtx);
      } catch (err) {
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: (err as Error).message,
        });
        span.recordException(err as Error);
        throw err;
      } finally {
        span.end();
      }
    });
  }

  async getRecordings(
    server: BbbServer,
    meetingID?: string,
  ): Promise<BbbRecording[]> {
    const secret = this.decryptSecret(server);
    const params: Record<string, string> = {};
    if (meetingID) params.meetingID = meetingID;
    const url = this.buildApiUrl(server, secret, "getRecordings", params);
    try {
      const response = await this.callApi(url);
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
    } catch (err) {
      Logger.warn(`getRecordings failed: ${(err as Error).message}`, loggerCtx);
      return [];
    }
  }
}
