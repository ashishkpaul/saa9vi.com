/**
 * Juspay SDK — isolated at the gateway boundary.
 *
 * CONTRACT STATUS (Step 4C — partially verified against live Juspay docs):
 * Most endpoints, request fields, response shapes, and authentication semantics
 * below have been verified against the current Juspay HyperCheckout documentation
 * (see ADR-037 for the full verification matrix). Markers indicate per-endpoint
 * verification status; createMandate() remains UNVERIFIED pending live sandbox.
 *
 * API CONTRACT (verified from Juspay docs):
 *
 *   Endpoints (POST = form-encoded; GET = query params):
 *     Sandbox: https://sandbox.juspay.in/...
 *     Prod:    https://api.juspay.in/...
 *
 *   Authentication:
 *     Header 1: Authorization: Basic <base64(apiKey:"")>  (password is empty string)
 *     Header 2: x-merchantid: <merchant_id>
 *     Header 3: x-routing-id: <customer_id>  (recommended; pass same value for all calls for same customer)
 *
 *   Mandate List API:
 *     GET /customers/{customer_id}/mandates
 *     Mandate status values: CREATED | ACTIVE | PAUSED | REVOKED | FAILURE | EXPIRED
 *     Returns: mandate_id, mandate_token, status, etc.
 *
 *   Mandate Execution (auto-debit):
 *     POST /txns   (NOT /mandates/execute as previously implemented)
 *     Form-encoded body:
 *       order.order_id       — unique merchant order ID
 *       order.amount          — decimal rupees (e.g. "199.00")
 *       order.customer_id     — Juspay customer ID
 *       merchant_id           — your Juspay merchant ID (username)
 *       mandate_id            — mandate_id from successful mandate registration
 *       format                — "json" (always required)
 *     Response: status = PENDING_VBV (initiated) → terminal via webhook
 *
 *   Order Status API (reconciliation fallback):
 *     GET /orders/{order_id}
 *
 * Webhooks: configured in Juspay Dashboard → Payments → Settings → Webhook Tab.
 *   HTTP Basic Auth (username:password) + optional custom headers.
 *   200 = acknowledged; non-200 triggers retry. Duplicate delivery possible.
 *   Event names: CHARGE_SUCCEEDED, CHARGE_FAILED, MANDATE_ACTIVATED, etc.
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

/** Mandate registration request params (awaiting live sandbox verification). */
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

/** VERIFIED: response shape from POST /orders and GET /orders/{order_id}. */
export interface JuspayOrderResponse {
    order_id: string;
    status: string;
    amount: number;
    currency: string;
    txn_id?: string;
    error_code?: string;
    error_message?: string;
}

/** VERIFIED: returned shape of the mandate-execution (auto-debit) call from POST /txns. */
export interface JuspayMandateExecutionResponse {
    order_id: string;
    status: string; // VERIFIED: PENDING_VBV (initiated), CHARGED (terminal success), CHARGED_FAILURE | FAILURE | JUSPAY_DECLINED (terminal failure)
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

    /**
     * UNVERIFIED: creates/registers a recurring mandate for a customer.
     * Contract (documented, not yet live-verified): POST /mandates with
     * customer_id, mandate_start_date, mandate_end_date, mandate_frequency,
     * amount, currency, unique_request_id.
     * Verification pending: live sandbox test against the specific mandate
     * product configured for Saa9vi (Express Checkout / UPI Autopay / card).
     */
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

