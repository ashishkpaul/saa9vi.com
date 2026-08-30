import { Logger } from '@nestjs/common';
import { JuspayCreateOrderParams, JuspayOrderResponse, JuspayRefundResponse, JuspayOrderStatus } from './juspay-sdk.types';

export interface JuspaySdkOptions {
  apiKey: string;
  merchantId: string;
  sandbox: boolean;
}

export class JuspaySdk {
  private readonly logger = new Logger(JuspaySdk.name);
  private readonly baseUrl: string;
  private readonly authHeader: string;

  constructor(private readonly options: JuspaySdkOptions) {
    this.baseUrl = options.sandbox ? 'https://sandbox.juspay.in' : 'https://api.juspay.in';
    this.authHeader = 'Basic ' + Buffer.from(options.apiKey + ':').toString('base64');
  }

  async createOrder(params: JuspayCreateOrderParams): Promise<JuspayOrderResponse> {
    const body = new URLSearchParams();
    
    // Add all params, skipping undefined fields
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined) {
        body.append(key, String(value));
      }
    });

    return this.post<JuspayOrderResponse>('/orders', body, {
      'x-routing-id': params.customer_id
    });
  }

  async getOrderStatus(orderId: string): Promise<JuspayOrderResponse> {
    return this.get<JuspayOrderResponse>(`/orders/${encodeURIComponent(orderId)}`, {
      'x-routing-id': orderId
    });
  }

  async createRefund(params: {
    order_id: string;
    unique_request_id: string;
    amount: number;        // decimal rupees
  }): Promise<JuspayRefundResponse> {
    const body = new URLSearchParams();
    body.append('unique_request_id', params.unique_request_id);
    body.append('amount', params.amount.toFixed(2));

    return this.post<JuspayRefundResponse>(`/orders/${encodeURIComponent(params.order_id)}/refunds`, body);
  }

  private commonHeaders(extra?: Record<string, string>): Record<string, string> {
    const headers: Record<string, string> = {
      'Authorization': this.authHeader,
      'x-merchantid': this.options.merchantId,
      'Content-Type': 'application/x-www-form-urlencoded'
    };

    if (extra) {
      Object.assign(headers, extra);
    }

    return headers;
  }

  private async post<T>(path: string, body: URLSearchParams, extra?: Record<string, string>): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: this.commonHeaders(extra),
      body: body
    });

    return this.parse<T>(response);
  }

  private async get<T>(path: string, extra?: Record<string, string>): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method: 'GET',
      headers: this.commonHeaders(extra)
    });

    return this.parse<T>(response);
  }

  private async parse<T>(res: Response): Promise<T> {
    const text = await res.text();
    
    if (!res.ok) {
      let error_code = 'HTTP_ERROR';
      let error_message = `HTTP ${res.status}: ${res.statusText}`;
      
      try {
        const json = JSON.parse(text);
        if (json.error_code) error_code = json.error_code;
        if (json.error_message) error_message = json.error_message;
      } catch {
        // If not JSON, use the text as error message
        error_message = text;
      }

      throw new Error(`${error_code}: ${error_message}`);
    }

    return JSON.parse(text) as T;
  }
}