import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';
import {
  Ctx,
  RequestContext,
  Allow,
  ID,
  Permission,
} from '@vendure/core';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { TenantPaymentAccountService } from '../services/tenant-payment-account.service';
import {
  TenantPaymentAccountCreateInput,
  TenantPaymentAccountSafeView,
} from '../services/tenant-payment-account.service';
import { ManageTenantPaymentAccount } from '../constants';
import { TenantRazorpayService } from '../services/tenant-razorpay.service';

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
    private readonly razorpayService: TenantRazorpayService,
  ) {}

  @Query()
  @Allow(ManageTenantPaymentAccount.Permission)
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
  @Allow(ManageTenantPaymentAccount.Permission)
  async upsertTenantPaymentAccount(
    @Ctx() ctx: RequestContext,
    @Args('input') input: TenantPaymentAccountCreateInput,
  ): Promise<TenantPaymentAccountSafeView> {
    const channelId = String(ctx.channelId);

    // Check if account exists — if so, update; otherwise create.
    const existing = await this.accountService.findByChannel(ctx, channelId);
    if (existing) {
      // Credential rotation: reset to pending, disable until re-verified
      const updated = await this.accountService.update(ctx, String(existing.id), {
        keyId: input.keyId,
        keySecret: input.keySecret,
        webhookSecret: input.webhookSecret, // Pass undefined to preserve existing, null to clear, string to update
        accountMode: input.accountMode,
        status: 'pending',
        isEnabled: false,
      });
      return this.accountService['toSafeView'](updated);
    }

    const created = await this.accountService.create(ctx, {
      channelId,
      keyId: input.keyId,
      keySecret: input.keySecret,
      webhookSecret: input.webhookSecret ?? null, // For create, null is fine for no webhook secret
      accountMode: input.accountMode,
    });
    return this.accountService['toSafeView'](created);
  }

  @Mutation()
  @Allow(ManageTenantPaymentAccount.Permission)
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

    // Only allow enabling if account is active (verified)
    if (isEnabled && account.status !== 'active') {
      throw new BadRequestException(
        'Cannot enable payment gateway: account credentials are not verified. Please verify credentials first.',
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
  @Allow(ManageTenantPaymentAccount.Permission)
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

  @Mutation()
  @Allow(ManageTenantPaymentAccount.Permission)
  async verifyTenantPaymentAccount(
    @Ctx() ctx: RequestContext,
  ): Promise<TenantPaymentAccountSafeView> {
    const channelId = String(ctx.channelId);
    const account = await this.accountService.findByChannel(ctx, channelId);
    if (!account) {
      throw new NotFoundException(
        'No Razorpay payment account configured for this channel',
      );
    }
    if (!account.encryptedKeySecret) {
      throw new BadRequestException(
        'Razorpay credentials are not configured',
      );
    }

    // Verify credentials by calling Razorpay API
    try {
      const credentials = await this.accountService.getDecryptedCredentials(
        ctx,
        channelId,
      );
      await this.razorpayService.verifyCredentials(
        credentials.keyId,
        credentials.keySecret,
      );
    } catch (err: any) {
      throw new BadRequestException(
        `Razorpay credential verification failed: ${err.message}`,
      );
    }

    // Mark as verified but keep disabled until explicitly enabled
    const updated = await this.accountService.markVerified(ctx, String(account.id));
    return this.accountService['toSafeView'](updated);
  }

  @Mutation()
  @Allow(ManageTenantPaymentAccount.Permission)
  async verifyTenantPaymentWebhook(
    @Ctx() ctx: RequestContext,
  ): Promise<{ webhookVerified: boolean }> {
    const channelId = String(ctx.channelId);
    const account = await this.accountService.findByChannel(ctx, channelId);
    if (!account) {
      throw new NotFoundException(
        'No Razorpay payment account configured for this channel',
      );
    }
    if (!account.encryptedWebhookSecret) {
      throw new BadRequestException(
        'Razorpay webhook secret is not configured',
      );
    }

    try {
      const credentials = await this.accountService.getDecryptedCredentials(
        ctx,
        channelId,
      );
      if (!credentials.webhookSecret) {
        throw new BadRequestException('Webhook secret is empty');
      }
    } catch (err: any) {
      throw new BadRequestException(
        `Webhook verification failed: ${err.message}`,
      );
    }

    return { webhookVerified: true };
  }
}