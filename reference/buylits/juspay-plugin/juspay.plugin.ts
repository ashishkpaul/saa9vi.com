import { VendurePlugin, RuntimeVendureConfig, LanguageCode, Type } from '@vendure/core';
import { PluginCommonModule } from '@vendure/core';
import { PaymentsCoreModule } from '../payments-core';
import { JuspayPluginOptions } from './options';
import { PaymentEventLog } from '../payments-core/entity/payment-event-log.entity';
import { PaymentSettlementAudit } from './entity/payment-settlement-audit.entity';
import { JuspayService } from './service/juspay.service';
import { JuspayWebhookQueue } from './jobs/juspay-webhook.queue';
import { JuspayReconciliationJob } from './jobs/juspay-reconciliation.job';
import { JuspayWebhookAuthGuard } from './webhook/webhook-auth.guard';
import { JuspayWebhookController } from './webhook/juspay-webhook.controller';
import { juspayPaymentHandler } from './config/juspay-payment-handler';
import { JuspaySdk } from '../payments-core/gateway/juspay-sdk';
import { JuspayShopResolver } from './api/juspay-shop.resolver';
import { shopApiExtensions } from './api/shop-api-extensions';
import { JUSPAY_PLUGIN_OPTIONS, JUSPAY_HANDLER_CODE } from './constants';
import { MiddlewareConsumer } from '@nestjs/common';
import { json } from 'express';

@VendurePlugin({
  imports: [
    PluginCommonModule,
    PaymentsCoreModule
  ],

  entities: [PaymentEventLog, PaymentSettlementAudit],

  providers: [
    JuspayService,
    JuspayWebhookQueue,
    JuspayReconciliationJob,
    JuspayWebhookAuthGuard,      // FIX audit #2: guard MUST be in providers
    {
      provide: JUSPAY_PLUGIN_OPTIONS,
      useFactory: () => JuspayPlugin.options,
    },
    // ADD JuspaySdk directly to the plugin
    {
      provide: JuspaySdk,
      inject: [JUSPAY_PLUGIN_OPTIONS],
      useFactory: (opts: JuspayPluginOptions) =>
        new JuspaySdk({
          apiKey: opts.apiKey,
          merchantId: opts.merchantId,
          sandbox: opts.sandbox ?? false,
        }),
    }
  ],

  controllers: [JuspayWebhookController],

  shopApiExtensions: {
    schema: shopApiExtensions,
    resolvers: [JuspayShopResolver],
  },

  exports: [
    JuspayService,
    JuspayWebhookAuthGuard,
    JUSPAY_PLUGIN_OPTIONS
  ],

  configuration: (config: RuntimeVendureConfig) => {
    // 1. Register payment handler
    config.paymentOptions.paymentMethodHandlers.push(juspayPaymentHandler);

    // 2. Add juspayOrderId custom field on Order
    config.customFields.Order ??= [];
    // Guard against duplicate registration (plugin loaded multiple times)
    if (!config.customFields.Order.some(f => f.name === 'juspayOrderId')) {
      config.customFields.Order.push({
        name: 'juspayOrderId',
        type: 'string',
        nullable: true,
        readonly: true,
        label: [{ languageCode: LanguageCode.en, value: 'Juspay Order ID' }],
        public: false,
      });
    }
    return config;
  },

  compatibility: '^3.0.0'
})
export class JuspayPlugin {
  static options: JuspayPluginOptions;

  static init(options: JuspayPluginOptions): Type<JuspayPlugin> {
    JuspayPlugin.options = options;
    return JuspayPlugin;
  }

  configure(consumer: MiddlewareConsumer): void {
    // Attach raw-body parser ONLY to the webhook route.
    // Required for HMAC signature verification.
    // Pattern from SellerPromotionPlugin.configure() in this codebase.
    consumer
      .apply(json({ verify: (req: any, _res, buf) => { req.rawBody = buf } }))
      .forRoutes('/payments/juspay');
  }
}

// TypeScript module augmentation
declare module '@vendure/core' {
  interface CustomOrderFields {
    juspayOrderId?: string;
  }
}