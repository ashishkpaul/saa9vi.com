import { Injectable, Logger } from '@nestjs/common';

const loggerCtx = 'TenantRazorpayOrdersClient';

/** Subset of the Razorpay Order object this integration relies on. */
export interface RazorpayOrder {
  id: string;
  amount: number;
  currency: string;
  receipt?: string | null;
  status: string;
  notes?: Record<string, string> | null;
}

/** Subset of the Razorpay Payment object this integration relies on. */
export interface RazorpayPayment {
  id: string;
  order_id: string | null;
  amount: number;
  currency: string;
  status: string;
  method?: string;
  error_code?: string | null;
  error_description?: string | null;
  notes?: Record<string, string> | null;
}

/** Thrown for any non-2xx provider response or missing credentials. */
export class TenantRazorpayApiError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly providerMessage: string,
    public readonly providerCode?: string,
  ) {
    super(`Tenant Razorpay API ${statusCode}: ${providerMessage}`);
    this.name = 'TenantRazorpayApiError';
  }
}

/**
 * Tenant-aware Razorpay Orders/Payments API client.
 *
 * Unlike `RazorpayOrdersClient` (which uses Saa9vi's platform env
 * credentials for Flow A), this client accepts tenant credentials per-call,
 * resolved from `TenantPaymentAccountService`. This ensures tenant-client
 * collections (Flow B) always use the tenant's own Razorpay account — never
 * Saa9vi's.
 *
 * Fail-closed: without keyId/keySecret every call throws before touching the
 * network.
 */
@Injectable()
export class TenantRazorpayOrdersClient {
  private static readonly TIMEOUT_MS = 10_000;

  async createOrder(
    keyId: string,
    keySecret: string,
    input: {
      amountMinor: number;
      currency: string;
      receipt: string;
      notes?: Record<string, string>;
    },
  ): Promise<RazorpayOrder> {
    return this.request<RazorpayOrder>(keyId, keySecret, 'POST', '/orders', {
      amount: input.amountMinor,
      currency: input.currency,
      receipt: input.receipt,
      notes: input.notes,
      payment_capture: 1,
    });
  }

  async fetchOrder(
    keyId: string,
    keySecret: string,
    razorpayOrderId: string,
  ): Promise<RazorpayOrder> {
    return this.request<RazorpayOrder>(
      keyId,
      keySecret,
      'GET',
      `/orders/${encodeURIComponent(razorpayOrderId)}`,
    );
  }

  async fetchPayment(
    keyId: string,
    keySecret: string,
    razorpayPaymentId: string,
  ): Promise<RazorpayPayment> {
    return this.request<RazorpayPayment>(
      keyId,
      keySecret,
      'GET',
      `/payments/${encodeURIComponent(razorpayPaymentId)}`,
    );
  }

  /**
   * Test credentials by making a lightweight API call.
   * Uses the Razorpay Payments API endpoint with limit=1 as a
   * lightweight credential check (returns 200 if credentials are valid).
   */
  async testCredentials(
    keyId: string,
    keySecret: string,
  ): Promise<void> {
    // Make a simple API call to verify credentials work
    await this.request<any>(
      keyId,
      keySecret,
      'GET',
      '/payments?count=1',
    );
  }

  async capturePayment(
    keyId: string,
    keySecret: string,
    input: {
      razorpayPaymentId: string;
      amountMinor: number;
      currency: string;
    },
  ): Promise<RazorpayPayment> {
    return this.request<RazorpayPayment>(
      keyId,
      keySecret,
      'POST',
      `/payments/${encodeURIComponent(input.razorpayPaymentId)}/capture`,
      { amount: input.amountMinor, currency: input.currency },
    );
  }

  private async request<T>(
    keyId: string,
    keySecret: string,
    method: 'GET' | 'POST',
    path: string,
    body?: Record<string, unknown>,
  ): Promise<T> {
    if (!keyId || !keySecret) {
      throw new TenantRazorpayApiError(
        0,
        'Tenant Razorpay credentials are not configured — tenant checkout is unavailable',
      );
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(
      () => controller.abort(),
      TenantRazorpayOrdersClient.TIMEOUT_MS,
    );
    const url = `https://api.razorpay.com/v1${path}`;

    try {
      const res = await fetch(url, {
        method,
        headers: {
          Authorization: `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString('base64')}`,
          'Content-Type': 'application/json',
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      const text = await res.text();
      const parsed = text.length > 0 ? (JSON.parse(text) as any) : {};

      if (!res.ok) {
        const detail =
          parsed?.error?.description ?? parsed?.error?.reason ?? `HTTP ${res.status}`;
        Logger.error(
          `Tenant Razorpay ${method} ${path} failed: ${detail}`,
          loggerCtx,
        );
        throw new TenantRazorpayApiError(
          res.status,
          String(detail),
          parsed?.error?.code ? String(parsed.error.code) : undefined,
        );
      }

      return parsed as T;
    } catch (err: any) {
      if (err?.name === 'AbortError') {
        throw new TenantRazorpayApiError(
          0,
          `Tenant Razorpay ${method} ${path} timed out after 10s`,
        );
      }
      throw err;
    } finally {
      clearTimeout(timeoutId);
    }
  }
}