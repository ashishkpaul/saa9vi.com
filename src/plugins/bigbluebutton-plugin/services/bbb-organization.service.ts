import { Injectable } from "@nestjs/common";
import {
  ID,
  RequestContext,
  TransactionalConnection,
  EntityNotFoundError,
  ChannelService,
} from "@vendure/core";
import { BbbOrganization } from "../entities/bbb-organization.entity";
import { BbbOrganizationMember } from "../entities/bbb-organization-member.entity";
import { BbbMeeting } from "../entities/bbb-meeting.entity";
import { BbbCapacityGrant } from "../entities/bbb-capacity-grant.entity";
import { MEETING_STATE } from "../constants";
import { BbbChannelAccessService } from "./bbb-channel-access.service";

export interface CreateBbbOrganizationInput {
  channelId: string;
  tenantProfileId: string;
  slug: string;
  name: string;
  concurrentMeetingLimit?: number;
  maxParticipantsPerMeeting?: number;
  recordingEnabled?: boolean;
}

export interface UpdateBbbOrganizationInput {
  name?: string;
  concurrentMeetingLimit?: number;
  maxParticipantsPerMeeting?: number;
  recordingEnabled?: boolean;
  suspended?: boolean;
}

@Injectable()
export class BbbOrganizationService {
  constructor(
    private readonly connection: TransactionalConnection,
    private readonly channelService: ChannelService,
    private readonly channelAccess: BbbChannelAccessService,
  ) {}

  async findAll(
    ctx: RequestContext,
    options?: { skip?: number; take?: number },
  ): Promise<{ items: BbbOrganization[]; totalItems: number }> {
    const take = Math.min(Math.max(options?.take ?? 25, 1), 100);
    const skip = Math.max(options?.skip ?? 0, 0);
    const channelId = ctx.channelId as string;
    const [items, totalItems] = await this.connection
      .getRepository(ctx, BbbOrganization)
      .findAndCount({
        where: { channelId },
        order: { createdAt: "ASC" },
        skip,
        take,
      });
    return { items, totalItems };
  }

  async findById(ctx: RequestContext, id: ID): Promise<BbbOrganization | null> {
    const org = await this.connection
      .getRepository(ctx, BbbOrganization)
      .findOne({ where: { id: id as string } });
    if (!org) return null;
    await this.channelAccess.assertOrganizationAccess(ctx, id);
    return org;
  }

  /**
   * Primary resolution method — all infrastructure calls start here.
   * Resolves the operational tenant from the Vendure channel context.
   * This is the core multi-tenant hook: each Channel → 1 BbbOrganization.
   */
  async findByChannelId(
    ctx: RequestContext,
    channelId?: ID,
  ): Promise<BbbOrganization | null> {
    const cid = (channelId ?? ctx.channelId) as string;
    return this.connection
      .getRepository(ctx, BbbOrganization)
      .findOne({ where: { channelId: cid } });
  }

  async findByChannelIdOrThrow(
    ctx: RequestContext,
    channelId?: ID,
  ): Promise<BbbOrganization> {
    const org = await this.findByChannelId(ctx, channelId);
    if (!org) {
      throw new EntityNotFoundError(
        "BbbOrganization",
        (channelId ?? ctx.channelId) as string,
      );
    }
    return org;
  }

  /**
   * Secondary org resolution path (M7): resolve organization via active
   * membership when channel-context resolution is ambiguous.
   */
  async findByMembership(
    ctx: RequestContext,
    customerId: ID,
  ): Promise<BbbOrganization | null> {
    const member = await this.connection
      .getRepository(ctx, BbbOrganizationMember)
      .findOne({
        where: { customerId: customerId as string, active: true },
        relations: ["organization"],
        order: { createdAt: "DESC" },
      });
    return member?.organization ?? null;
  }

  /**
   * Asserts the org can create another meeting right now.
   * Uses pessimistic write lock to prevent race conditions.
   */
  async assertCanCreateMeeting(
    ctx: RequestContext,
    org: BbbOrganization,
  ): Promise<void> {
    const repo = this.connection.getRepository(ctx, BbbOrganization);

    const locked = await repo
      .createQueryBuilder("org")
      .setLock("pessimistic_write")
      .where("org.id = :id", { id: org.id })
      .getOne();

    if (!locked) throw new Error("Organization not found");
    if (locked.suspended) {
      throw new Error(
        `Organization "${locked.name}" is suspended. Please check your subscription.`,
      );
    }

    const rawCount = await this.connection
      .getRepository(ctx, BbbMeeting)
      .createQueryBuilder("meeting")
      .select("COUNT(meeting.id)", "count")
      .where("meeting.organizationId = :orgId", { orgId: org.id as string })
      .andWhere("meeting.state IN (:...states)", {
        states: [MEETING_STATE.PROVISIONING, MEETING_STATE.ACTIVE],
      })
      .getRawOne<{ count: string }>();

    const count = rawCount?.count ?? "0";
    if (parseInt(count, 10) >= locked.concurrentMeetingLimit) {
      throw new Error(
        `Concurrent meeting limit reached (${locked.concurrentMeetingLimit}). ` +
          "Upgrade your plan for more simultaneous meetings.",
      );
    }
  }

  async create(
    ctx: RequestContext,
    input: CreateBbbOrganizationInput,
  ): Promise<BbbOrganization> {
    const existing = await this.findByChannelId(ctx, input.channelId);
    if (existing) {
      throw new Error(
        `An organization already exists for channel ${input.channelId}`,
      );
    }
    const org = new BbbOrganization({
      channelId: input.channelId,
      tenantProfileId: input.tenantProfileId,
      slug: input.slug,
      name: input.name,
      concurrentMeetingLimit: input.concurrentMeetingLimit ?? 5,
      maxParticipantsPerMeeting: input.maxParticipantsPerMeeting ?? 30,
      recordingEnabled: input.recordingEnabled ?? false,
    });
    await this.channelService.assignToCurrentChannel(org, ctx);
    const saved = await this.connection.getRepository(ctx, BbbOrganization).save(org);

    // FEAT-002: Auto-provision an internal_overhead grant for this org.
    // This grant is unbounded — internal sessions always have something to debit against.
    await this.connection.getRepository(ctx, BbbCapacityGrant).save(
      new BbbCapacityGrant({
        organization: saved,
        sourceType: "internal_overhead",
        isUnbounded: true,
        grantedMinutes: -1,   // sentinel — ignored when isUnbounded
        consumedMinutes: 0,
        exhausted: false,
        validFrom: new Date(),
        validUntil: new Date("2099-12-31"),
      }),
    );

    return saved;
  }

  async update(
    ctx: RequestContext,
    id: ID,
    input: UpdateBbbOrganizationInput,
  ): Promise<BbbOrganization> {
    await this.channelAccess.assertOrganizationAccess(ctx, id);
    const org = await this.connection.getEntityOrThrow(
      ctx,
      BbbOrganization,
      id,
    );
    Object.assign(org, input);
    return this.connection.getRepository(ctx, BbbOrganization).save(org);
  }

  async delete(ctx: RequestContext, id: ID): Promise<void> {
    await this.channelAccess.assertOrganizationAccess(ctx, id);
    await this.connection.getRepository(ctx, BbbOrganization).delete(id);
  }
}
