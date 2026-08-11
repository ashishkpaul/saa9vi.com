import { Injectable } from '@nestjs/common';
import {
  ChannelAware,
  ChannelService,
  Permission,
  RequestContext,
  VendureEntity,
} from '@vendure/core';

/**
 * Resolves the channel(s) a CMS entity should be assigned to on creation,
 * based on the creator's role (ADR-036 — CMS Channel Ownership Model).
 *
 * Saa9vi has two CMS ownership classes:
 *
 *   1. Platform CMS  — created by SuperAdmin, assigned to `__default_channel__` only.
 *   2. Academy CMS   — created by Tenant Admin, assigned to the tenant channel only.
 *
 * Tenant-created CMS content must NEVER automatically attach to the default
 * channel. The generic Vendure `assignToCurrentChannel()` helper assigns an
 * entity to the default channel AND the current channel, which leaks
 * tenant-created CMS content onto the platform channel and makes it visible
 * to other tenants (BUG-031). This policy replaces that blind usage.
 *
 * Usage:
 *   await this.cmsChannelAssignmentPolicy.assign(entity, ctx);
 */
@Injectable()
export class CmsChannelAssignmentPolicy {
  constructor(private readonly channelService: ChannelService) {}

  /**
   * Assign a CMS entity to the correct channel(s) based on the active user's
   * role. Must be called before the entity's first `save()`.
   */
  async assign<T extends ChannelAware & VendureEntity>(
    entity: T,
    ctx: RequestContext,
  ): Promise<T> {
    // ADR-036: Currently SuperAdmin is the platform CMS authority.
    // If a dedicated Portal Admin role is introduced later, replace this
    // SuperAdmin check with a dedicated platform-CMS permission (e.g.
    // `PlatformCmsAdmin` / `CreateCmsPlatformContent`).
    if (ctx.userHasPermissions([Permission.SuperAdmin])) {
      // Platform CMS — default channel only.
      const defaultChannel = await this.channelService.getDefaultChannel(ctx);
      entity.channels = [defaultChannel];
      return entity;
    }

    // Academy CMS — tenant channel only. Never the default channel.
    // ctx.channel is the active channel the admin is operating in (the tenant
    // channel for a tenant admin). Assigning directly avoids the default-channel
    // leak that assignToCurrentChannel() would introduce.
    if (!ctx.channel) {
      throw new Error(
        'CmsChannelAssignmentPolicy: no active channel in RequestContext for tenant CMS assignment',
      );
    }
    entity.channels = [ctx.channel];
    return entity;
  }
}
