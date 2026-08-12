// src/plugins/bigbluebutton-plugin/api/bbb-shop.resolver.ts
// Membership‑first authorization + role‑based join URL routing.
// Implements M6, S1, and S4 in one pass.

import { Args, Mutation, Query, Resolver } from "@nestjs/graphql";
import { In } from "typeorm";
import {
  Allow,
  AuthService,
  Ctx,
  ForbiddenError,
  Logger,
  Permission,
  RequestContext,
  TransactionalConnection,
} from "@vendure/core";
import { BbbMeetingService } from "../services/bbb-meeting.service";
import { BbbOrganizationService } from "../services/bbb-organization.service";
import { BbbRoomService } from "../services/bbb-room.service";
import { BbbMemberService } from "../services/bbb-member.service";
import { BbbScheduledSessionService } from "../services/bbb-scheduled-session.service";
import { TrialRegistrationService } from "../services/trial-registration.service";
import { LearningDashboardService } from "../services/learning-dashboard.service";
import { CustomerDeletionService } from "../../../platform/customer-deletion/customer-deletion.service";
import { BbbMeeting } from "../entities/bbb-meeting.entity";
import { BbbTrialRegistration } from "../entities/trial-registration.entity";
import { BbbScheduledSession } from "../entities/bbb-scheduled-session.entity";
import { BbbCapacityGrant } from "../entities/bbb-capacity-grant.entity";
import { BbbEnrollment } from "../entities/bbb-enrollment.entity";
import { BbbEntitlement } from "../entities/bbb-entitlement.entity";
import { BbbRoom } from "../entities/bbb-room.entity";
import { Customer } from "@vendure/core";

@Resolver()
export class BbbShopResolver {
  constructor(
    private readonly meetingService: BbbMeetingService,
    private readonly orgService: BbbOrganizationService,
    private readonly roomService: BbbRoomService,
    private readonly memberService: BbbMemberService,
    private readonly sessionService: BbbScheduledSessionService,
    private readonly connection: TransactionalConnection,
    private readonly trialRegistrationService: TrialRegistrationService,
    private readonly learningDashboardService: LearningDashboardService,
    private readonly customerDeletionService: CustomerDeletionService,
    private readonly authService: AuthService,
  ) {}

  @Query()
  @Allow(Permission.Authenticated)
  async myBbbMeetings(
    @Ctx() ctx: RequestContext,
    @Args("skip") skip?: number,
    @Args("take") take?: number,
  ): Promise<{ items: BbbMeeting[]; totalItems: number }> {
    if (!ctx.activeUserId) throw new ForbiddenError();
    const org = await this.orgService.findByChannelId(ctx);
    if (!org) return { items: [], totalItems: 0 };
    return this.meetingService.findAll(ctx, org.id, { skip, take });
  }

  @Query()
  @Allow(Permission.Authenticated)
  async myBbbCapacityGrants(
    @Ctx() ctx: RequestContext,
  ): Promise<BbbCapacityGrant[]> {
    if (!ctx.activeUserId) throw new ForbiddenError();
    const org = await this.orgService.findByChannelId(ctx);
    if (!org) return [];
    return this.connection.getRepository(ctx, BbbCapacityGrant).find({
      where: { organization: { id: org.id } },
      order: { createdAt: "DESC" },
    });
  }

  @Mutation()
  @Allow(Permission.Authenticated)
  async bbbJoinMeeting(
    @Ctx() ctx: RequestContext,
    @Args("meetingId") meetingId: string,
    @Args("participantName") participantName: string,
  ): Promise<string> {
    if (!ctx.activeUserId) throw new ForbiddenError();
    return this.meetingService.getJoinUrl(ctx, meetingId, participantName);
  }

