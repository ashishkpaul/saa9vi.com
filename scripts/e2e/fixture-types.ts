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
