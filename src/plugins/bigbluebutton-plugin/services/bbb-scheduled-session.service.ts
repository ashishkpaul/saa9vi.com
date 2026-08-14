import { Injectable } from "@nestjs/common";
import { EntityNotFoundError, ForbiddenError } from "@vendure/core";
import {
  ID,
  Logger,
  RequestContext,
  TransactionalConnection,
} from "@vendure/core";
import { BbbScheduledSession } from "../entities/bbb-scheduled-session.entity";
import { BbbOrganizationService } from "./bbb-organization.service";
import { BbbMeetingService } from "./bbb-meeting.service";
import { BbbMemberService } from "./bbb-member.service";
import { BbbOrganization } from "../entities/bbb-organization.entity";
import { BbbOrganizationMember } from "../entities/bbb-organization-member.entity";
import { Customer, Product, ProductVariant } from "@vendure/core";
import { BbbChannelAccessService } from "./bbb-channel-access.service";

const loggerCtx = "BbbScheduledSessionService";

@Injectable()
export class BbbScheduledSessionService {
  constructor(
    private readonly connection: TransactionalConnection,
    private readonly orgService: BbbOrganizationService,
    private readonly meetingService: BbbMeetingService,
    private readonly memberService: BbbMemberService,
    private readonly channelAccess: BbbChannelAccessService,
  ) {}

  // ─── Queries ──────────────────────────────────────────────────────────────

  async findByOrganization(
    ctx: RequestContext,
    orgId: ID,
  ): Promise<BbbScheduledSession[]> {
    await this.channelAccess.assertOrganizationAccess(ctx, orgId);
    return this.connection.getRepository(ctx, BbbScheduledSession).find({
      where: { organization: { id: orgId as string } },
      relations: ["trainer", "activeMeeting"],
      order: { startTime: "ASC" },
    });
  }

  async findMySessions(ctx: RequestContext): Promise<BbbScheduledSession[]> {
    if (!ctx.activeUserId) throw new ForbiddenError();

    const customer = await this.connection
      .getRepository(ctx, Customer)
      .findOne({ where: { user: { id: ctx.activeUserId as string } } });
    if (!customer) return [];

    const memberships = await this.memberService.findActiveByCustomer(
      ctx,
      customer.id,
    );
    if (!memberships.length) return [];

    // Collect all sessions across the customer's organizations — single query
    const orgIds = memberships.map(
      (m) => m.organization?.id ?? (m as any).organizationId,
    );
    if (!orgIds.length) return [];
    const sessions = await this.connection
      .getRepository(ctx, BbbScheduledSession)
      .createQueryBuilder("session")
      .leftJoinAndSelect("session.trainer", "trainer")
      .leftJoinAndSelect("session.activeMeeting", "activeMeeting")
      .where("session.organizationId IN (:...orgIds)", { orgIds })
      .orderBy("session.startTime", "ASC")
      .getMany();

    return sessions;
  }

  async findById(
    ctx: RequestContext,
    id: ID,
  ): Promise<BbbScheduledSession | null> {
    const session = await this.connection.getRepository(ctx, BbbScheduledSession).findOne({
      where: { id: id as string },
      relations: ["trainer", "activeMeeting", "organization"],
    });
    if (!session) return null;
    await this.channelAccess.assertSessionAccess(ctx, id);
    return session;
  }

  // ─── Admin Mutations ──────────────────────────────────────────────────────

