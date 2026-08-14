import {
  EntityHydrator,
  OrderStateTransitionEvent,
} from '@vendure/core';
import {
  EmailEventListener,
  transformOrderLineAssetUrls,
  shippingLinesWithMethod,
} from '@vendure/email-plugin';

/**
 * Customer notification when an order is placed and payment is settled.
 */
export const customerOrderConfirmationHandler = new EmailEventListener('order-confirmation')
  .on(OrderStateTransitionEvent)
  .filter(
    (event) =>
      event.toState === 'PaymentSettled' &&
      event.fromState !== 'Modifying' &&
      !!event.order.customer?.emailAddress
  )
  .loadData(async ({ event, injector }) => {
    const entityHydrator = injector.get(EntityHydrator);
    await entityHydrator.hydrate(event.ctx, event.order, {
      relations: [
        'customer',
        'lines.featuredAsset',
        'lines.productVariant',
        'shippingLines.shippingMethod',
        'channels',
      ],
    });
    transformOrderLineAssetUrls(event.ctx, event.order, injector);
    const shippingLines = shippingLinesWithMethod(event.order);
    return { shippingLines };
  })
  .setRecipient((event) => event.order.customer?.emailAddress || '')
  .setFrom('{{ fromAddress }}')
  .setSubject('Order Confirmation for #{{ order.code }}')
  .setTemplateVars((event) => ({
    order: event.order,
    customer: event.order.customer,
    shippingLines: event.data.shippingLines,
  }));
