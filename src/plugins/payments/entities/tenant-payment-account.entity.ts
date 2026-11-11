import { DeepPartial, VendureEntity, EntityId, ID } from '@vendure/core';
import { Column, Entity, Index } from 'typeorm';

/**
 * Tenant-owned Razorpay payment account (ADR-051, Option C — Phase 2).
 *
 * Stores a tenant's Razorpay merchant credentials, encrypted at rest.
 * Each tenant (Vendure Channel) can have at most one account per provider.
 * Credentials are decrypted only server-side when creating Razorpay Orders
 * or verifying webhooks — never returned through GraphQL.
 */
@Entity('tenant_payment_account')
export class TenantPaymentAccount extends VendureEntity {
  constructor(input?: DeepPartial<TenantPaymentAccount>) {
    super(input);
  }

  /** Owning tenant channel (INV-001: Channel = Tenant, scalar). */

  @Index()
  @Column('varchar')
  channelId: ID;

  /** Payment provider — always 'razorpay' in Phase 2. */
  @Column('varchar')
  provider: string;

  /** Tenant's public Razorpay Key ID — safe to expose through GraphQL. */
  @Column('varchar')
  keyId: string;

  /** Encrypted Razorpay Key Secret — server-side only, never exposed via GraphQL. */
  @Column('varchar')
  encryptedKeySecret: string;

  /** Encrypted Razorpay webhook secret — server-side only. */
  @Column('varchar', { nullable: true })
  encryptedWebhookSecret: string | null;

  /** Account mode: 'test' or 'live'. */
  @Column('varchar')
  accountMode: string;

  /** Account lifecycle status. */
  @Column('varchar')
  status: string;

  /** Whether the tenant has enabled this gateway for checkout. */
  @Column('boolean', { default: false })
  isEnabled: boolean;

  /** Last successful Razorpay connection test (nullable). */
  @Column('datetime', { nullable: true })
  lastVerifiedAt: Date | null;

  /** Unique account per tenant per provider. */
  static readonly UNIQUE_CONSTRAINT = 'UQ_tenant_payment_account_channel_provider';
}

export interface TenantPaymentAccountInput {
  channelId: ID;
  provider: string;
  keyId: string;
  encryptedKeySecret: string;
  encryptedWebhookSecret?: string | null;
  accountMode: string;
  status: string;
  isEnabled?: boolean;
}