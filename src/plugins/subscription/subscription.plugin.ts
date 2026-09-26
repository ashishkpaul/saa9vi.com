import { PluginCommonModule, RuntimeVendureConfig, Type, VendurePlugin, ConfigService } from '@vendure/core';

import { SUBSCRIPTION_PLUGIN_OPTIONS, RAZORPAY_SUBSCRIPTION_PROVIDER, RECURRING_BILLING_PROVIDER } from './constants';
import { OrganizationSubscription } from './entities/organization-subscription.entity';
import { SubscriptionPlan } from './entities/subscription-plan.entity';
import { SubscriptionProviderBinding } from './entities/subscription-provider-binding.entity';
import { SubscriptionBillingAttempt } from './entities/subscription-billing-attempt.entity';
import { ProviderWebhookEvent } from './entities/provider-webhook-event.entity';
import { RenewalPaymentReconciliationRequired } from './entities/renewal-reconciliation-required.entity';
import { SubscriptionAdminResolver } from './api/subscription-admin.resolver';
import { adminApiExtensions } from './api/schema/subscription-admin.schema';
import { SubscriptionShopResolver } from './api/subscription-shop.resolver';
import { shopApiExtensions } from './api/schema/subscription-shop.schema';
import { SubscriptionShopService } from './services/subscription-shop.service';
import { TenantSelfServeSubscriptionCooldownService } from './services/tenant-self-serve-subscription-cooldown.service';
import { CommercialEntitlementModule } from '../../platform/commercial/commercial-entitlement.module';
import { SubscriptionService } from './services/subscription.service';
import { FreePlanProvisioningService } from './services/free-plan-provisioning.service';
import { FreePlanProvisioningListener } from './listeners/free-plan-provisioning.listener';
import { SubscriptionRenewalService } from './services/subscription-renewal.service';
import { SubscriptionRenewalQueueService } from './services/subscription-renewal-queue.service';
import { ProviderWebhookQueueService } from './services/provider-webhook-queue.service';
import { SubscriptionBillingAttemptService } from './services/subscription-billing-attempt.service';
import { RazorpaySubscriptionProvider } from './providers/razorpay/razorpay-subscription.provider';
import { RazorpayWebhookVerifier } from './providers/razorpay/razorpay-webhook.verifier';
import { RazorpayWebhookProcessor } from './providers/razorpay/razorpay-webhook.processor';
import { RazorpayWebhookController } from './providers/razorpay/razorpay-webhook.controller';
import { subscriptionRenewalTask } from './jobs/subscription-renewal.task';
import { subscriptionDunningTask } from './jobs/subscription-dunning.task';
import { PluginInitOptions } from './types';

@VendurePlugin({
    imports: [PluginCommonModule, CommercialEntitlementModule],
    entities: [
        SubscriptionPlan,
        OrganizationSubscription,
        SubscriptionProviderBinding,
        SubscriptionBillingAttempt,
        ProviderWebhookEvent,
        RenewalPaymentReconciliationRequired,
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
        ProviderWebhookQueueService,
        SubscriptionBillingAttemptService,
        // Provider-free Free Basic activation (plan §3.2 / slice 4).
        // The listener is the only production caller: it subscribes to
        // TenantRegisteredEvent and is deliberately fail-soft.
        FreePlanProvisioningService,
        FreePlanProvisioningListener,
        // Tenant-facing commercial READ surface (plan §3.5, slice 8).
        // Read-only: self-serve upgrade/cancel stays deferred (UI-1).
        SubscriptionShopService,
        TenantSelfServeSubscriptionCooldownService,
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
    shopApiExtensions: {
        schema: shopApiExtensions,
        resolvers: [SubscriptionShopResolver],
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
