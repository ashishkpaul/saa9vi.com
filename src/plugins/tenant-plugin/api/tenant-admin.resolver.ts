import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';
import {
  AdministratorService,
  Allow,
  Ctx,
  ForbiddenError,
  ID,
  ListQueryBuilder,
  Permission,
  Relations,
  RequestContext,
  RoleService,
  Transaction,
  TransactionalConnection,
} from '@vendure/core';
import { IsNull } from 'typeorm';
import { SUPER_ADMIN_ROLE_CODE } from '@vendure/common/lib/shared-constants';
import { TenantProfileService } from '../services/tenant-profile.service';
import { InstructorProfileService } from '../services/instructor-profile.service';
import { MediaResourceService } from '../services/media-resource.service';
import { TenantThemeService } from '../services/tenant-theme.service';
import { TenantLearnerMembershipService } from '../services/tenant-learner-membership.service';
import { tenantProfilePermission, instructorProfilePermission, mediaResourcePermission, tenantManageAdmissionsPermission } from '../constants';
import { Administrator, Role } from '@vendure/core';

// ── C-15: Typed input DTOs (replacing `input: any`) ─────────────────────────

interface CreateTenantProfileInput {
  channelId?: string;
  businessName: string;
  tagline?: string;
  logoAssetId?: ID;
  timezone?: string;
  contactEmail: string;
}

interface UpdateTenantProfileInput {
  channelId: string;
  businessName?: string;
  tagline?: string;
  logoAssetId?: ID;
  timezone?: string;
  contactEmail?: string;
  customDomain?: string;
  onboardingComplete?: boolean;
}

interface CreateInstructorProfileInput {
  customerId: ID;
  slug: string;
  fullName: string;
  bio?: string;
  photoAssetId?: ID;
  credentials?: string;
  expertiseAreas?: string[];
  displayOrder?: number;
  isActive?: boolean;
  isPublic?: boolean;
}

interface UpdateInstructorProfileInput {
  id: ID;
  customerId?: ID;
  slug?: string;
  fullName?: string;
  bio?: string;
  photoAssetId?: ID;
  credentials?: string;
  expertiseAreas?: string[];
  displayOrder?: number;
  isActive?: boolean;
  isPublic?: boolean;
}

interface CreateMediaResourceInput {
  ownerType: string;
  ownerId: string;
  type: string;
  url: string;
  title: string;
  thumbnailAssetId?: ID;
  displayOrder?: number;
  isFeatured?: boolean;
  isActive?: boolean;
}

interface UpdateMediaResourceInput {
  id: ID;
  ownerType?: string;
  ownerId?: string;
  type?: string;
  url?: string;
  title?: string;
  thumbnailAssetId?: ID;
  displayOrder?: number;
  isFeatured?: boolean;
  isActive?: boolean;
}

interface TenantThemeInput {
  primaryColor?: string;
  secondaryColor?: string;
  accentColor?: string;
  backgroundColor?: string;
  textColor?: string;
  fontFamily?: string;
  logoAssetId?: ID;
  displayName?: string;
}

interface AdmitTenantLearnerInput {
  customerId: ID;
  admissionType?: string;
  invitedByUserId?: ID;
}

interface SuspendTenantLearnerInput {
  customerId: ID;
  reason: string;
}

interface RevokeTenantLearnerInput {
  customerId: ID;
  reason?: string;
}

interface ReadmitTenantLearnerInput {
  customerId: ID;
  reason?: string;
}

@Resolver()
export class TenantAdminResolver {
  constructor(
    private readonly tenantProfileService: TenantProfileService,
    private readonly instructorProfileService: InstructorProfileService,
    private readonly mediaResourceService: MediaResourceService,
    private readonly tenantThemeService: TenantThemeService,
    private readonly tenantLearnerMembershipService: TenantLearnerMembershipService,
    private readonly connection: TransactionalConnection,
    private readonly administratorService: AdministratorService,
    private readonly roleService: RoleService,
    private readonly listQueryBuilder: ListQueryBuilder,
  ) {}

