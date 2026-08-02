// src/plugins/bigbluebutton-plugin/api/bbb-admin.resolver.ts
// CHANGE: Added member queries and mutations (M4). All existing code preserved.
// CHANGE (Phase B): Granular permissions. Each method is decorated with
// @Allow(BbbAdminPermission.Permission, <granular>.Permission) so BBBAdmin
// remains backward compatible while allowing finer-grained roles.

import { Args, Mutation, Query, Resolver } from "@nestjs/graphql";
import {
  Allow,
  Ctx,
  RequestContext,
  Transaction,
  TransactionalConnection,
} from "@vendure/core";
import { In } from "typeorm";
import { BbbServerService } from "../services/bbb-server.service";
import { BbbOrganizationService } from "../services/bbb-organization.service";
import { BbbMeetingService } from "../services/bbb-meeting.service";
import { BbbMemberService } from "../services/bbb-member.service";
import { BbbScheduledSessionService } from "../services/bbb-scheduled-session.service";
import { BbbRoomService } from "../services/bbb-room.service";
import { BbbRoom } from "../entities/bbb-room.entity";
import { BbbCapacityGrant } from "../entities/bbb-capacity-grant.entity";
import { BbbOrganization } from "../entities/bbb-organization.entity";
import { BbbOrganizationMember } from "../entities/bbb-organization-member.entity";
import { BbbOrganizationMembership } from "../entities/bbb-organization-membership.entity";
import { BbbProductAccess } from "../entities/bbb-product-access.entity";
import { BbbEnrollment } from "../entities/bbb-enrollment.entity";
import { BbbEntitlement } from "../entities/bbb-entitlement.entity";
import { BbbMeeting } from "../entities/bbb-meeting.entity";
import {
  BbbAdminPermission,
  BbbManageEntitlementsPermission,
  BbbManageMeetingsPermission,
  BbbManageMembersPermission,
  BbbManageOrganizationsPermission,
  BbbManageRoomsPermission,
  BbbManageSessionsPermission,
  BbbPlatformInfrastructurePermission,
} from "../constants";
import { TrialRegistrationService } from "../services/trial-registration.service";
import { BbbMembershipService } from "../services/bbb-membership.service";
import { CapacityIntelligenceService } from "../services/capacity-intelligence.service";
import { BbbTrialRegistration } from "../entities/trial-registration.entity";

import { Customer, EntityNotFoundError } from "@vendure/core";

/** Shape returned to GraphQL with augmented customer info */
interface MemberWithCustomer extends BbbOrganizationMember {
  customerName?: string | null;
  customerEmail?: string | null;
}

// ─── Typed input interfaces for mutations ──────────────────────────────────

interface CreateBbbServerInput {
  name: string;
  apiUrl: string;
  apiSecret: string;
  maxLoad?: number;
}

interface UpdateBbbServerInput {
  name?: string;
  apiUrl?: string;
  apiSecret?: string;
  maxLoad?: number;
  enabled?: boolean;
}

interface AdminCreateBbbOrganizationInput {
  channelId: string;
  tenantProfileId: string;
  slug: string;
  name: string;
  concurrentMeetingLimit?: number;
  maxParticipantsPerMeeting?: number;
  recordingEnabled?: boolean;
}

interface UpdateBbbOrganizationInput {
  name?: string;
  concurrentMeetingLimit?: number;
  maxParticipantsPerMeeting?: number;
  recordingEnabled?: boolean;
  suspended?: boolean;
}

interface AddBbbMemberInput {
  organizationId: string;
  customerId: string;
  role: 'org-admin' | 'trainer';
}

interface UpdateBbbMemberInput {
  role?: 'org-admin' | 'trainer';
  active?: boolean;
}

interface CreateBbbMeetingInput {
  organizationId: string;
  title: string;
  recordingEnabled?: boolean;
}

interface UpdateBbbMeetingInput {
  title?: string;
  recordingEnabled?: boolean;
}

interface CreateBbbRoomInput {
  organizationId: string;
  name: string;
  description?: string;
  slug?: string;
  recordingEnabled?: boolean;
  maxParticipants?: number;
}

interface UpdateBbbRoomInput {
  name?: string;
  description?: string;
  recordingEnabled?: boolean;
  maxParticipants?: number;
}

