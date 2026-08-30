import { Injectable, Logger } from "@nestjs/common";
import * as crypto from "crypto";

/**
 * Per-endpoint verification inputs (multi-tenant: each JuspayWebhookEndpoint
 * carries its own credentials).
 */
export interface WebhookEndpointCredentials {
    basicAuthUsername: string;
    basicAuthPassword: string;
    hmacSecret: string;
}

/**
 * Fail-closed webhook authentication for the Juspay ingestion endpoint.
 *
 * Two layers, BOTH mandatory (unlike the BuyLits reference, where the HMAC
 * layer was optional and allow-when-unset — that behavior is deliberately
 * NOT inherited):
 *
 *   1. HTTP Basic Auth — per-endpoint, dashboard-configured credentials.
 *   2. HMAC-SHA256 over the EXACT raw request bytes, hex, in x-jp-signature.
 *
 * Missing config, missing header, wrong length, or mismatch → reject.
 * All comparisons use crypto.timingSafeEqual with a length-equality guard
 * (timingSafeEqual throws on length mismatch).
 *
 * Layer responsibilities (do not conflate with the two DB idempotency
 * layers — those live in JuspayWebhookEvent):
 *   - THIS service answers "did this request really come from the Juspay
 *     account that owns this tenant endpoint?".
 *   - The DB layers answer "have we already durably processed this event?".
 */
@Injectable()
export class JuspayWebhookAuthService {
    verify(basicAuthHeader: string | undefined, signatureHeader: string | undefined, rawBody: Buffer | undefined, credentials: WebhookEndpointCredentials | undefined | null): boolean {
        return this.verifyBasicAuth(basicAuthHeader, credentials) && this.verifyHmac(signatureHeader, rawBody, credentials);
    }

    private verifyBasicAuth(header: string | undefined, creds: WebhookEndpointCredentials | undefined | null): boolean {
        // Fail-closed: no configured credentials → reject everything.
        if (!creds?.basicAuthUsername || !creds.basicAuthPassword || !header) {
            return false;
        }
        const expected = "Basic " + Buffer.from(`${creds.basicAuthUsername}:${creds.basicAuthPassword}`).toString("base64");
        if (header.length !== expected.length) {
            return false;
        }
        return crypto.timingSafeEqual(Buffer.from(header), Buffer.from(expected));
    }

    private verifyHmac(signature: string | undefined, rawBody: Buffer | undefined, creds: WebhookEndpointCredentials | undefined | null): boolean {
        // Fail-closed: no configured secret → reject everything (BuyLits allowed this).
        if (!creds?.hmacSecret || !signature || !rawBody || rawBody.length === 0) {
            return false;
        }
        const computed = crypto.createHmac("sha256", creds.hmacSecret).update(rawBody).digest("hex");
        if (signature.length !== computed.length) {
            return false;
        }
        return crypto.timingSafeEqual(Buffer.from(computed), Buffer.from(signature));
    }
}
