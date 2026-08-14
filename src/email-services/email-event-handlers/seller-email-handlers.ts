// Centralized export and grouping for all seller / tenant email event handlers
// Improves maintainability and scalability for Vendure EmailPlugin configuration

import {
  sellerOrderDeliveredNotificationHandler,
  sellerOrderShippedNotificationHandler,
  sellerOrderCancelledNotificationHandler,
  sellerOrderPlacedNotificationHandler,
} from './02-seller-notifications';
import { createLowStockEmailHandler } from './stock-monitoring';
import { resolveOrderSellerEmails } from './utils/tenant-email-resolver';

export {
  sellerOrderDeliveredNotificationHandler,
  sellerOrderShippedNotificationHandler,
  sellerOrderCancelledNotificationHandler,
  sellerOrderPlacedNotificationHandler,
  createLowStockEmailHandler,
};

/**
 * All seller / tenant related email event handlers for Vendure EmailPlugin
 * Usage: EmailPlugin.init({ handlers: [...sellerEmailHandlers] })
 */
export const sellerEmailHandlers = [
  sellerOrderPlacedNotificationHandler,
  sellerOrderDeliveredNotificationHandler,
  sellerOrderShippedNotificationHandler,
  sellerOrderCancelledNotificationHandler,
  // Default low-stock monitoring handler (threshold: 10)
  createLowStockEmailHandler({
    threshold: 10,
    subject: 'Low Stock Alert: Variants Below Threshold',
    emailRecipients: async (injector, event) => {
      return resolveOrderSellerEmails(injector, event.ctx, event.order);
    },
  }),
];
