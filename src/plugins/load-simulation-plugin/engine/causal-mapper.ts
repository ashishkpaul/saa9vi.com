import { LifecycleStep } from "../../../platform/stress-test/lifecycle-simulator";

export interface GraphQLRequest {
  mutation: string | null;
  context: "shop" | "admin";
  variables?: Record<string, unknown>;
  isPending?: boolean;
}

export class CausalMapper {
  static map(step: LifecycleStep): GraphQLRequest {
    const eventType = step.eventType;
    const variables = { ...step.payload };

    switch (eventType) {
      case "OrderStateTransitionEvent":
        return {
          mutation: ADD_ITEM_TO_ORDER_MUTATION,
          context: "shop",
          variables,
        };

      // Phase 2 — not yet implemented
      case "SubscriptionRenewedEvent":
      case "SubscriptionInvoicePaidEvent":
      case "RecurringCapacityGrantCreatedEvent":
        return {
          mutation: null,
          context: "admin",
          isPending: true,
          variables,
        };

      case "BbbScheduledSessionActivatedEvent":
        return {
          mutation: ACTIVATE_SESSION_MUTATION,
          context: "admin",
          variables,
        };

      case "BbbWebhookEvent":
        return {
          mutation: SIMULATE_BBB_WEBHOOK_MUTATION,
          context: "admin",
          variables,
        };

      case "ReviewRequestCreatedEvent":
        return {
          mutation: CREATE_REVIEW_REQUEST_MUTATION,
          context: "admin",
          variables,
        };

      case "EntitlementCreatedEvent":
        return {
          mutation: CHECK_ENTITLEMENT_QUERY,
          context: "shop",
          variables,
        };

      case "MeetingStartedEvent":
        return {
          mutation: MY_BBB_MEETINGS_QUERY,
          context: "shop",
          variables,
        };

      case "MeetingEndedEvent":
        return {
          mutation: MY_BBB_ENROLLMENTS_QUERY,
          context: "shop",
          variables,
        };

      default:
        return {
          mutation: MY_BBB_ROOMS_QUERY,
          context: "shop",
          variables,
        };
    }
  }
}

// Real Shop API operations
const ADD_ITEM_TO_ORDER_MUTATION = /* GraphQL */ `
  mutation AddItemToOrder($productVariantId: ID!, $quantity: Int!) {
    addItemToOrder(productVariantId: $productVariantId, quantity: $quantity) {
      ... on Order { id, state, total }
      ... on ErrorResult { errorCode, message }
    }
  }
`;

const MY_BBB_MEETINGS_QUERY = /* GraphQL */ `
  query MyBbbMeetings($skip: Int, $take: Int) {
    myBbbMeetings(skip: $skip, take: $take) {
      items { id, state, roomId }
      totalItems
    }
  }
`;

const MY_BBB_ROOMS_QUERY = /* GraphQL */ `
  query MyBbbRooms {
    myBbbRooms { id, name, state }
  }
`;

const MY_BBB_ENROLLMENTS_QUERY = /* GraphQL */ `
  query MyBbbEnrollments {
    myBbbEnrollments { id, roomId, roomName, roomState, active }
  }
`;

const CHECK_ENTITLEMENT_QUERY = /* GraphQL */ `
  query BbbRoomStatus($id: ID!) {
    bbbRoomStatus(id: $id) { id, name, state }
  }
`;

// Admin API operations
const ACTIVATE_SESSION_MUTATION = /* GraphQL */ `
  mutation ActivateScheduledSession($sessionId: ID!) {
    activateScheduledSession(sessionId: $sessionId) { id, title, status }
  }
`;

const SIMULATE_BBB_WEBHOOK_MUTATION = /* GraphQL */ `
  mutation SimulateBbbWebhook($payload: String!) {
    simulateBbbWebhook(payload: $payload) { success }
  }
`;

const CREATE_REVIEW_REQUEST_MUTATION = /* GraphQL */ `
  mutation CreateReviewRequest($productId: ID!, $customerId: ID!) {
    createReviewRequest(productId: $productId, customerId: $customerId) { id }
  }
`;
