import { EntityHydrator, OrderStateTransitionEvent } from '@vendure/core';
import { EmailEventListener } from '@vendure/email-plugin';
import { resolveOrderSellerEmails } from '../utils/tenant-email-resolver';

/**
 * Seller / Tenant notification when a customer places an order.
 */
export const sellerOrderPlacedNotificationHandler = new EmailEventListener('seller-order-placed')
  .on(OrderStateTransitionEvent)
  .filter((event) => event.toState === 'PaymentSettled' && event.fromState !== 'Modifying')
  .loadData(async ({ event, injector }) => {
    const entityHydrator = injector.get(EntityHydrator);
    await entityHydrator.hydrate(event.ctx, event.order, {
      relations: [
        'customer',
        'lines.productVariant',
        'lines.productVariant.channels',
        'lines.productVariant.channels.seller',
      ],
    });
    const sellerEmails = await resolveOrderSellerEmails(injector, event.ctx, event.order);
    return { sellerEmails };
  })
  .setRecipient((event) => (event.data?.sellerEmails ? event.data.sellerEmails.join(', ') : ''))
  .setFrom('{{ fromAddress }}')
  .setSubject('[Seller Notice] New Order Received: #{{ order.code }}')
  .setTemplateVars((event) => ({
    order: event.order,
    customer: event.order.customer,
  }));
