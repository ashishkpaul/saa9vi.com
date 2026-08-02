import { Injectable } from "@nestjs/common";
import {
  ForbiddenError,
  ID,
  Permission,
  RequestContext,
  TransactionalConnection,
} from "@vendure/core";
import { BbbOrganization } from "../entities/bbb-organization.entity";
import { BbbRoom } from "../entities/bbb-room.entity";
import { BbbMeeting } from "../entities/bbb-meeting.entity";
import { BbbScheduledSession } from "../entities/bbb-scheduled-session.entity";
import { BbbEntitlement } from "../entities/bbb-entitlement.entity";
import { BbbCapacityGrant } from "../entities/bbb-capacity-grant.entity";
import { BbbEnrollment } from "../entities/bbb-enrollment.entity";
import { BbbOrganizationMember } from "../entities/bbb-organization-member.entity";
import { BbbOrganizationMembership } from "../entities/bbb-organization-membership.entity";
import { BbbProductAccess } from "../entities/bbb-product-access.entity";
import { BbbTrialRegistration } from "../entities/trial-registration.entity";

/**
 * Centralized channel-ownership guard for all BBB entities.
 *
 * Enforces the invariant:
 *
 *   "A tenant administrator operating under channel X must never
 *    read or mutate BBB resources whose owning organization
 *    does not belong to channel X."
 *
 * The validation chain follows the domain model:
 *
 *   Channel
 *      ↓
 *   BbbOrganization (channelId scalar + channels join table)
 *      ↓
 *   BbbRoom / BbbMeeting / BbbScheduledSession (via organizationId)
 *
 * For entities that carry a scalar channelId (BbbEntitlement, BbbScheduledSession),
 * the check is a direct scalar comparison.
 *
 * For entities that are organization-owned (BbbRoom, BbbMeeting, BbbOrganizationMember,
 * BbbOrganizationMembership, BbbEnrollment, BbbProductAccess, BbbTrialRegistration),
 * the check resolves through the organization.
 *
 * SuperAdmin users bypass all checks.
 */
@Injectable()
export class BbbChannelAccessService {
  constructor(private readonly connection: TransactionalConnection) {}

  /**
   * Check if the active user has SuperAdmin privileges.
   * SuperAdmin users bypass all channel ownership checks.
   */
  private isSuperAdmin(ctx: RequestContext): boolean {
    return ctx.userHasPermissions([Permission.SuperAdmin]);
  }

  /**
   * Assert that the active user can access the given organization.
   * BbbOrganization is ChannelAware — check channelId directly.
   */
  async assertOrganizationAccess(
    ctx: RequestContext,
    organizationId: ID,
  ): Promise<BbbOrganization | undefined> {
    if (this.isSuperAdmin(ctx)) return undefined;

    const channelId = ctx.channelId as string;
    const org = await this.connection
      .getRepository(ctx, BbbOrganization)
      .findOne({
        where: { id: organizationId as string },
        relations: ["channels"],
      });

    if (!org) {
      throw new ForbiddenError();
    }

    // Check via channels join table (ChannelAware pattern)
    const hasChannel = org.channels?.some(
      (ch) => (ch.id as string) === channelId,
    );

    if (!hasChannel && org.channelId !== channelId) {
      throw new ForbiddenError();
    }

    return org;
  }

  /**
   * Assert that the active user can access the given room.
   * BbbRoom is organization-owned — resolve through organization.
   */
  async assertRoomAccess(
    ctx: RequestContext,
    roomId: ID,
  ): Promise<BbbRoom | undefined> {
    if (this.isSuperAdmin(ctx)) return undefined;

    const channelId = ctx.channelId as string;
    const room = await this.connection
      .getRepository(ctx, BbbRoom)
      .findOne({
        where: { id: roomId as string },
        relations: ["organization"],
      });

    if (!room) {
      throw new ForbiddenError();
    }

    // Resolve through organization
    if (room.organization) {
      if (room.organization.channelId !== channelId) {
        throw new ForbiddenError();
      }
    } else {
      // Fallback: query organization directly
      const org = await this.connection
        .getRepository(ctx, BbbOrganization)
        .findOne({
          where: { id: (room as any).organizationId as string },
        });
      if (!org || org.channelId !== channelId) {
        throw new ForbiddenError();
      }
    }

    return room;
  }