interface CreateBbbScheduledSessionInput {
  organizationId: string;
  title: string;
  startTime: string;
  endTime: string;
  trainerId: string;
  productVariantId?: string;
}

@Resolver()
export class BbbAdminResolver {
  constructor(
    private readonly serverService: BbbServerService,
    private readonly orgService: BbbOrganizationService,
    private readonly meetingService: BbbMeetingService,
    private readonly memberService: BbbMemberService,
    private readonly roomService: BbbRoomService,
    private readonly scheduledSessionService: BbbScheduledSessionService,
    private readonly trialRegistrationService: TrialRegistrationService,
    private readonly membershipService: BbbMembershipService,
    private readonly capacityIntelligenceService: CapacityIntelligenceService,
    private readonly connection: TransactionalConnection,
  ) {}

  // ─── Capacity Intelligence Dashboard (ADR v1.7 §6A CI-003) ────────────────

  @Query()
  @Allow(BbbAdminPermission.Permission, BbbPlatformInfrastructurePermission.Permission)
  async poolCapacityDashboard(@Ctx() ctx: RequestContext) {
    return this.capacityIntelligenceService.buildDashboard(ctx);
  }

  // ─── Servers ────────────────────────────────────────────────────────────────

  @Query()
  @Allow(BbbAdminPermission.Permission, BbbPlatformInfrastructurePermission.Permission)
  bbbServers(
    @Ctx() ctx: RequestContext,
    @Args("options") options?: { skip?: number; take?: number },
  ) {
    return this.serverService.findAll(ctx, options);
  }

  @Query()
  @Allow(BbbAdminPermission.Permission, BbbPlatformInfrastructurePermission.Permission)
  bbbServer(@Ctx() ctx: RequestContext, @Args("id") id: string) {
    return this.serverService.findById(ctx, id);
  }

  @Allow(BbbAdminPermission.Permission, BbbPlatformInfrastructurePermission.Permission)
  @Transaction()
  @Mutation()
  createBbbServer(@Ctx() ctx: RequestContext, @Args("input") input: CreateBbbServerInput) {
    return this.serverService.create(ctx, input);
  }

  @Allow(BbbAdminPermission.Permission, BbbPlatformInfrastructurePermission.Permission)
  @Transaction()
  @Mutation()
  updateBbbServer(
    @Ctx() ctx: RequestContext,
    @Args("id") id: string,
    @Args("input") input: UpdateBbbServerInput,
  ) {
    return this.serverService.update(ctx, id, input);
  }

  // ─── Organizations ──────────────────────────────────────────────────────────

  @Query()
  @Allow(BbbAdminPermission.Permission, BbbManageOrganizationsPermission.Permission)
  bbbOrganizations(
    @Ctx() ctx: RequestContext,
    @Args("options") options?: { skip?: number; take?: number },
  ) {
    return this.orgService.findAll(ctx, options);
  }

  @Query()
  @Allow(BbbAdminPermission.Permission, BbbManageOrganizationsPermission.Permission)
  bbbOrganization(@Ctx() ctx: RequestContext, @Args("id") id: string) {
    return this.orgService.findById(ctx, id);
  }

  @Allow(BbbAdminPermission.Permission, BbbManageOrganizationsPermission.Permission)
  @Transaction()
  @Mutation()
  createBbbOrganization(@Ctx() ctx: RequestContext, @Args("input") input: AdminCreateBbbOrganizationInput) {
    return this.orgService.create(ctx, input);
  }

  @Allow(BbbAdminPermission.Permission, BbbManageOrganizationsPermission.Permission)
  @Transaction()
  @Mutation()
  updateBbbOrganization(
    @Ctx() ctx: RequestContext,
    @Args("id") id: string,
    @Args("input") input: UpdateBbbOrganizationInput,
  ) {
    return this.orgService.update(ctx, id, input);
  }

  // ─── Members (NEW — M4) ──────────────────────────────────────────────────────

