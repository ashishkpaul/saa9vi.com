/**
 * Phase 8 scenario: tenant divergence.
 *
 * Plain data only — no assertions, no client usage (scenarios/README.md).
 * Two tenants seeded into deliberately DIFFERENT commercial state so that
 * verify.ts's per-tenant diff and the cross-tenant isolation probe (INV-001)
 * actually prove something: identical tenants would let a broken
 * channel-scoping implementation pass every check.
 *
 *   tenant-a: active subscription on a marketplace-enabled plan,
 *             one PUBLISHED (SCHEDULED) BBB session, listing searchable.
 *   tenant-b: CANCELLED subscription on a free provider-free plan,
 *             one DRAFT (never published) BBB session — neither scheduled nor
 *             live (§4 'no_session' reads FSM state, not table presence), so
 *             its recorded title must be ABSENT from the marketplace.
 *
 * All three axes (subscription / bbb / marketplace) differ between the two.
 */
import { E2EScenario } from '../fixture-types';

export const tenantDivergenceScenario: E2EScenario = {
  name: 'tenant-divergence',
  summary:
    'Two deliberately different tenants: active+published vs cancelled+unpublished, so each state can be reported correctly AND proven invisible across tenants (INV-001).',
  tenants: [
    {
      key: 'tenant-a',
      label: 'Tenant A — E2E Fixture Academy Alpha',
      businessName: 'E2E Fixture Academy Alpha',
      plan: {
        name: 'E2E Fixture Plan Alpha',
        slug: 'e2e-fixture-plan-alpha',
        monthlyPriceInPaise: 49000,
        marketplaceListingEnabled: true,
      },
      admin: { email: 'e2e-fixture-alpha-admin@example.com', password: 'E2e-Fixture-Alpha-Passw0rd!' },
      instructor: {
        firstName: 'Ada',
        lastName: 'Alpha',
        email: 'e2e-fixture-alpha-instructor@example.com',
        password: 'E2e-Fixture-Instructor-Passw0rd!',
        slug: 'e2e-fixture-alpha-instructor',
        fullName: 'Ada Alpha',
      },
      student: {
        firstName: 'Sam',
        lastName: 'Alpha',
        email: 'e2e-fixture-alpha-student@example.com',
        password: 'E2e-Fixture-Student-Passw0rd!',
      },
      session: {
        title: 'E2E Fixture Alpha Python Bootcamp',
        subjectTags: ['e2e-fixture', 'python'],
      },
      expected: { subscription: 'active', bbb: 'scheduled_session', marketplace: 'published' },
    },
    {
      key: 'tenant-b',
      label: 'Tenant B — E2E Fixture Academy Beta',
      businessName: 'E2E Fixture Academy Beta',
      plan: {
        name: 'E2E Fixture Plan Beta',
        slug: 'e2e-fixture-plan-beta',
        monthlyPriceInPaise: 0,
        marketplaceListingEnabled: false,
      },
      admin: { email: 'e2e-fixture-beta-admin@example.com', password: 'E2e-Fixture-Beta-Passw0rd!' },
      instructor: {
        firstName: 'Bob',
        lastName: 'Beta',
        email: 'e2e-fixture-beta-instructor@example.com',
        password: 'E2e-Fixture-Instructor-Passw0rd!',
        slug: 'e2e-fixture-beta-instructor',
        fullName: 'Bob Beta',
      },
      student: {
        firstName: 'Sara',
        lastName: 'Beta',
        email: 'e2e-fixture-beta-student@example.com',
        password: 'E2e-Fixture-Student-Passw0rd!',
      },
      session: {
        title: 'E2E Fixture Beta Draft Workshop',
        subjectTags: ['e2e-fixture', 'biology'],
      },
      expected: { subscription: 'cancelled', bbb: 'no_session', marketplace: 'unpublished' },
    },
  ],
};
