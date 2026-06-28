export interface LifecycleStep {
  name: string;
  eventType: string;
  payload: Record<string, unknown>;
  expectedNext?: string[];
}

export class LifecycleSimulator {
  static getStudentPurchaseLifecycle(): LifecycleStep[] {
    return [
      {
        name: "order-created",
        eventType: "OrderStateTransitionEvent",
        payload: { toState: "PaymentSettled", orderId: "order-123" },
        expectedNext: ["Entitlement", "ReviewRequest"],
      },
      {
        name: "entitlement-created",
        eventType: "EntitlementCreatedEvent",
        payload: { type: "bbb_session", resourceId: "session-456" },
        expectedNext: ["MeetingProvisionedEvent"],
      },
      {
        name: "review-requested",
        eventType: "ReviewRequestCreatedEvent",
        payload: { productId: "product-789", customerId: "customer-101" },
        expectedNext: ["ReviewRequestScheduledEvent"],
      },
    ];
  }

  static getBbbSessionLifecycle(): LifecycleStep[] {
    return [
      {
        name: "session-activated",
        eventType: "BbbScheduledSessionActivatedEvent",
        payload: { sessionId: "session-456" },
        expectedNext: ["MeetingProvisionedEvent"],
      },
      {
        name: "meeting-started",
        eventType: "MeetingStartedEvent",
        payload: { meetingId: "meeting-123" },
        expectedNext: ["MeetingEndedEvent", "GrantConsumedEvent"],
      },
      {
        name: "meeting-ended",
        eventType: "MeetingEndedEvent",
        payload: { meetingId: "meeting-123", durationMinutes: 90 },
        expectedNext: ["BbbUsageLedger", "GrantConsumedEvent"],
      },
      {
        name: "webhook-received",
        eventType: "BbbWebhookEvent",
        payload: { eventType: "meeting-ended", meetingId: "meeting-123" },
        expectedNext: ["bbb-webhook-processor:started"],
      },
    ];
  }

  static getSubscriptionLifecycle(): LifecycleStep[] {
    return [
      {
        name: "subscription-renewed",
        eventType: "SubscriptionRenewedEvent",
        payload: { enrollmentId: "enrollment-456", invoiceId: "invoice-789" },
        expectedNext: ["RecurringCapacityGrant", "OrderCreated"],
      },
      {
        name: "invoice-paid",
        eventType: "SubscriptionInvoicePaidEvent",
        payload: { invoiceId: "invoice-789", amount: 99900 },
        expectedNext: ["RecurringCapacityGrant"],
      },
      {
        name: "grant-created",
        eventType: "RecurringCapacityGrantCreatedEvent",
        payload: { enrollmentId: "enrollment-456", grantedMinutes: 300 },
        expectedNext: ["OrderCreated", "MeetingProvisionedEvent"],
      },
    ];
  }

  static getAllLifecycles(): Record<string, LifecycleStep[]> {
    return {
      student_purchase: this.getStudentPurchaseLifecycle(),
      bbb_session: this.getBbbSessionLifecycle(),
      subscription: this.getSubscriptionLifecycle(),
    };
  }
}
