/**
 * Deterministic E2E fixture layer — GraphQL client.
 *
 * Mirrors the auth conventions already established in
 * `scripts/seed/seed-via-graphql.sh`: cookie-based session auth via the
 * `login` mutation, `vendure-token` header for channel scoping. This client
 * exists so the fixture layer never reimplements that convention loosely —
 * one typed transport, used by every scenario file.
 *
 * Hard rule (per the Phase-1 design): every call either returns typed data
 * or throws. There is no `data?.foo?.items ?? []` anywhere in this file or
 * in anything built on top of it — that fallback is exactly the pattern
 * that let the Mandates/Payment Attempts contract drift go unnoticed.
 */

export class GraphQLFixtureError extends Error {
  constructor(
    message: string,
    public readonly operation: string,
    public readonly errors?: unknown,
  ) {
    super(`[${operation}] ${message}`);
    this.name = 'GraphQLFixtureError';
  }
}

export interface GraphQLClientOptions {
  /** e.g. http://localhost:3000 */
  host: string;
  /** Session cookie captured from a prior `login` call, if any. */
  cookie?: string;
  /** Channel token (`vendure-token` header) for channel-scoped calls. */
  channelToken?: string;
}

interface GraphQLResponse<T> {
  data?: T;
  errors?: Array<{ message: string; path?: (string | number)[] }>;
}

/**
 * One request/response cycle against either the Admin or Shop API.
 * Captures and returns any `set-cookie` header so the caller can persist
 * a session across calls (mirrors the shell script's `-c file.txt` / `-b
 * file.txt` cookie-jar pattern, but in-process).
 */
async function post<T>(
  url: string,
  query: string,
  variables: Record<string, unknown> | undefined,
  operation: string,
  opts: GraphQLClientOptions,
): Promise<{ data: T; cookie?: string }> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (opts.cookie) headers['cookie'] = opts.cookie;
  if (opts.channelToken) headers['vendure-token'] = opts.channelToken;

  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({ query, variables }),
  });

  const setCookie = res.headers.get('set-cookie') ?? undefined;
  const json = (await res.json()) as GraphQLResponse<T>;

  if (json.errors?.length) {
    throw new GraphQLFixtureError(json.errors.map(e => e.message).join('; '), operation, json.errors);
  }
  if (json.data === undefined) {
    throw new GraphQLFixtureError('Response had no `data` and no `errors` — malformed response.', operation);
  }

  return { data: json.data, cookie: setCookie ?? opts.cookie };
}

export class FixtureGraphQLClient {
  private cookie?: string;
  private channelToken?: string;

  constructor(private readonly host: string) {}

  /** Scope subsequent Shop-API calls to a tenant channel. Admin-API calls stay unscoped unless you also set a session for that channel. */
  withChannelToken(token: string): this {
    this.channelToken = token;
    return this;
  }

  async adminQuery<T>(operation: string, query: string, variables?: Record<string, unknown>): Promise<T> {
    const { data, cookie } = await post<T>(`${this.host}/admin-api`, query, variables, operation, {
      host: this.host,
      cookie: this.cookie,
    });
    this.cookie = cookie;
    return data;
  }

  adminMutation<T>(operation: string, mutation: string, variables?: Record<string, unknown>): Promise<T> {
    return this.adminQuery<T>(operation, mutation, variables);
  }

  async shopQuery<T>(operation: string, query: string, variables?: Record<string, unknown>): Promise<T> {
    const { data, cookie } = await post<T>(`${this.host}/shop-api`, query, variables, operation, {
      host: this.host,
      cookie: this.cookie,
      channelToken: this.channelToken,
    });
    this.cookie = cookie;
    return data;
  }

  shopMutation<T>(operation: string, mutation: string, variables?: Record<string, unknown>): Promise<T> {
    return this.shopQuery<T>(operation, mutation, variables);
  }

  /** A fresh client sharing the same host but with an independent session/cookie — use one per actor (SuperAdmin, per-tenant admin, per-tenant customer) so sessions never bleed into each other. */
  forNewActor(): FixtureGraphQLClient {
    return new FixtureGraphQLClient(this.host);
  }
}
