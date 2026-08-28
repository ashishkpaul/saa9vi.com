import { Injectable, Logger } from "@nestjs/common";
import { RequestContext } from "@vendure/core";
import { BbbMeeting } from "../entities/bbb-meeting.entity";
import { BbbServer } from "../entities/bbb-server.entity";
import { BbbApiService } from "./bbb-api.service";
import { BbbEncryptionService } from "./bbb-encryption.service";

const loggerCtx = "BbbJoinUrlService";

export interface JoinUrlOptions {
  participantName: string;
  role?: "MODERATOR" | "VIEWER";
  userID?: string;
  avatarURL?: string;
  clientURL?: string;
  createTime?: number;
}

/**
 * Responsible for decrypting passwords, validating meeting liveness on BBB,
 * and building secure signed BBB Join URLs.
 */
@Injectable()
export class BbbJoinUrlService {
  constructor(
    private readonly bbbApiService: BbbApiService,
    private readonly encryptionService: BbbEncryptionService,
  ) {}

  /**
   * Validates that a meeting still exists on BBB before returning a join URL.
   */
  async validateMeetingExistsOnBbb(
    server: BbbServer,
    meeting: BbbMeeting,
  ): Promise<boolean> {
    if (!meeting.bbbMeetingId) {
      return false;
    }

    try {
      const info = await this.bbbApiService.getMeetingInfo(
        server,
        meeting.bbbMeetingId,
      );
      return info !== null;
    } catch (err: any) {
      if (
        err.message?.includes("[notFound]") ||
        err.message?.includes("notFound") ||
        ((err.response as any)?.returncode === "FAILED" &&
          (err.response as any)?.messageKey === "notFound")
      ) {
        return false;
      }
      throw err;
    }
  }

  /**
   * Generates a signed join URL for a participant with role-based password decryption.
   */
  buildJoinUrl(
    server: BbbServer,
    meeting: BbbMeeting,
    options: JoinUrlOptions,
  ): string {
    const role = options.role ?? "VIEWER";
    let password = "";

    if (role === "MODERATOR") {
      if (!meeting.encryptedModeratorPassword) {
        throw new Error("Encrypted moderator password not available on meeting record");
      }
      password = this.encryptionService.decrypt(meeting.encryptedModeratorPassword);
    } else {
      if (!meeting.encryptedAttendeePassword) {
        throw new Error("Encrypted attendee password not available on meeting record");
      }
      password = this.encryptionService.decrypt(meeting.encryptedAttendeePassword);
    }

    return this.bbbApiService.buildJoinUrl(server, {
      meetingID: meeting.bbbMeetingId,
      fullName: options.participantName,
      password,
      userID: options.userID,
      createTime: options.createTime,
    });
  }
}
