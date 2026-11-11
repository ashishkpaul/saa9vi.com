import gql from 'graphql-tag';

/**
 * Admin GraphQL extensions for tenant payment account management (Phase 2).
 *
 * All mutations are tenant-scoped — a tenant admin can only manage their
 * own channel's payment account. SuperAdmin can manage any account.
 *
 * Decrypted secrets are NEVER returned through GraphQL. The safe view
 * exposes keyId (public) and metadata only.
 */
export const tenantPaymentAdminSchema = gql`
  extend type Query {
    """
    Get the current channel's tenant payment account (safe view — no secrets).
    Tenant-scoped: returns only the account for the active channel.
    """
    tenantPaymentAccount: TenantPaymentAccount!

    """
    Get all tenant payment accounts (SuperAdmin only).
    """
    allTenantPaymentAccounts: [TenantPaymentAccount!]!
  }

  extend type Mutation {
    """
    Create or update the current channel's Razorpay payment account.
    Encrypts secrets before persisting.
    """
    upsertTenantPaymentAccount(
      input: UpsertTenantPaymentAccountInput!
    ): TenantPaymentAccount!

    """
    Enable or disable the tenant's Razorpay gateway (tenant-scoped).
    """
    setTenantPaymentAccountEnabled(
      isEnabled: Boolean!
    ): TenantPaymentAccount!

    """
    Delete the current channel's payment account (SuperAdmin or tenant admin).
    """
    deleteTenantPaymentAccount: Boolean!
  }

  type TenantPaymentAccount {
    id: ID!
    channelId: ID!
    provider: String!
    keyId: String!
    accountMode: String!
    status: String!
    isEnabled: Boolean!
    lastVerifiedAt: DateTime
    createdAt: DateTime!
    updatedAt: DateTime!
    """
    True if encrypted credentials exist (decrypted values are never returned).
    """
    credentialsConfigured: Boolean!
  }

  input UpsertTenantPaymentAccountInput {
    keyId: String!
    keySecret: String!
    webhookSecret: String
    accountMode: String! # 'test' or 'live'
  }
`;