import gql from 'graphql-tag';

export const shopApiExtensions = gql`
  type MarketplaceSession {
    id: ID!
    productVariantId: ID
    channelId: String!
    channelToken: String!
    title: String!
    startTime: DateTime!
    endTime: DateTime!
    priceInPaise: Int!
    academyName: String!
    academySlug: String!
    customDomain: String
    instructorName: String
    subjectTags: [String!]!
    bayesianRating: Float!
    isSponsored: Boolean!
  }

  type MarketplaceInstructor {
    id: ID!
    channelId: String!
    channelToken: String!
    name: String!
    bio: String!
    slug: String!
    photoUrl: String
    subjectTags: [String!]!
    reviewRating: Float
    academyName: String!
    academySlug: String!
  }

  type MarketplaceSearchResult {
    sessions: [MarketplaceSession!]!
    instructors: [MarketplaceInstructor!]!
    totalSessions: Int!
    totalInstructors: Int!
  }

  input MarketplaceSearchInput {
    query: String!
    subjectTags: [String!]
    city: String
    skip: Int
    take: Int
  }

  extend type Query {
    """
    Public marketplace search — no channel token required.
    Queries platform-level Elasticsearch indices for cross-tenant discovery.
    """
    marketplaceSearch(input: MarketplaceSearchInput!): MarketplaceSearchResult!
  }

  type MarketplaceReferenceApplyResult {
    ok: Boolean!
    orderId: ID
    code: String
  }

  extend type Mutation {
    """
    Attach a server-verified marketplace attribution reference to the active order..
    The storefront only supplies the opaque marketplaceRef it received from the marketplace
    discovery API。 Vendure resolves it(HMAC + TTL + channel binding) BEFORE storing,
    so the client can never select orderSource (INV-008;; ADR-021 Decision  ̃7/8)..
    orderSource is never accepted nor written here— it is classified later at the
    order lifecycle boundary (3B.3)。
    """
    applyMarketplaceReference(ref: String!): MarketplaceReferenceApplyResult!
  }
`;

export const adminApiExtensions = gql`
  extend type Query {
    """
    Trigger a full reindex of all marketplace ES indices.
    Requires SuperAdmin permission.
    """
    marketplaceFullReindex: Boolean!
  }
`;
