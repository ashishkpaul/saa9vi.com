import { Injectable, Logger } from "@nestjs/common";
import { ConfigService, ID, RequestContext, TransactionalConnection } from "@vendure/core";
import { In, IsNull } from "typeorm";
import { BbbEntitlement } from "../entities/bbb-entitlement.entity";
import { BbbEnrollment } from "../entities/bbb-enrollment.entity";
import { BbbTrialRegistration } from "../entities/trial-registration.entity";
import { BbbOrganizationMember } from "../entities/bbb-organization-member.entity";
import { BbbOrganizationMembership } from "../entities/bbb-organization-membership.entity";
import { BbbInstructorAssignment } from "../entities/instructor-assignment.entity";
import { BbbOrganization } from "../entities/bbb-organization.entity";
import { BbbRoom } from "../entities/bbb-room.entity";
import { BbbScheduledSession } from "../entities/bbb-scheduled-session.entity";
import { InstructorProfile } from "../../tenant-plugin/entities/instructor-profile.entity";

const loggerCtx = "BbbDeletionService";

/**
 * Handles customer data cleanup for the BigBlueButton plugin.
 *
 * Called by CustomerDeletionService during Flow A (leave_channel) and
 * Flow B (full_delete). All operations respect INV-013: no hard deletes
 * of financial/audit data; immutable ledgers are never touched.
 */
