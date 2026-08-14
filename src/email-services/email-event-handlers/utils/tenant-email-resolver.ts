import { Injector, RequestContext, TransactionalConnection, ProductVariant, Channel, Order } from '@vendure/core';
import { TenantProfile } from '../../../plugins/tenant-plugin/entities/tenant-profile.entity';

/**
 * Resolves the primary contact email for a specific tenant / channel.
 */
export async function resolveTenantContactEmail(
  injector: Injector,
  ctx: RequestContext,
  channelId?: string | number,
): Promise<string | undefined> {
  try {
    const connection = injector.get(TransactionalConnection);
    const targetChannelId = channelId || ctx.channelId;

    // 1. Look up TenantProfile
    const profile = await connection.getRepository(ctx, TenantProfile).findOne({
      where: { channelId: String(targetChannelId) },
    });
    if (profile?.contactEmail) {
      return profile.contactEmail;
    }

    // 2. Look up Channel Seller customFields
    const channel = await connection.getRepository(ctx, Channel).findOne({
      where: { id: targetChannelId },
      relations: ['seller', 'seller.customFields'],
    });
    const sellerEmail = (channel?.seller?.customFields as any)?.sellerOrderConfirmationEmailId;
    if (sellerEmail) {
      return sellerEmail;
    }
  } catch (error) {
    console.warn('[TenantEmailResolver] Could not resolve tenant contact email:', error);
  }
  return undefined;
}

/**
 * Collects all unique seller / tenant emails associated with the lines of an order.
 */
export async function resolveOrderSellerEmails(
  injector: Injector,
  ctx: RequestContext,
  order: Order,
  defaultFallbackEmail: string = 'support@saa9vi.com'
): Promise<string[]> {
  const sellerEmails = new Set<string>();

  try {
    const connection = injector.get(TransactionalConnection);

    // Check active channel tenant email first
    const primaryTenantEmail = await resolveTenantContactEmail(injector, ctx, ctx.channelId);
    if (primaryTenantEmail) {
      sellerEmails.add(primaryTenantEmail);
    }

    // Iterate through order lines to find variant channel sellers
    if (order.lines && order.lines.length > 0) {
      for (const line of order.lines) {
        if (!line.productVariant?.id) continue;
        const variant = await connection.getRepository(ctx, ProductVariant).findOne({
          where: { id: line.productVariant.id },
          relations: ['channels', 'channels.seller', 'channels.seller.customFields'],
        });

        if (variant && variant.channels) {
          for (const ch of variant.channels) {
            const email = (ch.seller?.customFields as any)?.sellerOrderConfirmationEmailId;
            if (email) {
              sellerEmails.add(email);
            }
            // Also check TenantProfile for this channel
            const tenantProfile = await connection.getRepository(ctx, TenantProfile).findOne({
              where: { channelId: String(ch.id) },
            });
            if (tenantProfile?.contactEmail) {
              sellerEmails.add(tenantProfile.contactEmail);
            }
          }
        }
      }
    }
  } catch (error) {
    console.error('[TenantEmailResolver] Error resolving order seller emails:', error);
  }

  return sellerEmails.size > 0 ? Array.from(sellerEmails) : [defaultFallbackEmail];
}
