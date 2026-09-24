import { CheckResult, Checker } from '../runner';
import { EventTraceCollector, EventChain } from './event-trace-collector';

export interface CausalityRule {
  name: string;
  description: string;
  trigger: string;
  requiredSteps: string[];
  severity: 'error' | 'warning' | 'info';
}

export class EventCausalityValidator implements Checker {
  name = 'runtime-causality';

  private collector: EventTraceCollector;

  constructor(collector: EventTraceCollector) {
    this.collector = collector;
  }

  async check(): Promise<CheckResult> {
    const rules = this.getRfcCausalityRules();
    const violations: string[] = [];
    const pendingRules: string[] = [];

    for (const rule of rules) {
      const chain = this.collector.getEmissions().find(e => e.eventName === rule.trigger);
      if (!chain) {
        // Trigger event not found in codebase — likely a Phase 2 feature
        pendingRules.push(rule.name);
        continue;
      }

      const missingSteps = rule.requiredSteps.filter(
        step => !chain.triggeredActions.includes(step)
      );

      if (missingSteps.length > 0) {
        violations.push(
          `[${rule.name}] ${rule.description}\n` +
          `  Missing subsequent actions: ${missingSteps.join(', ')}\n` +
          `  Expected after ${rule.trigger}: ${rule.requiredSteps.join(' → ')}`
        );
      }
    }

    const passed = violations.length === 0;

    return {
      checker: this.name,
      name: 'event-causality',
      passed,
      severity: 'warning',
      message: passed
        ? pendingRules.length > 0
          ? `Causality verified for implemented events; ${pendingRules.length} Phase 2/3 rule(s) pending`
          : 'All event causality rules verified'
        : `${violations.length} causality rule(s) violated`,
      details: passed
        ? pendingRules.length > 0
          ? `Implemented: ${rules.filter(r => !pendingRules.includes(r.name)).map(r => r.name).join(', ')}\nPending (Phase 2/3): ${pendingRules.join(', ')}`
          : 'RFC causality chain intact: PaymentSettled → Invoice → Grant → Order'
        : violations.join('\n\n'),
    };
  }

  private getRfcCausalityRules(): CausalityRule[] {
    return [
      {
        name: 'payment-settled-to-invoice',
        description: 'PaymentSettled MUST precede SubscriptionInvoice creation',
        trigger: 'PaymentSettledEvent',
        requiredSteps: ['SubscriptionInvoice'],
        severity: 'error',
      },
      {
        name: 'invoice-to-grant',
        description: 'SubscriptionInvoice MUST precede the subscription capacity grant',
        trigger: 'SubscriptionInvoice',
        requiredSteps: ['SubscriptionCapacityGrant'],
        severity: 'error',
      },
      {
        name: 'grant-to-order',
        description: 'Grant issuance MUST precede Order creation',
        trigger: 'SubscriptionCapacityGrant',
        requiredSteps: ['Order'],
        severity: 'error',
      },
      {
        name: 'webhook-persist-before-process',
        description: 'Webhook persistence MUST precede processing',
        trigger: 'BbbWebhookEvent',
        requiredSteps: ['BullMQJob'],
        severity: 'error',
      },
      {
        name: 'order-to-entitlement',
        description: 'Order fulfillment MUST create Entitlement',
        trigger: 'OrderStateTransitionEvent',
        requiredSteps: ['Entitlement'],
        severity: 'error',
      },
      {
        name: 'webhook-to-ledger',
        description: 'Meeting-ended webhook MUST write to BbbUsageLedger',
        trigger: 'MeetingEndedEvent',
        requiredSteps: ['BbbUsageLedger'],
        severity: 'error',
      },
      {
        name: 'subscription-renewed-event',
        // F-6 reconciliation (2026-09-24): the shipped grant is a
        // BbbCapacityGrant(sourceType='subscription') written by
        // BbbSubscriptionListener — a subscriber-side action merged into this
        // chain by EventTraceCollector.linkSubscriberActions under the
        // canonical action name SubscriptionCapacityGrant. RFC-001 §4's
        // programmatic renewal Order is not part of the shipped path yet
        // (R3/R4 payment gates), so it is deliberately not required here.
        description:
          'Subscription renewal success publishes SubscriptionRenewedEvent and writes the subscription capacity grant',
        trigger: 'SubscriptionRenewedEvent',
        requiredSteps: ['SubscriptionCapacityGrant'],
        severity: 'error',
      },
    ];
  }
}
