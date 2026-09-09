/**
 * Juspay billing credential wiring (credential-hardening audit GAP 1/2).
 *
 * Single, testable resolution point for the platform-global Juspay API
 * credentials. Reads ONLY from the provided environment record — credentials
 * can never enter through GraphQL input, channel custom fields, database
 * plaintext, or Admin UI configuration.
 *
 * Resolution rules:
 *   - Both JUSPAY_API_KEY and JUSPAY_MERCHANT_ID present → billing config
 *     (real provider). Absent/either-missing → undefined; the plugin factory
 *     then decides dev-simulate (NODE_ENV !== production) vs boot-throw
 *     (production) — existing fail-closed behavior, unchanged here.
 *   - JUSPAY_SANDBOX=true selects sandbox.juspay.in. REFUSED in production:
 *     pointing real production renewals at the sandbox endpoint would advance
 *     subscription periods without ever moving real money.
 */
export interface JuspayBillingConfig {
    apiKey: string;
    merchantId: string;
    sandbox: boolean;
}

export function resolveBillingConfig(env: NodeJS.ProcessEnv): JuspayBillingConfig | undefined {
    const sandbox = env.JUSPAY_SANDBOX === 'true';
    if (env.NODE_ENV === 'production' && sandbox) {
        throw new Error(
            'JUSPAY_SANDBOX=true is forbidden in production — refusing to boot. ' +
                'Production renewals must target the live Juspay endpoint.',
        );
    }
    const apiKey = env.JUSPAY_API_KEY?.trim();
    const merchantId = env.JUSPAY_MERCHANT_ID?.trim();
    if (!apiKey || !merchantId) {
        return undefined;
    }
    return { apiKey, merchantId, sandbox };
}
