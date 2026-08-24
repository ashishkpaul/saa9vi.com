import gql from "graphql-tag";

/**
 * Admin API extensions for Phase 2 tenant SaaS subscriptions.
 *
 * Portal Admin (SuperAdmin) manages the platform-global plan catalogue and
 * views tenant subscriptions. Tenant-facing subscribe/cancel flows arrive
 * with the Juspay integration increment.
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

  extend type Query {
    "All tenant SaaS plans (platform-global catalogue). SuperAdmin only."
    subscriptionPlans: [SubscriptionPlan!]!

    "All tenant subscriptions across channels. SuperAdmin only."
    organizationSubscriptions: [OrganizationSubscription!]!
  }

  extend type Mutation {
    "Create a plan in the global catalogue. SuperAdmin only."
    createSubscriptionPlan(input: SubscriptionPlanInput!): SubscriptionPlan!

    "Update an existing plan. SuperAdmin only."
    updateSubscriptionPlan(id: ID!, input: SubscriptionPlanInput!): SubscriptionPlan!
  }
`;
