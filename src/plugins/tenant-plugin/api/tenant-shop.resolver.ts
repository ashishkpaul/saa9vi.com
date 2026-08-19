import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';
import { Allow, Ctx, Logger, Permission, RequestContext, UserService } from '@vendure/core';
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
    private readonly userService: UserService,
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
    Logger.debug(`registerNewTenant called, ctx.channelId: ${ctx?.channelId}`, 'TenantShopResolver');
    return this.tenantRegistrationService.registerTenant(ctx, input);
  }

  /**
   * Verifies a tenant administrator's email address using the token from the
   * verification email. Mirrors Vendure's verifyCustomerAccount flow for
   * tenant admins (Phase 1.5 blocker).
   *
   * On success, returns the tenant's channel token (from the verified user's
   * roles → channels) so the storefront can redirect the admin to their
   * tenant dashboard — matching the CurrentUserChannel pattern documented at
   * https://docs.vendure.io/current/core/reference/graphql-api/shop/object-types#currentuserchannel
   */
  @Mutation()
  @Allow(Permission.Public)
  async verifyTenantAdmin(
    @Ctx() ctx: RequestContext,
    @Args('token') token: string,
  ): Promise<{ success: boolean; message: string | null; channelToken: string | null }> {
    try {
      const result = await this.userService.verifyUserByToken(ctx, token);
      if ('errorCode' in result) {
        return { success: false, message: result.message, channelToken: null };
      }

      // Resolve the tenant channel token from the verified user's roles.
      // The tenant admin role is scoped to exactly one channel (INV-001).
      const user = await this.userService.getUserById(ctx, result.id);
      const channel = user?.roles
        ?.flatMap((r) => r.channels ?? [])
        .find((c) => c.token);

      return {
        success: true,
        message: null,
        channelToken: channel?.token ?? null,
      };
    } catch (e: any) {
      Logger.warn(`verifyTenantAdmin failed: ${e?.message}`, 'TenantShopResolver');
      return { success: false, message: e?.message ?? 'Verification failed', channelToken: null };
    }
  }
}
