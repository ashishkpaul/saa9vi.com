import { PluginCommonModule, RuntimeVendureConfig, Type, VendurePlugin } from '@vendure/core';
 
import { SUBSCRIPTION_PLUGIN_OPTIONS, JUSPAY_SDK } from './constants';
import { OrganizationSubscription } from './entities/organization-subscription.entity';
import { SubscriptionPlan } from './entities/subscription-plan.entity';
import { JuspaySubscriptionMandate } from './entities/juspay-subscription-mandate.entity';
import { JuspayPaymentAttempt } from './entities/juspay-payment-attempt.entity';
import { JuspayWebhookEvent } from './entities/juspay-webhook-event.entity';
import { JuspayWebhookEndpoint } from './entities/juspay-webhook-endpoint.entity';
import { RenewalPaymentReconciliationRequired } from './entities/juspay-reconciliation-required.entity';
import { SubscriptionAdminResolver } from './api/subscription-admin.resolver';
import { adminApiExtensions } from './api/schema/subscription-admin.schema';
import { SubscriptionService } from './services/subscription.service';
import { SubscriptionRenewalService } from './services/subscription-renewal.service';
import { SubscriptionRenewalQueueService } from './services/subscription-renewal-queue.service';
import { JuspayWebhookQueueService } from './services/juspay-webhook-queue.service';
import { JuspayWebhookProcessorService } from './services/juspay-webhook-processor.service';
import { JuspayWebhookAuthService } from './auth/juspay-webhook-auth.service';
import { JuspayWebhookController } from './api/juspay-webhook.controller';
import { JuspayWebhookEndpointService } from './services/juspay-webhook-endpoint.service';
import { JuspayPaymentAttemptService } from './services/juspay-payment-attempt.service';
import { JuspayBillingService } from './services/juspay-billing.service';
import { JuspaySdk } from './juspay/juspay-sdk';
import { subscriptionRenewalTask } from './jobs/subscription-renewal.task';
import { PluginInitOptions } from './types';

@VendurePlugin({
    imports: [PluginCommonModule],
    entities: [
        SubscriptionPlan,
        OrganizationSubscription,
        JuspaySubscriptionMandate,
        JuspayPaymentAttempt,
        JuspayWebhookEvent,
        JuspayWebhookEndpoint,
        RenewalPaymentReconciliationRequired,
    ],
    providers: [
        { provide: SUBSCRIPTION_PLUGIN_OPTIONS, useFactory: () => SubscriptionPlugin.options },
        // Juspay SDK provided under a token. When no billing credentials are
        // configured:
        //   - dev/test: null → JuspayBillingService falls back to a clearly-logged
        //     SIMULATED charge so the state machine still runs without real money.
        //   - production: throws at startup — silently simulating renewals in
        //     production would mean advancing subscription periods without ever
        //     charging customers (a revenue-destroying failure mode).
        {
            provide: JUSPAY_SDK,
            inject: [SUBSCRIPTION_PLUGIN_OPTIONS],
            useFactory: (opts: PluginInitOptions) => {
                if (opts.billing?.apiKey && opts.billing?.merchantId) {
                    return new JuspaySdk({
                        apiKey: opts.billing.apiKey,
                        merchantId: opts.billing.merchantId,
                        sandbox: opts.billing.sandbox ?? false,
                    });
                }
                if (process.env.NODE_ENV === "production") {
                    throw new Error(
                        "Juspay billing credentials are required in production. " +
                            "Set JUSPAY_API_KEY and JUSPAY_MERCHANT_ID, or the plugin will not load. " +
                            "Without credentials, real subscriptions would be renewed without payment.",
                    );
                }
                return null;
            },
        },
        SubscriptionService,
        SubscriptionRenewalService,
        SubscriptionRenewalQueueService,
        JuspayWebhookAuthService,
        JuspayWebhookQueueService,
        JuspayWebhookProcessorService,
        JuspayWebhookEndpointService,
        JuspayPaymentAttemptService,
        JuspayBillingService,
    ],
    controllers: [JuspayWebhookController],
            adminApiExtensions: {
        schema: adminApiExtensions,
        resolvers: [SubscriptionAdminResolver],
    },
    configuration: (config: RuntimeVendureConfig) => {
        // Raw body is captured by Nest's built-in JSON parser via
        // bootstrap({ nestApplicationOptions: { rawBody: true } }) in
        // src/index.ts — required so the Juspay webhook HMAC can hash the
        // exact bytes Juspay signed. No route middleware is registered here
        // (a plugin json() middleware loses the race against the global
        // parser and would double-parse).
        // Register the renewal task in the Vendure scheduler
        const existingIds = new Set(
            (config.schedulerOptions.tasks ?? []).map((t) => t.id),
        );
        if (!existingIds.has(subscriptionRenewalTask.id)) {
            config.schedulerOptions.tasks = [
                ...(config.schedulerOptions.tasks ?? []),
                subscriptionRenewalTask,
            ];
        }
        return config;
    },
    compatibility: '^3.0.0',
})
export class SubscriptionPlugin {
    static options: PluginInitOptions;

    static init(options: PluginInitOptions): Type<SubscriptionPlugin> {
        this.options = options;
        return SubscriptionPlugin;
    }
}
