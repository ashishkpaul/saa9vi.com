import gql from "graphql-tag";

/**
 * Admin API extensions for Phase 2 tenant SaaS subscriptions.
 *
 * Portal Admin (SuperAdmin) manages the platform-global plan catalogue and
 * views tenant subscriptions. Step 5 adds read-only billing ledger surfaces:
 * Juspay mandates, payment attempts, and reconciliation incidents — all
 * filtered by channel (SEC-002 channel isolation).
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
    isActive: Boolean!
    sortOrder: Int!
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
    billingCustomerId: String
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
    isActive: Boolean
    sortOrder: Int
  }

  """
  Read-only view of a JuspaySubscriptionMandate for the Portal Admin ledger.
  Mirrors entity fields but exposes no mutations (mandates are created via the
  Juspay checkout flow, not the admin API).
  """
  type JuspayMandate {
    id: ID!
    createdAt: DateTime!
    updatedAt: DateTime!
    channelId: String!
    subscriptionId: ID!
    juspayCustomerId: String!
    mandateId: String
    status: String!
    activatedAt: DateTime
    revokedAt: DateTime
  }

  """
  Read-only view of a JuspayPaymentAttempt for the Portal Admin ledger.
  INV-002: immutable financial fact — no mutations exposed.
  """
  type JuspayPaymentAttempt {
    id: ID!
    createdAt: DateTime!
    channelId: String!
    subscriptionId: ID!
    invoiceId: String!
    billingPeriodStart: String!
    amountPaise: Int!
    status: String!
    juspayOrderId: String
    juspayTransactionId: String
    failureReason: String
    attemptedAt: DateTime!
  }

  """
  Operator-visible reconciliation incident (Step 4D). Created when a charge
  succeeded at Juspay but the Saa9vi period could not be finalized (CAS
  conflict, channel-missing, etc.). Must be resolved by an operator.
  """
  type RenewalPaymentReconciliationRequired {
    id: ID!
    createdAt: DateTime!
    channelId: String!
    subscriptionId: ID!
    invoiceId: String!
    juspayOrderId: String!
    detectedAt: DateTime!
    resolutionNote: String
    status: ReconciliationIncidentStatus!
  }

  enum ReconciliationIncidentStatus {
    PENDING
    RESOLVED
  }

  input JuspayMandateFilter {
    status: String
    subscriptionId: ID
  }

  input JuspayMandateSort {
    field: JuspayMandateSortField!
    direction: SortDirection! = DESC
  }

  enum JuspayMandateSortField {
    createdAt
    activatedAt
    status
  }

  input JuspayPaymentAttemptFilter {
    status: String
    invoiceId: String
    subscriptionId: ID
    billingPeriodStart: String
  }

  input JuspayPaymentAttemptSort {
    field: JuspayPaymentAttemptSortField!
    direction: SortDirection! = DESC
  }

  enum JuspayPaymentAttemptSortField {
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

  type JuspayMandateList {
    items: [JuspayMandate!]!
    total: Int!
  }

  type JuspayPaymentAttemptList {
    items: [JuspayPaymentAttempt!]!
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

    "Paginated read-only ledger of Juspay mandates for a channel. SuperAdmin only."
    juspayMandates(
      channelId: String!
      filter: JuspayMandateFilter
      sort: JuspayMandateSort
      pagination: PaginationInput
    ): JuspayMandateList!

    "Paginated read-only ledger of Juspay payment attempts for a channel. SuperAdmin only."
    juspayPaymentAttempts(
      channelId: String!
      filter: JuspayPaymentAttemptFilter
      sort: JuspayPaymentAttemptSort
      pagination: PaginationInput
    ): JuspayPaymentAttemptList!

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
  }
`;
