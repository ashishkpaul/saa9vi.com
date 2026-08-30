import { Injectable, Inject, Logger } from "@nestjs/common";
import { ID } from "@vendure/core";
import { JUSPAY_SDK } from "../constants";
import { JuspaySdk, JuspayChargeResult } from "../juspay/juspay-sdk";

const loggerCtx = "JuspayBillingService";

/**
 * Thin wrapper around the Juspay SDK for the recurring-charge initiation.
 *
 * PURPOSE: keep ALL Juspay-specific payload/response shapes inside the SDK
 * boundary — the renewal worker orchestrates CLAIM→ATTEMPT→CHARGE→FINALIZE
 * against this service's JuspayChargeResult, never against SDK shapes.
 *
 * SIMULATION FALLBACK: when no billing credentials are configured (dev /
 * unconfigured environments), this returns a clearly-logged SIMULATED
 * success so the full state machine runs without real money movement. The
 * resulting attempt rows are indistinguishable in shape — only the source
 * (juspayOrderId prefix / a log line) differs.
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
                ok: true,
                juspayOrderId: `SIMULATED-${params.orderId}`,
                txnId: `SIM-${params.subscriptionId}`,
            };
        }

        try {
            const response = await this.sdk.executeMandateCharge({
                mandate_id: params.mandateId,
                amount: params.amountPaise / 100, // paise → rupees
                order_id: params.orderId,
                customer_id: params.juspayCustomerId,
                description: `SubscriptionInvoice ${params.invoiceId}`,
            });
            this.logger.log(
                `Mandate charge initiated for subscription ${params.subscriptionId} (order ${response.order_id}, status ${response.status})`,
            );
            return {
                ok: true,
                juspayOrderId: response.order_id,
                txnId: response.txn_id,
            };
        } catch (err) {
            this.logger.error(
                `Mandate charge FAILED for subscription ${params.subscriptionId}: ${(err as Error).message}`,
                loggerCtx,
            );
            return {
                ok: false,
                juspayOrderId: params.orderId,
                errorMessage: (err as Error).message,
            };
        }
    }
}