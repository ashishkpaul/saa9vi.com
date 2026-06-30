import gql from 'graphql-tag';

export const shopApiExtensions = gql`
  type MarketplaceSession {
    id: ID!
    productVariantId: ID
    channelToken: String!
    title: String!
    startTime: DateTime!
    endTime: DateTime!
    priceInPaise: Int!
    academyName: String!
    academySlug: String!
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