  @Query()
  @Allow(Permission.Authenticated)
  async myBbbRooms(@Ctx() ctx: RequestContext) {
    if (!ctx.activeUserId) throw new ForbiddenError();
    const customer = await this.connection
      .getRepository(ctx, Customer)
      .findOne({ where: { user: { id: ctx.activeUserId as string } } });
    if (!customer) return [];

    const now = new Date();

    // Enrollment-based rooms (legacy storefront purchase path)
    const enrollments = await this.connection
      .getRepository(ctx, BbbEnrollment)
      .find({
        where: { customerId: customer.id as string, active: true },
        relations: ["room"],
      });
    const enrolledRoomIds = new Set(
      enrollments
        .filter((e) => {
          if (e.validUntil && e.validUntil < now) return false;
          if (!e.validUntil && e.expiresAt && e.expiresAt < now) return false;
          return true;
        })
        .map((e) => e.roomId),
    );

    // Entitlement-based rooms (current storefront purchase path — BUG-022)
    // BbbOrderFulfillmentListener writes BbbEntitlement { type: bbb_room }
    // for room purchases, so a paying customer's room must appear here.
    const entitlements = await this.connection
      .getRepository(ctx, BbbEntitlement)
      .find({
        where: {
          customerId: customer.id as string,
          type: "bbb_room",
        },
      });
    const entitlementRoomIds = new Set(
      entitlements
        .filter((e) => {
          if (e.validUntil && e.validUntil < now) return false;
          return true;
        })
        .map((e) => e.resourceId),
    );
    for (const id of entitlementRoomIds) enrolledRoomIds.add(id);

    // Membership-based rooms: staff only (TRAINER, ORG_ADMIN).
    // STUDENT membership is excluded — students access rooms via enrollment.
    const memberships = await this.memberService.findActiveByCustomer(
      ctx,
      customer.id,
    );
    const staffOrgIds = memberships
      .filter((m) => this.memberService.isModerator(m))
      .map((m) => m.organization?.id ?? (m as any).organizationId);

    const [enrolledRooms, memberRooms] = await Promise.all([
      enrolledRoomIds.size > 0
        ? this.connection
            .getRepository(ctx, BbbRoom)
            .findBy({ id: In([...enrolledRoomIds]) })
        : Promise.resolve([]),
      staffOrgIds.length > 0
        ? Promise.all(
            staffOrgIds.map((orgId) =>
              this.roomService.findByOrganization(ctx, orgId),
            ),
          ).then((r) => r.flat())
        : Promise.resolve([]),
    ]);

    // Merge, deduplicate by id
    const seen = new Set<string>();
    return [...enrolledRooms, ...memberRooms].filter((r) => {
      if (seen.has(r.id as string)) return false;
      seen.add(r.id as string);
      return true;
    });
  }

  @Query()
  @Allow(Permission.Authenticated)
  async bbbRoomStatus(@Ctx() ctx: RequestContext, @Args("id") id: string) {
    if (!ctx.activeUserId) throw new ForbiddenError();
    const customer = await this.connection
      .getRepository(ctx, Customer)
      .findOne({ where: { user: { id: ctx.activeUserId as string } } });
    if (!customer) throw new ForbiddenError();
    const room = await this.roomService.findById(ctx, id);
    if (!room) throw new ForbiddenError();

    // Allow access if customer has a valid enrollment, a valid entitlement,
    // or an org membership (BUG-022: also check BbbEntitlement).
    const now = new Date();
    let [enrollment, entitlement, member] = await Promise.all([
      this.connection.getRepository(ctx, BbbEnrollment).findOne({
        where: { roomId: id, customerId: customer.id as string, active: true },
      }),
      this.connection.getRepository(ctx, BbbEntitlement).findOne({
        where: {
          resourceId: id,
          customerId: customer.id as string,
          type: "bbb_room",
        },
      }),
      this.memberService.findActiveMembership(
        ctx,
        customer.id,
        room.organization.id,
      ),
    ]);
    if (enrollment?.expiresAt && enrollment.expiresAt < now) enrollment = null;
    const isExpired =
      (enrollment?.validUntil && enrollment.validUntil < now) ||
      (!enrollment?.validUntil && enrollment?.expiresAt && enrollment.expiresAt < now);
    if (isExpired) enrollment = null;
    if (entitlement?.validUntil && entitlement.validUntil < now) entitlement = null;
    if (!enrollment && !entitlement && !member) throw new ForbiddenError();

    return room;
  }

