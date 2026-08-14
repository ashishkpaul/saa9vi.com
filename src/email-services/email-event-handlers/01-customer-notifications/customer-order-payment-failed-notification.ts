import { EntityHydrator, PaymentStateTransitionEvent } from '@vendure/core';
import { EmailEventListener } from '@vendure/email-plugin';

/**
 * Customer notification when a payment attempt fails or is declined.
 */
export const customerOrderPaymentFailedNotificationHandler = new EmailEventListener(
  'customer-order-payment-failed'
)
  .on(PaymentStateTransitionEvent)
  .filter(
    (event) =>
      (event.toState === 'Declined' || event.toState === 'Error') &&
      !!event.order?.customer?.emailAddress
  )
  .loadData(async ({ event, injector }) => {
    const entityHydrator = injector.get(EntityHydrator);
    await entityHydrator.hydrate(event.ctx, event.order, {
      relations: ['customer', 'lines.productVariant'],
    });
    return {};
  })
  .setRecipient((event) => event.order.customer?.emailAddress || '')
  .setFrom('{{ fromAddress }}')
  .setSubject('Payment Failed for Order #{{ order.code }}')
  .setTemplateVars((event) => ({
    order: event.order,
    payment: event.payment,
    errorMessage: event.payment?.errorMessage || 'Payment transaction was declined.',
  }));
