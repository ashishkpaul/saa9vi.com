import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';
import {
  Allow,
  Ctx,
  ID,
  Permission,
  RequestContext,
  Transaction,
  TransactionalConnection,
} from '@vendure/core';
import { SUPER_ADMIN_ROLE_CODE } from '@vendure/common/lib/shared-constants';
import { TenantProfileService } from '../services/tenant-profile.service';
import { InstructorProfileService } from '../services/instructor-profile.service';
import { MediaResourceService } from '../services/media-resource.service';
import { tenantProfilePermission, instructorProfilePermission, mediaResourcePermission } from '../constants';
import { Administrator, Role } from '@vendure/core';

@Resolver()
export class TenantAdminResolver {
  constructor(
    private readonly tenantProfileService: TenantProfileService,
    private readonly instructorProfileService: InstructorProfileService,
    private readonly mediaResourceService: MediaResourceService,
    private readonly connection: TransactionalConnection,
  ) {}

  /**
   * INV-016: Override the built-in `administrators` query so a tenant admin
   * only sees administrators whose Role.channels[] includes the active
   * channel. SuperAdmin bypasses the filter and sees all administrators.
   */
  @Query()
  @Allow(Permission.ReadAdministrator)
  async administrators(
    @Ctx() ctx: RequestContext,
    @Args() args: { options?: any },
  ): Promise<{ items: Administrator[]; totalItems: number }> {
    const take = Math.min(Math.max(args.options?.take ?? 25, 1), 100);
    const skip = Math.max(args.options?.skip ?? 0, 0);

    // SuperAdmin sees all administrators (platform-level view).
    // NOTE: `user.roles.channels` is loaded so the nested graph is consistent
    // with the direct `roles` query — without it, TypeORM returns `channels: []`
    // for a tenant role even though the role-channel join exists (BUG-030).
    if (ctx.userHasPermissions([Permission.SuperAdmin])) {
      const [items, totalItems] = await this.connection
        .getRepository(ctx, Administrator)
        .findAndCount({
          relations: ['user', 'user.roles', 'user.roles.channels'],
          order: { createdAt: 'ASC' },
          skip,
          take,
        });
      return { items, totalItems };
    }

    // Tenant admin: only administrators whose roles include the active channel.
    // `role.channels` is loaded via leftJoinAndSelect so the returned
    // administrator's user.roles[].channels[] is populated consistently.
    const channelId = ctx.channelId as string;
    const qb = this.connection
      .getRepository(ctx, Administrator)
      .createQueryBuilder('administrator')
      .leftJoinAndSelect('administrator.user', 'user')
      .leftJoinAndSelect('user.roles', 'role')
      .leftJoinAndSelect('role.channels', 'roleChannel')
      .leftJoin('role.channels', 'channel')
      .where('channel.id = :channelId', { channelId })
      // INV-016: Vendure's SuperAdmin role carries ALL channels in
      // role.channels, so it matches the channel filter above. A tenant
      // read-admin must never see the global SuperAdmin account.
      .andWhere('role.code != :superAdminRoleCode', { superAdminRoleCode: SUPER_ADMIN_ROLE_CODE })
      .orderBy('administrator.createdAt', 'ASC');

    const [items, totalItems] = await qb
      .skip(skip)
      .take(take)
      .getManyAndCount();

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
   */
  @Query()
  @Allow(Permission.ReadAdministrator)
  async roles(
    @Ctx() ctx: RequestContext,
    @Args() args: { options?: any },
  ): Promise<{ items: Role[]; totalItems: number }> {
    const take = Math.min(Math.max(args.options?.take ?? 25, 1), 100);
    const skip = Math.max(args.options?.skip ?? 0, 0);

    // SuperAdmin sees all roles (platform-level view).
    if (ctx.userHasPermissions([Permission.SuperAdmin])) {
      const [items, totalItems] = await this.connection
        .getRepository(ctx, Role)
        .findAndCount({
          relations: ['channels'],
          order: { createdAt: 'ASC' },
          skip,
          take,
        });
      return { items, totalItems };
    }

    // Tenant admin: only roles whose channels[] includes the active channel.
    const channelId = ctx.channelId as string;
    const qb = this.connection
      .getRepository(ctx, Role)
      .createQueryBuilder('role')
      .leftJoinAndSelect('role.channels', 'channel')
      .where('channel.id = :channelId', { channelId })
      .orderBy('role.createdAt', 'ASC');

    const [items, totalItems] = await qb
      .skip(skip)
      .take(take)
      .getManyAndCount();

    return { items, totalItems };
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
    const channelId = ctx.channelId as string;
    return this.connection
      .getRepository(ctx, Role)
      .createQueryBuilder('role')
      .leftJoinAndSelect('role.channels', 'channel')
      .where('role.id = :id', { id: args.id })
      .andWhere('channel.id = :channelId', { channelId })
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
}
