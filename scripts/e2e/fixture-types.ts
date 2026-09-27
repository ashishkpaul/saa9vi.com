/**
 * Fixture type model — Phase 2's E2ETenantFixture, plus the billing/BBB/
 * marketplace state each tenant is seeded into. Kept as plain data so
 * `verify.ts` can diff "what we asked for" against "what GraphQL reports
 * back" without re-deriving either side from code.
 */

export type SubscriptionLifecycleState =
  | 'active'
  | 'past_due'
  | 'pending_provider_auth'
  | 'cancelled';

export type MarketplaceVisibility = 'published' | 'unpublished';

export interface E2ETenantFixture {
  label: string; // human-readable only, e.g. "Tenant A — Apex Academy"
  channelId: string;
  channelToken: string;

  admin: { email: string; password: string };
  instructor: { customerId: string; profileId: string };
  student: { customerId: string; email: string; password: string };

  bbbOrganizationId: string;

  /**
   * Recorded ids/data beyond the original §3 triple — added per §3 rule 3
   * ("a scenario needing a fourth axis extends the type here first"):
   * `planId` because the seeder creates the plan and the manifest records ids,
   * `scheduledSessionId` because the cross-tenant isolation probe needs
   * B's row id to request from A's session, and `sessionTitle` because the
   * marketplace probe can only search for a title the seeder actually created
   * (never a fabricated query term — a fixture is plain recorded data).
   */
  planId: string;
  scheduledSessionId: string;
  sessionTitle: string;

  expected: {
    subscription: SubscriptionLifecycleState;
    bbb: 'live_session' | 'scheduled_session' | 'no_session';
    marketplace: MarketplaceVisibility;
  };
}

export interface E2EFixtureManifest {
  createdAt: string;
  host: string;
  tenants: Record<string, E2ETenantFixture>; // keyed by fixture label slug, e.g. "tenant-a"
}

/**
 * Plain scenario input — what the seeder materialises. Scenario files export
 * `E2EScenario` data only (scenarios/README.md: no assertions, imports limited
 * to `../auth`, `../graphql-client`, `../fixture-types`).
 */
export interface E2ETenantSpec {
  key: string; // manifest key, e.g. "tenant-a"
  label: string;
  /**
   * Drives the channel-code prefix used to rediscover an already-registered
   * tenant when the manifest is lost (channelCode = slug(businessName)-suffix,
   * see ADR/runtime-flow registration path).
   */
  businessName: string;

  plan: {
    name: string;
    slug: string;
    monthlyPriceInPaise: number;
    marketplaceListingEnabled: boolean;
  };

  admin: { email: string; password: string };
  instructor: {
    firstName: string;
    lastName: string;
    email: string;
    password: string;
    slug: string;
    fullName: string;
  };
  student: { firstName: string; lastName: string; email: string; password: string };

  session: { title: string; subjectTags: string[] };

  expected: {
    subscription: SubscriptionLifecycleState;
    bbb: 'live_session' | 'scheduled_session' | 'no_session';
    marketplace: MarketplaceVisibility;
  };
}

export interface E2EScenario {
  name: string;
  summary: string;
  tenants: E2ETenantSpec[];
}