  @Query()
  @Allow(BbbAdminPermission.Permission, BbbManageMembersPermission.Permission)
  async bbbOrganizationMembers(
    @Ctx() ctx: RequestContext,
    @Args("organizationId") organizationId: string,
    @Args("options") options?: { skip?: number; take?: number },
  ): Promise<{ items: MemberWithCustomer[]; totalItems: number }> {
    const result = await this.memberService.findByOrganization(
      ctx,
      organizationId,
      options,
    );
    // Augment each member with customer display info by fetching Customer records.
    const customerIds = [
      ...new Set(result.items.map((m) => m.customerId).filter(Boolean)),
    ];
    const customers = customerIds.length
      ? await this.connection
          .getRepository(ctx, Customer)
          .findBy({ id: In(customerIds) as any })
      : [];
    // Build lookup map with String(id) keys to handle numeric/string type mismatch
    const customerMap = new Map<string, Customer>();
    for (const c of customers) {
      customerMap.set(String(c.id), c);
    }

    const items = result.items.map((m) => {
      const c = m.customerId
        ? customerMap.get(String(m.customerId))
        : undefined;
      return {
        ...m,
        customerName: c
          ? [c.firstName, c.lastName].filter(Boolean).join(" ") || null
          : null,
        customerEmail: c?.emailAddress ?? null,
      };
    });
    return { items, totalItems: result.totalItems };
  }

  @Query()
  @Allow(BbbAdminPermission.Permission, BbbManageMembersPermission.Permission)
  async bbbOrganizationMember(
    @Ctx() ctx: RequestContext,
    @Args("id") id: string,
  ): Promise<MemberWithCustomer | null> {
    const member = await this.connection
      .getRepository(ctx, BbbOrganizationMember)
      .findOne({
        where: { id },
      });
    if (!member || !member.customerId) return member;

    const customer = await this.connection
      .getRepository(ctx, Customer)
      .findOne({ where: { id: member.customerId as string } });

    return {
      ...member,
      customerName: customer
        ? [customer.firstName, customer.lastName].filter(Boolean).join(" ") ||
          null
        : null,
      customerEmail: customer?.emailAddress ?? null,
    };
  }

  @Allow(BbbAdminPermission.Permission, BbbManageMembersPermission.Permission)
  @Transaction()
  @Mutation()
  addBbbMember(@Ctx() ctx: RequestContext, @Args("input") input: AddBbbMemberInput) {
    return this.memberService.addMember(ctx, input);
  }

  @Allow(BbbAdminPermission.Permission, BbbManageMembersPermission.Permission)
  @Transaction()
  @Mutation()
  updateBbbMember(
    @Ctx() ctx: RequestContext,
    @Args("id") id: string,
    @Args("input") input: UpdateBbbMemberInput,
  ) {
    return this.memberService.updateMember(ctx, id, input);
  }

  @Allow(BbbAdminPermission.Permission, BbbManageMembersPermission.Permission)
  @Transaction()
  @Mutation()
  removeBbbMember(@Ctx() ctx: RequestContext, @Args("id") id: string) {
    return this.memberService.removeMember(ctx, id);
  }

  // ─── Organization Membership CRUD (FEAT-001 / BUG-018) ──────────────────────

  @Query()
  @Allow(BbbAdminPermission.Permission, BbbManageMembersPermission.Permission)
  async bbbOrgMemberships(
    @Ctx() ctx: RequestContext,
    @Args("organizationId") organizationId: string,
  ): Promise<BbbOrganizationMembership[]> {
    return this.membershipService.listByOrganization(ctx, organizationId);
  }

  @Allow(BbbAdminPermission.Permission, BbbManageMembersPermission.Permission)
  @Transaction()
  @Mutation()
  async createBbbOrgMembership(
    @Ctx() ctx: RequestContext,
    @Args("input")
    input: {
      organizationId: string;
      customerId: string;
      channelId: string;
      role: string;
    },
  ): Promise<BbbOrganizationMembership> {
    return this.membershipService.create(ctx, {
      organizationId: input.organizationId,
      customerId: input.customerId,
      channelId: input.channelId,
      role: input.role as "org_admin" | "moderator" | "staff",
    });
  }