  @Mutation()
  @Allow(Permission.Authenticated)
  async bbbJoinRoom(
    @Ctx() ctx: RequestContext,
    @Args("roomId") roomId: string,
    @Args("participantName") participantName: string,
  ): Promise<{ status: string; joinUrl?: string }> {
    if (!ctx.activeUserId) throw new ForbiddenError();

    const customer = await this.connection
      .getRepository(ctx, Customer)
      .findOne({ where: { user: { id: ctx.activeUserId as string } } });
    if (!customer) throw new ForbiddenError();

    const room = await this.roomService.findById(ctx, roomId);
    if (!room) throw new ForbiddenError();

    // Membership check is enforced inside meetingService.joinRoom via
    // memberService.assertActiveMembership. No need to check it here too.
    const result = await this.meetingService.joinRoom(
      ctx,
      roomId,
      participantName,
      customer.id,
    );
    Logger.info(
      `[bbbJoinRoom] roomId=${roomId} customerId=${customer.id} status=${result.status} hasJoinUrl=${!!result.joinUrl} joinUrlPrefix=${result.joinUrl ? result.joinUrl.substring(0, 60) + "..." : "N/A"}`,
    );
    return result;
  }

  @Query()
  @Allow(Permission.Authenticated)
  async myBbbEnrollments(
    @Ctx() ctx: RequestContext,
  ): Promise<
    Array<{
      id: string;
      roomId: string;
      roomName: string;
      roomState: string;
      active: boolean;
      expiresAt: string | null;
      validFrom: string | null;
      validUntil: string | null;
    }>
  > {
    if (!ctx.activeUserId) throw new ForbiddenError();
    const customer = await this.connection
      .getRepository(ctx, Customer)
      .findOne({ where: { user: { id: ctx.activeUserId as string } } });
    if (!customer) return [];

    const enrollments = await this.connection
      .getRepository(ctx, BbbEnrollment)
      .find({
        where: { customerId: customer.id as string, active: true },
        relations: ["room"],
      });

    // BUG-022: also surface rooms purchased via BbbEntitlement (the current
    // storefront purchase path). Merge entitlement-based rooms into the list.
    const entitlements = await this.connection
      .getRepository(ctx, BbbEntitlement)
      .find({
        where: {
          customerId: customer.id as string,
          type: "bbb_room",
        },
        relations: ["room"],
      });

    const now = new Date();
    const enrollmentItems = enrollments
      .filter((e) => {
        if (e.validUntil && e.validUntil < now) return false;
        if (!e.validUntil && e.expiresAt && e.expiresAt < now) return false;
        return true;
      })
      .map((e) => ({
        id: e.id as string,
        roomId: e.roomId,
        roomName: e.room.name,
        roomState: e.room.state,
        active: e.active,
        expiresAt: e.expiresAt ? e.expiresAt.toISOString() : null,
        validFrom: e.validFrom ? e.validFrom.toISOString() : null,
        validUntil: e.validUntil ? e.validUntil.toISOString() : null,
      }));

    const entitlementItems = entitlements
      .filter((e) => {
        if (e.validUntil && e.validUntil < now) return false;
        return true;
      })
      .map((e) => ({
        id: e.id as string,
        roomId: e.resourceId,
        roomName: (e as any).room?.name ?? e.resourceId,
        roomState: (e as any).room?.state ?? "Idle",
        active: true,
        expiresAt: e.validUntil ? e.validUntil.toISOString() : null,
        validFrom: e.validFrom ? e.validFrom.toISOString() : null,
        validUntil: e.validUntil ? e.validUntil.toISOString() : null,
      }));

    // Deduplicate by roomId, preferring the enrollment entry.
    const seen = new Set<string>();
    return [...enrollmentItems, ...entitlementItems].filter((item) => {
      if (seen.has(item.roomId)) return false;
      seen.add(item.roomId);
      return true;
    });
  }

  // ─── Scheduled Sessions ──────────────────────────────────────────────────

