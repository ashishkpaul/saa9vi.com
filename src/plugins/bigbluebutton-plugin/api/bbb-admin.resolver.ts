// src/plugins/bigbluebutton-plugin/api/bbb-admin.resolver.ts
// CHANGE: Added member queries and mutations (M4). All existing code preserved.
// CHANGE (Phase B): Granular permissions. Each method is decorated with
// @Allow(BbbAdminPermission.Permission, <granular>.Permission) so BBBAdmin
// remains backward compatible while allowing finer-grained roles.

import { Args, Mutation, Query, Resolver } from "@nestjs/graphql";
import {
  Allow,
  Ctx,
  Permission,
  RequestContext,
  Transaction,
  TransactionalConnection,
  UserInputError,
} from "@vendure/core";
import { In } from "typeorm";
import { BbbServerService } from "../services/bbb-server.service";
import { BbbOrganizationService } from "../services/bbb-organization.service";
// H3 (BUG-049 / INV-029): capacity-grant reads are channel-asserted, exactly as
// `BbbOrganizationService.findById/update/delete` already are.
import { BbbChannelAccessService } from "../services/bbb-channel-access.service";
import { BbbMeetingService } from "../services/bbb-meeting.service";
import { BbbMemberService } from "../services/bbb-member.service";
import { BbbScheduledSessionService } from "../services/bbb-scheduled-session.service";
import { BbbRoomService } from "../services/bbb-room.service";
import { BbbReconciliationService } from "../services/bbb-reconciliation.service";
import { BbbRoom } from "../entities/bbb-room.entity";
import { BbbCapacityGrant } from "../entities/bbb-capacity-grant.entity";
import { BbbOrganization } from "../entities/bbb-organization.entity";
import { BbbOrganizationMember } from "../entities/bbb-organization-member.entity";
import { BbbOrganizationMembership } from "../entities/bbb-organization-membership.entity";
import { BbbProductAccess } from "../entities/bbb-product-access.entity";
import { BbbEnrollment } from "../entities/bbb-enrollment.entity";
import { BbbEntitlement } from "../entities/bbb-entitlement.entity";
import { BbbMeeting } from "../entities/bbb-meeting.entity";
import { BbbScheduledSession } from "../entities/bbb-scheduled-session.entity";
import { BbbSessionTemplate } from "../entities/bbb-session-template.entity";
import {
  BILLING_MODE,
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
import {
  BbbPlatformCapacityPolicyService,
  EffectiveCapacityPolicy,
} from "../services/bbb-platform-capacity-policy.service";
import { BbbPlatformCapacityPolicy } from "../entities/bbb-platform-capacity-policy.entity";
import { BbbTrialRegistration } from "../entities/trial-registration.entity";
import { SessionAttendance } from "../entities/session-attendance.entity";

import { Customer, EntityNotFoundError } from "@vendure/core";
import { AttendanceAnalyticsService } from "../services/attendance-analytics.service";
import { BbbBillingService } from "../services/bbb-billing.service";

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
  /** 0 = unlimited. Only platform operators should set this. */
  maxSessionsPerOrg?: number;
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

/** Per-pass counts returned by runBbbReconciliation (mirrors the scheduled task result). */
interface BbbReconciliationResult {
  provisioningFixed: number;
  activeReconciled: number;
  roomsReconciled: number;
  billingRecovered: number;
  meteredRecovered: number;
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
  subjectTags?: string[];
  isTrial?: boolean;
  visibility?: string;
  /** Optional room linkage (ADR-047 / D5); validated against the session's org. */
  roomId?: string;
}

interface CreateBbbSessionTemplateInput {
  organizationId: string;
  name: string;
  defaultTitle: string;
  defaultTrainerId?: string;
  durationMinutes?: number;
  defaultSubjectTags?: string[];
  defaultVisibility?: string;
  productVariantId?: string;
}

interface UpdateBbbScheduledSessionInput {
  title?: string;
  startTime?: string;
  endTime?: string;
  subjectTags?: string[];
  visibility?: string;
  isTrial?: boolean;
  /** Room linkage (ADR-047 / D5); null detaches. Must belong to the same org. */
  roomId?: string | null;
}

@Resolver()
export class BbbAdminResolver {
  constructor(
    private readonly serverService: BbbServerService,
    private readonly orgService: BbbOrganizationService,
    private readonly channelAccess: BbbChannelAccessService,
    private readonly meetingService: BbbMeetingService,
    private readonly memberService: BbbMemberService,
    private readonly roomService: BbbRoomService,
    private readonly scheduledSessionService: BbbScheduledSessionService,
    private readonly trialRegistrationService: TrialRegistrationService,
    private readonly membershipService: BbbMembershipService,
    private readonly capacityIntelligenceService: CapacityIntelligenceService,
    private readonly capacityPolicyService: BbbPlatformCapacityPolicyService,
    private readonly connection: TransactionalConnection,
    private readonly attendanceAnalytics: AttendanceAnalyticsService,
    private readonly billingService: BbbBillingService,
    private readonly reconciliationService: BbbReconciliationService,
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

  /**
   * Resolve the BbbOrganization bound to the active channel (Channel = Tenant).
   *
   * Mirrors the Shop API's `orgService.findByChannelId(ctx)` resolution
   * (bbb-shop.resolver.ts `myBbbMeetings`) so tenant screens read the tenant
   * from the channel context instead of asking the client to pick one.
   * Returns null when the active channel has no organization.
   *
   * Every granular BBB permission is allowed: this exposes only the caller's
   * own channel, which BbbChannelAccessService already treats as readable.
   */
  @Query()
  @Allow(
    BbbAdminPermission.Permission,
    BbbPlatformInfrastructurePermission.Permission,
    BbbManageOrganizationsPermission.Permission,
    BbbManageRoomsPermission.Permission,
    BbbManageSessionsPermission.Permission,
    BbbManageMeetingsPermission.Permission,
    BbbManageEntitlementsPermission.Permission,
    BbbManageMembersPermission.Permission,
  )
  bbbMyOrganization(@Ctx() ctx: RequestContext): Promise<BbbOrganization | null> {
    return this.orgService.findByChannelId(ctx);
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
  async updateBbbOrganization(
    @Ctx() ctx: RequestContext,
    @Args("id") id: string,
    @Args("input") input: UpdateBbbOrganizationInput,
  ) {
    // ADR-048: assert the caller owns the organization before the allowlisted
    // write. The service asserts too — this is the resolver-boundary gate the
    // assertionCoverage ratchet pins.
    await this.channelAccess.assertOrganizationAccess(ctx, id);
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
    // Channel ownership FIRST (INV: Channel=Tenant). `organizationId` is a
    // caller-supplied GraphQL argument and BbbOrganizationMember rows are
    // returned with their customers' PII (customerName/customerEmail), so
    // without this assert the list is an unauthenticated cross-tenant read
    // handle. DefaultEntityAccessControlStrategy implements canAccess() only —
    // there is no row-level channel scoping to fall back on.
    await this.channelAccess.assertOrganizationAccess(ctx, organizationId);

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
        relations: ["organization"],
      });
    // Channel ownership derived from the LOADED row: BbbOrganizationMember has
    // no scalar channelId and no denormalized organizationId, so the caller
    // cannot supply the tenant — the member's own organization is the only
    // authority. A missing row still returns null (nothing to disclose); a row
    // belonging to a foreign tenant is refused.
    if (member) {
      await this.channelAccess.assertOrganizationAccess(
        ctx,
        member.organization.id,
      );
    }
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
  async addBbbMember(@Ctx() ctx: RequestContext, @Args("input") input: AddBbbMemberInput) {
    // ADR-048: assert the caller owns the target organization before writing.
    await this.channelAccess.assertOrganizationAccess(ctx, input.organizationId);
    return this.memberService.addMember(ctx, input);
  }

  @Allow(BbbAdminPermission.Permission, BbbManageMembersPermission.Permission)
  @Transaction()
  @Mutation()
  async updateBbbMember(
    @Ctx() ctx: RequestContext,
    @Args("id") id: string,
    @Args("input") input: UpdateBbbMemberInput,
  ) {
    // ADR-048: assert the caller owns the member's organization before writing.
    await this.channelAccess.assertMemberAccess(ctx, id);
    return this.memberService.updateMember(ctx, id, input);
  }

  @Allow(BbbAdminPermission.Permission, BbbManageMembersPermission.Permission)
  @Transaction()
  @Mutation()
  async removeBbbMember(@Ctx() ctx: RequestContext, @Args("id") id: string) {
    // ADR-048: assert the caller owns the member's organization before deleting.
    await this.channelAccess.assertMemberAccess(ctx, id);
    return this.memberService.removeMember(ctx, id);
  }

  // ─── Organization Membership CRUD (FEAT-001 / BUG-018) ──────────────────────

  @Query()
  @Allow(BbbAdminPermission.Permission, BbbManageMembersPermission.Permission)
  async bbbOrgMemberships(
    @Ctx() ctx: RequestContext,
    @Args("organizationId") organizationId: string,
  ): Promise<BbbOrganizationMembership[]> {
    // Channel ownership FIRST — same untrusted-argument shape as
    // bbbOrganizationMembers: memberships carry customerId + role, so an
    // asserted organization is what makes the list tenant-safe.
    await this.channelAccess.assertOrganizationAccess(ctx, organizationId);

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
    // ADR-048: assert the caller owns the target organization before writing.
    await this.channelAccess.assertOrganizationAccess(ctx, input.organizationId);
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
    // ADR-048: assert the caller owns the membership's channel before writing.
    await this.channelAccess.assertMembershipAccess(ctx, id);
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
    // ADR-048: assert the caller owns the membership's channel before deleting.
    await this.channelAccess.assertMembershipAccess(ctx, id);
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
    // ADR-048: assert ownership of the failed meeting before reading it —
    // findById asserts too, but the resolver boundary must not depend on that.
    await this.channelAccess.assertMeetingAccess(ctx, failedMeetingId);
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

    const next = await this.meetingService.createAndEnqueue(ctx, {
      organizationId: failed.organization.id,
      title: failed.title,
      recordingEnabled: failed.recordingEnabled,
    });

    // Relink any scheduled session whose activeMeeting was the failed meeting
    // so the provisioning listener (which transitions the session to LIVE on
    // MeetingProvisionedEvent of the linked meeting) works for retried meetings.
    await this.connection
      .getRepository(ctx, BbbScheduledSession)
      .update({ activeMeeting: { id: failed.id } }, { activeMeeting: { id: next.id } });

    return next;
  }

  // ─── Meetings ───────────────────────────────────────────────────────────────

  @Query()
  @Allow(BbbAdminPermission.Permission, BbbManageMeetingsPermission.Permission)
  bbbMeetings(
    @Ctx() ctx: RequestContext,
    @Args("organizationId") orgId?: string,
    @Args("options") options?: { skip?: number; take?: number },
    @Args("roomId") roomId?: string,
  ) {
    return this.meetingService.findAll(ctx, orgId, options, roomId);
  }

  @Query()
  @Allow(BbbAdminPermission.Permission, BbbManageMeetingsPermission.Permission)
  bbbMeeting(@Ctx() ctx: RequestContext, @Args("id") id: string) {
    return this.meetingService.findById(ctx, id);
  }

  @Allow(BbbAdminPermission.Permission, BbbManageMeetingsPermission.Permission)
  @Transaction()
  @Mutation()
  async createBbbMeeting(@Ctx() ctx: RequestContext, @Args("input") input: CreateBbbMeetingInput) {
    // ADR-048: assert the caller owns the target organization before minting a
    // meeting. Without this a tenant admin with the right permission could
    // create a meeting that consumes a foreign channel's provisioning capacity.
    await this.channelAccess.assertOrganizationAccess(ctx, input.organizationId);
    return this.meetingService.createAndEnqueue(ctx, input);
  }

  @Allow(BbbAdminPermission.Permission, BbbManageMeetingsPermission.Permission)
  @Transaction()
  @Mutation()
  async updateBbbMeeting(
    @Ctx() ctx: RequestContext,
    @Args("id") id: string,
    @Args("input") input: UpdateBbbMeetingInput,
  ) {
    // ADR-048: assert before delegating (meetingService.update also asserts
    // via findById — double gate, resolver boundary pinned by the ratchet).
    await this.channelAccess.assertMeetingAccess(ctx, id);
    return this.meetingService.update(ctx, id, input);
  }

  @Allow(BbbAdminPermission.Permission, BbbManageMeetingsPermission.Permission)
  @Transaction()
  @Mutation()
  async deleteBbbMeeting(
    @Ctx() ctx: RequestContext,
    @Args("id") id: string,
  ): Promise<boolean> {
    // ADR-048: assert before deleting.
    await this.channelAccess.assertMeetingAccess(ctx, id);
    await this.meetingService.delete(ctx, id);
    return true;
  }

  @Allow(BbbAdminPermission.Permission, BbbManageMeetingsPermission.Permission)
  @Transaction()
  @Mutation()
  async endBbbMeeting(@Ctx() ctx: RequestContext, @Args("id") id: string) {
    // ADR-048: assert before transitioning the meeting's state.
    await this.channelAccess.assertMeetingAccess(ctx, id);
    return this.meetingService.endMeeting(ctx, id);
  }

  /**
   * On-demand BBB reconciliation (SuperAdmin only).
   *
   * Runs the same five passes as the scheduled `bbb-reconciliation` task
   * (stuck provisioning, active-meeting drift, room drift, grant billing
   * recovery, metered billing recovery) and returns the per-pass counts, so
   * future drift can be repaired through the app instead of raw SQL.
   *
   * Deliberately NOT @Transaction()'d and does NOT touch BbbMetricsService:
   * each reconcile pass manages its own writes (some call out to the BBB
   * API), and a manual trigger must not reset the scheduled task's current
   * metrics window. The mutation takes no caller-supplied resource reference,
   * so there is nothing to channel-assert — Permission.SuperAdmin itself is
   * the tenancy boundary (same shape as marketplaceRefreshBaseline).
   */
  @Allow(Permission.SuperAdmin)
  @Mutation()
  async runBbbReconciliation(): Promise<BbbReconciliationResult> {
    const [
      provisioningFixed,
      activeReconciled,
      roomsReconciled,
      billingRecovered,
      meteredRecovered,
    ] = await Promise.all([
      this.reconciliationService.reconcileProvisioning(),
      this.reconciliationService.reconcileActiveMeetings(),
      this.reconciliationService.reconcileRooms(),
      this.reconciliationService.reconcilePendingBilling(),
      this.reconciliationService.reconcilePendingMeteredBilling(),
    ]);
    return {
      provisioningFixed,
      activeReconciled,
      roomsReconciled,
      billingRecovered,
      meteredRecovered,
    };
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

  /**
   * H2 / BUG-047 sibling (SEC-008): deleting an organization is **platform**
   * capacity governance, not a tenant act. Retargeted from
   * `BbbManageOrganizations` (held by every tenant admin role) to
   * `BBBPlatformInfrastructure`, which ADR-033 deliberately excludes from the
   * tenant role — the gate is the permission, never a tenant-role edit (A15).
   * The channel assert in `BbbOrganizationService.delete` stays as defence in
   * depth (INV-029).
   */
  @Allow(BbbAdminPermission.Permission, BbbPlatformInfrastructurePermission.Permission)
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

  /**
   * H3 / BUG-049 (SEC-008): the query accepts an arbitrary `organizationId`, so
   * it must assert channel ownership before reading — exactly the contract
   * `BbbOrganizationService.findById()` enforces for the same id shape.
   *
   * Resolved scope decision (2026-09-30, plan §7 Q2): *assert*, do not make the
   * query platform-only. Reading one's own channel's grants is legitimate (the
   * shipped `PlansList` resolves the organization from the active channel —
   * INV-029), so the tenant boundary is `ctx.channelId`, not the presence of an
   * explicit argument. Cross-tenant reads are now ForbiddenError; a SuperAdmin
   * short-circuits inside `assertOrganizationAccess`.
   */
  @Query()
  @Allow(BbbAdminPermission.Permission, BbbManageOrganizationsPermission.Permission)
  async bbbCapacityGrants(
    @Ctx() ctx: RequestContext,
    @Args("organizationId") orgId: string,
    @Args("options") options?: { skip?: number; take?: number },
  ): Promise<{ items: BbbCapacityGrant[]; totalItems: number }> {
    // Throws ForbiddenError for another tenant's org (missing org included),
    // so no cross-tenant row can reach the mapper below.
    await this.channelAccess.assertOrganizationAccess(ctx, orgId);

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

  /**
   * H2 / BUG-047 sibling (SEC-008): minting capacity is a **platform** act.
   * Retargeted from `BbbManageOrganizations` (held by every tenant admin role) to
   * `BBBPlatformInfrastructure`: a tenant admin can no longer grant itself free
   * capacity. `sourceType: 'manual'` is retained so platform overrides stay
   * distinguishable from purchases (BUG-044).
   */
  @Allow(BbbAdminPermission.Permission, BbbPlatformInfrastructurePermission.Permission)
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
    // ADR-048: assert before minting. BBBPlatformInfrastructure callers
    // (SuperAdmin/Portal Admin) still run through assertOrganizationAccess —
    // SuperAdmin short-circuits immediately, Portal Admin operates on the
    // default channel which resolves org via the channels join table.
    await this.channelAccess.assertOrganizationAccess(ctx, input.organizationId);
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
      // BUG-044: was unset, so every manual override silently stored the
      // 'order' default and was indistinguishable from a purchase.
      sourceType: "manual",
    });
    return this.connection.getRepository(ctx, BbbCapacityGrant).save(grant);
  }

  // ─── Rooms ──────────────────────────────────────────────────────────────────

  /**
   * Room list for the tenant's organization (Phase 5.4: the read carries the
   * batched `studentCount` — see `BbbRoomService.findAllCards`).
   */
  @Query()
  @Allow(BbbAdminPermission.Permission, BbbManageRoomsPermission.Permission)
  bbbRooms(
    @Ctx() ctx: RequestContext,
    @Args("organizationId") orgId: string,
    @Args("options") options?: { skip?: number; take?: number },
  ) {
    return this.roomService.findAllCards(ctx, orgId, options);
  }

  /** Single room read (Phase 5.4: same batched stats as the list). */
  @Query()
  @Allow(BbbAdminPermission.Permission, BbbManageRoomsPermission.Permission)
  bbbRoom(@Ctx() ctx: RequestContext, @Args("id") id: string) {
    return this.roomService.findCard(ctx, id);
  }

  @Allow(BbbAdminPermission.Permission, BbbManageRoomsPermission.Permission)
  @Transaction()
  @Mutation()
  async createBbbRoom(@Ctx() ctx: RequestContext, @Args("input") input: CreateBbbRoomInput) {
    // ADR-048: assert the caller owns the target organization before creating a room.
    await this.channelAccess.assertOrganizationAccess(ctx, input.organizationId);
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
    // ADR-048: assert BEFORE the entity read so a ForbiddenError is raised
    // before any foreign-channel room is loaded or mutated. Moving the assert
    // above the findOne eliminates the read-then-write authorization window.
    await this.channelAccess.assertRoomAccess(ctx, id);
    // INV-014: clamp maxParticipants to the owning org's ceiling.
    const room = await this.connection.getRepository(ctx, BbbRoom).findOne({
      where: { id },
      relations: ["organization"],
    });
    if (!room) throw new EntityNotFoundError("BbbRoom", id);
    const updateInput: UpdateBbbRoomInput = { ...input };
    if (updateInput.maxParticipants != null) {
      updateInput.maxParticipants = Math.min(
        updateInput.maxParticipants,
        room.organization.maxParticipantsPerMeeting,
      );
    }
    await this.connection.getRepository(ctx, BbbRoom).update(id, updateInput);
    return this.roomService.findById(ctx, id);
  }

  @Allow(BbbAdminPermission.Permission, BbbManageRoomsPermission.Permission)
  @Transaction()
  @Mutation()
  async deleteBbbRoom(
    @Ctx() ctx: RequestContext,
    @Args("id") id: string,
  ): Promise<boolean> {
    // ADR-048: assert the caller owns the room's organization before deleting.
    await this.channelAccess.assertRoomAccess(ctx, id);
    await this.connection.getRepository(ctx, BbbRoom).delete(id);
    return true;
  }

  @Allow(BbbAdminPermission.Permission, BbbManageRoomsPermission.Permission)
  @Transaction()
  @Mutation()
  async resetBbbRoom(@Ctx() ctx: RequestContext, @Args("id") id: string) {
    // ADR-048: assert before resetting the room FSM (service asserts too).
    await this.channelAccess.assertRoomAccess(ctx, id);
    return this.roomService.resetFailedRoom(ctx, id);
  }

  /**
   * A22 (Phase 5.2) — the dashboard's "Start class".
   *
   * Deliberately NOT `@Transaction()`: `startRoomAsModerator` runs its own
   * short transactions and then **waits** for the provisioning worker, so
   * wrapping the call in one would hold a transaction open across the wait.
   *
   * The gate is the tenant's own channel (`BbbManageRooms`); the service adds
   * the room channel assert (INV-029) and the INV-027 moderator check before
   * anything is provisioned.
   */
  @Allow(BbbAdminPermission.Permission, BbbManageRoomsPermission.Permission)
  @Mutation()
  async bbbStartRoom(
    @Ctx() ctx: RequestContext,
    @Args("roomId") roomId: string,
    @Args("moderatorName") moderatorName?: string,
    @Args("waitMs") waitMs?: number,
  ) {
    // ADR-048: assert at the resolver boundary before any provisioning work
    // starts — the service's room assert remains as defence in depth.
    await this.channelAccess.assertRoomAccess(ctx, roomId);
    return this.meetingService.startRoomAsModerator(ctx, roomId, {
      moderatorName,
      waitMs,
    });
  }

  // ─── Product Access ─────────────────────────────────────────────────────────

  @Query()
  @Allow(BbbAdminPermission.Permission, BbbManageRoomsPermission.Permission)
  async bbbProductAccessByRoom(
    @Ctx() ctx: RequestContext,
    @Args("roomId") roomId: string,
  ): Promise<BbbProductAccess[]> {
    // INV-029 read parity: this read took an arbitrary roomId with no channel
    // filter (found while auditing resolver bodies for ADR-048 clause 2 — the
    // clause itself only covers @Mutation). Cross-tenant row metadata
    // (variant id, access window) is withheld the same way the other six
    // admin reads withhold it.
    await this.channelAccess.assertRoomAccess(ctx, roomId);
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
    // ADR-048: assert the caller owns the room's organization before writing.
    await this.channelAccess.assertRoomAccess(ctx, input.roomId);
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
    // ADR-048: assert the caller owns the product-access record's room/org before deleting.
    await this.channelAccess.assertProductAccessAccess(ctx, id);
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
    // Channel ownership FIRST (INV: Channel=Tenant). `roomId` is a
    // caller-supplied argument and the rows below are joined to Customer PII
    // (customerName/customerEmail). Fixing the id-space bug underneath WITHOUT
    // this assert would have ESCALATED a missing-names bug into a cross-tenant
    // PII leak, so the two changes land together.
    await this.channelAccess.assertRoomAccess(ctx, roomId);

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

    const customerIds = [
      ...new Set(enrollments.map((e) => e.customerId).filter(Boolean)),
    ];
    const customers = customerIds.length
      ? await this.connection
          .getRepository(ctx, Customer)
          .findBy({ id: In(customerIds) as any })
      : [];
    // `customer.id` is an integer PK while the denormalized
    // `bbb_enrollment.customerId` varchar column stores the decoded id as a
    // string (both `roomId`/`customerId` are `ID!` inputs, so the IdCodec
    // decodes them at the API boundary before persistence). Keying this map on
    // the raw value (number) and looking up with the column value (string) never
    // matched, so every enrollment rendered as an "anonymous student"
    // (production-readiness defect #2). Compare in a single id space, exactly as
    // bbbOrganizationMembers already does.
    const customerMap = new Map<string, Customer>(
      customers.map((c) => [String(c.id), c]),
    );

    const items = enrollments.map((e) => {
      const c = e.customerId
        ? customerMap.get(String(e.customerId))
        : undefined;
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
    // ADR-048: assert the caller owns the enrollment's room/org before writing.
    await this.channelAccess.assertEnrollmentAccess(ctx, id);
    const enrollment = await this.connection.getEntityOrThrow(
      ctx,
      BbbEnrollment,
      id,
    );
    enrollment.active = false;
    // W5 audit trail: who deactivated, and when (trace writer #4).
    enrollment.deactivatedByUserId =
      ctx.activeUserId != null ? String(ctx.activeUserId) : null;
    enrollment.deactivatedAt = new Date();
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
    // ADR-048: assert the caller owns the target room's organization before writing.
    await this.channelAccess.assertRoomAccess(ctx, input.roomId);
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
      // W5 audit trail: re-activation clears the deactivation stamp (trace
      // writer #5) — the row reads as currently-active, not deactivated.
      existing.deactivatedByUserId = null;
      existing.deactivatedAt = null;
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
    // Channel assert (production-readiness item 2, read side): the by-org
    // variant above derives sessions through findByOrganization (which
    // asserts), but this variant trusts the raw sessionId — a cross-tenant
    // registration read. assertSessionAccess throws ForbiddenError for
    // another channel's session.
    await this.channelAccess.assertSessionAccess(ctx, sessionId);
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
    // ADR-048: assert the caller owns the registration's session's org before
    // the write. This is assertTrialRegistrationAccess's resolver call site —
    // the service-level assertRegistrationAccess stays as defence in depth.
    await this.channelAccess.assertTrialRegistrationAccess(ctx, id);
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
    // ADR-048: assert the SOURCE registration the mutation crosses
    // (session → org). The TARGET-room org check stays load-bearing in
    // TrialRegistrationService.convertToEnrollment, which must resolve the
    // room against the registration's org to preserve the EntityNotFoundError
    // contract — asserting the room up-front here would convert a "not a room
    // of this org" answer into ForbiddenError (and leak room existence).
    await this.channelAccess.assertTrialRegistrationAccess(ctx, registrationId);
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
    @Args("options")
    options?: {
      skip?: number;
      take?: number;
      filter?: { customerId?: string | null };
    },
  ): Promise<{ items: BbbEntitlement[]; totalItems: number }> {
    const take = Math.min(Math.max(options?.take ?? 25, 1), 100);
    const skip = Math.max(options?.skip ?? 0, 0);
    const [items, totalItems] = await this.connection
      .getRepository(ctx, BbbEntitlement)
      .findAndCount({
        // Invariant "Channel=Tenant". BbbEntitlement carries a denormalized
        // scalar channelId and no row-level access strategy is registered for
        // it, so this filter is the only thing between a tenant admin and every
        // other tenant's entitlement rows (each carrying a customerId).
        // Platform callers keep the unrestricted list, matching the same
        // platform-vs-tenant split already made by bbbMeetings/bbbOrganizations
        // (`isPlatformCaller` — tenant roles never hold BBBAdmin, ADR-033).
        // The customerId probe (BbbEntitlementListOptions.filter) narrows
        // within — never instead of — that scope.
        where: {
          ...(this.channelAccess.isPlatformCaller(ctx)
            ? {}
            : { channelId: String(ctx.channelId) }),
          ...(options?.filter?.customerId
            ? { customerId: String(options.filter.customerId) }
            : {}),
        },
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
    // ADR-048: channelId is stamped from ctx.channelId below so a cross-tenant
    // write is already structurally impossible. The resource-org check is
    // present here for auditability (INV-029) and to surface a clean
    // ForbiddenError if a future caller supplies a resourceId that resolves to
    // a foreign channel's session or room.
    //
    // For bbb_session resources, assert session channel. For bbb_room resources,
    // assert room channel. Skip for non-resource types (purchase/import paths
    // that carry no resolvable resourceId — the channelId stamp is sufficient).
    if (input.type === "bbb_session") {
      await this.channelAccess.assertSessionAccess(ctx, input.resourceId);
    } else if (input.type === "bbb_room") {
      await this.channelAccess.assertRoomAccess(ctx, input.resourceId);
    }
    const entitlement = new BbbEntitlement({
      customerId: input.customerId,
      type: input.type,
      resourceId: input.resourceId,
      source: input.source,
      validFrom: input.validFrom ? new Date(input.validFrom) : null,
      validUntil: input.validUntil ? new Date(input.validUntil) : null,
      // Channel isolation (INV: Channel=Tenant). hasAccess() matches on
      // channelId — an entitlement without it is invisible in the shop API.
      channelId: ctx.channelId as string,
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
    // ADR-048: assert the caller owns the entitlement's channel before deleting.
    await this.channelAccess.assertEntitlementAccess(ctx, id);
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
  updateBbbScheduledSession(
    @Ctx() ctx: RequestContext,
    @Args("id") id: string,
    @Args("input") input: UpdateBbbScheduledSessionInput,
  ) {
    return this.scheduledSessionService.update(ctx, id, input);
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

  @Allow(BbbAdminPermission.Permission, BbbManageSessionsPermission.Permission)
  @Transaction()
  @Mutation()
  publishBbbScheduledSession(
    @Ctx() ctx: RequestContext,
    @Args("id") id: string,
  ) {
    return this.scheduledSessionService.publish(ctx, id);
  }

  // ─── Session Templates (Gap 2: recurring/series) ──────────────────────────

  @Query()
  @Allow(BbbAdminPermission.Permission, BbbManageSessionsPermission.Permission)
  bbbSessionTemplates(
    @Ctx() ctx: RequestContext,
    @Args("organizationId") organizationId: string,
  ) {
    return this.scheduledSessionService.findTemplatesByOrganization(ctx, organizationId);
  }

  @Allow(BbbAdminPermission.Permission, BbbManageSessionsPermission.Permission)
  @Transaction()
  @Mutation()
  createBbbSessionTemplate(
    @Ctx() ctx: RequestContext,
    @Args("input") input: CreateBbbSessionTemplateInput,
  ): Promise<BbbSessionTemplate> {
    return this.scheduledSessionService.createTemplate(ctx, input);
  }

  @Allow(BbbAdminPermission.Permission, BbbManageSessionsPermission.Permission)
  @Transaction()
  @Mutation()
  async deleteBbbSessionTemplate(
    @Ctx() ctx: RequestContext,
    @Args("id") id: string,
  ): Promise<boolean> {
    return this.scheduledSessionService.deleteTemplate(ctx, id);
  }

  @Allow(BbbAdminPermission.Permission, BbbManageSessionsPermission.Permission)
  @Transaction()
  @Mutation()
  createSessionsFromTemplate(
    @Ctx() ctx: RequestContext,
    @Args("templateId") templateId: string,
    @Args("startTimes") startTimes: string[],
  ) {
    return this.scheduledSessionService.createSessionsFromTemplate(ctx, templateId, startTimes);
  }

  // ─── Platform Capacity Policy (ADR-031) ────────────────────────────────────

  @Query()
  @Allow(BbbAdminPermission.Permission, BbbPlatformInfrastructurePermission.Permission)
  async platformCapacityPolicies(
    @Ctx() ctx: RequestContext,
  ): Promise<BbbPlatformCapacityPolicy[]> {
    return this.connection.getRepository(ctx, BbbPlatformCapacityPolicy).find({
      order: { createdAt: "ASC" },
    });
  }

  @Query()
  @Allow(BbbAdminPermission.Permission, BbbPlatformInfrastructurePermission.Permission)
  async effectiveCapacityPolicy(
    @Ctx() ctx: RequestContext,
    @Args("channelId") channelId: string,
  ): Promise<EffectiveCapacityPolicy> {
    return this.capacityPolicyService.getEffectivePolicy(ctx, channelId);
  }

  /**
   * Upsert keyed by subscriptionPlanId (null = platform-default row).
   * Creating the first row flips capacity enforcement to policy-driven
   * (opt-in adoption — see hasAnyPolicy() guards in room/org services).
   */
  @Allow(BbbAdminPermission.Permission, BbbPlatformInfrastructurePermission.Permission)
  @Transaction()
  @Mutation()
  async upsertPlatformCapacityPolicy(
    @Ctx() ctx: RequestContext,
    @Args("input")
    input: {
      subscriptionPlanId?: string | null;
      defaultRoomCapacity: number;
      maxRoomCapacity: number;
      maxConcurrentParticipants: number;
      /**
       * Optional by design: callers that predate plan-derived concurrency omit
       * it and keep the stored value (fresh rows take the column default, 5).
       */
      maxConcurrentMeetings?: number | null;
    },
  ): Promise<BbbPlatformCapacityPolicy> {
    if (input.maxRoomCapacity < input.defaultRoomCapacity) {
      throw new Error(
        `maxRoomCapacity (${input.maxRoomCapacity}) must be >= defaultRoomCapacity (${input.defaultRoomCapacity})`,
      );
    }
    if (input.maxConcurrentMeetings != null && input.maxConcurrentMeetings < 1) {
      throw new Error(
        `maxConcurrentMeetings (${input.maxConcurrentMeetings}) must be >= 1; a tenant cannot be granted zero simultaneous meetings`,
      );
    }
    const repo = this.connection.getRepository(ctx, BbbPlatformCapacityPolicy);
    const existing = await repo.findOne({
      where: { subscriptionPlanId: input.subscriptionPlanId ?? (null as any) },
    });
    if (existing) {
      existing.defaultRoomCapacity = input.defaultRoomCapacity;
      existing.maxRoomCapacity = input.maxRoomCapacity;
      existing.maxConcurrentParticipants = input.maxConcurrentParticipants;
      // Omitted ⇒ leave the stored value untouched (never silently reset an
      // Admin's paid-tier number back to the column default).
      if (input.maxConcurrentMeetings != null) {
        existing.maxConcurrentMeetings = input.maxConcurrentMeetings;
      }
      return repo.save(existing);
    }
    return repo.save(
      new BbbPlatformCapacityPolicy({
        subscriptionPlanId: input.subscriptionPlanId ?? null,
        defaultRoomCapacity: input.defaultRoomCapacity,
        maxRoomCapacity: input.maxRoomCapacity,
        maxConcurrentParticipants: input.maxConcurrentParticipants,
        // Omitted ⇒ column default (5). TypeORM applies the DB default, so
        // pass the property only when explicitly supplied.
        ...(input.maxConcurrentMeetings != null
          ? { maxConcurrentMeetings: input.maxConcurrentMeetings }
          : {}),
      }),
    );
  }

  @Allow(BbbAdminPermission.Permission, BbbPlatformInfrastructurePermission.Permission)
  @Transaction()
  @Mutation()
  async deletePlatformCapacityPolicy(
    @Ctx() ctx: RequestContext,
    @Args("id") id: string,
  ): Promise<boolean> {
    await this.connection.getRepository(ctx, BbbPlatformCapacityPolicy).delete(id);
    return true;
  }

  // ─── Attendance Analytics (3D.3d) ──────────────────────────────────────────

  @Query()
  @Allow(BbbAdminPermission.Permission, BbbManageSessionsPermission.Permission)
  async scheduledSessionAttendance(
    @Ctx() ctx: RequestContext,
    @Args("sessionId") sessionId: string,
  ): Promise<SessionAttendance[]> {
    return this.attendanceAnalytics.getSessionAttendance(ctx, sessionId);
  }

  @Query()
  @Allow(BbbAdminPermission.Permission, BbbManageSessionsPermission.Permission)
  async scheduledSessionAttendanceSummary(
    @Ctx() ctx: RequestContext,
    @Args("sessionId") sessionId: string,
  ) {
    return this.attendanceAnalytics.getSessionAttendanceSummary(ctx, sessionId);
  }

  @Query()
  @Allow(BbbAdminPermission.Permission, BbbManageSessionsPermission.Permission)
  async channelAttendanceSummary(
    @Ctx() ctx: RequestContext,
    @Args("from") from: Date,
    @Args("to") to: Date,
  ) {
    return this.attendanceAnalytics.getChannelAttendanceSummary(ctx, from, to);
  }

  // ─── Metered billing reads + platform billing control (ADR-047 Phase 4) ───

  /**
   * Tenant billing summary (D3): the organization is derived from
   * `ctx.channelId` — this query deliberately exposes NO `organizationId`
   * argument. Every paise figure comes from `computeMonthChargePaise` (D2).
   */
  @Query()
  @Allow(BbbAdminPermission.Permission, BbbManageMeetingsPermission.Permission)
  bbbBillingSummary(@Ctx() ctx: RequestContext, @Args("month") month?: string) {
    return this.billingService.getSummary(ctx, month);
  }

  /**
   * Tenant billed history for a month (D3): organization from the channel, no
   * `organizationId` argument; rows expose the stored `recordingUrl`.
   */
  @Query()
  @Allow(BbbAdminPermission.Permission, BbbManageMeetingsPermission.Permission)
  bbbMeteredMeetings(
    @Ctx() ctx: RequestContext,
    @Args("month") month?: string,
    @Args("skip") skip?: number,
    @Args("take") take?: number,
  ) {
    return this.billingService.getMeteredMeetings(ctx, month, skip, take);
  }

  /**
   * Platform-wide roll-up across tenants — platform tier only. Tenants hold
   * neither `BBBAdmin` nor `BBBPlatformInfrastructure`, never a `BbbManage*`
   * permission (a tenant-held permission here would be a permission regression).
   */
  @Query()
  @Allow(BbbAdminPermission.Permission, BbbPlatformInfrastructurePermission.Permission)
  bbbPlatformBillingSummary(
    @Ctx() ctx: RequestContext,
    @Args("month") month?: string,
  ) {
    return this.billingService.getPlatformSummary(ctx, month);
  }

  /**
   * H1 landing spot (ADR-047 / SEC-008 / BUG-047): `billingMode`,
   * `ratePaisePerLearnerHour`, `monthlySpendLimitPaise` and `suspended` are
   * settable ONLY here — never through `updateBbbOrganization`, whose tenant
   * allowlist rejects them. Full-replace semantics: `rate: null` clears the
   * per-org override back to the platform default; `monthlySpendLimitPaise:
   * null` clears the ceiling to unlimited.
   */
  @Allow(BbbAdminPermission.Permission, BbbPlatformInfrastructurePermission.Permission)
  @Transaction()
  @Mutation()
  async setBbbOrganizationBilling(
    @Ctx() ctx: RequestContext,
    @Args("organizationId") organizationId: string,
    @Args("billingMode") billingMode: string,
    @Args("ratePaisePerLearnerHour") ratePaisePerLearnerHour?: number | null,
    @Args("monthlySpendLimitPaise") monthlySpendLimitPaise?: number | null,
    @Args("suspended") suspended?: boolean,
  ): Promise<BbbOrganization> {
    if (
      billingMode !== BILLING_MODE.GRANT &&
      billingMode !== BILLING_MODE.METERED
    ) {
      throw new UserInputError(
        `billingMode must be "${BILLING_MODE.GRANT}" or "${BILLING_MODE.METERED}"`,
      );
    }
    if (ratePaisePerLearnerHour != null && ratePaisePerLearnerHour < 0) {
      throw new UserInputError(
        "ratePaisePerLearnerHour must be >= 0 (paise per learner-hour)",
      );
    }
    if (monthlySpendLimitPaise != null && monthlySpendLimitPaise < 0) {
      throw new UserInputError("monthlySpendLimitPaise must be >= 0 (paise)");
    }
    const org = await this.connection.getEntityOrThrow(
      ctx,
      BbbOrganization,
      organizationId,
    );
    org.billingMode = billingMode as BbbOrganization["billingMode"];
    org.ratePaisePerLearnerHour = ratePaisePerLearnerHour ?? null;
    org.monthlySpendLimitPaise = monthlySpendLimitPaise ?? null;
    org.suspended = suspended ?? org.suspended;
    return this.connection.getRepository(ctx, BbbOrganization).save(org);
  }
}