  /**
   * INV-016: Override the built-in `administrators` query so a tenant admin
   * only sees administrators whose Role.channels[] includes the active
   * channel. SuperAdmin bypasses the filter and sees all administrators.
   *
   * SuperAdmin keeps delegating to AdministratorService.findAll (it applies
   * Dashboard filter/sort/pagination via ListQueryBuilder, and no visibility
   * restriction is applied to a SuperAdmin caller).
   *
   * Non-SuperAdmin callers must NOT go through findAll: since Vendure 3.7.3
   * findAll applies restrictToVisibleAdministrators — core's grant-based rule
   * which hides an administrator as soon as they hold a Role the caller could
   * not be granted — which drops the tenant-admin row for a channel-scoped
   * read-admin before the INV-016 channel filter can ever see it (regression
   * introduced when 1107159 delegated the list to the core service). The
   * INV-016 contract splits the two concerns: the administrator ROW follows
   * channel scoping (this query), while Role DETAILS stay hidden from the
   * read-admin via core's 3.7.3 `User.roles` @ResolveField filter (anti-
   * enumeration, asserted in the e2e suite). So we build the same
   * ListQueryBuilder query directly — Dashboard filter/sort/pagination keep
   * working (the whole point of 1107159) — plus the tenant extras: the
   * global SuperAdmin account and cross-channel administrators are never
   * listed to a tenant-scoped caller.
   */
  @Query()
  @Allow(Permission.ReadAdministrator)
  async administrators(
    @Ctx() ctx: RequestContext,
    @Args() args: { options?: any },
    @Relations(Administrator) relations: string[],
  ): Promise<{ items: Administrator[]; totalItems: number }> {
    // BUG-030: keep user.roles.channels loaded so the nested graph is
    // consistent with the direct `roles` query.
    const withChannels = Array.from(
      new Set([...(relations ?? []), 'user', 'user.roles', 'user.roles.channels']),
    ) as never;

    if (ctx.userHasPermissions([Permission.SuperAdmin])) {
      return this.administratorService.findAll(ctx, args.options ?? undefined, withChannels);
    }

    // INV-016 tenant-scoped listing: the channel filter is applied to the
    // query (not to its result) so that totalItems, sorting, filtering and
    // pagination all operate over the visible administrators only.
    // Vendure's SuperAdmin role carries ALL channels, so it would match the
    // channel filter below — hence the explicit SuperAdmin-role exclusion to
    // keep the global SuperAdmin account hidden from tenant-scoped callers.
    const channelId = ctx.channelId as string;
    const qb = this.listQueryBuilder.build(Administrator, args.options ?? undefined, {
      relations: withChannels,
      where: { deletedAt: IsNull() },
      ctx,
    });
    qb.leftJoin('administrator.user', 'inv016User')
      .leftJoin('inv016User.roles', 'inv016Role')
      .leftJoin('inv016Role.channels', 'inv016Channel')
      .andWhere('inv016Channel.id = :inv016ChannelId', { inv016ChannelId: channelId })
      .andWhere('inv016Role.code != :inv016SuperAdminRoleCode', {
        inv016SuperAdminRoleCode: SUPER_ADMIN_ROLE_CODE,
      });
    const [items, totalItems] = await qb.getManyAndCount();
    return { items, totalItems };
  }

  /**
   * BUG-026: Override the built-in singular `administrator(id)` query.
   * Same channel-scoping gap as the plural `administrators` override (INV-016):
   * Vendure's built-in `administrator` query is implicitly channel-scoped, so
   * a SuperAdmin on the Default channel gets "not found" for a tenant admin
   * even though `administrators` (list) correctly returns it.
   */
  @Query()
  @Allow(Permission.ReadAdministrator)
  async administrator(
    @Ctx() ctx: RequestContext,
    @Args() args: { id: string },
  ): Promise<Administrator | undefined> {
    // SuperAdmin sees any administrator regardless of channel.
    // NOTE: `user.roles.channels` loaded for graph consistency (BUG-030).
    if (ctx.userHasPermissions([Permission.SuperAdmin])) {
      return this.connection
        .getRepository(ctx, Administrator)
        .findOne({
          where: { id: args.id as any },
          relations: ['user', 'user.roles', 'user.roles.channels'],
        })
        .then((a) => a ?? undefined);
    }

    // Tenant admin: only if the administrator's roles include the active channel.
    // `role.channels` loaded via leftJoinAndSelect for graph consistency (BUG-030).
    const channelId = ctx.channelId as string;
    return this.connection
      .getRepository(ctx, Administrator)
      .createQueryBuilder('administrator')
      .leftJoinAndSelect('administrator.user', 'user')
      .leftJoinAndSelect('user.roles', 'role')
      .leftJoinAndSelect('role.channels', 'roleChannel')
      .leftJoin('role.channels', 'channel')
      .where('administrator.id = :id', { id: args.id })
      .andWhere('channel.id = :channelId', { channelId })
      // INV-016: never expose the global SuperAdmin account to tenant admins
      // (SuperAdmin role carries ALL channels, so it matches the filter above).
      .andWhere('role.code != :superAdminRoleCode', { superAdminRoleCode: SUPER_ADMIN_ROLE_CODE })
      .getOne()
      .then((a) => a ?? undefined);
  }