    /**
     * Executes a mandate (auto-debit) for a subscription period.
     *
     * VERIFIED CONTRACT: POST https://sandbox.juspay.in/txns (or /api.juspay.in/txns in prod)
     * Authentication: Basic Auth (apiKey:empty) + x-merchantid header + x-routing-id (customer_id)
     * Body: form-encoded with order.order_id, order.amount, order.customer_id,
     *       merchant_id, mandate_id, format=json
     *
     * Response status:
     *   - HTTP 200 + status "PENDING_VBV" → charge accepted, terminal outcome
     *     arrives asynchronously via CHARGE_SUCCEEDED / CHARGE_FAILED webhook
     *   - HTTP 200 + status "CHARGED"     → (synchronous success, rare for mandate debits)
     *   - HTTP 200 + status "CHARGED_FAILURE"/"FAILURE"/"JUSPAY_DECLINED" → sync failure
     *   - HTTP !200                    → initiation call itself failed
     *
     * Returns { status: "initiated" } on a 200 with PENDING_VBV (the common
     * case — the period is NOT advanced; the worker waits for the webhook).
     * Returns { status: "succeeded" } on a 200 with an already-terminal success
     * (simulation/dev-only; production mandate execution returns PENDING_VBV).
     * Returns { status: "failed" } on a 200 with an explicit failure status
     * or on an HTTP error.
     */
    async executeMandateCharge(params: {
        mandate_id: string;
        amount: number;
        order_id: string;
        customer_id: string;
        description?: string;
    }): Promise<JuspayChargeResult> {
        const body = new URLSearchParams();
        // Juspay's /txns endpoint uses dot-notation for order-scoped fields
        body.append("order.order_id", params.order_id);
        body.append("order.amount", params.amount.toFixed(2));
        body.append("order.customer_id", params.customer_id);
        body.append("merchant_id", this.merchantId);
        body.append("mandate_id", params.mandate_id);
        body.append("format", "json");
        if (params.description) {
            body.append("order.description", params.description);
        }

        const response = await this.post<JuspayMandateExecutionResponse>("/txns", body, params.customer_id);

        // Map Juspay order status to our tri-state charge result.
        // A 200 response here means Juspay ACCEPTED the charge request —
        // the terminal outcome arrives via webhook. Only PENDING_VBV is
        // treated as "initiated" (awaiting webhook). Already-terminal 200
        // responses (e.g. synchronous success) are treated accordingly.
        if (response.status === "PENDING_VBV") {
            return { status: "initiated", juspayOrderId: response.order_id, txnId: response.txn_id };
        }
        if (response.status === "CHARGED") {
            return { status: "succeeded", juspayOrderId: response.order_id, txnId: response.txn_id };
        }
        // Any other status (CHARGED_FAILURE, FAILURE, JUSPAY_DECLINED, etc.)
        return { status: "failed", juspayOrderId: response.order_id, txnId: response.txn_id, errorMessage: response.error_message };
    }

    /**
     * Checks a mandate's current status.
     * VERIFIED CONTRACT: GET /customers/{customer_id}/mandates
     * Auth: Basic Auth + x-merchantid + x-routing-id (customer_id)
     * Response: list of mandate objects with status = CREATED|ACTIVE|PAUSED|REVOKED|FAILURE|EXPIRED
     *
     * @param customerId - Juspay customer ID (used in the API path)
     * @param mandateId - Juspay mandate ID (used for client-side filtering)
     */
    async getMandateStatus(customerId: string, mandateId: string): Promise<{ mandate_id: string; status: string }> {
        // Use the List Mandate API (GET /customers/{customer_id}/mandates)
        // and filter client-side to find the specific mandate by mandate_id.
        // Route on customerId as the x-routing-id per docs recommendation.
        const response = await this.get<{ list: Array<{ mandate_id: string; status: string }> }>(
            `/customers/${encodeURIComponent(customerId)}/mandates`,
            customerId,
        );
        const mandate = response.list?.find((m) => m.mandate_id === mandateId);
        return mandate ?? { mandate_id: mandateId, status: "FAILURE" };
    }

    /**
     * Revokes a mandate.
     * CONTRACT: POST /mandates/{mandate_id} with command=revoke
     * Auth: Basic Auth + x-merchantid + x-routing-id (customer_id)
     * Response: mandate_status = REVOKED
     *
     * @param customerId - Juspay customer ID (used for x-routing-id)
     * @param mandateId - Juspay mandate ID (used in the API path)
     */
    async revokeMandate(customerId: string, mandateId: string, reason?: string): Promise<{ mandate_id: string; status: string }> {
        const body = new URLSearchParams();
        body.append("command", "revoke");
        if (reason) body.append("reason", reason);
        return this.post<{ mandate_id: string; status: string }>(
            `/mandates/${encodeURIComponent(mandateId)}`,
            body,
            customerId,
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