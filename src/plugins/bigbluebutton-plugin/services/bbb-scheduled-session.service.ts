import { Injectable } from "@nestjs/common";
import { EntityNotFoundError, EventBus, ForbiddenError } from "@vendure/core";
import {
  ID,
  Logger,
  RequestContext,
  TransactionalConnection,
} from "@vendure/core";
import { BbbScheduledSession } from "../entities/bbb-scheduled-session.entity";
import { BbbSessionTemplate } from "../entities/bbb-session-template.entity";
import { BbbOrganizationService } from "./bbb-organization.service";
import { BbbMeetingService } from "./bbb-meeting.service";
import { BbbMemberService } from "./bbb-member.service";
import { BbbOrganization } from "../entities/bbb-organization.entity";
import { BbbOrganizationMember } from "../entities/bbb-organization-member.entity";
import { Customer, Product, ProductVariant } from "@vendure/core";
import { InstructorProfile } from "../../tenant-plugin/entities/instructor-profile.entity";
import { BbbChannelAccessService } from "./bbb-channel-access.service";
import {
  SessionCancelledEvent,
  SessionCreatedEvent,
  SessionUpdatedEvent,
} from "../events/bbb-events";

const loggerCtx = "BbbScheduledSessionService";

/** Non-terminal statuses that count against the org session cap. */
const ACTIVE_STATUSES = ["DRAFT", "SCHEDULED", "LIVE"];

