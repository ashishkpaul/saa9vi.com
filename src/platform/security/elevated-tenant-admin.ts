import gql from 'graphql-tag';
import type { SimpleGraphQLClient } from '@vendure/testing';

/**
 * Evidence-quality harness for the Vendure 3.7.3 security regression suites.
 *
 * A cross-channel denial is only meaningful when the acting principal HOLDS
 * the relevant permission on its own channel — otherwise the probe proves
 * nothing beyond "the permission guard rejected an unprivileged caller"
 * (permission denial ≠ channel-scope enforcement).
 *
 * This helper grants an explicit, channel-scoped permission set to a
 * test-only administrator entirely through the Admin API (createRole /
 * createAdministrator). No direct database writes are performed, per the
 * repository governance rule that application state changes go through
 * GraphQL/application APIs.
 *
 * NOTE: `verifyTenantAdminViaApi` (Phase 1.5 verification for
 * registerNewTenant admins) lives with the tenant e2e fixtures at
 * src/plugins/tenant-plugin/e2e/fixtures/verify-tenant-admin.ts because it
 * is part of the tenant-registration domain, not the security probes.
 */

const CREATE_ROLE = gql`
  mutation CreateElevatedRole($input: CreateRoleInput!) {
    createRole(input: $input) {
      id
      code
    }
  }
`;

const CREATE_ADMINISTRATOR = gql`
  mutation CreateElevatedAdmin($input: CreateAdministratorInput!) {
    createAdministrator(input: $input) {
      id
      emailAddress
    }
  }
`;

export interface ElevatedTenantAdmin {
  email: string;
  password: string;
  administratorId: string;
  roleId: string;
}

/**
 * Creates a test-only administrator whose role is scoped to `channelId`
 * and granted exactly `permissions` (plus Authenticated).
 *
 * The caller must have already authenticated `adminClient` as SuperAdmin.
 */
export async function createElevatedTenantAdmin(
  adminClient: SimpleGraphQLClient,
  channelId: string,
  tag: string,
  permissions: string[],
): Promise<ElevatedTenantAdmin> {
  const stamp = `${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const email = `elevated-${stamp}@e2e.test`;
  const password = 'ElevatedP@ss1';

  const role: any = await adminClient.query(CREATE_ROLE, {
    input: {
      code: `elevated-${stamp}`,
      description: `Test-only elevated role for ${tag} (channel-scoped)`,
      permissions: ['Authenticated', ...permissions],
      channelIds: [channelId],
    },
  });
  const roleId: string = role.createRole.id;

  const admin: any = await adminClient.query(CREATE_ADMINISTRATOR, {
    input: {
      firstName: 'Elevated',
      lastName: `Probe ${tag}`,
      emailAddress: email,
      password,
      roleIds: [roleId],
    },
  });

  return {
    email,
    password,
    administratorId: String(admin.createAdministrator.id),
    roleId,
  };
}
