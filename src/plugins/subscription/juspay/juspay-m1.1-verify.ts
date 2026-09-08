/**
 * M1.1 — Juspay Merchant Capability Verification (diagnostic tool)
 *
 * PURPOSE: Establish the mandate-registration contract for the
 * Saa9viOnlineServices merchant account BEFORE implementing M2 code.
 *
 * FOCUS (post-401 result):
 *   1. Authentication probe — confirm valid credentials
 *   2. Session API — the documented HyperCheckout registration path
 *   3. Controlled Order Status — post-authorization probe
 *
 * DELIBERATELY EXCLUDES: legacy POST /mandates (not the documented
 * registration flow; removed to avoid noise/obsolete documentation).
 *
 * PREREQUISITES: Valid sandbox API key + merchant ID in .env
 *   (the key previously in .env was exposed and must be rotated).
 *   JUSPAY_SANDBOX=true.
 *
 * STATUS: M1.1 authentication unsuccessful (401). Merchant capability
 * not established. Re-run after obtaining valid credentials.
 *
 * USAGE:
 *   npx ts-node src/plugins/subscription/juspay/juspay-m1.1-verify.ts
 */
import "dotenv/config";

const apiKey = process.env.JUSPAY_API_KEY ?? "";
const merchantId = process.env.JUSPAY_MERCHANT_ID ?? "";
const isSandbox = process.env.JUSPAY_SANDBOX === "true";
if (!apiKey || !merchantId) { console.error("ERROR: JUSPAY_API_KEY and JUSPAY_MERCHANT_ID must be set"); process.exit(1); }

const baseUrl = isSandbox ? "https://sandbox.juspay.in" : "https://api.juspay.in";
const authHeader = "Basic " + Buffer.from(apiKey + ":").toString("base64");
const redact = (s: string) => (s ? s.slice(0,4)+"..."+s.slice(-4) : "EMPTY");

interface Capture { step: string; endpoint: string; method: string; httpStatus: number; responseBody: unknown; durationMs: number; notes: string[]; }
const captures: Capture[] = [];