  /**
   * Assert that the active user can access the given meeting.
   * BbbMeeting is organization-owned — resolve through organization.
   */
  async assertMeetingAccess(
    ctx: RequestContext,
    meetingId: ID,
  ): Promise<BbbMeeting | undefined> {
    if (this.isSuperAdmin(ctx)) return undefined;

    const channelId = ctx.channelId as string;
    const meeting = await this.connection
      .getRepository(ctx, BbbMeeting)
      .findOne({
        where: { id: meetingId as string },
        relations: ["organization"],
      });

    if (!meeting) {
      throw new ForbiddenError();
    }

    if (meeting.organization) {
      if (meeting.organization.channelId !== channelId) {
        throw new ForbiddenError();
      }
    } else {
      const org = await this.connection
        .getRepository(ctx, BbbOrganization)
        .findOne({
          where: { id: (meeting as any).organizationId as string },
        });
      if (!org || org.channelId !== channelId) {
        throw new ForbiddenError();
      }
    }

    return meeting;
  }

  /**
   * Assert that the active user can access the given scheduled session.
   * BbbScheduledSession has a denormalized channelId — check directly.
   */
  async assertSessionAccess(
    ctx: RequestContext,
    sessionId: ID,
  ): Promise<BbbScheduledSession | undefined> {
    if (this.isSuperAdmin(ctx)) return undefined;

    const channelId = ctx.channelId as string;
    const session = await this.connection
      .getRepository(ctx, BbbScheduledSession)
      .findOne({
        where: { id: sessionId as string },
        relations: ["organization"],
      });

    if (!session) {
      throw new ForbiddenError();
    }

    // Check via denormalized channelId first, then organization
    if (session.channelId && session.channelId !== channelId) {
      throw new ForbiddenError();
    }

    if (session.organization && session.organization.channelId !== channelId) {
      throw new ForbiddenError();
    }

    return session;
  }

  /**
   * Assert that the active user can access the given entitlement.
   * BbbEntitlement has a scalar channelId (DL-011 exception) — check directly.
   */
  async assertEntitlementAccess(
    ctx: RequestContext,
    entitlementId: ID,
  ): Promise<BbbEntitlement | undefined> {
    if (this.isSuperAdmin(ctx)) return undefined;

    const channelId = ctx.channelId as string;
    const entitlement = await this.connection
      .getRepository(ctx, BbbEntitlement)
      .findOne({
        where: { id: entitlementId as string },
      });

    if (!entitlement) {
      throw new ForbiddenError();
    }

    if (entitlement.channelId && entitlement.channelId !== channelId) {
      throw new ForbiddenError();
    }

    return entitlement;
  }

  /**
   * Assert that the active user can access the given capacity grant.
   * BbbCapacityGrant is organization-owned — resolve through organization.
   */
  async assertCapacityGrantAccess(
    ctx: RequestContext,
    grantId: ID,
  ): Promise<BbbCapacityGrant | undefined> {
    if (this.isSuperAdmin(ctx)) return undefined;

    const channelId = ctx.channelId as string;
    const grant = await this.connection
      .getRepository(ctx, BbbCapacityGrant)
      .findOne({
        where: { id: grantId as string },
        relations: ["organization"],
      });

    if (!grant) {
      throw new ForbiddenError();
    }

    if (grant.organization) {
      if (grant.organization.channelId !== channelId) {
        throw new ForbiddenError();
      }
    } else {
      const org = await this.connection
        .getRepository(ctx, BbbOrganization)
        .findOne({
          where: { id: (grant as any).organizationId as string },
        });
      if (!org || org.channelId !== channelId) {
        throw new ForbiddenError();
      }
    }

    return grant;
  }

  /**
   * Assert that the active user can access the given enrollment.
   * BbbEnrollment is room-owned — resolve through room → organization.
   */
  async assertEnrollmentAccess(
    ctx: RequestContext,
    enrollmentId: ID,
  ): Promise<BbbEnrollment | undefined> {
    if (this.isSuperAdmin(ctx)) return undefined;

    const channelId = ctx.channelId as string;
    const enrollment = await this.connection
      .getRepository(ctx, BbbEnrollment)
      .findOne({
        where: { id: enrollmentId as string },
        relations: ["room", "room.organization"],
      });

    if (!enrollment) {
      throw new ForbiddenError();
    }

    const org = enrollment.room?.organization;
    if (org) {
      if (org.channelId !== channelId) {
        throw new ForbiddenError();
      }
    } else {
      // Fallback: query room → organization
      const room = await this.connection
        .getRepository(ctx, BbbRoom)
        .findOne({
          where: { id: (enrollment as any).roomId as string },
          relations: ["organization"],
        });
      if (!room?.organization || room.organization.channelId !== channelId) {
        throw new ForbiddenError();
      }
    }

    return enrollment;
  }