  @Allow(BbbAdminPermission.Permission, BbbManageMembersPermission.Permission)
  @Transaction()
  @Mutation()
  async updateBbbOrgMembership(
    @Ctx() ctx: RequestContext,
    @Args("id") id: string,
    @Args("input")
    input: {
      role?: string;
      isActive?: boolean;
    },
  ): Promise<BbbOrganizationMembership> {
    return this.membershipService.update(ctx, id, {
      role: input.role as "org_admin" | "moderator" | "staff" | undefined,
      isActive: input.isActive,
    });
  }

  @Allow(BbbAdminPermission.Permission, BbbManageMembersPermission.Permission)
  @Transaction()
  @Mutation()
  async removeBbbOrgMembership(
    @Ctx() ctx: RequestContext,
    @Args("id") id: string,
  ): Promise<boolean> {
    await this.membershipService.remove(ctx, id);
    return true;
  }

  // ─── Retry Meeting (resets room + creates new meeting) ─────────────────────

  @Allow(BbbAdminPermission.Permission, BbbManageMeetingsPermission.Permission)
  @Transaction()
  @Mutation()
  async retryBbbMeeting(
    @Ctx() ctx: RequestContext,
    @Args("failedMeetingId") failedMeetingId: string,
  ): Promise<BbbMeeting> {
    const failed = await this.meetingService.findById(ctx, failedMeetingId);
    if (!failed) {
      throw new EntityNotFoundError("BbbMeeting", failedMeetingId);
    }

    // If the failed meeting has an associated room, reset the room FSM so
    // the new meeting can be provisioned via the room-based path. This is
    // critical because the room may be stuck in "Failed" state with
    // retryCount >= maxAutoRetries, causing requestProvisioning to return
    // shouldEnqueue=false for storefront users.
    if (failed.roomId) {
      await this.roomService.resetFailedRoom(ctx, failed.roomId);
    }

    return this.meetingService.createAndEnqueue(ctx, {
      organizationId: failed.organization.id,
      title: failed.title,
      recordingEnabled: failed.recordingEnabled,
    });
  }

  // ─── Meetings ───────────────────────────────────────────────────────────────

  @Query()
  @Allow(BbbAdminPermission.Permission, BbbManageMeetingsPermission.Permission)
  bbbMeetings(
    @Ctx() ctx: RequestContext,
    @Args("organizationId") orgId?: string,
    @Args("options") options?: { skip?: number; take?: number },
  ) {
    return this.meetingService.findAll(ctx, orgId, options);
  }

  @Query()
  @Allow(BbbAdminPermission.Permission, BbbManageMeetingsPermission.Permission)
  bbbMeeting(@Ctx() ctx: RequestContext, @Args("id") id: string) {
    return this.meetingService.findById(ctx, id);
  }

  @Allow(BbbAdminPermission.Permission, BbbManageMeetingsPermission.Permission)
  @Transaction()
  @Mutation()
  createBbbMeeting(@Ctx() ctx: RequestContext, @Args("input") input: CreateBbbMeetingInput) {
    return this.meetingService.createAndEnqueue(ctx, input);
  }

  @Allow(BbbAdminPermission.Permission, BbbManageMeetingsPermission.Permission)
  @Transaction()
  @Mutation()
  updateBbbMeeting(
    @Ctx() ctx: RequestContext,
    @Args("id") id: string,
    @Args("input") input: UpdateBbbMeetingInput,
  ) {
    return this.meetingService.update(ctx, id, input);
  }

  @Allow(BbbAdminPermission.Permission, BbbManageMeetingsPermission.Permission)
  @Transaction()
  @Mutation()
  async deleteBbbMeeting(
    @Ctx() ctx: RequestContext,
    @Args("id") id: string,
  ): Promise<boolean> {
    await this.meetingService.delete(ctx, id);
    return true;
  }

  @Allow(BbbAdminPermission.Permission, BbbManageMeetingsPermission.Permission)
  @Transaction()
  @Mutation()
  endBbbMeeting(@Ctx() ctx: RequestContext, @Args("id") id: string) {
    return this.meetingService.endMeeting(ctx, id);
  }

  @Allow(BbbAdminPermission.Permission, BbbPlatformInfrastructurePermission.Permission)
  @Transaction()
  @Mutation()
  async deleteBbbServer(
    @Ctx() ctx: RequestContext,
    @Args("id") id: string,
  ): Promise<boolean> {
    await this.serverService.delete(ctx, id);
    return true;
  }

