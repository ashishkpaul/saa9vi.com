import { EntityHydrator, RefundStateTransitionEvent } from '@vendure/core';
import { EmailEventListener } from '@vendure/email-plugin';

/**
 * Customer notification when a refund is settled.
 */
export const customerOrderRefundNotificationHandler = new EmailEventListener(
  'customer-order-refund'
)
  .on(RefundStateTransitionEvent)
  .filter((event) => event.toState === 'Settled' && !!event.order?.customer?.emailAddress)
  .loadData(async ({ event, injector }) => {
    const entityHydrator = injector.get(EntityHydrator);
    await entityHydrator.hydrate(event.ctx, event.order, {
      relations: ['customer', 'lines.productVariant'],
    });
    return {};
  })
  .setRecipient((event) => event.order.customer?.emailAddress || '')
  .setFrom('{{ fromAddress }}')
  .setSubject('Refund Processed for Order #{{ order.code }}')
  .setTemplateVars((event) => ({
    order: event.order,
    refund: event.refund,
  }));
