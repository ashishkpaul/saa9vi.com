/**
 * Juspay SDK — isolated at the gateway boundary.
 *
 * ⚠️ CONTRACT STATUS (Step 4C): the recurring/mandate methods below are
 * implemented against DOCUMENTED-BUT-UNVERIFIED Juspay API shapes. Live
 * verification could not be performed (Juspay MCP tools require an api_key
 * token that is not configured in this environment; public docs URLs 404).
 * Nothing in the subscription/business layer reads these shapes directly —
 * correct or replace them here once sandbox/live documentation is verified.
 *
 * The underlying HTTP transport (Basic auth, x-merchantid, form-encoded) is
 * ported from the BuyLits reference (reference/buylits/payments-core/gateway
 * /juspay-sdk.ts). Mandate methods are net-new.
 */
import { Logger } from "@nestjs/common";

export interface JuspaySdkOptions {
    apiKey: string;
    merchantId: string;
    sandbox?: boolean;
}

/** UNVERIFIED: recurring-payment configuration assumed from the Juspay Mandates docs. */
export interface JuspayMandateOptions {
    customerId: string;
    amount: number; // decimal rupees
    currency?: string;
    startDate: string; // YYYY-MM-DD
    endDate: string; // YYYY-MM-DD
    frequency: string; // e.g. 'MONTHLY'
    /** Unique merchant-side reference for idempotency. */
    mandateReference: string;
}

export interface JuspayOrderResponse {
    order_id: string;
    status: string;
    amount: number;
    currency: string;
    txn_id?: string;
    error_code?: string;
    error_message?: string;
}

/** UNVERIFIED: returned shape of the mandate-execution (auto-debit) call. */
export interface JuspayMandateExecutionResponse {
    order_id: string;
    status: string;
    txn_id?: string;
    error_code?: string;
    error_message?: string;
}

/**
 * Charge result exposed to the renewal worker.
 *
 * ASYNC REALITY (corrected Step 4): real Juspay mandate execution creates an
 * order and the TERMINAL outcome arrives asynchronously via a webhook
 * (CHARGE_SUCCEEDED / CHARGE_FAILED). The initiation call returning
 * successfully only means Juspay ACCEPTED the charge request — it is NOT a
 * confirmed debit.
 *
 * Therefore:
 *   - "initiated"  → charge request accepted; worker stores the provider
 *                     order ID and WAITS for the webhook to reconcile.
 *   - "succeeded"  → simulation-only: the full lifecycle is assumed to have
 *                     succeeded (dev/test without webhook). Production never
 *                     returns this from the real SDK path.
 *   - "failed"     → the initiation call itself failed (HTTP error, mandate
 *                     rejected synchronously).
 *
 * The webhook processor independently reconciles the same attempt (CAS-guarded
 * via JuspayPaymentAttemptService) and triggers finalization. Both paths
 * converge on identical terminal state.
 */
export type JuspayChargeStatus = "initiated" | "succeeded" | "failed";

export interface JuspayChargeResult {
    status: JuspayChargeStatus;
    juspayOrderId: string;
    txnId?: string;
    errorMessage?: string;
}

export class JuspaySdkError extends Error {}

export class JuspaySdk {
    private readonly baseUrl: string;
    private readonly authHeader: string;
    private readonly merchantId: string;

    constructor(private readonly options: JuspaySdkOptions) {
        this.baseUrl = (options.sandbox ?? false) ? "https://sandbox.juspay.in" : "https://api.juspay.in";
        this.authHeader = "Basic " + Buffer.from(`${options.apiKey}:`).toString("base64");
        this.merchantId = options.merchantId;
    }

    async createOrder(params: {
        order_id: string;
        amount: number;
        customer_id: string;
        customer_email?: string;
        customer_phone?: string;
        currency?: string;
        description?: string;
    }): Promise<JuspayOrderResponse> {
        const body = new URLSearchParams();
        Object.entries(params).forEach(([k, v]) => {
            if (v !== undefined) body.append(k, String(v));
        });
        return this.post<JuspayOrderResponse>("/orders", body, params.customer_id);
    }

