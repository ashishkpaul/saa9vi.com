import { Injectable, Logger } from "@nestjs/common";
import { RequestContext } from "@vendure/core";
import { BbbMeeting } from "../entities/bbb-meeting.entity";
import { BbbServer } from "../entities/bbb-server.entity";
import { BbbApiService, BbbNotFoundError } from "./bbb-api.service";
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
   * W1: `getMeetingInfo` now throws — only `BbbNotFoundError` means gone.
   * Unavailable/Rejected (outage, checksum) rethrows so the caller can fail
   * the join loudly instead of issuing a URL for a dead meeting.
   * Sends the moderator password: BBB requires it on getMeetingInfo.
   */
  async validateMeetingExistsOnBbb(
    server: BbbServer,
    meeting: BbbMeeting,
  ): Promise<boolean> {
    if (!meeting.bbbMeetingId) {
      return false;
    }

    let moderatorPW: string | undefined;
    if (meeting.encryptedModeratorPassword) {
      try {
        moderatorPW = this.encryptionService.decrypt(
          meeting.encryptedModeratorPassword,
        );
      } catch {
        moderatorPW = undefined;
      }
    }

    try {
      await this.bbbApiService.getMeetingInfo(
        server,
        meeting.bbbMeetingId,
        moderatorPW,
      );
      return true;
    } catch (err: any) {
      if (err instanceof BbbNotFoundError) {
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
