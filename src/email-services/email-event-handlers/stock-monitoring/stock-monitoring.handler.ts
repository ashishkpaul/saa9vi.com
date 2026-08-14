import {
  EntityHydrator,
  Injector,
  OrderStateTransitionEvent,
  ProductVariant,
  TransactionalConnection,
} from '@vendure/core';
import { EmailEventListener, EmailEventHandler } from '@vendure/email-plugin';
import { resolveOrderSellerEmails } from '../utils/tenant-email-resolver';

export interface LowStockEmailHandlerOptions {
  threshold: number;
  subject?: string;
  emailRecipients?: (
    injector: Injector,
    event: OrderStateTransitionEvent
  ) => Promise<string[]> | string[];
}

export interface LowStockVariantInfo {
  id: string | number;
  name: string;
  sku: string;
  stockOnHand: number;
}

/**
 * Creates a dynamic low stock email event handler for a given stock threshold.
 */
export function createLowStockEmailHandler(
  options: LowStockEmailHandlerOptions
): EmailEventHandler<'low-stock', any> {
  const threshold = options.threshold ?? 10;
  const defaultSubject = options.subject ?? `Low Stock Alert: Variants Below ${threshold}`;

  return new EmailEventListener('low-stock')
    .on(OrderStateTransitionEvent)
    .filter((event) => event.toState === 'PaymentSettled' && event.fromState !== 'Modifying')
    .loadData(async ({ event, injector }) => {
      const entityHydrator = injector.get(EntityHydrator);
      const connection = injector.get(TransactionalConnection);

      await entityHydrator.hydrate(event.ctx, event.order, {
        relations: [
          'lines.productVariant',
          'lines.productVariant.channels',
          'lines.productVariant.channels.seller',
        ],
      });

      // Find all variants in this order whose total stockOnHand is at or below the threshold
      const lowStockVariants: LowStockVariantInfo[] = [];

      for (const line of event.order.lines) {
        if (!line.productVariant?.id) continue;
        const variant = await connection.getRepository(event.ctx, ProductVariant).findOne({
          where: { id: line.productVariant.id },
          relations: ['stockLevels'],
        });

        if (variant) {
          const totalStockOnHand = variant.stockLevels?.reduce(
            (sum, sl) => sum + (sl.stockOnHand || 0),
            0
          ) ?? 0;

          if (totalStockOnHand <= threshold) {
            lowStockVariants.push({
              id: variant.id,
              name: typeof variant.name === 'string' ? variant.name : (variant.name as any),
              sku: variant.sku,
              stockOnHand: totalStockOnHand,
            });
          }
        }
      }

      // Resolve recipient emails
      let recipients: string[] = [];
      if (options.emailRecipients) {
        try {
          const customRecipients = await options.emailRecipients(injector, event);
          if (Array.isArray(customRecipients) && customRecipients.length > 0) {
            recipients = customRecipients;
          }
        } catch (err) {
          console.warn('[LowStockHandler] Error in custom emailRecipients callback:', err);
        }
      }

      // Fallback: resolve seller / tenant emails automatically
      if (recipients.length === 0) {
        recipients = await resolveOrderSellerEmails(injector, event.ctx, event.order);
      }

      return {
        lowStockVariants,
        recipients,
        hasLowStock: lowStockVariants.length > 0,
      };
    })
    .filter((event) => (event.data as any)?.hasLowStock === true)
    .setRecipient((event) => {
      const recs = (event.data as any)?.recipients;
      return Array.isArray(recs) ? recs.join(', ') : (recs || '');
    })
    .setFrom('{{ fromAddress }}')
    .setSubject(defaultSubject)
    .setTemplateVars((event) => ({
      threshold,
      lowStockVariants: (event.data as any).lowStockVariants,
      order: event.order,
    }));
}