    async getOrderStatus(orderId: string): Promise<JuspayOrderResponse> {
        return this.get<JuspayOrderResponse>(`/orders/${encodeURIComponent(orderId)}`, orderId);
    }

    /** UNVERIFIED: creates/registers a recurring mandate for a customer. */
    async createMandate(opts: JuspayMandateOptions): Promise<{ mandate_id: string; status: string }> {
        const body = new URLSearchParams();
        Object.entries({
            customer_id: opts.customerId,
            mandate_start_date: opts.startDate,
            mandate_end_date: opts.endDate,
            mandate_frequency: opts.frequency,
            amount: opts.amount.toFixed(2),
            currency: opts.currency ?? "INR",
            unique_request_id: `mandate-${opts.mandateReference}`,
        }).forEach(([k, v]) => body.append(k, String(v)));
        return this.post<{ mandate_id: string; status: string }>("/mandates", body, opts.customerId);
    }

    /** UNVERIFIED: executes a mandate (auto-debit) for a subscription period. */
    async executeMandateCharge(params: {
        mandate_id: string;
        amount: number;
        order_id: string;
        customer_id: string;
        description?: string;
    }): Promise<JuspayMandateExecutionResponse> {
        const body = new URLSearchParams();
        Object.entries({
            mandate_id: params.mandate_id,
            amount: params.amount.toFixed(2),
            order_id: params.order_id,
            description: params.description ?? "",
        }).forEach(([k, v]) => body.append(k, String(v)));
        return this.post<JuspayMandateExecutionResponse>("/mandates/execute", body, params.customer_id);
    }

    /** UNVERIFIED: checks a mandate's current status. */
    async getMandateStatus(mandateId: string): Promise<{ mandate_id: string; status: string }> {
        return this.get<{ mandate_id: string; status: string }>(`/mandates/${encodeURIComponent(mandateId)}`, mandateId);
    }

    /** UNVERIFIED: revokes a mandate. */
    async revokeMandate(mandateId: string, reason?: string): Promise<{ mandate_id: string; status: string }> {
        const body = new URLSearchParams();
        if (reason) body.append("reason", reason);
        return this.post<{ mandate_id: string; status: string }>(
            `/mandates/${encodeURIComponent(mandateId)}/revoke`,
            body,
            mandateId,
        );
    }

    private commonHeaders(routingId?: string): Record<string, string> {
        return {
            Authorization: this.authHeader,
            "x-merchantid": this.merchantId,
            "Content-Type": "application/x-www-form-urlencoded",
            ...(routingId ? { "x-routing-id": routingId } : {}),
        };
    }

    private post<T>(path: string, body: URLSearchParams, routingId?: string): Promise<T> {
        return this.request<T>(async () => {
            const res = await fetch(`${this.baseUrl}${path}`, {
                method: "POST",
                headers: this.commonHeaders(routingId),
                body,
            });
            return res;
        });
    }

    private get<T>(path: string, routingId?: string): Promise<T> {
        return this.request<T>(async () => {
            const res = await fetch(`${this.baseUrl}${path}`, { headers: this.commonHeaders(routingId) });
            return res;
        });
    }

    private async request<T>(fn: () => Promise<Response>): Promise<T> {
        const res = await fn();
        const text = await res.text();
        if (!res.ok) {
            let error_code = "HTTP_ERROR";
            let error_message = `HTTP ${res.status}: ${res.statusText}`;
            try {
                const json = JSON.parse(text);
                if (json.error_code) error_code = json.error_code;
                if (json.error_message) error_message = json.error_message;
            } catch {
                error_message = text || error_message;
            }
            throw new JuspaySdkError(`${error_code}: ${error_message}`);
        }
        return JSON.parse(text) as T;
    }
}