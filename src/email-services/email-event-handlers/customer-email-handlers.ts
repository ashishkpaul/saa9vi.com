// Centralized export and grouping for all customer email event handlers
// Improves maintainability and scalability for Vendure EmailPlugin configuration

import {
  customerOrderConfirmationHandler,
  customerOrderCancellationNotificationHandler,
  customerOrderPaymentFailedNotificationHandler,
  customerOrderRefundNotificationHandler,
  customerOrderDeliveredHandler,
  customerOrderShippedHandler,
  customerPasswordResetHandler,
  customerPasswordResetVerifiedHandler,
  customerEmailVerificationHandler,
  customerAccountVerifiedHandler,
  customerOrderConfirmationCodeHandler,
} from './01-customer-notifications';

export {
  customerOrderConfirmationHandler,
  customerOrderCancellationNotificationHandler,
  customerOrderPaymentFailedNotificationHandler,
  customerOrderRefundNotificationHandler,
  customerOrderDeliveredHandler,
  customerOrderShippedHandler,
  customerPasswordResetHandler,
  customerPasswordResetVerifiedHandler,
  customerEmailVerificationHandler,
  customerAccountVerifiedHandler,
  customerOrderConfirmationCodeHandler,
};

/**
 * All customer-related email event handlers for Vendure EmailPlugin
 * Usage: EmailPlugin.init({ handlers: [...customerEmailHandlers] })
 */
export const customerEmailHandlers = [
  customerOrderConfirmationHandler,
  customerOrderCancellationNotificationHandler,
  customerOrderPaymentFailedNotificationHandler,
  customerOrderRefundNotificationHandler,
  customerOrderDeliveredHandler,
  customerOrderShippedHandler,
  customerPasswordResetHandler,
  customerPasswordResetVerifiedHandler,
  customerEmailVerificationHandler,
  customerAccountVerifiedHandler,
  customerOrderConfirmationCodeHandler,
];
