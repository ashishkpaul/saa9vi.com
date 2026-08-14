import { EntityHydrator, OrderStateTransitionEvent } from '@vendure/core';
import { EmailEventListener } from '@vendure/email-plugin';

/**
 * Customer notification when an order is marked as Delivered.
 */
export const customerOrderDeliveredHandler = new EmailEventListener('customer-order-delivered')
  .on(OrderStateTransitionEvent)
  .filter((event) => event.toState === 'Delivered' && !!event.order.customer?.emailAddress)
  .loadData(async ({ event, injector }) => {
    const entityHydrator = injector.get(EntityHydrator);
    await entityHydrator.hydrate(event.ctx, event.order, {
      relations: ['customer', 'lines.productVariant', 'shippingLines'],
    });
    return {};
  })
  .setRecipient((event) => event.order.customer?.emailAddress || '')
  .setFrom('{{ fromAddress }}')
  .setSubject('Your Order #{{ order.code }} Has Been Delivered')
  .setTemplateVars((event) => ({
    order: event.order,
    customer: event.order.customer,
  }));