  /**
   * BUG-025: Override the built-in `roles` query so a SuperAdmin sees all
   * roles regardless of the active channel. Vendure's built-in `roles` query
   * is implicitly channel-scoped — it only returns roles whose channels[]
   * includes the active channel. This causes tenant-created roles (scoped to
   * only their tenant channel) to be invisible to a SuperAdmin operating on
   * the Default channel, which breaks role-name resolution in the dashboard
   * (a role shows as a bare numeric id). Tenant admins remain channel-scoped.
   *
   * Delegates to RoleService.findAll so Dashboard filter/sort/pagination
   * work (it computes visible role ids, then builds the ListQueryBuilder
   * query). The tenant extra: the global SuperAdmin role is never listed
   * to tenant admins.
   */
  @Query()
  @Allow(Permission.ReadAdministrator)
  async roles(
    @Ctx() ctx: RequestContext,
    @Args() args: { options?: any },
    @Relations(Role) relations: string[],
  ): Promise<{ items: Role[]; totalItems: number }> {
    const result = await this.roleService.findAll(ctx, args.options ?? undefined, relations as never);
    if (ctx.userHasPermissions([Permission.SuperAdmin])) {
      return result;
    }
    const visible = result.items.filter((r) => r.code !== SUPER_ADMIN_ROLE_CODE);
    return { items: visible, totalItems: visible.length };
  }

  /**
   * BUG-026: Override the built-in singular `role(id)` query.
   * Same channel-scoping gap as the plural `roles` override (BUG-025):
   * Vendure's built-in `role` query is implicitly channel-scoped, so
   * a SuperAdmin on the Default channel gets "not found" for a tenant-scoped
   * role even though `roles` (list) now correctly returns it.
   */
  @Query()
  @Allow(Permission.ReadAdministrator)
  async role(
    @Ctx() ctx: RequestContext,
    @Args() args: { id: string },
  ): Promise<Role | undefined> {
    // SuperAdmin sees any role regardless of channel.
    if (ctx.userHasPermissions([Permission.SuperAdmin])) {
      return this.connection
        .getRepository(ctx, Role)
        .findOne({
          where: { id: args.id as any },
          relations: ['channels'],
        })
        .then((r) => r ?? undefined);
    }

    // Tenant admin: only if the role's channels[] includes the active channel.
    // INV-016: never expose the global SuperAdmin role to tenant admins.
    const channelId = ctx.channelId as string;
    return this.connection
      .getRepository(ctx, Role)
      .createQueryBuilder('role')
      .leftJoinAndSelect('role.channels', 'channel')
      .where('role.id = :id', { id: args.id })
      .andWhere('channel.id = :channelId', { channelId })
      .andWhere('role.code != :superAdminRoleCode', { superAdminRoleCode: SUPER_ADMIN_ROLE_CODE })
      .getOne()
      .then((r) => r ?? undefined);
  }

  @Query()
  @Allow(tenantProfilePermission.Read)
  tenantProfile(@Ctx() ctx: RequestContext, @Args() args?: { channelId?: string }) {
    // C-01: SuperAdmin may read any channel by explicit channelId.
    // Non-SuperAdmin callers are always scoped to ctx.channelId — ignore supplied channelId.
    const channelId = ctx.userHasPermissions([Permission.SuperAdmin]) && args?.channelId && args.channelId !== '__current__'
      ? args.channelId
      : ctx.channelId as string;
    return this.tenantProfileService.findByChannelId(ctx, channelId);
  }

  @Allow(tenantProfilePermission.Update)
  @Transaction()
  @Mutation()
  createTenantProfile(@Ctx() ctx: RequestContext, @Args('input') input: CreateTenantProfileInput) {
    return this.tenantProfileService.create(ctx, input);
  }

