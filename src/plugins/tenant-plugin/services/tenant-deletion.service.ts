import { Injectable, Logger } from "@nestjs/common";
import { ConfigService, ID, RequestContext, TransactionalConnection } from "@vendure/core";
import { InstructorProfile } from "../entities/instructor-profile.entity";

const loggerCtx = "TenantDeletionService";

/**
 * Handles customer data cleanup for the Tenant plugin.
 *
 * Called by CustomerDeletionService during Flow A (leave_channel) and
 * Flow B (full_delete). Anonymizes instructor profiles rather than
 * deleting them — slugs are preserved for URL integrity.
 */
@Injectable()
export class TenantDeletionService {
  constructor(
    private readonly connection: TransactionalConnection,
    private readonly configService: ConfigService,
  ) {}

  /** Decode GraphQL-encoded id to the raw PK string stored in varchar columns. */
  private rawId(id: ID): string {
    const decoded = this.configService.entityIdStrategy.decodeId(String(id));
    return decoded === -1 ? String(id) : String(decoded);
  }

  /**
   * Anonymize instructor profiles for this customer in a single channel.
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
  }

  /**
   * Anonymize instructor profiles for this customer across all channels.
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
  }
}