  /**
   * Assert that the active user can access the given organization member.
   * BbbOrganizationMember is organization-owned — resolve through organization.
   */
  async assertMemberAccess(
    ctx: RequestContext,
    memberId: ID,
  ): Promise<BbbOrganizationMember | undefined> {
    if (this.isSuperAdmin(ctx)) return undefined;

    const channelId = ctx.channelId as string;
    const member = await this.connection
      .getRepository(ctx, BbbOrganizationMember)
      .findOne({
        where: { id: memberId as string },
        relations: ["organization"],
      });

    if (!member) {
      throw new ForbiddenError();
    }

    if (member.organization) {
      if (member.organization.channelId !== channelId) {
        throw new ForbiddenError();
      }
    } else {
      const org = await this.connection
        .getRepository(ctx, BbbOrganization)
        .findOne({
          where: { id: (member as any).organizationId as string },
        });
      if (!org || org.channelId !== channelId) {
        throw new ForbiddenError();
      }
    }

    return member;
  }

  /**
   * Assert that the active user can access the given organization membership.
   * BbbOrganizationMembership has a scalar channelId (DL-017 exception) — check directly.
   */
  async assertMembershipAccess(
    ctx: RequestContext,
    membershipId: ID,
  ): Promise<BbbOrganizationMembership | undefined> {
    if (this.isSuperAdmin(ctx)) return undefined;

    const channelId = ctx.channelId as string;
    const membership = await this.connection
      .getRepository(ctx, BbbOrganizationMembership)
      .findOne({
        where: { id: membershipId as string },
      });

    if (!membership) {
      throw new ForbiddenError();
    }

    if (membership.channelId !== channelId) {
      throw new ForbiddenError();
    }

    return membership;
  }

  /**
   * Assert that the active user can access the given product access record.
   * BbbProductAccess is room-owned — resolve through room → organization.
   */
  async assertProductAccessAccess(
    ctx: RequestContext,
    productAccessId: ID,
  ): Promise<BbbProductAccess | undefined> {
    if (this.isSuperAdmin(ctx)) return undefined;

    const channelId = ctx.channelId as string;
    const productAccess = await this.connection
      .getRepository(ctx, BbbProductAccess)
      .findOne({
        where: { id: productAccessId as string },
        relations: ["room", "room.organization"],
      });

    if (!productAccess) {
      throw new ForbiddenError();
    }

    const org = productAccess.room?.organization;
    if (org) {
      if (org.channelId !== channelId) {
        throw new ForbiddenError();
      }
    } else {
      const room = await this.connection
        .getRepository(ctx, BbbRoom)
        .findOne({
          where: { id: (productAccess as any).roomId as string },
          relations: ["organization"],
        });
      if (!room?.organization || room.organization.channelId !== channelId) {
        throw new ForbiddenError();
      }
    }

    return productAccess;
  }

  /**
   * Assert that the active user can access the given trial registration.
   * BbbTrialRegistration is session-owned — resolve through session → organization.
   */
  async assertTrialRegistrationAccess(
    ctx: RequestContext,
    trialId: ID,
  ): Promise<BbbTrialRegistration | undefined> {
    if (this.isSuperAdmin(ctx)) return undefined;

    const channelId = ctx.channelId as string;
    const trial = await this.connection
      .getRepository(ctx, BbbTrialRegistration)
      .findOne({
        where: { id: trialId as string },
        relations: ["scheduledSession", "scheduledSession.organization"],
      });

    if (!trial) {
      throw new ForbiddenError();
    }

    const org = trial.scheduledSession?.organization;
    if (org) {
      if (org.channelId !== channelId) {
        throw new ForbiddenError();
      }
    } else {
      const session = await this.connection
        .getRepository(ctx, BbbScheduledSession)
        .findOne({
          where: { id: (trial as any).scheduledSessionId as string },
          relations: ["organization"],
        });
      if (
        !session?.organization ||
        session.organization.channelId !== channelId
      ) {
        throw new ForbiddenError();
      }
    }


    return trial;
  }
}