async function callApi(step: string, method: string, path: string, body?: Record<string, string>, routingId = "m1.1-test-customer"): Promise<{ status: number; json: unknown; durationMs: number }> {
    const headers: Record<string, string> = {
        Authorization: authHeader, "x-merchantid": merchantId,
        "x-routing-id": routingId, "Content-Type": "application/json",
    };
    const start = Date.now();
    const res = await fetch(baseUrl + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
    const durationMs = Date.now() - start;
    const text = await res.text();
    let json: unknown;
    try { json = JSON.parse(text); } catch { json = text; }
    captures.push({ step, endpoint: path, method, httpStatus: res.status, responseBody: json, durationMs, notes: [] });
    return { status: res.status, json, durationMs };
}

async function main() {
    console.log("=".repeat(72));
    console.log("  M1.1 — Juspay Merchant Capability Verification (diagnostic)");
    console.log("  Environment: " + (isSandbox ? "SANDBOX" : "PRODUCTION") + " | Merchant: " + merchantId + " | Key: " + redact(apiKey));
    console.log("  Time: " + new Date().toISOString());
    console.log("  Status: auth unsuccessful (401) with previous key. Re-run after rotation.");
    console.log("=".repeat(72));

    // M1.1-A: Authentication probe
    console.log("\n[M1.1-A] Authentication probe ...");
    try {
        const r = await callApi("A-auth-probe", "GET", "/orders/m1.1-nonexistent-test");
        console.log("  GET /orders/{nonexistent} → " + r.status + " (" + r.durationMs + "ms)");
        const json = r.json as any;
        if (r.status === 200) {
            console.log("  → Authenticated. Response shape:");
            console.log("  " + JSON.stringify(r.json, null, 2).slice(0, 400));
            captures[captures.length - 1].notes.push("AUTH_SUCCESS");
        } else if (r.status === 401) {
            console.log("  → 401 " + (json?.error_code || "access_denied") + ": credentials invalid or missing");
            captures[captures.length - 1].notes.push("AUTH_FAILED_401");
        } else {
            console.log("  → Unexpected. Response: " + JSON.stringify(r.json, null, 2).slice(0, 300));
        }
    } catch (err) { console.log("  ERROR: " + (err as Error).message); }

    // M1.1-B: Session API (documented HyperCheckout registration path)
    console.log("\n[M1.1-B] Session API (documented HyperCheckout flow) ...");
    try {
        const sessionBody: Record<string, string> = {
            order_id: "m1.1-test-" + Date.now(), amount: "1.00", customer_id: "m1.1-test-customer",
            customer_email: "test@e2e.saa9vi.com", customer_phone: "9999999912",
            "options.create_mandate": "REQUIRED", "mandate.max_amount": "1000.00",
            "mandate.frequency": "MONTHLY", "mandate.amount_rule": "VARIABLE",
            "mandate.block_funds": "false", payment_page_client_id: merchantId,
        };
        const r = await callApi("B-session-create", "POST", "/session", sessionBody);
        console.log("  POST /session → " + r.status + " (" + r.durationMs + "ms)");
        const json = r.json as any;
        if (r.status === 200) {
            console.log("  → Session created. Response shape:");
            console.log("  " + JSON.stringify(r.json, null, 2).slice(0, 600));
            const sid = json?.sdk_payload?.session_id || json?.session_id || json?.order_id;
            if (sid) { console.log("  → Session/Order ID: " + sid); captures[captures.length - 1].notes.push("session_id=" + sid); }
            if (json?.sdk_payload?.payment_links) console.log("  → Payment links present");
            captures[captures.length - 1].notes.push("SESSION_SUCCESS");
        } else if (r.status === 401) {
            console.log("  → 401: credentials invalid. Fix auth before probing Session API.");
            captures[captures.length - 1].notes.push("AUTH_BLOCKED");
        } else {
            console.log("  → " + r.status + ". Response: " + JSON.stringify(r.json, null, 2).slice(0, 400));
        }
    } catch (err) { console.log("  ERROR: " + (err as Error).message); }

    // M1.1-C: Controlled Order Status
    console.log("\n[M1.1-C] Controlled Order Status ...");
    try {
        const r = await callApi("C-order-status", "GET", "/orders/m1.1-test-" + Date.now());
        console.log("  GET /orders/{id} → " + r.status + " (" + r.durationMs + "ms)");
        if (r.status === 200) {
            console.log("  → Response: " + JSON.stringify(r.json, null, 2).slice(0, 400));
            captures[captures.length - 1].notes.push("ORDER_STATUS_OK");
        } else if (r.status === 401) {
            console.log("  → 401: credentials invalid.");
        } else if (r.status === 404) {
            console.log("  → 404: order not found (expected for probe ID). Auth is working.");
            captures[captures.length - 1].notes.push("AUTH_OK_ORDER_NOT_FOUND");
        } else {
            console.log("  → " + r.status + ". Response: " + JSON.stringify(r.json, null, 2).slice(0, 300));
        }
    } catch (err) { console.log("  ERROR: " + (err as Error).message); }

    // Summary
    console.log("\n" + "=".repeat(72));
    console.log("  CAPTURE SUMMARY");
    console.log("=".repeat(72));
    for (const c of captures) {
        console.log("  [" + c.step + "] " + c.method + " " + c.endpoint + " → " + c.httpStatus + " (" + c.durationMs + "ms)");
        if (c.notes.length) console.log("    Notes: " + c.notes.join(", "));
    }
    console.log("\n  NEXT: Obtain valid sandbox credentials, then re-run.");
    console.log("  Do NOT put credentials in ADR-037.");
    console.log("=".repeat(72));
}

main().catch((err) => { console.error("FATAL:", err); process.exit(2); });
