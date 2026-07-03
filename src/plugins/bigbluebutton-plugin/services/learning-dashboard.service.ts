import { Injectable, Logger } from "@nestjs/common";
import { ID, RequestContext, TransactionalConnection } from "@vendure/core";
import { BbbEntitlement } from "../entities/bbb-entitlement.entity";
import { BbbScheduledSession } from "../entities/bbb-scheduled-session.entity";
import { BbbEntitlementService } from "./bbb-entitlement.service";
import { BbbMeetingService } from "./bbb-meeting.service";
import { Customer } from "@vendure/core";
import { InstructorProfile } from "../../tenant-plugin/entities/instructor-profile.entity";

const loggerCtx = "LearningDashboardService";

export interface LearningCourse {
  id: string;
  title: string;
  canJoin: boolean;
  joinUrl: string | null;
  nextSession: { startsAt: string; endsAt: string } | null;
  instructorName: string | null;
  entitlementType: string;
  entitlementSource: string;
}

/**
 * Domain API service for the student learning dashboard.
 *
 * Aggregates across BbbEntitlement, BbbScheduledSession, and InstructorProfile
 * to produce a single frontend-friendly contract (INV-006).
 *
 * No Bbb* prefixed types are exposed to the storefront (INV-006 lint rule).
 */
@Injectable()
export class LearningDashboardService {
  constructor(
    private readonly connection: TransactionalConnection,
    private readonly entitlementService: BbbEntitlementService,
    private readonly meetingService: BbbMeetingService,
  ) {}

  async getDashboard(ctx: RequestContext): Promise<{ courses: LearningCourse[] }> {
    if (!ctx.activeUserId) {
      return { courses: [] };
    }

    const customer = await this.connection
      .getRepository(ctx, Customer)
      .findOne({ where: { user: { id: ctx.activeUserId as string } } });

    if (!customer) {
      return { courses: [] };
    }

    const customerId = String(customer.id);

    // 1. Fetch all active entitlements for this customer
    const entitlements = await this.connection
      .getRepository(ctx, BbbEntitlement)
      .find({
        where: { customerId },
        order: { createdAt: "DESC" },
      });

    if (!entitlements.length) {
      return { courses: [] };
    }

    // 2. For session-type entitlements, fetch the linked BbbScheduledSession
    const sessionEntitlements = entitlements.filter((e) => e.type === "bbb_session");
    const sessionIds = [...new Set(sessionEntitlements.map((e) => e.resourceId))];

    const sessions = sessionIds.length
      ? await this.connection
          .getRepository(ctx, BbbScheduledSession)
          .find({
            where: { id: { $in: sessionIds } as any },
            relations: ["trainer", "activeMeeting", "organization"],
          })
      : [];

    const sessionMap = new Map<string, BbbScheduledSession>();
    for (const s of sessions) {
      sessionMap.set(String(s.id), s);
    }

    // 3. Pre-resolve instructor names from InstructorProfile
    //    BbbScheduledSession.trainer has a customerId → InstructorProfile.customerId
    const trainerCustomerIds = sessions
      .map((s) => s.trainer?.customerId)
      .filter(Boolean) as string[];

    const instructorProfiles = trainerCustomerIds.length
      ? await this.connection
          .getRepository(ctx, InstructorProfile)
          .find({ where: { customerId: { $in: trainerCustomerIds } as any } })
      : [];

    const instructorNameMap = new Map<string, string>();
    for (const ip of instructorProfiles) {
      instructorNameMap.set(ip.customerId, ip.fullName);
    }

    // 4. Build the dashboard response
    const courses: LearningCourse[] = [];

    for (const entitlement of sessionEntitlements) {
      const session = sessionMap.get(entitlement.resourceId);
      if (!session) continue;

      // Determine canJoin: entitlement is valid AND session is LIVE
      const hasValidEntitlement = await this.entitlementService.hasAccess(
        ctx,
        customerId,
        "bbb_session",
        entitlement.resourceId,
      );

      const isSessionLive = session.status === "LIVE";
      const canJoin = hasValidEntitlement && isSessionLive;

      // Generate joinUrl only when canJoin is true
      let joinUrl: string | null = null;
      if (canJoin && session.activeMeeting) {
        try {
          const name =
            [customer.firstName, customer.lastName].filter(Boolean).join(" ") ||
            "Student";
          joinUrl = await this.meetingService.getJoinUrl(
            ctx,
            session.activeMeeting.id,
            name,
          );
        } catch (err: any) {
          Logger.warn(
            `Failed to generate join URL for session ${session.id}: ${err.message}`,
            loggerCtx,
          );
        }
      }

      // Resolve instructor name
      let instructorName: string | null = null;
      if (session.trainer?.customerId) {
        instructorName = instructorNameMap.get(session.trainer.customerId) ?? null;
      }

      courses.push({
        id: String(session.id),
        title: session.title,
        canJoin,
        joinUrl,
        nextSession: {
          startsAt: session.startTime.toISOString(),
          endsAt: session.endTime.toISOString(),
        },
        instructorName,
        entitlementType: entitlement.type,
        entitlementSource: entitlement.source,
      });
    }

    return { courses };
  }
}