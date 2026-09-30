import { Injectable } from "@nestjs/common";
import {
  ConfigService,
  ID,
  ForbiddenError,
  RequestContext,
  TransactionalConnection,
  EntityNotFoundError,
  ChannelService,
} from "@vendure/core";
import { BbbOrganization } from "../entities/bbb-organization.entity";
import { BbbOrganizationMember } from "../entities/bbb-organization-member.entity";
import { BbbMeeting } from "../entities/bbb-meeting.entity";
import { BbbCapacityGrant } from "../entities/bbb-capacity-grant.entity";
import { MEETING_STATE, BILLING_MODE } from "../constants";
import { BbbChannelAccessService } from "./bbb-channel-access.service";
import { BbbPlatformCapacityPolicyService } from "./bbb-platform-capacity-policy.service";

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
  /** Platform-only — rejected for tenant callers by the allowlist below. */
  maxSessionsPerOrg?: number;
  recordingEnabled?: boolean;
  suspended?: boolean;
}

/**
 * The ONLY fields a tenant administrator may change through
 * `updateBbbOrganization` on its own organization (S1.7 / BUG-047-H1 /
 * SEC-008). Everything else — `suspended` and the capacity limits
 * (`maxSessionsPerOrg`, `concurrentMeetingLimit`, `maxParticipantsPerMeeting`)
 * — is platform-only: capacity fields are ADR-031/INV-015 policy-synced caches
 * and `suspended` is the ADR-047 platform credit guard. Billing fields are not
 * part of this input at all (they belong to `setBbbOrganizationBilling`,
 * Phase 4). Allowlist, never a denylist — a new field on the input is
 * platform-only until explicitly added here.
 */
export const TENANT_EDITABLE_ORG_FIELDS: readonly string[] = [
  "name",
  "recordingEnabled",
];

