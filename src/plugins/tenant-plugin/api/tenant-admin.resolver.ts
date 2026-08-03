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
import { TenantProfileService } from '../services/tenant-profile.service';
import { InstructorProfileService } from '../services/instructor-profile.service';
import { MediaResourceService } from '../services/media-resource.service';
import { tenantProfilePermission, instructorProfilePermission, mediaResourcePermission } from '../constants';
import { Administrator } from '@vendure/core';

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
    if (ctx.userHasPermissions([Permission.SuperAdmin])) {
      const [items, totalItems] = await this.connection
        .getRepository(ctx, Administrator)
        .findAndCount({
          relations: ['user', 'roles'],
          order: { createdAt: 'ASC' },
          skip,
          take,
        });
      return { items, totalItems };
    }

    // Tenant admin: only administrators whose roles include the active channel.
    const channelId = ctx.channelId as string;
    const qb = this.connection
      .getRepository(ctx, Administrator)
      .createQueryBuilder('administrator')
      .leftJoinAndSelect('administrator.user', 'user')
      .leftJoinAndSelect('administrator.roles', 'role')
      .leftJoin('role.channels', 'channel')
      .where('channel.id = :channelId', { channelId })
      .orderBy('administrator.createdAt', 'ASC');

    const [items, totalItems] = await qb
      .skip(skip)
      .take(take)
      .getManyAndCount();

    return { items, totalItems };
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