  @Query()
  @Allow(Permission.Authenticated)
  async myScheduledSessions(@Ctx() ctx: RequestContext): Promise<
    Array<{
      id: string;
      title: string;
      startTime: string;
      endTime: string;
      status: string;
      trainerName: string | null;
      activeMeetingId: string | null;
      joinUrl: string | null;
    }>
  > {
    if (!ctx.activeUserId) throw new ForbiddenError();
    const sessions = await this.sessionService.findMySessions(ctx);

    // Pre-resolve current customer once, not per-session
    const currentCustomer = ctx.activeUserId
      ? await this.connection.getRepository(ctx, Customer).findOne({
          where: { user: { id: ctx.activeUserId as string } },
        })
      : null;

    return Promise.all(
      sessions.map(async (session) => {
        let joinUrl: string | null = null;
        let trainerName: string | null = null;

        // Resolve actual trainer name from Customer entity via customerId
        if (session.trainer) {
          const trainerCustomer = await this.connection
            .getRepository(ctx, Customer)
            .findOne({ where: { id: session.trainer.customerId } });
          if (trainerCustomer) {
            trainerName =
              [trainerCustomer.firstName, trainerCustomer.lastName]
                .filter(Boolean)
                .join(" ") || "Trainer";
          }
        }

        // If LIVE, generate a join URL using the active meeting
        if (
          session.status === "LIVE" &&
          session.activeMeeting &&
          currentCustomer
        ) {
          try {
            const name =
              [currentCustomer.firstName, currentCustomer.lastName]
                .filter(Boolean)
                .join(" ") || "Participant";
            joinUrl = await this.meetingService.getJoinUrl(
              ctx,
              session.activeMeeting.id,
              name,
            );
          } catch {
            // Best-effort — session remains visible even if join fails
          }
        }

        return {
          id: session.id as string,
          title: session.title,
          startTime: session.startTime.toISOString(),
          endTime: session.endTime.toISOString(),
          status: session.status,
          trainerName,
          activeMeetingId: session.activeMeeting?.id
            ? (session.activeMeeting.id as string)
            : null,
          joinUrl,
        };
      }),
    );
  }

  @Query()
  @Allow(Permission.Public)
  async publicScheduledSessions(@Ctx() ctx: RequestContext): Promise<
    Array<{
      id: string;
      title: string;
      startTime: string;
      endTime: string;
      status: string;
      trainerName: string | null;
      isTrial: boolean;
      visibility: string;
      maxAttendees: number | null;
      slug: string | null;
      activeMeetingId: string | null;
      joinUrl: string | null;
    }>
  > {
    const sessions = await this.connection
      .getRepository(ctx, BbbScheduledSession)
      .find({
        where: { visibility: "PUBLIC", isTrial: true },
        order: { startTime: "ASC" },
      });

    return sessions.map((s) => ({
      id: s.id as string,
      title: s.title,
      startTime: s.startTime.toISOString(),
      endTime: s.endTime.toISOString(),
      status: s.status,
      trainerName: null,
      isTrial: s.isTrial,
      visibility: s.visibility,
      maxAttendees: s.maxAttendees,
      slug: s.slug,
      activeMeetingId: s.activeMeeting?.id ? (s.activeMeeting.id as string) : null,
      joinUrl: null,
    }));
  }

  @Query()
  @Allow(Permission.Authenticated)
  async myTrialRegistrations(@Ctx() ctx: RequestContext): Promise<
    Array<{
      id: string;
      sessionId: string;
      sessionTitle: string | null;
      status: string;
      registeredAt: string;
      attendedAt: string | null;
    }>
  > {
    if (!ctx.activeUserId) throw new Error("Unauthenticated");
    const customerId = ctx.activeUserId as string;
    const registrations = await this.connection
      .getRepository(ctx, BbbTrialRegistration)
      .find({
        where: { customerId },
        order: { registeredAt: "DESC" },
        relations: ["scheduledSession"],
      });

    return registrations.map((r) => ({
      id: r.id as string,
      sessionId: r.scheduledSessionId,
      sessionTitle: r.scheduledSession?.title ?? null,
      status: r.status,
      registeredAt: r.registeredAt.toISOString(),
      attendedAt: r.attendedAt ? r.attendedAt.toISOString() : null,
    }));
  }

  @Mutation()
  @Allow(Permission.Authenticated)
  async registerForTrial(
    @Ctx() ctx: RequestContext,
    @Args("sessionId") sessionId: string,
  ): Promise<{
    id: string;
    sessionId: string;
    sessionTitle: string | null;
    status: string;
    registeredAt: string;
  }> {
    if (!ctx.activeUserId) throw new Error("Unauthenticated");
    const registration = await this.trialRegistrationService.register(
      ctx,
      sessionId,
      "",
      "",
    );
    return {
      id: registration.id as string,
      sessionId: registration.scheduledSessionId,
      sessionTitle: null,
      status: registration.status,
      registeredAt: registration.registeredAt.toISOString(),
    };
  }

  // ─── Learning Dashboard (Phase 1.5, ADR-013 INV-006) ──────────────────────

