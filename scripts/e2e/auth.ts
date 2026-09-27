/**
 * Auth helpers for the E2E fixture layer.
 *
 * Same `login { ... on CurrentUser { id identifier } }` shape already used
 * in `scripts/seed/seed-via-graphql.sh` — kept identical deliberately so a
 * failure here means the login contract actually changed, not that the
 * fixture layer drifted from it.
 */

import { FixtureGraphQLClient, GraphQLFixtureError } from './graphql-client';

const LOGIN_MUTATION = `
  mutation LogIn($username: String!, $password: String!) {
    login(username: $username, password: $password) {
      ... on CurrentUser { id identifier }
      ... on ErrorResult { errorCode message }
    }
  }
`;

interface LoginResult {
  login: { id?: string; identifier?: string; errorCode?: string; message?: string };
}

async function loginOrThrow(
  client: FixtureGraphQLClient,
  api: 'adminMutation' | 'shopMutation',
  username: string,
  password: string,
): Promise<void> {
  const result = await client[api]<LoginResult>('LogIn', LOGIN_MUTATION, { username, password });
  if (result.login.errorCode) {
    throw new GraphQLFixtureError(result.login.message ?? result.login.errorCode, 'LogIn');
  }
}

/** SuperAdmin session on the Admin API — the actor that creates channels/tenants. */
export async function loginSuperAdmin(host: string, username = 'superadmin', password = 'superadmin'): Promise<FixtureGraphQLClient> {
  const client = new FixtureGraphQLClient(host);
  await loginOrThrow(client, 'adminMutation', username, password);
  return client;
}

/** A tenant's own Administrator session on the Admin API. */
export async function loginTenantAdmin(host: string, username: string, password: string): Promise<FixtureGraphQLClient> {
  const client = new FixtureGraphQLClient(host);
  await loginOrThrow(client, 'adminMutation', username, password);
  return client;
}

/** A Customer session on the Shop API, scoped to one tenant's channel token. Use a fresh client per customer — never share cookies across tenants. */
export async function loginShopCustomer(
  host: string,
  channelToken: string,
  emailAddress: string,
  password: string,
): Promise<FixtureGraphQLClient> {
  const client = new FixtureGraphQLClient(host).withChannelToken(channelToken);
  await loginOrThrow(client, 'shopMutation', emailAddress, password);
  return client;
}
