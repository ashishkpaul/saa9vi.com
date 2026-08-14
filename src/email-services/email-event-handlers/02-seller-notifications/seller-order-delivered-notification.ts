import { EntityHydrator, OrderStateTransitionEvent } from '@vendure/core';
import { EmailEventListener } from '@vendure/email-plugin';
import { resolveOrderSellerEmails } from '../utils/tenant-email-resolver';

/**
 * Seller / Tenant notification when an order is marked as Delivered.
 */
export const sellerOrderDeliveredNotificationHandler = new EmailEventListener(
  'seller-order-delivered'
)
  .on(OrderStateTransitionEvent)
  .filter((event) => event.toState === 'Delivered')
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
  .setSubject('[Seller Notice] Order #{{ order.code }} Has Been Delivered')
  .setTemplateVars((event) => ({
    order: event.order,
    customer: event.order.customer,
  }));