  @Query()
  @Allow(Permission.Authenticated)
  async myLearningDashboard(
    @Ctx() ctx: RequestContext,
  ): Promise<{ courses: Array<{
    id: string;
    title: string;
    canJoin: boolean;
    joinUrl: string | null;
    nextSession: { startsAt: string; endsAt: string } | null;
    instructorName: string | null;
    entitlementType: string;
    entitlementSource: string;
    ctaAction: string;
    ctaLabel: string;
  }> }> {
    return this.learningDashboardService.getDashboard(ctx);
  }

  @Mutation()
  @Allow(Permission.Authenticated)
  async startScheduledSession(
    @Ctx() ctx: RequestContext,
    @Args("sessionId") sessionId: string,
  ): Promise<{
    id: string;
    title: string;
    startTime: string;
    endTime: string;
    status: string;
    trainerName: string | null;
    activeMeetingId: string | null;
    joinUrl: string | null;
  }> {
    if (!ctx.activeUserId) throw new ForbiddenError();
    const session = await this.sessionService.startSession(ctx, sessionId);

    // startSession calls createAndEnqueue which puts the meeting in PENDING
    // state and enqueues the provisioning job. The job runs asynchronously.
    // The meeting is almost certainly not ACTIVE yet, so getJoinUrl would
    // throw because state !== ACTIVE. Instead, return status: "provisioning"
    // and let the frontend poll myScheduledSessions for the join URL once
    // the meeting transitions to ACTIVE.
    let joinUrl: string | null = null;
    if (session.status === "LIVE" && session.activeMeeting) {
      const customer = await this.connection
        .getRepository(ctx, Customer)
        .findOne({ where: { user: { id: ctx.activeUserId as string } } });
      if (customer) {
        try {
          const name =
            [customer.firstName, customer.lastName].filter(Boolean).join(" ") ||
            "Trainer";
          joinUrl = await this.meetingService.getJoinUrl(
            ctx,
            session.activeMeeting.id,
            name,
          );
        } catch {
          // Best-effort — session remains visible even if join fails
        }
      }
    }

    // Resolve trainer name for response
    let trainerName: string | null = null;
    if (session.trainer) {
      const trainerCustomer = await this.connection
        .getRepository(ctx, Customer)
        .findOne({ where: { id: session.trainer.customerId } });
      if (trainerCustomer) {
        trainerName =
          [trainerCustomer.firstName, trainerCustomer.lastName]
            .filter(Boolean)
            .join(" ") || "Trainer";
      }
    }

    return {
      id: session.id as string,
      title: session.title,
      startTime: session.startTime.toISOString(),
      endTime: session.endTime.toISOString(),
      status: session.status,
      trainerName,
      activeMeetingId: session.activeMeeting?.id
        ? (session.activeMeeting.id as string)
        : null,
      joinUrl,
    };
  }

  // ─── Account Deletion Mutations (INV-013) ───────────────────────────────

  @Mutation()
  @Allow(Permission.Authenticated)
  async leaveAcademy(@Ctx() ctx: RequestContext): Promise<{ success: boolean; message: string | null }> {
    if (!ctx.activeUserId) throw new ForbiddenError();

    const customer = await this.connection
      .getRepository(ctx, Customer)
      .findOne({ where: { user: { id: ctx.activeUserId as string } } });
    if (!customer) throw new ForbiddenError();

    // channelId is resolved from the request context, never from client input
    const channelId = ctx.channelId as string;
    await this.customerDeletionService.removeFromChannel(ctx, customer.id, channelId);
    return { success: true, message: null };
  }

  @Mutation()
  @Allow(Permission.Authenticated)
  async deleteMyAccount(
    @Ctx() ctx: RequestContext,
    @Args("password") password: string,
  ): Promise<{ success: boolean; message: string | null }> {
    if (!ctx.activeUserId) throw new ForbiddenError();

    const customer = await this.connection
      .getRepository(ctx, Customer)
      .findOne({
        where: { user: { id: ctx.activeUserId as string } },
        relations: ["user"],
      });
    if (!customer) throw new ForbiddenError();

    // Verify password before proceeding with irreversible deletion
    const passwordValid = await this.authService.verifyUserPassword(
      ctx,
      ctx.activeUserId,
      password,
    );
    if (passwordValid !== true) {
      return { success: false, message: "Incorrect password. Account deletion requires password confirmation." };
    }

    await this.customerDeletionService.fullDelete(ctx, customer.id);
    return { success: true, message: null };
  }
}
