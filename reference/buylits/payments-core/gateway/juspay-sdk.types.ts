export interface JuspayCreateOrderParams {
  order_id: string;
  amount: number;          // decimal rupees (e.g. 199.00)
  customer_id: string;
  customer_email: string;
  customer_phone: string;
  currency?: string;
  return_url: string;
  description?: string;
  udf1?: string;           // idempotency key slot
  udf2?: string;           // sellerId cross-check
}

export type JuspayOrderStatus = 
  | 'NEW' 
  | 'PENDING_VBV' 
  | 'CHARGED' 
  | 'AUTHENTICATION_FAILED' 
  | 'AUTHORIZATION_FAILED' 
  | 'JUSPAY_DECLINED' 
  | 'AUTO_REFUNDED' 
  | 'REFUNDED';

export interface JuspayOrderResponse {
  order_id: string;
  status: JuspayOrderStatus;
  amount: number;
  currency: string;
  payment_links?: { web?: string; mobile?: string };
  txn_id?: string;
  error_code?: string;
  error_message?: string;
}

export interface JuspayRefundResponse {
  unique_request_id: string;
  status: 'SUCCESS' | 'PENDING' | 'FAILURE';
  amount: number;
  order_id: string;
}