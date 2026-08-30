import type { JuspayOrderStatus } from '../payments-core';

/**
 * Juspay webhook event types
 */
export type JuspayWebhookEventType =
  | 'ORDER_SUCCEEDED' 
  | 'ORDER_FAILED' 
  | 'ORDER_REFUNDED' 
  | 'TXN_CREATED';

/**
 * Juspay webhook event structure
 */
export interface JuspayWebhookEvent {
  event_name: JuspayWebhookEventType;
  content: {
    order: {
      order_id: string;
      status: JuspayOrderStatus;
      amount: number;
      currency: string;
      txn_id?: string;
      error_code?: string;
      error_message?: string;
      refunds?: Array<{
        unique_request_id: string;
        amount: number;
        status: string;
      }>;
    };
  };
}