  async create(
    ctx: RequestContext,
    input: {
      organizationId: ID;
      title: string;
      startTime: string;
      endTime: string;
      trainerId: ID;
      productVariantId?: string;
    },
  ): Promise<BbbScheduledSession> {
    await this.channelAccess.assertOrganizationAccess(ctx, input.organizationId);
    const org = await this.connection.getEntityOrThrow(
      ctx,
      BbbOrganization,
      input.organizationId,
    );

    let trainer = await this.connection
      .getRepository(ctx, BbbOrganizationMember)
      .findOne({ where: { id: input.trainerId as string } });
    if (!trainer) {
      trainer = await this.connection
        .getRepository(ctx, BbbOrganizationMember)
        .findOne({
          where: {
            customerId: input.trainerId as string,
            organization: { id: input.organizationId as string },
          },
        });
    }
    if (!trainer) {
      throw new EntityNotFoundError("BbbOrganizationMember", input.trainerId);
    }

    // Set channelId from the request context for tenant isolation
    const channelId = ctx.channelId as string | undefined;

    const session = new BbbScheduledSession({
      organization: org,
      organizationId: String(org.id),
      title: input.title,
      startTime: new Date(input.startTime),
      endTime: new Date(input.endTime),
      trainer,
      status: "SCHEDULED",
      activeMeeting: null,
      channelId: channelId ?? null,
      productVariantId: input.productVariantId ?? null,
    });

    const saved = await this.connection
      .getRepository(ctx, BbbScheduledSession)
      .save(session);

    // ─── Gap 6: Populate Product.customFields.bbbSessionId and instructorProfileId ──
    if (input.productVariantId) {
      try {
        const variant = await this.connection
          .getRepository(ctx, ProductVariant)
          .findOne({
            where: { id: input.productVariantId as any },
            relations: ['product'],
          });

        if (variant) {
          const product = (variant as any).product;
          if (product) {
            const productRepo = this.connection.getRepository(ctx, Product);
            await productRepo.save({
              ...product,
              customFields: {
                ...(product as any).customFields,
                bbbSessionId: String(saved.id),
                instructorProfileId: input.trainerId ? String(input.trainerId) : null,
              },
            });
            Logger.info(
              `Updated Product ${product.id} customFields: bbbSessionId=${saved.id}, instructorProfileId=${input.trainerId}`,
              loggerCtx,
            );
          }
        }
      } catch (err: any) {
        Logger.warn(
          `Failed to update Product customFields for variant ${input.productVariantId}: ${err.message}`,
          loggerCtx,
        );
      }
    }

    Logger.info(
      `Scheduled session ${saved.id} created for org ${org.id} channel ${channelId ?? "none"}: "${input.title}"`,
      loggerCtx,
    );

    return saved;
  }

  async cancel(ctx: RequestContext, id: ID): Promise<BbbScheduledSession> {
    await this.channelAccess.assertSessionAccess(ctx, id);
    const session = await this.findById(ctx, id);
    if (!session) throw new EntityNotFoundError("BbbScheduledSession", id);

    session.status = "CANCELLED";
    const saved = await this.connection
      .getRepository(ctx, BbbScheduledSession)
      .save(session);

    Logger.info(`Scheduled session ${id} cancelled`, loggerCtx);
    return saved;
  }

  // ─── Shop Mutations (Trainer) ─────────────────────────────────────────────

  /**
   * Trainer activates a scheduled session within its time window.
   * Provisions a BBB meeting via the existing infrastructure pipeline.
   */
  async startSession(
    ctx: RequestContext,
    sessionId: ID,
  ): Promise<BbbScheduledSession> {
    if (!ctx.activeUserId) throw new ForbiddenError();

    const customer = await this.connection
      .getRepository(ctx, Customer)
      .findOne({ where: { user: { id: ctx.activeUserId as string } } });
    if (!customer) throw new ForbiddenError();

    const session = await this.findById(ctx, sessionId);
    if (!session) throw new EntityNotFoundError("BbbScheduledSession", sessionId);

    // Verify the caller is a moderator (trainer/org-admin) for this org
    const member = await this.memberService.assertActiveMembership(
      ctx,
      customer.id,
      session.organization.id,
    );
    if (!this.memberService.isModerator(member)) {
      throw new ForbiddenError();
    }

    // Guard: session must be SCHEDULED
    if (session.status !== "SCHEDULED") {
      throw new Error(
        `Cannot start session in status: ${session.status}. Expected SCHEDULED.`,
      );
    }

    // Guard: current time must be within the session window
    const now = new Date();
    if (now < session.startTime) {
      throw new Error(
        `Session starts at ${session.startTime.toISOString()}. It is not yet time to start.`,
      );
    }
    if (now > session.endTime) {
      session.status = "FINISHED";
      await this.connection
        .getRepository(ctx, BbbScheduledSession)
        .save(session);
      throw new Error(
        `Session window has already passed (ended at ${session.endTime.toISOString()}). Marked as FINISHED.`,
      );
    }

    // Provision the meeting via existing pipeline
    const meeting = await this.meetingService.createAndEnqueue(ctx, {
      organizationId: session.organization.id,
      title: session.title,
    });

    // Link session to meeting and mark LIVE
    session.activeMeeting = meeting;
    session.status = "LIVE";
    const saved = await this.connection
      .getRepository(ctx, BbbScheduledSession)
      .save(session);

    Logger.info(
      `Session ${sessionId} started → meeting ${meeting.id} provisioned`,
      loggerCtx,
    );

    return saved;
  }
}