  @Allow(BbbAdminPermission.Permission, BbbManageOrganizationsPermission.Permission)
  @Transaction()
  @Mutation()
  async deleteBbbOrganization(
    @Ctx() ctx: RequestContext,
    @Args("id") id: string,
  ): Promise<boolean> {
    await this.orgService.delete(ctx, id);
    return true;
  }

  @Query()
  @Allow(BbbAdminPermission.Permission, BbbManageMeetingsPermission.Permission)
  async bbbModeratorJoinUrl(
    @Ctx() ctx: RequestContext,
    @Args("meetingId") meetingId: string,
    @Args("moderatorName") moderatorName: string,
  ): Promise<string> {
    return this.meetingService.getModeratorJoinUrl(
      ctx,
      meetingId,
      moderatorName,
    );
  }

  // ─── Capacity Grants ────────────────────────────────────────────────────────

  @Query()
  @Allow(BbbAdminPermission.Permission, BbbManageOrganizationsPermission.Permission)
  async bbbCapacityGrants(
    @Ctx() ctx: RequestContext,
    @Args("organizationId") orgId: string,
    @Args("options") options?: { skip?: number; take?: number },
  ): Promise<{ items: BbbCapacityGrant[]; totalItems: number }> {
    const take = Math.min(Math.max(options?.take ?? 25, 1), 100);
    const skip = Math.max(options?.skip ?? 0, 0);
    const [items, totalItems] = await this.connection
      .getRepository(ctx, BbbCapacityGrant)
      .findAndCount({
        where: { organization: { id: orgId } },
        order: { createdAt: "DESC" },
        skip,
        take,
      });
    return { items, totalItems };
  }

  @Allow(BbbAdminPermission.Permission, BbbManageOrganizationsPermission.Permission)
  @Transaction()
  @Mutation()
  async createBbbCapacityGrant(
    @Ctx() ctx: RequestContext,
    @Args("input")
    input: {
      organizationId: string;
      grantedMinutes: number;
      validFrom?: string;
      validUntil?: string;
    },
  ): Promise<BbbCapacityGrant> {
    const org = await this.connection.getEntityOrThrow(
      ctx,
      BbbOrganization,
      input.organizationId,
    );
    const now = new Date();
    const thirtyDaysOut = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    const grant = new BbbCapacityGrant({
      organization: org,
      grantedMinutes: input.grantedMinutes ?? 0,
      consumedMinutes: 0,
      validFrom: input.validFrom ? new Date(input.validFrom) : now,
      validUntil: input.validUntil ? new Date(input.validUntil) : thirtyDaysOut,
      exhausted: false,
    });
    return this.connection.getRepository(ctx, BbbCapacityGrant).save(grant);
  }

  // ─── Rooms ──────────────────────────────────────────────────────────────────

  @Query()
  @Allow(BbbAdminPermission.Permission, BbbManageRoomsPermission.Permission)
  bbbRooms(
    @Ctx() ctx: RequestContext,
    @Args("organizationId") orgId: string,
    @Args("options") options?: { skip?: number; take?: number },
  ) {
    return this.roomService.findAll(ctx, orgId, options);
  }

  @Query()
  @Allow(BbbAdminPermission.Permission, BbbManageRoomsPermission.Permission)
  bbbRoom(@Ctx() ctx: RequestContext, @Args("id") id: string) {
    return this.roomService.findById(ctx, id);
  }

  @Allow(BbbAdminPermission.Permission, BbbManageRoomsPermission.Permission)
  @Transaction()
  @Mutation()
  createBbbRoom(@Ctx() ctx: RequestContext, @Args("input") input: CreateBbbRoomInput) {
    return this.roomService.create(ctx, {
      ...input,
      createdByCustomerId: undefined,
    });
  }

  @Allow(BbbAdminPermission.Permission, BbbManageRoomsPermission.Permission)
  @Transaction()
  @Mutation()
  async updateBbbRoom(
    @Ctx() ctx: RequestContext,
    @Args("id") id: string,
    @Args("input") input: UpdateBbbRoomInput,
  ) {
    await this.connection.getRepository(ctx, BbbRoom).update(id, input);
    return this.roomService.findById(ctx, id);
  }

