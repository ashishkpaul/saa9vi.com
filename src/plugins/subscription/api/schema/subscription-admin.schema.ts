import gql from "graphql-tag";

/**
 * Admin API extensions for Phase 2 tenant SaaS subscriptions.
 *
 * Portal Admin (SuperAdmin) manages the platform-global plan catalogue and
 * views tenant subscriptions. Read-only billing ledger surfaces:
 * provider mandates, payment attempts, and reconciliation incidents — all
 * filtered by channel (SEC-002 channel isolation).
 *
 * NOTE: Type names are provider-neutral (ProviderMandate, ProviderPaymentAttempt)
 * even though historical data may originate from a specific provider.
 */
export const adminApiExtensions = gql`
  type SubscriptionPlan {
    id: ID!
    createdAt: DateTime!
    updatedAt: DateTime!
    name: String!
    slug: String!
    description: String
    monthlyPriceInPaise: Int!
    includedBbbMinutes: Int!
    maxStudents: Int!
    customDomainEnabled: Boolean!
    whitelabelEnabled: Boolean!
    "ADR-042: plan-tier marketplace listing capability. Opt-in per tier."
    marketplaceListingEnabled: Boolean!
    isActive: Boolean!
    sortOrder: Int!
    providerPlanId: String
  }

  type OrganizationSubscription {
    id: ID!
    createdAt: DateTime!
    updatedAt: DateTime!
    plan: SubscriptionPlan!
    channelId: String!
    status: String!
    currentPeriodStart: DateTime
    currentPeriodEnd: DateTime
    cancelAtPeriodEnd: Boolean!
    cancelledAt: DateTime
    "ADR-042 §3: deadline until which a past_due subscription keeps its marketplace listing (null = no grace in progress). Set/cleared by the local subscription FSM."
    marketplaceGraceUntil: DateTime
    billingCustomerId: String
    providerStatus: String
    providerShortUrl: String
    version: Int!
  }

  input SubscriptionPlanInput {
    name: String!
    slug: String!
    description: String
    monthlyPriceInPaise: Int
    includedBbbMinutes: Int
    maxStudents: Int
    customDomainEnabled: Boolean
    whitelabelEnabled: Boolean
    "ADR-042: enable/disable marketplace listing for this plan tier (default false)."
    marketplaceListingEnabled: Boolean
    isActive: Boolean
    sortOrder: Int
    providerPlanId: String
  }

  """
  Read-only view of a provider subscription binding for the Portal Admin ledger.
  Mirrors SubscriptionProviderBinding entity fields; exposes no mutations
  (bindings are created via the provider checkout flow, not the admin API).
  """
  type ProviderMandate {
    id: ID!
    createdAt: DateTime!
    updatedAt: DateTime!
    channelId: String!
    subscriptionId: ID!
    provider: String!
    providerSubscriptionId: String!
    providerPlanId: String
    providerStatus: String!
    active: Boolean!
  }

  """
  Read-only view of a provider payment attempt for the Portal Admin ledger.
  Mirrors SubscriptionBillingAttempt entity fields.
  INV-019: immutable financial fact — no mutations exposed.
  """
  type ProviderPaymentAttempt {
    id: ID!
    createdAt: DateTime!
    updatedAt: DateTime!
    channelId: String!
    subscriptionId: ID!
    provider: String!
    providerSubscriptionId: String
    providerPaymentId: String
    providerInvoiceId: String
    providerEventId: String
    providerAttemptId: String
    invoiceId: String
    billingPeriodStart: String!
    amountPaise: Int!
    status: String!
    failureReason: String
    attemptedAt: DateTime!
  }

  """
  Operator-visible reconciliation incident. Created when a charge
  succeeded at the payment provider but the Saa9vi period could not be finalized
  (CAS conflict, channel-missing, etc.). Must be resolved by an operator.
  """
  type RenewalPaymentReconciliationRequired {
    id: ID!
    createdAt: DateTime!
    channelId: String!
    subscriptionId: ID!
    invoiceId: String!
    providerOrderId: String!
    detectedAt: DateTime!
    resolutionNote: String
    status: ReconciliationIncidentStatus!
  }

  enum ReconciliationIncidentStatus {
    PENDING
    RESOLVED
  }

  input ProviderMandateFilter {
    status: String
    subscriptionId: ID
  }

  input ProviderMandateSort {
    field: ProviderMandateSortField!
    direction: SortDirection! = DESC
  }

  enum ProviderMandateSortField {
    createdAt
    providerStatus
  }

  input ProviderPaymentAttemptFilter {
    status: String
    invoiceId: String
    subscriptionId: ID
    billingPeriodStart: String
  }

  input ProviderPaymentAttemptSort {
    field: ProviderPaymentAttemptSortField!
    direction: SortDirection! = DESC
  }

  enum ProviderPaymentAttemptSortField {
    attemptedAt
    amountPaise
    status
  }

  enum SortDirection {
    ASC
    DESC
  }

  input PaginationInput {
    skip: Int = 0
    take: Int = 50
  }

  type ProviderMandateList {
    items: [ProviderMandate!]!
    total: Int!
  }

  type ProviderPaymentAttemptList {
    items: [ProviderPaymentAttempt!]!
    total: Int!
  }

  type ReconciliationIncidentList {
    items: [RenewalPaymentReconciliationRequired!]!
    total: Int!
  }

  extend type Query {
    "All tenant SaaS plans (platform-global catalogue). SuperAdmin only."
    subscriptionPlans: [SubscriptionPlan!]!

    "All tenant subscriptions across channels. SuperAdmin only."
    organizationSubscriptions: [OrganizationSubscription!]!

    "Paginated read-only ledger of provider mandates for a channel. SuperAdmin only."
    providerMandates(
      channelId: String!
      filter: ProviderMandateFilter
      sort: ProviderMandateSort
      pagination: PaginationInput
    ): ProviderMandateList!

    "Paginated read-only ledger of provider payment attempts for a channel. SuperAdmin only."
    providerPaymentAttempts(
      channelId: String!
      filter: ProviderPaymentAttemptFilter
      sort: ProviderPaymentAttemptSort
      pagination: PaginationInput
    ): ProviderPaymentAttemptList!

    "Paginated list of operator-visible reconciliation incidents. SuperAdmin only."
    reconciliationIncidents(
      channelId: String
      status: ReconciliationIncidentStatus
      pagination: PaginationInput
    ): ReconciliationIncidentList!
  }

  extend type Mutation {
    "Create a plan in the global catalogue. SuperAdmin only."
    createSubscriptionPlan(input: SubscriptionPlanInput!): SubscriptionPlan!

    "Update an existing plan. SuperAdmin only."
    updateSubscriptionPlan(id: ID!, input: SubscriptionPlanInput!): SubscriptionPlan!

    "Subscribe a channel to a plan. SuperAdmin only."
    subscribeToPlan(channelId: String!, planId: ID!): OrganizationSubscription!
    "Supersede-in-place plan change for the channel's current subscription (ADR-044). Handles provider-wired and provider-free branches. SuperAdmin only."
    changeOrganizationSubscriptionPlan(channelId: String!, planId: ID!): OrganizationSubscription!
    "Cancel the channel's current subscription: immediately (atPeriodEnd=false, provider-wired rows also cancel at the provider) or at period end (atPeriodEnd=true; provider-free rows always cancel locally since they have no billing period). SuperAdmin only."
    cancelOrganizationSubscription(channelId: String!, atPeriodEnd: Boolean = true): OrganizationSubscription!
  }
`;