  @Allow(tenantProfilePermission.Update)
  @Transaction()
  @Mutation()
  updateTenantProfile(@Ctx() ctx: RequestContext, @Args('input') input: UpdateTenantProfileInput) {
    // C-01: Non-SuperAdmin callers cannot write to a different channel.
    if (!ctx.userHasPermissions([Permission.SuperAdmin])) {
      if (input.channelId && String(input.channelId) !== String(ctx.channelId)) {
        throw new ForbiddenError();
      }
    }
    const channelId = ctx.userHasPermissions([Permission.SuperAdmin]) && input.channelId
      ? input.channelId
      : ctx.channelId as string;
    return this.tenantProfileService.update(ctx, channelId, input);
  }

  @Query()
  @Allow(instructorProfilePermission.Read)
  instructorProfiles(@Ctx() ctx: RequestContext, @Args() args: { options?: any }) {
    return this.instructorProfileService.findAll(ctx, args.options);
  }

  @Query()
  @Allow(instructorProfilePermission.Read)
  instructorProfile(@Ctx() ctx: RequestContext, @Args() args: { id: ID }) {
    return this.instructorProfileService.findOne(ctx, args.id as string);
  }

  @Allow(instructorProfilePermission.Create)
  @Transaction()
  @Mutation()
  createInstructorProfile(@Ctx() ctx: RequestContext, @Args('input') input: CreateInstructorProfileInput) {
    return this.instructorProfileService.create(ctx, input as any);
  }

  @Allow(instructorProfilePermission.Update)
  @Transaction()
  @Mutation()
  updateInstructorProfile(@Ctx() ctx: RequestContext, @Args('input') input: UpdateInstructorProfileInput) {
    return this.instructorProfileService.update(ctx, input.id as string, input as any);
  }

  @Allow(instructorProfilePermission.Delete)
  @Transaction()
  @Mutation()
  async deleteInstructorProfile(@Ctx() ctx: RequestContext, @Args() args: { id: ID }) {
    await this.instructorProfileService.delete(ctx, args.id as string);
    return true;
  }

  @Query()
  @Allow(mediaResourcePermission.Read)
  mediaResources(@Ctx() ctx: RequestContext, @Args() args: { options?: any }) {
    return this.mediaResourceService.findAll(ctx, args.options);
  }

  @Query()
  @Allow(mediaResourcePermission.Read)
  mediaResource(@Ctx() ctx: RequestContext, @Args() args: { id: ID }) {
    return this.mediaResourceService.findOne(ctx, args.id as string);
  }

  @Allow(mediaResourcePermission.Create)
  @Transaction()
  @Mutation()
  createMediaResource(@Ctx() ctx: RequestContext, @Args('input') input: CreateMediaResourceInput) {
    return this.mediaResourceService.create(ctx, input as any);
  }

  @Allow(mediaResourcePermission.Update)
  @Transaction()
  @Mutation()
  updateMediaResource(@Ctx() ctx: RequestContext, @Args('input') input: UpdateMediaResourceInput) {
    return this.mediaResourceService.update(ctx, input.id as string, input as any);
  }

  @Allow(mediaResourcePermission.Delete)
  @Transaction()
  @Mutation()
  async deleteMediaResource(@Ctx() ctx: RequestContext, @Args() args: { id: ID }) {
    await this.mediaResourceService.delete(ctx, args.id as string);
    return true;
  }

  // ── Theme (ADR-043 L1) ────────────────────────────────────────────────────

  @Query()
  @Allow(tenantProfilePermission.Read)
  async tenantThemes(@Ctx() ctx: RequestContext) {
    const items = await this.tenantThemeService.listByChannel(ctx);
    return { items, totalItems: items.length };
  }

  @Query()
  @Allow(tenantProfilePermission.Read)
  async tenantTheme(@Ctx() ctx: RequestContext, @Args('id') id: ID) {
    return this.tenantThemeService.findById(ctx, id);
  }

  @Mutation()
  @Transaction()
  @Allow(tenantProfilePermission.Update)
  async createTenantTheme(@Ctx() ctx: RequestContext, @Args('input') input: TenantThemeInput) {
    return this.tenantThemeService.createTheme(ctx, input as any);
  }

  @Mutation()
  @Transaction()
  @Allow(tenantProfilePermission.Update)
  async updateTenantTheme(@Ctx() ctx: RequestContext, @Args('id') id: ID, @Args('input') input: TenantThemeInput) {
    return this.tenantThemeService.updateTheme(ctx, id, input as any);
  }