  @Allow(BbbAdminPermission.Permission, BbbManageRoomsPermission.Permission)
  @Transaction()
  @Mutation()
  async deleteBbbRoom(
    @Ctx() ctx: RequestContext,
    @Args("id") id: string,
  ): Promise<boolean> {
    await this.connection.getRepository(ctx, BbbRoom).delete(id);
    return true;
  }

  @Allow(BbbAdminPermission.Permission, BbbManageRoomsPermission.Permission)
  @Transaction()
  @Mutation()
  resetBbbRoom(@Ctx() ctx: RequestContext, @Args("id") id: string) {
    return this.roomService.resetFailedRoom(ctx, id);
  }

  // ─── Product Access ─────────────────────────────────────────────────────────

  @Query()
  @Allow(BbbAdminPermission.Permission, BbbManageRoomsPermission.Permission)
  bbbProductAccessByRoom(
    @Ctx() ctx: RequestContext,
    @Args("roomId") roomId: string,
  ): Promise<BbbProductAccess[]> {
    return this.connection
      .getRepository(ctx, BbbProductAccess)
      .find({ where: { room: { id: roomId } }, relations: ["room"] });
  }

  @Allow(BbbAdminPermission.Permission, BbbManageRoomsPermission.Permission)
  @Transaction()
  @Mutation()
  async createBbbProductAccess(
    @Ctx() ctx: RequestContext,
    @Args("input")
    input: { roomId: string; productVariantId: string; accessDays?: number },
  ): Promise<BbbProductAccess> {
    const room = await this.connection.getEntityOrThrow(
      ctx,
      BbbRoom,
      input.roomId,
    );
    const access = new BbbProductAccess({
      room,
      productVariantId: input.productVariantId,
      accessDays: input.accessDays ?? null,
    });
    return this.connection.getRepository(ctx, BbbProductAccess).save(access);
  }

  @Allow(BbbAdminPermission.Permission, BbbManageRoomsPermission.Permission)
  @Transaction()
  @Mutation()
  async deleteBbbProductAccess(
    @Ctx() ctx: RequestContext,
    @Args("id") id: string,
  ): Promise<boolean> {
    await this.connection.getRepository(ctx, BbbProductAccess).delete(id);
    return true;
  }

  @Query()
  @Allow(BbbAdminPermission.Permission, BbbManageRoomsPermission.Permission)
  async bbbEnrollmentsByRoom(
    @Ctx() ctx: RequestContext,
    @Args("roomId") roomId: string,
    @Args("options") options?: { skip?: number; take?: number },
  ): Promise<{ items: object[]; totalItems: number }> {
    const take = Math.min(Math.max(options?.take ?? 25, 1), 100);
    const skip = Math.max(options?.skip ?? 0, 0);
    const [enrollments, totalItems] = await this.connection
      .getRepository(ctx, BbbEnrollment)
      .findAndCount({
        where: { roomId },
        order: { createdAt: "DESC" },
        skip,
        take,
      });

    const customerIds = [...new Set(enrollments.map((e) => e.customerId))];
    const customers = customerIds.length
      ? await this.connection
          .getRepository(ctx, Customer)
          .findBy({ id: In(customerIds) as any })
      : [];
    const customerMap = new Map(customers.map((c) => [c.id, c]));

    const items = enrollments.map((e) => {
      const c = customerMap.get(e.customerId);
      return {
        ...e,
        customerName: c
          ? [c.firstName, c.lastName].filter(Boolean).join(" ") || null
          : null,
        customerEmail: c?.emailAddress ?? null,
      };
    });
    return { items, totalItems };
  }

  @Allow(BbbAdminPermission.Permission, BbbManageRoomsPermission.Permission)
  @Transaction()
  @Mutation()
  async deactivateBbbEnrollment(
    @Ctx() ctx: RequestContext,
    @Args("id") id: string,
  ): Promise<BbbEnrollment> {
    const enrollment = await this.connection.getEntityOrThrow(
      ctx,
      BbbEnrollment,
      id,
    );
    enrollment.active = false;
    return this.connection.getRepository(ctx, BbbEnrollment).save(enrollment);
  }

