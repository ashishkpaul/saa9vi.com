import { EntityHydrator, OrderStateTransitionEvent } from '@vendure/core';
import { EmailEventListener } from '@vendure/email-plugin';

/**
 * Customer notification when an order is cancelled.
 */
export const customerOrderCancellationNotificationHandler = new EmailEventListener(
  'customer-order-cancellation'
)
  .on(OrderStateTransitionEvent)
  .filter((event) => event.toState === 'Cancelled' && !!event.order.customer?.emailAddress)
  .loadData(async ({ event, injector }) => {
    const entityHydrator = injector.get(EntityHydrator);
    await entityHydrator.hydrate(event.ctx, event.order, {
      relations: ['customer', 'lines.productVariant', 'shippingLines'],
    });
    return {};
  })
  .setRecipient((event) => event.order.customer?.emailAddress || '')
  .setFrom('{{ fromAddress }}')
  .setSubject('Cancellation Notice for Order #{{ order.code }}')
  .setTemplateVars((event) => ({
    order: event.order,
    customer: event.order.customer,
  }));
