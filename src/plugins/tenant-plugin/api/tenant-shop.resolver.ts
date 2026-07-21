import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';
import { Allow, Ctx, Permission, RequestContext } from '@vendure/core';
import { TenantProfileService } from '../services/tenant-profile.service';
import { InstructorProfileService } from '../services/instructor-profile.service';
import { MediaResourceService } from '../services/media-resource.service';
import {
  RegisterTenantInput,
  TenantRegistrationService,
} from '../services/tenant-registration.service';

@Resolver()
export class TenantShopResolver {
  constructor(
    private readonly tenantProfileService: TenantProfileService,
    private readonly instructorProfileService: InstructorProfileService,
    private readonly mediaResourceService: MediaResourceService,
    private readonly tenantRegistrationService: TenantRegistrationService,
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
    return this.tenantProfileService.findByChannelId(ctx, ctx.channelId);
  }

  @Query()
  @Allow(Permission.Public)
  async mediaResources(@Ctx() ctx: RequestContext, @Args() args: { ownerType: string; ownerId: string }) {
    const result = await this.mediaResourceService.findAll(ctx, {
      ownerType: args.ownerType,
      ownerId: args.ownerId,
    });
    return result.items;
  }

  /**
   * Self-serve tenant/seller registration.
   *
   * NOT SAFE FOR PRODUCTION UNTIL SEC-004 LANDS: this is a public mutation
   * with no rate limiting, and each call provisions a Seller, Channel, Role
   * and Administrator. See TenantRegistrationService for the full caveats
   * (also: no email verification yet).
   */
  @Mutation()
  @Allow(Permission.Public)
  registerNewTenant(@Ctx() ctx: RequestContext, @Args('input') input: RegisterTenantInput) {
    console.log('[TenantShopResolver] registerNewTenant resolver called, ctx.channelId:', ctx?.channelId);
    console.log('[TenantShopResolver] registerNewTenant resolver input:', JSON.stringify(input));
    return this.tenantRegistrationService.registerTenant(ctx, input);
  }
}
