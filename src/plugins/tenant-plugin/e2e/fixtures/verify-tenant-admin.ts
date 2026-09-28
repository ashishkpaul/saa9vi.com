import gql from 'graphql-tag';
import { NativeAuthenticationMethod, TransactionalConnection, User } from '@vendure/core';
import type { SimpleGraphQLClient, TestServer } from '@vendure/testing';

/**
 * Shared e2e helper completing Phase 1.5 admin verification for a
 * registerNewTenant admin — used by every suite that logs in as a
 * registerNewTenant-created tenant administrator.
 *
 * Vendure 3.7.3 (GHSA-wr5h-x3x6-4h23) refuses native login for an unverified
 * user whenever the credential still carries a pending verificationToken —
 * REGARDLESS of authOptions.requireVerification, which worked on 3.6.5.
 * registerNewTenant intentionally creates the admin unverified with a token
 * (Phase 1.5), so on 3.7.3 login fails with "Cannot return null for
 * non-nullable field CurrentUser.id" until the token is consumed.
 *
 * Governance-compliant flow (no direct database WRITES):
 *   1. READ the pending token (diagnostics-class read).
 *   2. Consume it through the public Shop-API `verifyTenantAdmin` mutation —
 *      the application-API path production uses (mirrors verifyCustomerAccount).
 *
 * Call immediately after the registration mutation, while `shopClient` still
 * targets the default channel (the suites set E2E_DEFAULT_CHANNEL_TOKEN
 * before registering), so the public mutation is routed correctly.
 * Throws if no token is pending (already verified, or the flow changed).
 */
const VERIFY_TENANT_ADMIN = gql`
  mutation VerifyTenantAdmin($token: String!) {
    verifyTenantAdmin(token: $token) {
      success
      message
      channelToken
    }
  }
`;

export async function verifyTenantAdminViaApi(
  server: TestServer,
  shopClient: SimpleGraphQLClient,
  email: string,
): Promise<void> {
  // Direct entity lookup: NativeAuthenticationMethod carries the pending
  // token (verificationToken is a plain column; passwordHash is select:false,
  // so we query the dedicated repository rather than scanning relations).
  const raw = server.app.get(TransactionalConnection).rawConnection;
  const native = await raw
    .getRepository(NativeAuthenticationMethod)
    .findOne({ where: { identifier: email } });
  const token: string | null = native?.verificationToken ?? null;
  if (!token) {
    // Distinguish "already verified" from "flow changed" for better errors.
    const user = await raw.getRepository(User).findOne({ where: { identifier: email } });
    if (!user) {
      throw new Error(`verifyTenantAdminViaApi: user ${email} not found`);
    }
    throw new Error(
      `verifyTenantAdminViaApi: no pending verificationToken for ${email} ` +
        `(user.verified=${user.verified}; already verified, or Phase 1.5 flow changed — ` +
        `re-check harness assumptions)`,
    );
  }

  const result: any = await shopClient.query(VERIFY_TENANT_ADMIN, { token });
  if (!result.verifyTenantAdmin?.success) {
    throw new Error(
      `verifyTenantAdmin failed for ${email}: ${result.verifyTenantAdmin?.message ?? 'unknown'}`,
    );
  }
}
