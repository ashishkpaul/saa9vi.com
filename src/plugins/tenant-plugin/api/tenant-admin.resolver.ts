import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';
import { Allow, Ctx, ID, RequestContext, Transaction } from '@vendure/core';
import { TenantProfileService } from '../services/tenant-profile.service';
import { InstructorProfileService } from '../services/instructor-profile.service';
import { MediaResourceService } from '../services/media-resource.service';
import { tenantProfilePermission, instructorProfilePermission, mediaResourcePermission } from '../constants';

@Resolver()
export class TenantAdminResolver {
  constructor(
    private readonly tenantProfileService: TenantProfileService,
    private readonly instructorProfileService: InstructorProfileService,
    private readonly mediaResourceService: MediaResourceService,
  ) {}

  @Query()
  @Allow(tenantProfilePermission.Read)
  tenantProfile(@Ctx() ctx: RequestContext, @Args() args?: { channelId?: string }) {
    const channelId = args?.channelId && args.channelId !== '__current__'
      ? args.channelId
      : ctx.channelId as string;
    return this.tenantProfileService.findByChannelId(ctx, channelId);
  }

  @Transaction()
  @Mutation()
  @Allow(tenantProfilePermission.Update)
  createTenantProfile(@Ctx() ctx: RequestContext, @Args('input') input: any) {
    return this.tenantProfileService.create(ctx, input);
  }

  @Transaction()
  @Mutation()
  @Allow(tenantProfilePermission.Update)
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

  @Transaction()
  @Mutation()
  @Allow(instructorProfilePermission.Create)
  createInstructorProfile(@Ctx() ctx: RequestContext, @Args('input') input: any) {
    return this.instructorProfileService.create(ctx, input);
  }

  @Transaction()
  @Mutation()
  @Allow(instructorProfilePermission.Update)
  updateInstructorProfile(@Ctx() ctx: RequestContext, @Args('input') input: any) {
    return this.instructorProfileService.update(ctx, input.id, input);
  }

  @Transaction()
  @Mutation()
  @Allow(instructorProfilePermission.Delete)
  deleteInstructorProfile(@Ctx() ctx: RequestContext, @Args() args: { id: ID }) {
    return this.instructorProfileService.delete(ctx, args.id as string);
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

  @Transaction()
  @Mutation()
  @Allow(mediaResourcePermission.Create)
  createMediaResource(@Ctx() ctx: RequestContext, @Args('input') input: any) {
    return this.mediaResourceService.create(ctx, input);
  }

  @Transaction()
  @Mutation()
  @Allow(mediaResourcePermission.Update)
  updateMediaResource(@Ctx() ctx: RequestContext, @Args('input') input: any) {
    return this.mediaResourceService.update(ctx, input.id, input);
  }

  @Transaction()
  @Mutation()
  @Allow(mediaResourcePermission.Delete)
  deleteMediaResource(@Ctx() ctx: RequestContext, @Args() args: { id: ID }) {
    return this.mediaResourceService.delete(ctx, args.id as string);
  }
}