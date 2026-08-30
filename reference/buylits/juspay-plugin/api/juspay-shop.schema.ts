import { gql } from 'graphql-tag';

export const juspayShopSchema = gql`
  type JuspayPaymentResponse {
    juspayOrderId: String!
    paymentLink: String
    status: String!
  }

  extend type Mutation {
    initiateJuspayPayment(orderId: ID!, amount: Int!): JuspayPaymentResponse!
  }
`;