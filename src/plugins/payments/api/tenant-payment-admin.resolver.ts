import {
  Args,
  Mutation,
  Query,
  Resolver,
} from '@nestjs/graphql';
import {
  Ctx,
  RequestContext,
  Allow,
  Permission,
  ID,
} from '@vendure/core';
import { NotFoundException } from '@nestjs/common';
import { TenantPaymentAccountService } from '../services/tenant-payment-account.service';
import {
  TenantPaymentAccountCreateInput,
  TenantPaymentAccountSafeView,
} from '../services/tenant-payment-account.service';

/**
 * Admin GraphQL resolver for tenant payment account management (Phase 2).
 *
 * All queries/mutations are channel-scoped via ctx.channelId:
 *   - Tenant admins manage their own channel's account only.
 *   * SuperAdmin can manage any channel's account.
 *
 * Decrypted secrets are never returned through GraphQL.
 */
@Resolver()
export class TenantPaymentAdminResolver {
  constructor(
    private readonly accountService: TenantPaymentAccountService,
  ) {}

  @Query()
  @Allow(Permission.Authenticated)
  async tenantPaymentAccount(
    @Ctx() ctx: RequestContext,
  ): Promise<TenantPaymentAccountSafeView | null> {
    const account = await this.accountService.findByChannel(
      ctx,
      String(ctx.channelId),
    );
    if (!account) return null;
    return this.accountService['toSafeView'](account);
  }

  @Query()
  @Allow(Permission.SuperAdmin)
  async allTenantPaymentAccounts(
    @Ctx() ctx: RequestContext,
  ): Promise<TenantPaymentAccountSafeView[]> {
    return this.accountService.findAll(ctx);
  }

  @Mutation()
  @Allow(Permission.Authenticated)
  async upsertTenantPaymentAccount(
    @Ctx() ctx: RequestContext,
    @Args('input') input: TenantPaymentAccountCreateInput,
  ): Promise<TenantPaymentAccountSafeView> {
    const channelId = String(ctx.channelId);

    // Check if account exists — if so, update; otherwise create.
    const existing = await this.accountService.findByChannel(ctx, channelId);
    if (existing) {
      const updated = await this.accountService.update(ctx, String(existing.id), {
        keyId: input.keyId,
        keySecret: input.keySecret,
        webhookSecret: input.webhookSecret ?? null,
        accountMode: input.accountMode,
        status: 'pending',
        isEnabled: existing.isEnabled,
      });
      return this.accountService['toSafeView'](updated);
    }

    const created = await this.accountService.create(ctx, {
      channelId,
      keyId: input.keyId,
      keySecret: input.keySecret,
      webhookSecret: input.webhookSecret ?? null,
      accountMode: input.accountMode,
    });
    return this.accountService['toSafeView'](created);
  }

  @Mutation()
  @Allow(Permission.Authenticated)
  async setTenantPaymentAccountEnabled(
    @Ctx() ctx: RequestContext,
    @Args('isEnabled') isEnabled: boolean,
  ): Promise<TenantPaymentAccountSafeView> {
    const account = await this.accountService.findByChannel(
      ctx,
      String(ctx.channelId),
    );
    if (!account) {
      throw new NotFoundException(
        'No Razorpay payment account configured for this channel',
      );
    }
    const updated = await this.accountService.setEnabled(
      ctx,
      String(account.id),
      isEnabled,
    );
    return this.accountService['toSafeView'](updated);
  }

  @Mutation()
  @Allow(Permission.Authenticated)
  async deleteTenantPaymentAccount(
    @Ctx() ctx: RequestContext,
  ): Promise<boolean> {
    const account = await this.accountService.findByChannel(
      ctx,
      String(ctx.channelId),
    );
    if (!account) {
      throw new NotFoundException(
        'No Razorpay payment account found for this channel',
      );
    }
    await this.accountService.delete(ctx, String(account.id));
    return true;
  }
}