import { Injectable, Logger } from "@nestjs/common";
import { ConfigService, ID, RequestContext, TransactionalConnection } from "@vendure/core";
import { InstructorProfile } from "../entities/instructor-profile.entity";
import { TenantLearnerMembershipService } from "./tenant-learner-membership.service";
import { decodeEntityId } from "../../../platform/id-utils";

const loggerCtx = "TenantDeletionService";

/**
 * Handles customer data cleanup for the Tenant plugin.
 *
 * Called by CustomerDeletionService during Flow A (leave_channel) and
 * Flow B (full_delete). Anonymizes instructor profiles rather than
 * deleting them — slugs are preserved for URL integrity.
 *
 * C-03: also transitions TenantLearnerMembership status through
 * TenantLearnerMembershipService (single writer — never writes the entity
 * directly). Both flows are idempotent: terminal-state rows are skipped.
 */
@Injectable()
export class TenantDeletionService {
  constructor(
    private readonly connection: TransactionalConnection,
    private readonly configService: ConfigService,
    private readonly membershipService: TenantLearnerMembershipService,
  ) {}

  /** Decode GraphQL-encoded id to the raw PK string stored in varchar columns. */
  private rawId(id: ID): string {
    return decodeEntityId(id, this.configService);
  }

  /**
   * Flow A — Remove the customer from a single channel.
   * Anonymizes instructor profiles and transitions membership to LEFT.
   */
  async removeFromChannel(
    ctx: RequestContext,
    customerId: ID,
    channelId: string,
  ): Promise<void> {
    Logger.log(
      `Tenant: Anonymizing instructor profiles for customer ${customerId} in channel ${channelId}`,
      loggerCtx,
    );

    const profiles = await this.connection
      .getRepository(ctx, InstructorProfile)
      .find({ where: { customerId: this.rawId(customerId), channelId: Number(channelId) } });

    for (const profile of profiles) {
      profile.fullName = "[deleted]";
      profile.bio = null as any;
      profile.photoAssetId = null as any;
      profile.isActive = false;
      await this.connection.getRepository(ctx, InstructorProfile).save(profile);
    }

    // C-03: transition membership to LEFT via the admission service so the
    // single-writer rule is preserved and the log is appended.
    await this.membershipService.leaveAcademy(ctx, customerId, channelId);
  }

  /**
   * Flow B — Permanently remove the customer from the entire platform.
   * Anonymizes instructor profiles across all channels and revokes all memberships.
   */
  async fullDelete(
    ctx: RequestContext,
    customerId: ID,
  ): Promise<void> {
    Logger.log(
      `Tenant: Anonymizing instructor profiles for customer ${customerId} across all channels`,
      loggerCtx,
    );

    const profiles = await this.connection
      .getRepository(ctx, InstructorProfile)
      .find({ where: { customerId: this.rawId(customerId) } });

    for (const profile of profiles) {
      profile.fullName = "[deleted]";
      profile.bio = null as any;
      profile.photoAssetId = null as any;
      profile.isActive = false;
      await this.connection.getRepository(ctx, InstructorProfile).save(profile);
    }

    // C-03: revoke all memberships across all channels via the admission
    // service. revoke() is idempotent — already-REVOKED rows are skipped.
    const memberships = await this.membershipService.findByCustomer(ctx, customerId);
    for (const m of memberships) {
      await this.membershipService.revoke(ctx, customerId, m.channelId, null, 'account-deleted');
    }
  }
}
