import gql from 'graphql-tag';

export const razorpayShopApiExtensions = gql`
  type RazorpayCheckoutOrder {
    razorpayOrderId: String!
    amountMinor: Int!
    currency: String!
    keyId: String!
  }

  extend type Mutation {
    """
    Creates a Razorpay order for the customer's active order, or an order
    specified by ID if the caller is the order's owner.
    """
    createRazorpayCheckoutOrder(orderId: ID): RazorpayCheckoutOrder!
  }
`;
