import { graphql } from '@/gql';

/**
 * GraphQL queries and mutations for tenant payment gateway management.
 * These operations are scoped to the current channel and require the
 * `ManageTenantPaymentAccount` permission.
 */

export const GET_TENANT_PAYMENT_ACCOUNT = graphql(`
  query GetTenantPaymentAccount {
    tenantPaymentAccount {
      id
      channelId
      provider
      keyId
      accountMode
      status
      isEnabled
      lastVerifiedAt
      createdAt
      updatedAt
      credentialsConfigured
      webhookSecretConfigured
    }
  }
`);

export const UPSERT_TENANT_PAYMENT_ACCOUNT = graphql(`
  mutation UpsertTenantPaymentAccount($input: UpsertTenantPaymentAccountInput!) {
    upsertTenantPaymentAccount(input: $input) {
      id
      channelId
      provider
      keyId
      accountMode
      status
      isEnabled
      lastVerifiedAt
      createdAt
      updatedAt
      credentialsConfigured
      webhookSecretConfigured
    }
  }
`);

export const SET_TENANT_PAYMENT_ACCOUNT_ENABLED = graphql(`
  mutation SetTenantPaymentAccountEnabled($isEnabled: Boolean!) {
    setTenantPaymentAccountEnabled(isEnabled: $isEnabled) {
      id
      channelId
      provider
      keyId
      accountMode
      status
      isEnabled
      lastVerifiedAt
      createdAt
      updatedAt
      credentialsConfigured
      webhookSecretConfigured
    }
  }
`);

export const DELETE_TENANT_PAYMENT_ACCOUNT = graphql(`
  mutation DeleteTenantPaymentAccount {
    deleteTenantPaymentAccount
  }
`);

export const VERIFY_TENANT_PAYMENT_ACCOUNT = graphql(`
  mutation VerifyTenantPaymentAccount {
    verifyTenantPaymentAccount {
      id
      channelId
      provider
      keyId
      accountMode
      status
      isEnabled
      lastVerifiedAt
      createdAt
      updatedAt
      credentialsConfigured
      webhookSecretConfigured
    }
  }
`);

export const VERIFY_TENANT_PAYMENT_WEBHOOK = graphql(`
  mutation VerifyTenantPaymentWebhook {
    verifyTenantPaymentWebhook {
      webhookVerified
    }
  }
`);

// Type for the account safe view (no secrets)
export type TenantPaymentAccountData = {
  id: string;
  channelId: string;
  provider: string;
  keyId: string;
  accountMode: 'test' | 'live';
  status: 'not-configured' | 'pending' | 'verified' | 'active' | 'disabled' | 'verification-failed';
  isEnabled: boolean;
  lastVerifiedAt: string | null;
  createdAt: string;
  updatedAt: string;
  credentialsConfigured: boolean;
  webhookSecretConfigured: boolean;
};