@Injectable()
export class BbbScheduledSessionService {
  constructor(
    private readonly connection: TransactionalConnection,
    private readonly orgService: BbbOrganizationService,
    private readonly meetingService: BbbMeetingService,
    private readonly memberService: BbbMemberService,
    private readonly channelAccess: BbbChannelAccessService,
    private readonly eventBus: EventBus,
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
      subjectTags?: string[];
      isTrial?: boolean;
      visibility?: string;
    },
  ): Promise<BbbScheduledSession> {
    await this.channelAccess.assertOrganizationAccess(ctx, input.organizationId);
    const org = await this.connection.getEntityOrThrow(
      ctx,
      BbbOrganization,
      input.organizationId,
    );

    // Gap 1: enforce per-org session cap with pessimistic write lock.
    // The resolver is already wrapped in @Transaction() so ctx carries an
    // active transaction. Lock the org row, count, validate, then insert —
    // all inside the SAME transaction so the lock covers the insert.
    if (org.maxSessionsPerOrg > 0) {
      const lockedOrg = await this.connection
        .getRepository(ctx, BbbOrganization)
        .createQueryBuilder("org")
        .setLock("pessimistic_write")
        .where("org.id = :id", { id: org.id })
        .getOne();
      if (!lockedOrg) throw new Error("Organization not found");
      const activeCount = await this.connection
        .getRepository(ctx, BbbScheduledSession)
        .createQueryBuilder("s")
        .where("s.organizationId = :orgId", { orgId: String(org.id) })
        .andWhere("s.status IN (:...statuses)", { statuses: ACTIVE_STATUSES })
        .getCount();
      if (activeCount >= lockedOrg.maxSessionsPerOrg) {
        throw new Error(
          `Organization has reached its session limit of ${lockedOrg.maxSessionsPerOrg}. ` +
            `Cancel or finish existing sessions before creating new ones, or ask the platform operator to raise the limit.`,
        );
      }
    }

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

    // Channel=Tenant (INV-001): the session's tenant scope is derived from the
    // authoritative channel-scoped aggregate (the organization), NOT from the
    // request context. This prevents a superadmin (or cross-channel operator)
    // from creating a session whose tenant scope disagrees with its organization.
    const channelId = (org.channelId as string | undefined) ?? (ctx.channelId as string | undefined);

    const session = new BbbScheduledSession({
      organization: org,
      organizationId: String(org.id),
      title: input.title,
      startTime: new Date(input.startTime),
      endTime: new Date(input.endTime),
      trainer,
      // Gap 3: sessions start as DRAFT — must be explicitly published
      // (publishBbbScheduledSession) before they are discoverable by
      // learners or startable by trainers.
      status: "DRAFT",
      activeMeeting: null,
      channelId: channelId ?? null,
      productVariantId: input.productVariantId ?? null,
      subjectTags: input.subjectTags ?? null,
      isTrial: input.isTrial ?? false,
      visibility: input.visibility ?? "PRIVATE",
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
            // Resolve the authoritative InstructorProfile ID from the trainer's customerId.
            // input.trainerId is a BbbOrganizationMember.id — not an InstructorProfile.id.
            // The downstream marketplace indexer queries InstructorProfile by this field,
            // so storing BbbOrganizationMember.id here would produce broken marketplace links.
            let resolvedInstructorProfileId: string | null = null;
            if (trainer?.customerId) {
              const profile = await this.connection
                .getRepository(ctx, InstructorProfile)
                .findOne({ where: { customerId: trainer.customerId as any } });
              if (profile) {
                resolvedInstructorProfileId = String(profile.id);
              } else {
                Logger.warn(
                  `No InstructorProfile found for trainer customerId=${trainer.customerId} — instructorProfileId will be null on product ${product.id}`,
                  loggerCtx,
                );
              }
            }

            const productRepo = this.connection.getRepository(ctx, Product);
            await productRepo.save({
              ...product,
              customFields: {
                ...(product as any).customFields,
                bbbSessionId: String(saved.id),
                instructorProfileId: resolvedInstructorProfileId,
              },
            });
            Logger.info(
              `Updated Product ${product.id} customFields: bbbSessionId=${saved.id}, instructorProfileId=${resolvedInstructorProfileId}`,
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
    this.eventBus.publish(new SessionCreatedEvent(String(saved.id), saved.channelId ?? null));

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
    this.eventBus.publish(new SessionCancelledEvent(String(saved.id), saved.channelId ?? null));
    return saved;
  }

  // ─── Gap 3: Draft → Scheduled publish ────────────────────────────────────

  /**
   * Transition a DRAFT session to SCHEDULED, making it visible to learners
   * and startable by trainers.
   *
   * Only DRAFT sessions can be published. Attempting to publish a session
   * in any other status is a no-op error to avoid accidental re-publishing
   * of finished or cancelled sessions.
   */
  async publish(ctx: RequestContext, id: ID): Promise<BbbScheduledSession> {
    await this.channelAccess.assertSessionAccess(ctx, id);
    const session = await this.findById(ctx, id);
    if (!session) throw new EntityNotFoundError("BbbScheduledSession", id);

    if (session.status !== "DRAFT") {
      throw new Error(
        `Cannot publish session ${id}: status is '${session.status}'. Only DRAFT sessions can be published.`,
      );
    }

    session.status = "SCHEDULED";
    const saved = await this.connection
      .getRepository(ctx, BbbScheduledSession)
      .save(session);

    Logger.info(`Scheduled session ${id} published (DRAFT → SCHEDULED)`, loggerCtx);
    this.eventBus.publish(new SessionUpdatedEvent(String(saved.id), saved.channelId ?? null));
    return saved;
  }

  // ─── Gap 2: Template / recurring sessions ────────────────────────────────

  /**
   * Create a reusable session template. The template stores shared defaults
   * (title, trainer, tags, duration, productVariantId) so that the same
   * values do not need to be repeated for every session in a series.
   */
  async createTemplate(
    ctx: RequestContext,
    input: {
      organizationId: ID;
      name: string;
      defaultTitle: string;
      defaultTrainerId?: ID;
      durationMinutes?: number;
      defaultSubjectTags?: string[];
      defaultVisibility?: string;
      productVariantId?: string;
    },
  ): Promise<BbbSessionTemplate> {
    await this.channelAccess.assertOrganizationAccess(ctx, input.organizationId);
    const org = await this.connection.getEntityOrThrow(
      ctx,
      BbbOrganization,
      input.organizationId,
    );

    const channelId =
      (org.channelId as string | undefined) ?? (ctx.channelId as string | undefined);

    // Validate duration.
    const durationMinutes = input.durationMinutes ?? 60;
    if (durationMinutes <= 0 || !Number.isFinite(durationMinutes)) {
      throw new Error(`durationMinutes must be a positive number, got ${durationMinutes}.`);
    }
    if (durationMinutes > 1440) {
      throw new Error(`durationMinutes cannot exceed 1440 (24 hours), got ${durationMinutes}.`);
    }

    // Validate trainer belongs to this org if supplied.
    if (input.defaultTrainerId) {
      const trainer = await this.connection
        .getRepository(ctx, BbbOrganizationMember)
        .findOne({
          where: {
            id: String(input.defaultTrainerId),
            organization: { id: org.id as any },
            active: true,
          },
        });
      if (!trainer) {
        throw new Error(
          `Trainer ${input.defaultTrainerId} is not an active member of organization ${org.id}.`,
        );
      }
    }

    const template = new BbbSessionTemplate({
      organization: org,
      organizationId: String(org.id),
      channelId: channelId ?? null,
      name: input.name,
      defaultTitle: input.defaultTitle,
      defaultTrainerId: input.defaultTrainerId ? String(input.defaultTrainerId) : null,
      durationMinutes,
      defaultSubjectTags: input.defaultSubjectTags ?? null,
      defaultVisibility: input.defaultVisibility ?? "PRIVATE",
      productVariantId: input.productVariantId ?? null,
    });

    const saved = await this.connection
      .getRepository(ctx, BbbSessionTemplate)
      .save(template);

    Logger.info(
      `Session template ${saved.id} created for org ${org.id}: "${input.name}"`,
      loggerCtx,
    );
    return saved;
  }

  async findTemplatesByOrganization(
    ctx: RequestContext,
    orgId: ID,
  ): Promise<BbbSessionTemplate[]> {
    await this.channelAccess.assertOrganizationAccess(ctx, orgId);
    return this.connection
      .getRepository(ctx, BbbSessionTemplate)
      .find({ where: { organizationId: String(orgId) }, order: { createdAt: "ASC" } });
  }

  async deleteTemplate(ctx: RequestContext, id: ID): Promise<boolean> {
    const template = await this.connection
      .getRepository(ctx, BbbSessionTemplate)
      .findOne({ where: { id: String(id) } });
    if (!template) throw new EntityNotFoundError("BbbSessionTemplate", id);
    await this.channelAccess.assertOrganizationAccess(ctx, template.organizationId);
    await this.connection.getRepository(ctx, BbbSessionTemplate).delete(String(id));
    return true;
  }

  /**
   * Generate multiple DRAFT BbbScheduledSession instances from a template.
   *
   * The caller supplies an array of start-time strings. Each entry produces
   * one session: endTime = startTime + template.durationMinutes. All sessions
   * start as DRAFT and must be individually published.
   *
   * The session cap (maxSessionsPerOrg) is checked against the total of
   * current active sessions PLUS the number of new sessions being created —
   * the entire batch is rejected if it would exceed the limit.
   */
  async createSessionsFromTemplate(
    ctx: RequestContext,
    templateId: ID,
    startTimes: string[],
  ): Promise<BbbScheduledSession[]> {
    if (!startTimes.length) {
      throw new Error("createSessionsFromTemplate: startTimes must not be empty.");
    }
    if (startTimes.length > 100) {
      throw new Error("createSessionsFromTemplate: cannot create more than 100 sessions in a single batch.");
    }

    // Validate all dates up front before touching the DB.
    const parsedTimes: Date[] = [];
    for (const s of startTimes) {
      const d = new Date(s);
      if (isNaN(d.getTime())) {
        throw new Error(`createSessionsFromTemplate: invalid start time "${s}". Must be a valid ISO 8601 datetime.`);
      }
      parsedTimes.push(d);
    }

    // Reject duplicate start times.
    const unique = new Set(parsedTimes.map((d) => d.toISOString()));
    if (unique.size !== parsedTimes.length) {
      throw new Error("createSessionsFromTemplate: startTimes contains duplicate entries.");
    }

    const template = await this.connection
      .getRepository(ctx, BbbSessionTemplate)
      .findOne({
        where: { id: String(templateId) },
        relations: ["organization"],
      });
    if (!template) throw new EntityNotFoundError("BbbSessionTemplate", templateId);

    await this.channelAccess.assertOrganizationAccess(ctx, template.organizationId);

    const org = template.organization;

    // Enforce cap across the whole batch inside the resolver's existing
    // transaction (ctx). Lock → count → validate → insert all stay in one
    // transaction so the lock covers every insert in the batch.
    if (org.maxSessionsPerOrg > 0) {
      const lockedOrg = await this.connection
        .getRepository(ctx, BbbOrganization)
        .createQueryBuilder("org")
        .setLock("pessimistic_write")
        .where("org.id = :id", { id: org.id })
        .getOne();
      if (!lockedOrg) throw new Error("Organization not found");
      const activeCount = await this.connection
        .getRepository(ctx, BbbScheduledSession)
        .createQueryBuilder("s")
        .where("s.organizationId = :orgId", { orgId: String(org.id) })
        .andWhere("s.status IN (:...statuses)", { statuses: ACTIVE_STATUSES })
        .getCount();
      const available = lockedOrg.maxSessionsPerOrg - activeCount;
      if (startTimes.length > available) {
        throw new Error(
          `Cannot create ${startTimes.length} sessions: organization limit is ${lockedOrg.maxSessionsPerOrg} ` +
            `and ${activeCount} active sessions already exist (${available} slot(s) remaining).`,
        );
      }
    }

    // Resolve trainer if set on template — validate it belongs to this org.
    let trainer: BbbOrganizationMember | null = null;
    if (template.defaultTrainerId) {
      trainer =
        (await this.connection
          .getRepository(ctx, BbbOrganizationMember)
          .findOne({
            where: {
              id: template.defaultTrainerId,
              organization: { id: template.organizationId as any },
              active: true,
            },
          })) ?? null;
      if (!trainer) {
        throw new Error(
          `Template trainer ${template.defaultTrainerId} is not an active member of organization ${template.organizationId}. ` +
            `Update the template with a valid trainer before generating sessions.`,
        );
      }
    }

    const repo = this.connection.getRepository(ctx, BbbScheduledSession);
    const created: BbbScheduledSession[] = [];

    for (const startTime of parsedTimes) {
      const endTime = new Date(startTime.getTime() + template.durationMinutes * 60_000);

      const session = new BbbScheduledSession({
        organization: org,
        organizationId: String(org.id),
        title: template.defaultTitle,
        startTime,
        endTime,
        trainer: trainer ?? undefined,
        status: "DRAFT",
        activeMeeting: null,
        channelId: template.channelId,
        productVariantId: template.productVariantId,
        subjectTags: template.defaultSubjectTags,
        visibility: template.defaultVisibility,
      });

      const saved = await repo.save(session);
      this.eventBus.publish(new SessionCreatedEvent(String(saved.id), saved.channelId ?? null));
      created.push(saved);
    }

    Logger.info(
      `Created ${created.length} DRAFT sessions from template ${templateId} for org ${org.id}`,
      loggerCtx,
    );
    return created;
  }

  /**
   * Update editable session fields (Gate 1.4 / F5). Publishes
   * SessionUpdatedEvent so the marketplace projection can reindex or
   * remove the document (eligibility rule owned by indexSession()).
   */
  async update(
    ctx: RequestContext,
    id: ID,
    input: {
      title?: string;
      startTime?: string;
      endTime?: string;
      subjectTags?: string[];
      visibility?: string;
      isTrial?: boolean;
    },
  ): Promise<BbbScheduledSession> {
    await this.channelAccess.assertSessionAccess(ctx, id);
    const session = await this.findById(ctx, id);
    if (!session) throw new EntityNotFoundError("BbbScheduledSession", id);

    if (input.title !== undefined) session.title = input.title;
    if (input.startTime !== undefined) session.startTime = new Date(input.startTime);
    if (input.endTime !== undefined) session.endTime = new Date(input.endTime);
    if (input.subjectTags !== undefined) session.subjectTags = input.subjectTags;
    if (input.visibility !== undefined) session.visibility = input.visibility;
    if (input.isTrial !== undefined) session.isTrial = input.isTrial;

    const saved = await this.connection
      .getRepository(ctx, BbbScheduledSession)
      .save(session);

    Logger.info(`Scheduled session ${id} updated`, loggerCtx);
    this.eventBus.publish(new SessionUpdatedEvent(String(saved.id), saved.channelId ?? null));
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
        `Cannot start session in status: ${session.status}. ` +
          `${session.status === "DRAFT" ? "Publish the session first (publishBbbScheduledSession)." : "Expected SCHEDULED."}`,
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

    // Link session to the pending meeting.
    // NOTE: session.status intentionally remains SCHEDULED here. It will
    // transition to LIVE only after the meeting is successfully provisioned:
    // the BullMQ worker calls BBB createMeeting, and on success emits
    // MeetingProvisionedEvent, which BbbSessionProvisioningListener uses to
    // transition the session to LIVE.
    // Setting LIVE here would create a race where learners see canJoin=true
    // before the BBB room actually exists on the server.
    session.activeMeeting = meeting;
    const saved = await this.connection
      .getRepository(ctx, BbbScheduledSession)
      .save(session);

    Logger.info(
      `Session ${sessionId} provisioning requested → meeting ${meeting.id} pending`,
      loggerCtx,
    );

    return saved;
  }
}
