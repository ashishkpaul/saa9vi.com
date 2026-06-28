import { LifecycleStep } from "../../../platform/stress-test/lifecycle-simulator";

export interface GraphQLRequest {
  mutation: string;
  context: "shop" | "admin";
  variables?: Record<string, unknown>;
}

export class CausalMapper {
  static map(step: LifecycleStep): GraphQLRequest {
    const eventType = step.eventType;
    const variables = { ...step.payload };

    switch (eventType) {
      case "OrderStateTransitionEvent":
        return {
          mutation: CREATE_ORDER_MUTATION,
          context: "shop",
          variables,
        };

      case "SubscriptionRenewedEvent":
        return {
          mutation: RENEW_SUBSCRIPTION_MUTATION,
          context: "admin",
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
          mutation: PROCESS_WEBHOOK_MUTATION,
          context: "admin",
          variables,
        };

      case "ReviewRequestCreatedEvent":
        return {
          mutation: CREATE_REVIEW_REQUEST_MUTATION,
          context: "admin",
          variables,
        };

      default:
        return {
          mutation: `# Unmapped event: ${eventType}`,
          context: "shop",
          variables,
        };
    }
  }
}

// Placeholder mutations — replace with real GraphQL operations
const CREATE_ORDER_MUTATION = /* GraphQL */ `
  mutation CreateOrder($input: CreateOrderInput!) {
    createOrder(input: $input) { id, orderState, total }
  }
`;

const RENEW_SUBSCRIPTION_MUTATION = /* GraphQL */ `
  mutation RenewSubscription($enrollmentId: ID!) {
    renewSubscription(enrollmentId: $enrollmentId) { id, status }
  }
`;

const ACTIVATE_SESSION_MUTATION = /* GraphQL */ `
  mutation ActivateSession($sessionId: ID!) {
    activateScheduledSession(sessionId: $sessionId) { id, status }
  }
`;

const PROCESS_WEBHOOK_MUTATION = /* GraphQL */ `
  mutation ProcessWebhook($payload: String!) {
    processBbbWebhook(payload: $payload) { success }
  }
`;

const CREATE_REVIEW_REQUEST_MUTATION = /* GraphQL */ `
  mutation CreateReviewRequest($productId: ID!, $customerId: ID!) {
    createReviewRequest(productId: $productId, customerId: $customerId) { id }
  }
`;
