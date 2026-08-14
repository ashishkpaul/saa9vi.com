import { EntityHydrator, OrderStateTransitionEvent } from '@vendure/core';
import { EmailEventListener } from '@vendure/email-plugin';

/**
 * Customer notification when an order is marked as Shipped.
 */
export const customerOrderShippedHandler = new EmailEventListener('customer-order-shipped')
  .on(OrderStateTransitionEvent)
  .filter((event) => event.toState === 'Shipped' && !!event.order.customer?.emailAddress)
  .loadData(async ({ event, injector }) => {
    const entityHydrator = injector.get(EntityHydrator);
    await entityHydrator.hydrate(event.ctx, event.order, {
      relations: ['customer', 'lines.productVariant', 'shippingLines.shippingMethod'],
    });
    return {};
  })
  .setRecipient((event) => event.order.customer?.emailAddress || '')
  .setFrom('{{ fromAddress }}')
  .setSubject('Your Order #{{ order.code }} Has Shipped!')
  .setTemplateVars((event) => ({
    order: event.order,
    customer: event.order.customer,
  }));
