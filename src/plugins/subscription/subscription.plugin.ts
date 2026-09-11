import { PluginCommonModule, RuntimeVendureConfig, Type, VendurePlugin, ConfigService } from '@vendure/core';

import { SUBSCRIPTION_PLUGIN_OPTIONS, RAZORPAY_SUBSCRIPTION_PROVIDER, RECURRING_BILLING_PROVIDER } from './constants';
import { OrganizationSubscription } from './entities/organization-subscription.entity';
import { SubscriptionPlan } from './entities/subscription-plan.entity';
import { JuspaySubscriptionMandate } from './entities/juspay-subscription-mandate.entity';
import { JuspayPaymentAttempt } from './entities/juspay-payment-attempt.entity';
import { JuspayWebhookEvent } from './entities/juspay-webhook-event.entity';
import { JuspayWebhookEndpoint } from './entities/juspay-webhook-endpoint.entity';
import { RenewalPaymentReconciliationRequired } from './entities/juspay-reconciliation-required.entity';
import { SubscriptionProviderBinding } from './entities/subscription-provider-binding.entity';
import { SubscriptionBillingAttempt } from './entities/subscription-billing-attempt.entity';
import { SubscriptionAdminResolver } from './api/subscription-admin.resolver';
import { adminApiExtensions } from './api/schema/subscription-admin.schema';
import { SubscriptionService } from './services/subscription.service';
import { SubscriptionRenewalService } from './services/subscription-renewal.service';
import { SubscriptionRenewalQueueService } from './services/subscription-renewal-queue.service';
import { SubscriptionBillingAttemptService } from './services/subscription-billing-attempt.service';
import { RazorpaySubscriptionProvider } from './providers/razorpay/razorpay-subscription.provider';
import { RazorpayWebhookVerifier } from './providers/razorpay/razorpay-webhook.verifier';
import { RazorpayWebhookProcessor } from './providers/razorpay/razorpay-webhook.processor';
import { RazorpayWebhookController } from './providers/razorpay/razorpay-webhook.controller';
import { subscriptionRenewalTask } from './jobs/subscription-renewal.task';
import { subscriptionDunningTask } from './jobs/subscription-dunning.task';
import { PluginInitOptions } from './types';
import { ProviderWebhookEvent } from './entities/provider-webhook-event.entity';

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
        SubscriptionProviderBinding,
        SubscriptionBillingAttempt,
        ProviderWebhookEvent,
    ],
    providers: [
        { provide: SUBSCRIPTION_PLUGIN_OPTIONS, useFactory: () => SubscriptionPlugin.options },
        // Provider selection: explicit config required in production.
        // Fail-closed: throws if an unsupported provider is configured.
        {
            provide: RECURRING_BILLING_PROVIDER,
            inject: [SUBSCRIPTION_PLUGIN_OPTIONS],
            useFactory: (opts: PluginInitOptions) => {
                const provider = opts.provider;
                
                // Fail-closed in production: require explicit provider selection
                if (process.env.NODE_ENV === 'production' && !provider) {
                    throw new Error(
                        'Subscription provider is required in production. ' +
                            'Set provider: "razorpay" in SubscriptionPlugin options.',
                    );
                }
                
                // Explicit provider selection
                switch (provider) {
                    case 'razorpay':
                    case undefined: // Default to Razorpay
                        return new RazorpaySubscriptionProvider(new ConfigService());
                    default:
                        throw new Error(
                            `Unsupported recurring billing provider: ${provider}. ` +
                                'Use provider: "razorpay".',
                        );
                }
            },
        },
        // Core services
        SubscriptionService,
        SubscriptionRenewalService,
        SubscriptionRenewalQueueService,
        SubscriptionBillingAttemptService,
        // Razorpay services (default provider)
        RazorpaySubscriptionProvider,
        RazorpayWebhookVerifier,
        RazorpayWebhookProcessor,
    ],
    controllers: [
        RazorpayWebhookController,
    ],
    adminApiExtensions: {
        schema: adminApiExtensions,
        resolvers: [SubscriptionAdminResolver],
    },
    dashboard: './dashboard/index.tsx',
    configuration: (config: RuntimeVendureConfig) => {
        // Raw body is captured by Nest's built-in JSON parser via
        // bootstrap({ nestApplicationOptions: { rawBody: true } }) in
        // src/index.ts - required so the Razorpay webhook HMAC can hash the
        // exact bytes Razorpay signed. No route middleware is registered here
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
        if (!existingIds.has(subscriptionDunningTask.id)) {
            config.schedulerOptions.tasks = [
                ...(config.schedulerOptions.tasks ?? []),
                subscriptionDunningTask,
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