@Injectable()
export class BbbDeletionService {
  constructor(
    private readonly connection: TransactionalConnection,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Decode a GraphQL-facing id to the raw PK string stored in varchar columns.
   *
   * In production (AutoIncrementIdStrategy) encodeId/decodeId are identity
   * functions, so this.rawId(customerId) = the stored value. In the e2e test
   * environment (TestingEntityIdStrategy) ctx.customerId arrives as "T_3"
   * while all BBB columns store the decoded form "3" — the decode call
   * normalises both environments to the same stored value.
   */
  private rawId(id: ID): string {
    const decoded = this.configService.entityIdStrategy.decodeId(String(id));
    return decoded === -1 ? String(id) : String(decoded);
  }

  /**
   * W5 audit trail: stamp for deactivation writes — who (request user, null
   * for system/erasure context) and when. The caller passes one `now` so the
   * expiry instant (`validUntil`) and `deactivatedAt` always agree.
   */
  private deactivationAudit(ctx: RequestContext, now: Date) {
    return {
      deactivatedByUserId:
        ctx.activeUserId != null ? String(ctx.activeUserId) : null,
      deactivatedAt: now,
    };
  }

  // ─── Flow A: Channel-scoped ───────────────────────────────────────────────

  /**
   * Remove customer data scoped to a single channel.
   */
  async removeFromChannel(
    ctx: RequestContext,
    customerId: ID,
    channelId: string,
  ): Promise<void> {
    Logger.log(
      `BBB: Removing customer ${customerId} from channel ${channelId}`,
      loggerCtx,
    );

    // 1. Deactivate entitlements in this channel (W5: stamped, not just expired)
    //    Multi-row safe (revoke→re-grant keeps old rows): one UPDATE per scope.
    //    First-writer-wins on the stamps — an earlier admin revoker is never
    //    overwritten by a later erasure/system stamp.
    const now = new Date();
    await this.connection.getRepository(ctx, BbbEntitlement).update(
      { customerId: this.rawId(customerId), channelId, deactivatedByUserId: IsNull() as any },
      { ...this.deactivationAudit(ctx, now) },
    );
    await this.connection.getRepository(ctx, BbbEntitlement).update(
      { customerId: this.rawId(customerId), channelId },
      { validUntil: now },
    );

    // 2. Deactivate enrollments via room → organization → channel
    const orgs = await this.connection
      .getRepository(ctx, BbbOrganization)
      .find({ where: { channelId } });

    for (const org of orgs) {
      const rooms = await this.connection
        .getRepository(ctx, BbbRoom)
        .find({ where: { organization: { id: org.id as string } } });

      if (rooms.length > 0) {
        const roomIds = rooms.map((r) => r.id as string);
        await this.connection.getRepository(ctx, BbbEnrollment).update(
          { customerId: this.rawId(customerId), roomId: In(roomIds) },
          { active: false, ...this.deactivationAudit(ctx, now) },
        );
      }
    }

    // 3. Cancel trial registrations for sessions in this channel
    const sessions = await this.connection
      .getRepository(ctx, BbbScheduledSession)
      .find({ where: { organization: { id: In(orgs.map((o) => o.id as string)) } } });

    if (sessions.length > 0) {
      const sessionIds = sessions.map((s) => s.id as string);
      await this.connection.getRepository(ctx, BbbTrialRegistration).update(
        { customerId: this.rawId(customerId), scheduledSessionId: In(sessionIds) },
        { status: "CANCELLED" as any },
      );
    }

    // 4. Deactivate org memberships in this channel
    for (const org of orgs) {
      await this.connection.getRepository(ctx, BbbOrganizationMember).update(
        { customerId: this.rawId(customerId), organization: { id: org.id as string } },
        { active: false },
      );

      await this.connection.getRepository(ctx, BbbOrganizationMembership).update(
        { customerId: this.rawId(customerId), organizationId: org.id as string },
        { isActive: false },
      );
    }

    // 5. Delete instructor assignments (resolved via InstructorProfile)
    const instructorProfiles = await this.connection
      .getRepository(ctx, InstructorProfile)
      .find({ where: { customerId: this.rawId(customerId), channelId: Number(channelId) } });

    for (const profile of instructorProfiles) {
      await this.connection.getRepository(ctx, BbbInstructorAssignment).delete({
        instructorProfileId: profile.id as string,
      });
    }
  }

  // ─── Flow B: Full platform deletion ───────────────────────────────────────

  /**
   * Remove customer data across all channels.
   */
  async fullDelete(
    ctx: RequestContext,
    customerId: ID,
  ): Promise<void> {
    Logger.log(
      `BBB: Full deletion of customer ${customerId}`,
      loggerCtx,
    );

    // 1. Deactivate all entitlements (W5: stamped, not just expired).
    //    Same two-step as removeFromChannel: stamp ONLY unstamped rows
    //    (first-writer-wins — a system erasure never overwrites an admin's
    //    revoker), then expire every row.
    const now = new Date();
    await this.connection.getRepository(ctx, BbbEntitlement).update(
      { customerId: this.rawId(customerId), deactivatedByUserId: IsNull() as any },
      { ...this.deactivationAudit(ctx, now) },
    );
    await this.connection.getRepository(ctx, BbbEntitlement).update(
      { customerId: this.rawId(customerId) },
      { validUntil: now },
    );

    // 2. Deactivate all enrollments
    await this.connection.getRepository(ctx, BbbEnrollment).update(
      { customerId: this.rawId(customerId) },
      { active: false, ...this.deactivationAudit(ctx, now) },
    );

    // 3. Cancel all trial registrations
    await this.connection.getRepository(ctx, BbbTrialRegistration).update(
      { customerId: this.rawId(customerId) },
      { status: "CANCELLED" as any },
    );

    // 4. Deactivate all org memberships
    await this.connection.getRepository(ctx, BbbOrganizationMember).update(
      { customerId: this.rawId(customerId) },
      { active: false },
    );

    await this.connection.getRepository(ctx, BbbOrganizationMembership).update(
      { customerId: this.rawId(customerId) },
      { isActive: false },
    );

    // 5. Delete instructor assignments across all channels
    const instructorProfiles = await this.connection
      .getRepository(ctx, InstructorProfile)
      .find({ where: { customerId: this.rawId(customerId) } });

    for (const profile of instructorProfiles) {
      await this.connection.getRepository(ctx, BbbInstructorAssignment).delete({
        instructorProfileId: profile.id as string,
      });
    }
  }
}
