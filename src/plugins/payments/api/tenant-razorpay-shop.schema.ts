import gql from 'graphql-tag';

/**
 * Tenant Razorpay Shop API extensions (Phase 2, ADR-051 Option C).
 *
 * Tenant-client collections (Flow B) use the tenant's own Razorpay account,
 * resolved from the authenticated request's channel. This is separate from
 * the platform Razorpay handler (Flow A: tenant admin pays Saa9vi).
 */
export const tenantRazorpayShopApiExtensions = gql`
  extend type Mutation {
    """
    Create a Razorpay order for tenant-client checkout (Flow B).
    Resolves the tenant's Razorpay credentials from the active channel.
    Returns the tenant's public Key ID for the browser checkout.
    """
    createTenantRazorpayCheckoutOrder(orderId: ID): TenantRazorpayCheckoutOrder!
  }

  type TenantRazorpayCheckoutOrder {
    razorpayOrderId: String!
    amountMinor: Int!
    currency: String!
    """
    Tenant's public Razorpay Key ID — safe to expose to the browser.
    """
    keyId: String!
  }
`;