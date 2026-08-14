import { EntityHydrator, OrderStateTransitionEvent } from '@vendure/core';
import { EmailEventListener } from '@vendure/email-plugin';
import { resolveOrderSellerEmails } from '../utils/tenant-email-resolver';

/**
 * Seller / Tenant notification when an order is marked as Shipped.
 */
export const sellerOrderShippedNotificationHandler = new EmailEventListener(
  'seller-order-shipped'
)
  .on(OrderStateTransitionEvent)
  .filter((event) => event.toState === 'Shipped')
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
  .setSubject('[Seller Notice] Order #{{ order.code }} Has Been Shipped')
  .setTemplateVars((event) => ({
    order: event.order,
    customer: event.order.customer,
  }));

/**
 * Seller / Tenant notification when an order is Cancelled.
 */
export const sellerOrderCancelledNotificationHandler = new EmailEventListener(
  'seller-order-cancelled'
)
  .on(OrderStateTransitionEvent)
  .filter((event) => event.toState === 'Cancelled')
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
  .setSubject('[Seller Notice] Order #{{ order.code }} Was Cancelled')
  .setTemplateVars((event) => ({
    order: event.order,
    customer: event.order.customer,
  }));
