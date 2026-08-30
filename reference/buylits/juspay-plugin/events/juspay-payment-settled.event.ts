import { VendureEvent, RequestContext, ID } from '@vendure/core';

/**
 * Emitted on EventBus after ORDER_SUCCEEDED is fully verified and
 * the Vendure payment is settled.
 * Consumed by: SellerPromotionPlugin, MultivendorPlugin, PayoutPlugin.
 */
export class JuspayPaymentSettledEvent extends VendureEvent {
  constructor(
    public readonly ctx: RequestContext,
    public readonly orderId: ID,
    public readonly paymentId: ID,
    public readonly juspayOrderId: string,
    public readonly amountMinorUnits: number,
    public readonly currency: string
  ) {
    super();
  }
}
