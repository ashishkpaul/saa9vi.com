import { Injectable, Inject, Logger } from "@nestjs/common";
import { ID } from "@vendure/core";
import { JUSPAY_SDK } from "../constants";
import { JuspaySdk, JuspayChargeResult } from "../juspay/juspay-sdk";

const loggerCtx = "JuspayBillingService";

/**
 * Thin wrapper around the Juspay SDK for the recurring-charge initiation.
 *
 * PURPOSE: keep ALL Juspay-specific payload/response shapes inside the SDK
 * boundary — the renewal worker orchestrates CLAIM→ATTEMPT→CHARGE→(webhook)→
 * FINALIZE against this service's JuspayChargeResult, never against SDK
 * shapes.
 *
 * ASYNC SEMANTICS (corrected Step 4): a successful SDK call returns
 * status "initiated" — it means Juspay ACCEPTED the charge request, NOT that
 * the debit succeeded. The terminal outcome arrives via webhook. The renewal
 * worker stores the provider order ID and waits; it does NOT finalize the
 * subscription period on this response alone.
 *
 * SIMULATION FALLBACK (dev/test only): when no billing credentials are
 * configured, this returns a clearly-logged SIMULATED "succeeded" so the full
 * CLAIM→ATTEMPT→CHARGE→FINALIZE state machine still runs without a webhook.
 * Production must never reach this path — see subscription.plugin.ts which
 * fails fast when credentials are missing in a production environment.
 */
@Injectable()
export class JuspayBillingService {
    private readonly logger = new Logger(loggerCtx);

    constructor(@Inject(JUSPAY_SDK) private readonly sdk: JuspaySdk | null) {}

    async chargeSubscription(params: {
        subscriptionId: ID;
        channelId: string;
        juspayCustomerId: string;
        mandateId: string;
        invoiceId: string;
        amountPaise: number;
        orderId: string;
    }): Promise<JuspayChargeResult> {
        if (!this.sdk) {
            this.logger.warn(
                `SIMULATED charge for subscription ${params.subscriptionId} (channel ${params.channelId}) — no JUSPAY billing credentials configured. Money did NOT move.`,
            );
            return {
                status: "succeeded",
                juspayOrderId: `SIMULATED-${params.orderId}`,
                txnId: `SIM-${params.subscriptionId}`,
            };
        }

                        try {
            const chargeResult = await this.sdk.executeMandateCharge({
                mandate_id: params.mandateId,
                amount: params.amountPaise / 100, // paise → rupees
                order_id: params.orderId,
                customer_id: params.juspayCustomerId,
                description: `SubscriptionInvoice ${params.invoiceId}`,
            });
            this.logger.log(
                `Mandate charge ${chargeResult.status} for subscription ${params.subscriptionId} (order ${chargeResult.juspayOrderId}) — webhook will reconcile terminal outcome`,
            );
            // executeMandateCharge() already maps the Juspay response status
            // to our tri-state (initiated/succeeded/failed). A 200 from Juspay
            // means the charge request was accepted — the terminal debit result
            // arrives asynchronously via webhook. No remapping is needed here.
            return chargeResult;
        } catch (err) {
            this.logger.error(
                `Mandate charge FAILED for subscription ${params.subscriptionId}: ${(err as Error).message}`,
                loggerCtx,
            );
            return {
                status: "failed",
                juspayOrderId: params.orderId,
                errorMessage: (err as Error).message,
            };
        }
    }
}