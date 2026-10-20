import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';
import {
  AdministratorService,
  Allow,
  Ctx,
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
import { tenantProfilePermission, instructorProfilePermission, mediaResourcePermission } from '../constants';
import { Administrator, Role } from '@vendure/core';

@Resolver()
export class TenantAdminResolver {
  constructor(
    private readonly tenantProfileService: TenantProfileService,
    private readonly instructorProfileService: InstructorProfileService,
    private readonly mediaResourceService: MediaResourceService,
    private readonly tenantThemeService: TenantThemeService,
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
    const channelId = args?.channelId && args.channelId !== '__current__'
      ? args.channelId
      : ctx.channelId as string;
    return this.tenantProfileService.findByChannelId(ctx, channelId);
  }

  @Allow(tenantProfilePermission.Update)
  @Transaction()
  @Mutation()
  createTenantProfile(@Ctx() ctx: RequestContext, @Args('input') input: any) {
    return this.tenantProfileService.create(ctx, input);
  }

  @Allow(tenantProfilePermission.Update)
  @Transaction()
  @Mutation()
  updateTenantProfile(@Ctx() ctx: RequestContext, @Args('input') input: any) {
    return this.tenantProfileService.update(ctx, input.channelId, input);
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
  createInstructorProfile(@Ctx() ctx: RequestContext, @Args('input') input: any) {
    return this.instructorProfileService.create(ctx, input);
  }

  @Allow(instructorProfilePermission.Update)
  @Transaction()
  @Mutation()
  updateInstructorProfile(@Ctx() ctx: RequestContext, @Args('input') input: any) {
    return this.instructorProfileService.update(ctx, input.id, input);
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
  createMediaResource(@Ctx() ctx: RequestContext, @Args('input') input: any) {
    return this.mediaResourceService.create(ctx, input);
  }

  @Allow(mediaResourcePermission.Update)
  @Transaction()
  @Mutation()
  updateMediaResource(@Ctx() ctx: RequestContext, @Args('input') input: any) {
    return this.mediaResourceService.update(ctx, input.id, input);
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
  async createTenantTheme(@Ctx() ctx: RequestContext, @Args('input') input: any) {
    return this.tenantThemeService.createTheme(ctx, input);
  }

  @Mutation()
  @Transaction()
  @Allow(tenantProfilePermission.Update)
  async updateTenantTheme(@Ctx() ctx: RequestContext, @Args('id') id: ID, @Args('input') input: any) {
    return this.tenantThemeService.updateTheme(ctx, id, input);
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
}
