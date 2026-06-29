import gql from 'graphql-tag';

export const adminApiExtensions = gql`
  type LoadMetrics {
    avgLatency: Float!
    p95: Float!
    p99: Float!
    errorRate: Float!
    totalRequests: Int!
  }

  type CausalDrift {
    latencyViolation: Boolean!
    errorViolation: Boolean!
    causalBreak: Boolean!
    details: [String!]!
  }

  type LoadReport {
    id: ID!
    profile: String!
    totalRequests: Int!
    successCount: Int!
    errorCount: Int!
    duration: Int!
    metrics: LoadMetrics!
    drift: CausalDrift!
  }

  extend type Query {
    runLoadTest(profile: String!): LoadReport!
  }
`;