  @Mutation()
  @Transaction()
  @Allow(tenantProfilePermission.Update)
  async publishTenantTheme(@Ctx() ctx: RequestContext, @Args('id') id: ID) {
    return this.tenantThemeService.publishTheme(ctx, id);
  }

  @Mutation()
  @Transaction()
  @Allow(tenantProfilePermission.Update)
  async rollbackTenantTheme(@Ctx() ctx: RequestContext, @Args('id') id: ID) {
    return this.tenantThemeService.rollbackTheme(ctx, id);
  }

  @Mutation()
  @Transaction()
  @Allow(tenantProfilePermission.Update)
  async resetTenantTheme(@Ctx() ctx: RequestContext) {
    return this.tenantThemeService.resetTheme(ctx);
  }

  // ── Academy admission (C-02) ──────────────────────────────────────────────

  @Query()
  @Allow(tenantManageAdmissionsPermission.Read)
  async tenantLearners(@Ctx() ctx: RequestContext, @Args() args?: { options?: any }) {
    return this.tenantLearnerMembershipService.findAllByChannel(ctx, ctx.channelId as string, args?.options);
  }

  @Query()
  @Allow(tenantManageAdmissionsPermission.Read)
  async tenantLearnerMembershipLogs(@Ctx() ctx: RequestContext, @Args() args: { customerId: ID }) {
    return this.tenantLearnerMembershipService.findLogs(ctx, args.customerId, ctx.channelId as string);
  }

  @Mutation()
  @Transaction()
  @Allow(tenantManageAdmissionsPermission.Create)
  async admitTenantLearner(@Ctx() ctx: RequestContext, @Args('input') input: AdmitTenantLearnerInput) {
    // NF5: verify the customer belongs to the caller's channel before admitting.
    // Without this, a tenant admin can admit a customer who has never visited
    // their academy into their channel.
    const channelId = ctx.channelId as string;
    const customer = await this.connection
      .getRepository(ctx, 'Customer' as any)
      .findOne({
        where: { id: input.customerId as any },
        relations: ['channels'],
      });
    if (!customer) {
      throw new ForbiddenError();
    }
    const customerChannels = (customer as any).channels ?? [];
    const isInChannel = customerChannels.some(
      (c: any) => String(c.id) === String(channelId),
    );
    if (!isInChannel && !ctx.userHasPermissions([Permission.SuperAdmin])) {
      throw new ForbiddenError();
    }

    const actorId = ctx.activeUserId != null ? String(ctx.activeUserId) : null;
    return this.tenantLearnerMembershipService.admit(ctx, {
      customerId: input.customerId,
      channelId,
      admissionType: (input.admissionType as any) ?? 'REGULAR',
      actorId,
    });
  }

  @Mutation()
  @Transaction()
  @Allow(tenantManageAdmissionsPermission.Update)
  async activateTenantLearner(@Ctx() ctx: RequestContext, @Args('customerId') customerId: ID) {
    const actorId = ctx.activeUserId != null ? String(ctx.activeUserId) : null;
    return this.tenantLearnerMembershipService.activate(ctx, customerId, ctx.channelId as string, actorId);
  }

  @Mutation()
  @Transaction()
  @Allow(tenantManageAdmissionsPermission.Update)
  async suspendTenantLearner(@Ctx() ctx: RequestContext, @Args('input') input: SuspendTenantLearnerInput) {
    const actorId = ctx.activeUserId != null ? String(ctx.activeUserId) : null;
    return this.tenantLearnerMembershipService.suspend(ctx, input.customerId, ctx.channelId as string, input.reason, actorId);
  }

  @Mutation()
  @Transaction()
  @Allow(tenantManageAdmissionsPermission.Update)
  async revokeTenantLearner(@Ctx() ctx: RequestContext, @Args('input') input: RevokeTenantLearnerInput) {
    const actorId = ctx.activeUserId != null ? String(ctx.activeUserId) : null;
    return this.tenantLearnerMembershipService.revoke(ctx, input.customerId, ctx.channelId as string, actorId, input.reason);
  }

  @Mutation()
  @Transaction()
  @Allow(tenantManageAdmissionsPermission.Update)
  async readmitTenantLearner(@Ctx() ctx: RequestContext, @Args('input') input: ReadmitTenantLearnerInput) {
    const actorId = ctx.activeUserId != null ? String(ctx.activeUserId) : null;
    return this.tenantLearnerMembershipService.readmit(ctx, input.customerId, ctx.channelId as string, actorId, input.reason);
  }
}
