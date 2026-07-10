import gql from "graphql-tag";

export const adminApiExtensions = gql`
  extend type Query {
    """
    List customer status change logs (platform-wide or channel-scoped).
    Only accessible by SuperAdmin.
    """
    customerStatusChangeLogs(
      customerId: ID
      scope: String
    ): [CustomerStatusChangeLog!]!

    """
    Get channel-level status for a specific customer and channel.
    """
    customerChannelStatus(
      customerId: ID!
      channelId: ID!
    ): CustomerChannelStatus

    """
    List all channel status records for a customer across all channels.
    """
    customerChannelStatuses(
      customerId: ID!
    ): [CustomerChannelStatus!]!
  }

  extend type Mutation {
    """
    Suspend a customer platform-wide (SuperAdmin only).
    Blocks checkout in ALL channels.
    """
    suspendCustomer(
      customerId: ID!
      reason: String
    ): Boolean!

    """
    Reinstate a customer platform-wide (SuperAdmin only).
    """
    reinstateCustomer(customerId: ID!): Boolean!

    """
    Suspend a customer for a specific channel.
    Academy admins can suspend customers in their own channel.
    SuperAdmins can suspend in any channel.
    """
    suspendCustomerInChannel(
      customerId: ID!
      channelId: ID!
      reason: String
    ): Boolean!

    """
    Reinstate a customer for a specific channel.
    """
    reinstateCustomerInChannel(
      customerId: ID!
      channelId: ID!
    ): Boolean!
  }

  type CustomerChannelStatus {
    id: ID!
    createdAt: DateTime!
    updatedAt: DateTime!
    customerId: ID!
    channelId: ID!
    status: String!
    reason: String
  }

  type CustomerStatusChangeLog {
    id: ID!
    createdAt: DateTime!
    updatedAt: DateTime!
    customerId: ID!
    channelId: ID
    scope: String!
    previousStatus: String!
    newStatus: String!
    reason: String
    changedByAdministratorId: ID
    changedAt: DateTime
  }
`;