@Injectable()
export class BbbOrganizationService {
  constructor(
    private readonly connection: TransactionalConnection,
    private readonly channelService: ChannelService,
    private readonly channelAccess: BbbChannelAccessService,
    private readonly capacityPolicyService: BbbPlatformCapacityPolicyService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Normalize a GraphQL-encoded id (e.g. "T_2" under the e2e
   * TestingEntityIdStrategy) to the internal raw PK form so denormalized
   * FK columns are always stored consistently with ctx.channelId.
   * Identity under the production AutoIncrementIdStrategy.
   */
  private toInternalId(id: string): string {
    const decoded = this.configService.entityIdStrategy.decodeId(id);
    return decoded === -1 ? id : String(decoded);
  }

  async findAll(
    ctx: RequestContext,
    options?: { skip?: number; take?: number },
  ): Promise<{ items: BbbOrganization[]; totalItems: number }> {
    const take = Math.min(Math.max(options?.take ?? 25, 1), 100);
    const skip = Math.max(options?.skip ?? 0, 0);
    const channelId = ctx.channelId as string;

    // Platform callers (SuperAdmin / BBBAdmin / BBBPlatformInfrastructure) see
    // all organizations regardless of channel; tenant admins see only
    // organizations on their authorized channel — via the SAME shared helper
    // meetingService.findAll uses, so the two definitions cannot drift
    // apart (Q5 / INV-029).
    const isPlatform = this.channelAccess.isPlatformCaller(ctx);
    const repo = this.connection.getRepository(ctx, BbbOrganization);

    if (isPlatform) {
      const [items, totalItems] = await repo.findAndCount({
        order: { createdAt: "ASC" },
        skip,
        take,
      });
      return { items, totalItems };
    }

    // For tenant admins, find orgs where the channels relation includes
    // the current channel. This matches assertOrganizationAccess semantics.
    const [items, totalItems] = await repo
      .createQueryBuilder("org")
      .innerJoin("org.channels", "ch")
      .where("ch.id = :channelId", { channelId })
      .orderBy("org.createdAt", "ASC")
      .skip(skip)
      .take(take)
      .getManyAndCount();

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
    // A pessimistic_write lock REQUIRES an open transaction. Wrap the whole
    // assertion in a transaction so the lock is valid and the limit check
    // is atomic with respect to concurrent meeting creation.
    await this.connection.withTransaction(ctx, async (txCtx) => {
      const repo = this.connection.getRepository(txCtx, BbbOrganization);

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
        .getRepository(txCtx, BbbMeeting)
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
    });
  }

  async create(
    ctx: RequestContext,
    input: CreateBbbOrganizationInput,
  ): Promise<BbbOrganization> {
    // BUG-050 / INV-001 (Channel=Tenant): a tenant may provision an
    // organization only on its own channel; platform callers (SuperAdmin /
    // BBBAdmin / BBBPlatformInfrastructure) may target any channel (e.g.
    // listener/system provisioning runs without a user and stays on its own
    // channel). This also keeps the scalar `channelId` and the `channels`
    // many-to-many assignment below (`assignToCurrentChannel` uses ctx) from
    // drifting apart.
    if (
      !this.channelAccess.isPlatformCaller(ctx) &&
      this.toInternalId(String(input.channelId)) !== String(ctx.channelId)
    ) {
      throw new ForbiddenError();
    }
    const existing = await this.findByChannelId(ctx, input.channelId);
    if (existing) {
      throw new Error(
        `An organization already exists for channel ${input.channelId}`,
      );
    }
    const org = new BbbOrganization({
      channelId: this.toInternalId(input.channelId),
      tenantProfileId: input.tenantProfileId,
      slug: input.slug,
      name: input.name,
      concurrentMeetingLimit: input.concurrentMeetingLimit ?? 5,
      maxParticipantsPerMeeting: input.maxParticipantsPerMeeting ?? 30,
      recordingEnabled: input.recordingEnabled ?? false,
      // ADR-047 / D7: new organizations are metered (postpaid attendee-hours).
      // 'grant' remains the DDL default so existing rows are untouched; setting
      // it here — one testable place — is what makes new tenants metered. The
      // rate is intentionally left null → platform default
      // (`defaultRatePaisePerLearnerHour`) until a platform operator sets one
      // via setBbbOrganizationBilling.
      billingMode: BILLING_MODE.METERED,
    });
    await this.channelService.assignToCurrentChannel(org, ctx);
    const saved = await this.connection.getRepository(ctx, BbbOrganization).save(org);

    // ADR-031 / INV-015: the organization's capacity fields are denormalized
    // caches of the effective platform capacity policy.
    //   • maxParticipantsPerMeeting ← defaultRoomCapacity
    //   • concurrentMeetingLimit    ← maxConcurrentMeetings
    // Policy wins once adopted (any policy row exists); before that the legacy
    // form-supplied values above are preserved (opt-in adoption, same guard as
    // room creation).
    //
    // Ordering note (ADR-031 amendment, Decision 5): at tenant registration
    // this runs under BbbTenantProvisioningListener, which is registered
    // BEFORE the subscription plugin's FreePlanProvisioningListener, so the
    // Free Basic subscription row may not exist yet — Tier 2 then cannot match
    // and `syncConcurrentMeetingLimit()` correctly declines to write. The
    // plan-derived value is applied later by BbbPlanCapacitySyncListener /
    // the startup reconciliation pass. Convergence, never ordering.
    if (await this.capacityPolicyService.hasAnyPolicy(ctx)) {
      const policy = await this.capacityPolicyService.getEffectivePolicy(
        ctx,
        saved.channelId,
      );
      await this.capacityPolicyService.syncOrganizationCache(ctx, saved, policy);
      await this.capacityPolicyService.syncConcurrentMeetingLimit(
        ctx,
        saved,
        policy,
      );
    }

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
    // S1.7 / BUG-047-H1 (SEC-008): allowlist, never a denylist. A tenant may
    // change only TENANT_EDITABLE_ORG_FIELDS on its own org; any other field
    // is rejected loudly (a silently dropped field would look applied to the
    // caller). Platform callers keep the full input — the capacity re-sync
    // below still applies to them (INV-015).
    let effective: UpdateBbbOrganizationInput = input;
    if (!this.channelAccess.isPlatformCaller(ctx)) {
      const rejected = Object.keys(input).filter(
        (key) => !TENANT_EDITABLE_ORG_FIELDS.includes(key),
      );
      if (rejected.length > 0) {
        throw new ForbiddenError();
      }
      const allowed: UpdateBbbOrganizationInput = {};
      for (const [key, value] of Object.entries(input)) {
        if (TENANT_EDITABLE_ORG_FIELDS.includes(key)) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (allowed as any)[key] = value;
        }
      }
      effective = allowed;
    }
    Object.assign(org, effective);
    const saved = await this.connection
      .getRepository(ctx, BbbOrganization)
      .save(org);

    // ADR-031 amendment (Decision 4): once a plan-derived policy row exists the
    // policy is authoritative. A manual `concurrentMeetingLimit` edit is
    // accepted by the mutation but immediately re-synced from the policy, and
    // the caller receives the authoritative value — so the effective limit can
    // never drift away from what the tier grants. This mirrors INV-015's
    // existing "manual form edits are then overridden by policy" contract for
    // maxParticipantsPerMeeting.
    if (await this.capacityPolicyService.hasAnyPolicy(ctx)) {
      const policy = await this.capacityPolicyService.getEffectivePolicy(
        ctx,
        saved.channelId,
      );
      await this.capacityPolicyService.syncConcurrentMeetingLimit(
        ctx,
        saved,
        policy,
      );
    }

    return saved;
  }

  async delete(ctx: RequestContext, id: ID): Promise<void> {
    await this.channelAccess.assertOrganizationAccess(ctx, id);
    await this.connection.getRepository(ctx, BbbOrganization).delete(id);
  }
}