  @Allow(BbbAdminPermission.Permission, BbbManageRoomsPermission.Permission)
  @Transaction()
  @Mutation()
  async createBbbEnrollment(
    @Ctx() ctx: RequestContext,
    @Args("input")
    input: {
      roomId: string;
      customerId: string;
      accessDays?: number;
      reason?: string;
    },
  ): Promise<BbbEnrollment> {
    const room = await this.connection.getEntityOrThrow(
      ctx,
      BbbRoom,
      input.roomId,
    );
    const expiresAt =
      input.accessDays != null
        ? new Date(Date.now() + input.accessDays * 24 * 60 * 60 * 1000)
        : null;

    // Upsert: re-activate existing deactivated enrollment
    const existing = await this.connection
      .getRepository(ctx, BbbEnrollment)
      .findOne({
        where: { roomId: input.roomId, customerId: input.customerId },
      });

    if (existing) {
      existing.active = true;
      existing.expiresAt = expiresAt;
      existing.source = "admin";
      return this.connection.getRepository(ctx, BbbEnrollment).save(existing);
    }

    return this.connection.getRepository(ctx, BbbEnrollment).save(
      new BbbEnrollment({
        room,
        roomId: input.roomId,
        customerId: input.customerId,
        orderId: null,
        active: true,
        expiresAt,
        source: "admin",
      }),
    );
  }

  @Query()
  @Allow(BbbAdminPermission.Permission, BbbManageRoomsPermission.Permission)
  async bbbProductVariantSearch(
    @Ctx() ctx: RequestContext,
    @Args("term") term: string,
  ): Promise<
    Array<{ id: string; name: string; sku: string; productName: string }>
  > {
    const { ProductVariant } = await import("@vendure/core");
    const variants = await this.connection
      .getRepository(ctx, ProductVariant)
      .createQueryBuilder("v")
      .innerJoinAndSelect("v.product", "p")
      .innerJoinAndSelect("v.translations", "vt")
      .innerJoinAndSelect("p.translations", "pt")
      .where(
        "LOWER(v.sku) LIKE LOWER(:term) OR LOWER(vt.name) LIKE LOWER(:term) OR LOWER(pt.name) LIKE LOWER(:term)",
        {
          term: `%${term}%`,
        },
      )
      .andWhere("v.deletedAt IS NULL")
      .take(10)
      .getMany();

    return variants.map((v) => ({
      id: String(v.id),
      name: (v.translations?.[0] as any)?.name ?? v.sku,
      sku: v.sku,
      productName: (v.product?.translations?.[0] as any)?.name ?? "",
    }));
  }

  // ─── Trial Registrations (Admin) ───────────────────────────────────────────

  @Query()
  @Allow(BbbAdminPermission.Permission, BbbManageSessionsPermission.Permission)
  async bbbTrialRegistrationsBySession(
    @Ctx() ctx: RequestContext,
    @Args("sessionId") sessionId: string,
  ): Promise<BbbTrialRegistration[]> {
    const result = await this.trialRegistrationService.findAllBySession(ctx, sessionId);
    return result.items;
  }

  @Query()
  @Allow(BbbAdminPermission.Permission, BbbManageSessionsPermission.Permission)
  async bbbTrialRegistrationsByOrganization(
    @Ctx() ctx: RequestContext,
    @Args("organizationId") orgId: string,
  ): Promise<BbbTrialRegistration[]> {
    // Fetch all scheduled sessions for the org, then collect registrations
    const sessions = await this.scheduledSessionService.findByOrganization(ctx, orgId);
    const allRegistrations: BbbTrialRegistration[] = [];
    for (const session of sessions) {
      const result = await this.trialRegistrationService.findAllBySession(ctx, String(session.id));
      allRegistrations.push(...result.items);
    }
    // Sort by registeredAt DESC
    allRegistrations.sort((a, b) => b.registeredAt.getTime() - a.registeredAt.getTime());
    return allRegistrations;
  }

  @Allow(BbbAdminPermission.Permission, BbbManageSessionsPermission.Permission)
  @Transaction()
  @Mutation()
  async updateBbbTrialRegistrationStatus(
    @Ctx() ctx: RequestContext,
    @Args("id") id: string,
    @Args("status") status: "REGISTERED" | "ATTENDED" | "CANCELLED" | "NO_SHOW",
  ): Promise<BbbTrialRegistration> {
    return this.trialRegistrationService.updateStatus(ctx, String(id), status);
  }

