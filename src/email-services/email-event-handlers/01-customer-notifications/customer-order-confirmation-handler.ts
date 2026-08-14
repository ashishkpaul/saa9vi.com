import { EntityHydrator, OrderPlacedEvent } from '@vendure/core';
import { EmailEventListener } from '@vendure/email-plugin';

/**
 * Customer notification for order confirmation codes / verification.
 */
export const customerOrderConfirmationCodeHandler = new EmailEventListener(
  'customer-order-confirmation-code'
)
  .on(OrderPlacedEvent)
  .filter((event) => !!event.order.customer?.emailAddress)
  .loadData(async ({ event, injector }) => {
    const entityHydrator = injector.get(EntityHydrator);
    await entityHydrator.hydrate(event.ctx, event.order, {
      relations: ['customer', 'lines.productVariant'],
    });
    return {};
  })
  .setRecipient((event) => event.order.customer?.emailAddress || '')
  .setFrom('{{ fromAddress }}')
  .setSubject('Your Order Confirmation Code for #{{ order.code }}')
  .setTemplateVars((event) => ({
    order: event.order,
    customer: event.order.customer,
    confirmationCode: event.order.code,
  }));
