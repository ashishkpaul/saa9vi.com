import gql from 'graphql-tag';

export const shopApiExtensions = gql`
  type JuspaySessionResult {
    juspayOrderId: String!
    paymentLink: String
    status: String!
  }

  extend type Mutation {
    initiateJuspaySession(orderId: ID!): JuspaySessionResult!
    cancelJuspaySession(orderId: ID!): Boolean!
  }

  extend type Query {
    juspayOrderStatus(juspayOrderId: String!): String!
  }
`;