import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import {
  RequestContext,
  TransactionalConnection,
  ID,
} from '@vendure/core';
import { TenantPaymentAccount } from '../entities/tenant-payment-account.entity';
import { TenantPaymentEncryptionService } from './tenant-payment-encryption.service';

export interface TenantPaymentAccountCreateInput {
  channelId: ID;
  keyId: string;
  keySecret: string;
  webhookSecret?: string | null;
  accountMode: 'test' | 'live';
}

export interface TenantPaymentAccountUpdateInput {
  keyId?: string;
  keySecret?: string;
  webhookSecret?: string | null;
  accountMode?: 'test' | 'live';
  status?: string;
  isEnabled?: boolean;
}

export interface TenantPaymentAccountSafeView {
  id: ID;
  channelId: ID;
  provider: string;
  keyId: string;
  accountMode: string;
  status: string;
  isEnabled: boolean;
  lastVerifiedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  credentialsConfigured: boolean;
  webhookSecretConfigured: boolean;
}

export interface TenantRazorpayCredentials {
  keyId: string;
  keySecret: string;
  webhookSecret: string | null;
  accountMode: string;
}

@Injectable()
export class TenantPaymentAccountService {
  constructor(
    private readonly connection: TransactionalConnection,
    private readonly encryptionService: TenantPaymentEncryptionService,
  ) {}

  async create(
    ctx: RequestContext,
    input: TenantPaymentAccountCreateInput,
  ): Promise<TenantPaymentAccount> {
    const repo = this.connection.getRepository(ctx, TenantPaymentAccount);

    const existing = await repo.findOne({
      where: { channelId: String(input.channelId), provider: 'razorpay' },
    });
    if (existing) {
      throw new ConflictException(
        `A Razorpay payment account already exists for channel ${input.channelId}`,
      );
    }

    const account = repo.create({
      channelId: String(input.channelId),
      provider: 'razorpay',
      keyId: input.keyId,
      encryptedKeySecret: this.encryptionService.encrypt(input.keySecret),
      encryptedWebhookSecret: input.webhookSecret
        ? this.encryptionService.encrypt(input.webhookSecret)
        : null,
      accountMode: input.accountMode,
      status: 'pending',
      isEnabled: false,
    });

    return repo.save(account);
  }

  async findByChannel(
    ctx: RequestContext,
    channelId: ID,
  ): Promise<TenantPaymentAccount | null> {
    const repo = this.connection.getRepository(ctx, TenantPaymentAccount);
    return repo.findOne({ where: { channelId: String(channelId), provider: 'razorpay' } });
  }

  async findAll(ctx: RequestContext): Promise<TenantPaymentAccountSafeView[]> {
    const repo = this.connection.getRepository(ctx, TenantPaymentAccount);
    const accounts = await repo.find();
    return accounts.map((a) => this.toSafeView(a));
  }

  async update(
    ctx: RequestContext,
    accountId: string,
    input: TenantPaymentAccountUpdateInput,
  ): Promise<TenantPaymentAccount> {
    const repo = this.connection.getRepository(ctx, TenantPaymentAccount);
    const account = await repo.findOne({ where: { id: accountId } });
    if (!account) {
      throw new NotFoundException(`Tenant payment account ${accountId} not found`);
    }

    if (input.keyId !== undefined) account.keyId = input.keyId;
    if (input.keySecret !== undefined) {
      account.encryptedKeySecret = this.encryptionService.encrypt(input.keySecret);
    }
    if (input.webhookSecret !== undefined) {
      account.encryptedWebhookSecret = input.webhookSecret
        ? this.encryptionService.encrypt(input.webhookSecret)
        : null;
    }
    if (input.accountMode !== undefined) account.accountMode = input.accountMode;
    if (input.status !== undefined) account.status = input.status;
    if (input.isEnabled !== undefined) account.isEnabled = input.isEnabled;

    return repo.save(account);
  }

  async delete(ctx: RequestContext, accountId: string): Promise<void> {
    const repo = this.connection.getRepository(ctx, TenantPaymentAccount);
    const result = await repo.delete({ id: accountId });
    if (result.affected === 0) {
      throw new NotFoundException(`Tenant payment account ${accountId} not found`);
    }
  }

