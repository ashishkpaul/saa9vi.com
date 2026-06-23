import { Args, Query, Resolver } from '@nestjs/graphql';
import { Allow, Ctx, Permission, RequestContext } from '@vendure/core';
import { TenantProfileService } from '../services/tenant-profile.service';
import { InstructorProfileService } from '../services/instructor-profile.service';
import { MediaResourceService } from '../services/media-resource.service';

@Resolver()
export class TenantShopResolver {
  constructor(
    private readonly tenantProfileService: TenantProfileService,
    private readonly instructorProfileService: InstructorProfileService,
    private readonly mediaResourceService: MediaResourceService,
  ) {}

  @Query()
  @Allow(Permission.Public)
  instructorProfile(@Ctx() ctx: RequestContext, @Args() args: { slug: string }) {
    return this.instructorProfileService.findPublicBySlug(ctx, args.slug);
  }

  @Query()
  @Allow(Permission.Public)
  instructorProfiles(@Ctx() ctx: RequestContext, @Args() args: { options?: any }) {
    return this.instructorProfileService.findPublicByChannel(ctx, args.options);
  }

  @Query()
  @Allow(Permission.Public)
  tenantProfile(@Ctx() ctx: RequestContext) {
    return this.tenantProfileService.findByChannelId(ctx, ctx.channelId as string);
  }

  @Query()
  @Allow(Permission.Public)
  mediaResources(@Ctx() ctx: RequestContext, @Args() args: { ownerType: string; ownerId: string }) {
    return this.mediaResourceService.findAll(ctx, {
      ownerType: args.ownerType,
      ownerId: args.ownerId,
    });
  }
}