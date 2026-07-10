import { Injectable, Logger } from "@nestjs/common";
import { ID, RequestContext, TransactionalConnection } from "@vendure/core";
import { In } from "typeorm";
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
  constructor(private readonly connection: TransactionalConnection) {}

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

    // 1. Deactivate entitlements in this channel
    await this.connection.getRepository(ctx, BbbEntitlement).update(
      { customerId: String(customerId), channelId },
      { validUntil: new Date() },
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
          { customerId: String(customerId), roomId: In(roomIds) },
          { active: false },
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
        { customerId: String(customerId), scheduledSessionId: In(sessionIds) },
        { status: "CANCELLED" as any },
      );
    }

    // 4. Deactivate org memberships in this channel
    for (const org of orgs) {
      await this.connection.getRepository(ctx, BbbOrganizationMember).update(
        { customerId: String(customerId), organization: { id: org.id as string } },
        { active: false },
      );

      await this.connection.getRepository(ctx, BbbOrganizationMembership).update(
        { customerId: String(customerId), organizationId: org.id as string },
        { isActive: false },
      );
    }

    // 5. Delete instructor assignments (resolved via InstructorProfile)
    const instructorProfiles = await this.connection
      .getRepository(ctx, InstructorProfile)
      .find({ where: { customerId: String(customerId), channelId } });

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

    // 1. Deactivate all entitlements
    await this.connection.getRepository(ctx, BbbEntitlement).update(
      { customerId: String(customerId) },
      { validUntil: new Date() },
    );

    // 2. Deactivate all enrollments
    await this.connection.getRepository(ctx, BbbEnrollment).update(
      { customerId: String(customerId) },
      { active: false },
    );

    // 3. Cancel all trial registrations
    await this.connection.getRepository(ctx, BbbTrialRegistration).update(
      { customerId: String(customerId) },
      { status: "CANCELLED" as any },
    );

    // 4. Deactivate all org memberships
    await this.connection.getRepository(ctx, BbbOrganizationMember).update(
      { customerId: String(customerId) },
      { active: false },
    );

    await this.connection.getRepository(ctx, BbbOrganizationMembership).update(
      { customerId: String(customerId) },
      { isActive: false },
    );

    // 5. Delete instructor assignments across all channels
    const instructorProfiles = await this.connection
      .getRepository(ctx, InstructorProfile)
      .find({ where: { customerId: String(customerId) } });

    for (const profile of instructorProfiles) {
      await this.connection.getRepository(ctx, BbbInstructorAssignment).delete({
        instructorProfileId: profile.id as string,
      });
    }
  }
}
