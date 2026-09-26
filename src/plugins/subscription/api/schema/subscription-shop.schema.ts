import gql from "graphql-tag";

/**
 * Shop API (tenant-facing) commercial read surface — plan §3.5, slice 8.
 *
 * Tenant-facing commercial read and self-serve mutation surface.
 * The plan catalogue and read model remain provider-internal-safe; ADR-046 adds
 * only tenant-scoped lifecycle mutations with an ephemeral authorizationUrl result.
 *
 * TENANT RESOLUTION: every tenant-scoped field resolves the tenant from
 * `ctx.channelId` — the hostname→channel resolution the storefront already
 * performs. There is deliberately NO `channelId` argument anywhere in this
 * surface, so a caller cannot name another tenant.
 *
 * PERMISSION MODEL (locked for slice 8):
 *   availableSubscriptionPlans : Permission.Public — the platform-global plan
 *       catalogue carries no tenant-private state, so it renders pre-auth.
 *   mySubscription / myLiveUsage : Permission.Authenticated **plus** an explicit
 *       tenant business-account ownership check
 *       (`TenantBusinessAccountService`). `Authenticated` alone is NOT
 *       ownership: the Customer role is assigned to every tenant channel, so
 *       any logged-in learner would otherwise satisfy it. See that service for
 *       the full rationale.
 *
 * PROVIDER-INTERNALS BOUNDARY: these types expose only customer-facing fields.
 * `providerPlanId`, `providerStatus`, `providerShortUrl` and `billingCustomerId`
 * are NEVER exposed here — they are provider/billing internals that belong to
 * the Admin surface (`subscription-admin.schema.ts`) only.
 */
export const shopApiExtensions = gql`
  """
  A tenant-subscribable tier as the storefront may see it.
  Deliberately omits provider wiring (see module note above).
  """
  type SubscriptionPlanPublic {
    id: ID!
    name: String!
    slug: String!
    description: String
    monthlyPriceInPaise: Int!
    includedBbbMinutes: Int!
    maxStudents: Int!
    customDomainEnabled: Boolean!
    whitelabelEnabled: Boolean!
    "ADR-042 §2: whether this tier may be listed on the marketplace."
    marketplaceListingEnabled: Boolean!
  }

  """
  Result of a tenant self-serve subscription lifecycle mutation.
  authorizationUrl is invocation-scoped provider authorization data and is
  never persisted on the MySubscription read model.
  """
  type MySubscriptionChangeResult {
    subscription: MySubscription!
    authorizationUrl: String
  }

  """
  The active channel's own subscription. Readable only by the tenant's
  business account.
  """
  type MySubscription {
    plan: SubscriptionPlanPublic!
    """
    Local FSM state (ADR-039): pending_provider_auth | trialing | active |
    past_due | cancelled. Never the provider's own status string.
    """
    status: String!
    """
    NULL for a provider-free plan (Free Basic): those rows must keep the period
    NULL so the paid renewal scan never discovers them (plan §0.19 F-7).
    """
    currentPeriodStart: DateTime
    currentPeriodEnd: DateTime
    cancelAtPeriodEnd: Boolean!
    cancelledAt: DateTime
    """
    ADR-042/INV-024 marketplace-listing eligibility for this channel, evaluated
    by the shared platform policy 'CommercialEntitlementService' — not
    re-derived here.
    """
    marketplaceEligible: Boolean!
  }

  """
  Live meeting-minutes allowance for the active channel's current period.

  Sourced from BbbCapacityGrant, restricted to tenant-selectable source types
  ('order', 'subscription'): 'internal_overhead' is ops headroom and is never
  reported as customer allowance (BUG-036 semantics, shared with the
  provisioning gate).
  """
  type MyLiveUsage {
    "The subscription period these figures belong to (NULL when provider-free)."
    periodStart: DateTime
    periodEnd: DateTime
    "Minutes granted for this period (excludes unlimited grants)."
    includedMinutes: Int!
    "Minutes consumed for this period."
    consumedMinutes: Int!
    """
    Minutes left. NULL when the channel has an unlimited grant — infinite
    capacity, not a number, so it is not coerced into one.
    """
    remainingMinutes: Int
    isUnbounded: Boolean!
  }

  extend type Query {
    "The platform-global plan catalogue. Public — no tenant state involved."
    availableSubscriptionPlans: [SubscriptionPlanPublic!]!
    "Null when the channel has no subscription at all."
    mySubscription: MySubscription
    myLiveUsage: MyLiveUsage!
  }

  extend type Mutation {
    "Change the subscription for the authenticated business account's active tenant channel."
    requestMySubscriptionPlanChange(planId: ID!): MySubscriptionChangeResult!
    "Cancel the subscription for the authenticated business account's active tenant channel."
    cancelMySubscription(atPeriodEnd: Boolean = true): MySubscriptionChangeResult!
  }
`;