  /**
   * Settlement-only credential resolver.
   *
   * Unlike the general-purpose credential read used by the Admin verification
   * workflow, this method checks the persisted account state immediately before
   * decrypting any tenant secret. Flow B settlement must not continue for a
   * pending, suspended, disabled or incompletely configured account.
   */
  async getActiveDecryptedCredentials(
    ctx: RequestContext,
    channelId: ID,
  ): Promise<Pick<TenantRazorpayCredentials, 'keyId' | 'keySecret'>> {
    const account = await this.findByChannel(ctx, channelId);
    if (!account) {
      throw new NotFoundException('Tenant Razorpay account is not configured');
    }
    if (account.status !== 'active' || account.isEnabled !== true) {
      throw new Error('Tenant Razorpay account must be active and enabled');
    }
    if (!account.encryptedKeySecret) {
      throw new Error('Tenant Razorpay credentials are not configured');
    }

    return {
      keyId: account.keyId,
      keySecret: this.encryptionService.decrypt(account.encryptedKeySecret),
    };
  }

  async getDecryptedCredentials(
    ctx: RequestContext,
    channelId: ID,
  ): Promise<TenantRazorpayCredentials> {
    const account = await this.findByChannel(ctx, channelId);
    if (!account) {
      throw new NotFoundException(
        `No Razorpay payment account configured for channel ${channelId}`,
      );
    }
    if (!account.encryptedKeySecret) {
      throw new Error(
        `Razorpay credentials for channel ${channelId} are not configured`,
      );
    }

    return {
      keyId: account.keyId,
      keySecret: this.encryptionService.decrypt(account.encryptedKeySecret),
      webhookSecret: account.encryptedWebhookSecret
        ? this.encryptionService.decrypt(account.encryptedWebhookSecret)
        : null,
      accountMode: account.accountMode,
    };
  }

  /**
   * Decrypt only the tenant webhook secret for ingress authentication.
   * This is intentionally independent of the account's checkout enabled flag:
   * already-captured payments must still be authenticated and reconciled after
   * a tenant temporarily disables new checkout.
   */
  async getWebhookSecret(
    ctx: RequestContext,
    channelId: ID,
  ): Promise<string> {
    const account = await this.findByChannel(ctx, channelId);
    if (!account?.encryptedWebhookSecret) {
      throw new NotFoundException('Tenant Razorpay webhook secret is not configured');
    }
    return this.encryptionService.decrypt(account.encryptedWebhookSecret);
  }

  /**
   * Credentials used only by the signed webhook worker to reconcile money
   * already captured at Razorpay. Do not apply the checkout enabled gate here:
   * disabling new checkout must not strand an already-captured payment.
   */
  async getWebhookSettlementCredentials(
    ctx: RequestContext,
    channelId: ID,
  ): Promise<Pick<TenantRazorpayCredentials, 'keyId' | 'keySecret'>> {
    const account = await this.findByChannel(ctx, channelId);
    if (!account?.encryptedKeySecret) {
      throw new NotFoundException('Tenant Razorpay credentials are not configured');
    }
    return {
      keyId: account.keyId,
      keySecret: this.encryptionService.decrypt(account.encryptedKeySecret),
    };
  }

  async markVerified(
    ctx: RequestContext,
    accountId: string,
  ): Promise<TenantPaymentAccount> {
    const repo = this.connection.getRepository(ctx, TenantPaymentAccount);
    const account = await repo.findOne({ where: { id: accountId } });
    if (!account) {
      throw new NotFoundException(`Tenant payment account ${accountId} not found`);
    }
    account.status = 'active';
    account.lastVerifiedAt = new Date();
    return repo.save(account);
  }

  async setEnabled(
    ctx: RequestContext,
    accountId: string,
    isEnabled: boolean,
  ): Promise<TenantPaymentAccount> {
    const repo = this.connection.getRepository(ctx, TenantPaymentAccount);
    const account = await repo.findOne({ where: { id: accountId } });
    if (!account) {
      throw new NotFoundException(`Tenant payment account ${accountId} not found`);
    }
    account.isEnabled = isEnabled;
    return repo.save(account);
  }

  private toSafeView(account: TenantPaymentAccount): TenantPaymentAccountSafeView {
    return {
      id: account.id,
      channelId: account.channelId,
      provider: account.provider,
      keyId: account.keyId,
      accountMode: account.accountMode,
      status: account.status,
      isEnabled: account.isEnabled,
      lastVerifiedAt: account.lastVerifiedAt,
      createdAt: account.createdAt,
      updatedAt: account.updatedAt,
      credentialsConfigured: !!account.encryptedKeySecret,
      webhookSecretConfigured: !!account.encryptedWebhookSecret,
    };
  }
}
