import { Injectable } from '@nestjs/common';
import { Logger } from '@vendure/core';
import {
  RAZORPAY_API_BASE_URL,
  razorpayKeyId,
  razorpayKeySecret,
} from '../constants';

const loggerCtx = 'RazorpayOrdersClient';

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

/** Thrown for any non-2xx provider response or missing configuration. */
export class RazorpayApiError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly providerMessage: string,
    public readonly providerCode?: string,
  ) {
    super(`Razorpay API ${statusCode}: ${providerMessage}`);
    this.name = 'RazorpayApiError';
  }
}

/**
 * Thin adapter for the Razorpay **Orders/Payments** API (one-time commerce).
 *
 * Deliberately separate from `src/plugins/subscription/providers/razorpay/*`,
 * which drives the Subscriptions API: the two provider lifecycles must not be
 * merged (ADR-038; `production-readiness.md` §7/§9).
 *
 * Fail-closed: without `RAZORPAY_KEY_ID`/`RAZORPAY_KEY_SECRET` every call
 * throws before touching the network.
 */
@Injectable()
export class RazorpayOrdersClient {
  private static readonly TIMEOUT_MS = 10_000;

  isConfigured(): boolean {
    return razorpayKeyId().length > 0 && razorpayKeySecret().length > 0;
  }

  async createOrder(input: {
    amountMinor: number;
    currency: string;
    receipt: string;
    notes?: Record<string, string>;
  }): Promise<RazorpayOrder> {
    return this.request<RazorpayOrder>('POST', '/orders', {
      amount: input.amountMinor,
      currency: input.currency,
      receipt: input.receipt,
      notes: input.notes,
      // Single-step settlement (R3 decision 2): Razorpay captures on success so
      // `createPayment` only ever has to verify, never to orchestrate capture.
      payment_capture: 1,
    });
  }

  async fetchOrder(razorpayOrderId: string): Promise<RazorpayOrder> {
    return this.request<RazorpayOrder>('GET', `/orders/${encodeURIComponent(razorpayOrderId)}`);
  }

  async fetchPayment(razorpayPaymentId: string): Promise<RazorpayPayment> {
    return this.request<RazorpayPayment>('GET', `/payments/${encodeURIComponent(razorpayPaymentId)}`);
  }

  async capturePayment(input: {
    razorpayPaymentId: string;
    amountMinor: number;
    currency: string;
  }): Promise<RazorpayPayment> {
    return this.request<RazorpayPayment>(
      'POST',
      `/payments/${encodeURIComponent(input.razorpayPaymentId)}/capture`,
      { amount: input.amountMinor, currency: input.currency },
    );
  }

  private async request<T>(
    method: 'GET' | 'POST',
    path: string,
    body?: Record<string, unknown>,
  ): Promise<T> {
    const keyId = razorpayKeyId();
    const keySecret = razorpayKeySecret();
    if (!keyId || !keySecret) {
      throw new RazorpayApiError(
        0,
        'RAZORPAY_KEY_ID/RAZORPAY_KEY_SECRET are not configured — one-time checkout is unavailable',
      );
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), RazorpayOrdersClient.TIMEOUT_MS);
    const url = `${RAZORPAY_API_BASE_URL}${path}`;

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
        // Never log the key material; the provider message is safe.
        Logger.error(`Razorpay ${method} ${path} failed: ${detail}`, loggerCtx);
        throw new RazorpayApiError(
          res.status,
          String(detail),
          parsed?.error?.code ? String(parsed.error.code) : undefined,
        );
      }

      return parsed as T;
    } catch (err: any) {
      if (err?.name === 'AbortError') {
        throw new RazorpayApiError(0, `Razorpay ${method} ${path} timed out after 10s`);
      }
      throw err;
    } finally {
      clearTimeout(timeoutId);
    }
  }
}