  @Allow(BbbAdminPermission.Permission, BbbManageSessionsPermission.Permission)
  @Transaction()
  @Mutation()
  async convertTrialToEnrollment(
    @Ctx() ctx: RequestContext,
    @Args("registrationId") registrationId: string,
    @Args("roomId") roomId: string,
    @Args("accessDays") accessDays?: number,
  ): Promise<BbbEntitlement> {
    return this.trialRegistrationService.convertToEnrollment(
      ctx,
      registrationId,
      String(roomId),
      accessDays,
    );
  }

  // ─── Entitlements ─────────────────────────────────────────────────────────

  @Query()
  @Allow(BbbAdminPermission.Permission, BbbManageEntitlementsPermission.Permission)
  async bbbEntitlements(
    @Ctx() ctx: RequestContext,
    @Args("options") options?: { skip?: number; take?: number },
  ): Promise<{ items: BbbEntitlement[]; totalItems: number }> {
    const take = Math.min(Math.max(options?.take ?? 25, 1), 100);
    const skip = Math.max(options?.skip ?? 0, 0);
    const [items, totalItems] = await this.connection
      .getRepository(ctx, BbbEntitlement)
      .findAndCount({
        order: { createdAt: "DESC" },
        skip,
        take,
      });
    return { items, totalItems };
  }

  @Allow(BbbAdminPermission.Permission, BbbManageEntitlementsPermission.Permission)
  @Transaction()
  @Mutation()
  async createBbbEntitlement(
    @Ctx() ctx: RequestContext,
    @Args("input")
    input: {
      customerId: string;
      type: "bbb_session" | "bbb_room";
      resourceId: string;
      source: "purchase" | "trial" | "admin" | "import";
      validFrom?: string;
      validUntil?: string;
    },
  ): Promise<BbbEntitlement> {
    const entitlement = new BbbEntitlement({
      customerId: input.customerId,
      type: input.type,
      resourceId: input.resourceId,
      source: input.source,
      validFrom: input.validFrom ? new Date(input.validFrom) : null,
      validUntil: input.validUntil ? new Date(input.validUntil) : null,
    });
    return this.connection.getRepository(ctx, BbbEntitlement).save(entitlement);
  }

  @Allow(BbbAdminPermission.Permission, BbbManageEntitlementsPermission.Permission)
  @Transaction()
  @Mutation()
  async deleteBbbEntitlement(
    @Ctx() ctx: RequestContext,
    @Args("id") id: string,
  ): Promise<boolean> {
    await this.connection.getRepository(ctx, BbbEntitlement).delete(id);
    return true;
  }

  // ─── Scheduled Sessions ────────────────────────────────────────────────────

  @Query()
  @Allow(BbbAdminPermission.Permission, BbbManageSessionsPermission.Permission)
  bbbScheduledSessions(
    @Ctx() ctx: RequestContext,
    @Args("organizationId") orgId: string,
  ) {
    return this.scheduledSessionService.findByOrganization(ctx, orgId);
  }

  @Query()
  @Allow(BbbAdminPermission.Permission, BbbManageSessionsPermission.Permission)
  bbbScheduledSession(
    @Ctx() ctx: RequestContext,
    @Args("id") id: string,
  ) {
    return this.scheduledSessionService.findById(ctx, id);
  }

  @Allow(BbbAdminPermission.Permission, BbbManageSessionsPermission.Permission)
  @Transaction()
  @Mutation()
  createBbbScheduledSession(
    @Ctx() ctx: RequestContext,
    @Args("input") input: CreateBbbScheduledSessionInput,
  ) {
    return this.scheduledSessionService.create(ctx, input);
  }

  @Allow(BbbAdminPermission.Permission, BbbManageSessionsPermission.Permission)
  @Transaction()
  @Mutation()
  cancelBbbScheduledSession(
    @Ctx() ctx: RequestContext,
    @Args("id") id: string,
  ) {
    return this.scheduledSessionService.cancel(ctx, id);
  }
}
