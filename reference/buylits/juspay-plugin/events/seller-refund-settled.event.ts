import { VendureEvent, ID, RequestContext } from "@vendure/core";

/**
 * Emitted by JuspayPlugin when a gateway refund webhook is confirmed.
 * Consumed by SellerRefundListener in multivendor-plugin.
 */
export class SellerRefundSettledEvent extends VendureEvent {
  constructor(
    public readonly ctx: RequestContext,
    /** Vendure Order ID */
    public readonly orderId: ID,
    /** Refund amount in paise (as confirmed by gateway) */
    public readonly amountPaise: number,
    /** Juspay unique_request_id for idempotency */
    public readonly refundRef: string,
    public readonly currencyCode: string,
    /**
     * Optional refunded line breakdown for proportional cashback reversal.
     * If omitted, listeners will fall back to full-order reversal behavior.
     */
    public readonly refundedLines?: Array<{
      productVariantId: string;
      quantity: number;
    }>,
  ) {
    super();
  }
}
