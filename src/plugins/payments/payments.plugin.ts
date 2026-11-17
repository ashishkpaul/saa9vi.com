import { PluginCommonModule, RuntimeVendureConfig, VendurePlugin, TransactionalConnection, PaymentMethod } from '@vendure/core';
import { DocumentNode, Kind } from 'graphql';
import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { razorpayPaymentHandler } from './config/razorpay-payment-handler';
import { tenantRazorpayPaymentHandler } from './config/tenant-razorpay-payment-handler';
import { RazorpayOrdersClient } from './services/razorpay-orders.client';
import { RazorpayCheckoutService } from './services/razorpay-checkout.service';
import { PaymentWebhookQueueService } from './services/payment-webhook-queue.service';
import { PaymentWebhookEvent } from './entities/payment-webhook-event.entity';
import { razorpayShopApiExtensions } from './api/razorpay-shop.schema';
import { RazorpayShopResolver } from './api/razorpay-shop.resolver';
import { RazorpayPaymentsWebhookController } from './api/razorpay-payments-webhook.controller';
import { PaymentOpsAlertService } from './services/payment-ops-alert.service';
// Phase 2 — Per-tenant Razorpay (ADR-051 Option C)
import { TenantPaymentAccount } from './entities/tenant-payment-account.entity';
import { TenantPaymentEncryptionService } from './services/tenant-payment-encryption.service';
import { TenantPaymentAccountService } from './services/tenant-payment-account.service';
import { tenantPaymentAdminSchema } from './api/tenant-payment-admin.schema';
import { TenantPaymentAdminResolver } from './api/tenant-payment-admin.resolver';
import { TenantRazorpayOrdersClient } from './services/tenant-razorpay-orders.client';
import { TenantRazorpayService } from './services/tenant-razorpay.service';
import { tenantRazorpayShopApiExtensions } from './api/tenant-razorpay-shop.schema';
import { TenantRazorpayShopResolver } from './api/tenant-razorpay-shop.resolver';
import { ManageTenantPaymentAccount } from './constants';

/** Vendure core handler code for the dev-only dummy payment handler. */
export const DUMMY_PAYMENT_HANDLER_CODE = 'dummy-payment-handler';

const loggerCtx = 'PaymentsPlugin';

/** Concatenates multiple GraphQL schema-extension documents into one. */
function concatApiExtensions(...docs: DocumentNode[]): DocumentNode {
  return {
    kind: Kind.DOCUMENT,
    definitions: docs.flatMap((doc) => doc.definitions),
  };
}

/**
 * Commit 1 hygiene guard: in any non-dev deployment, boot must fail when a
 * PaymentMethod row still uses the dummy handler — tenants must not pay
 * through a dev-only dummy handler. Dev/test keep the dummy for e2e fixtures.
 */
@Injectable()
export class PaymentsProductionGuard implements OnApplicationBootstrap {
  constructor(private readonly connection: TransactionalConnection) {}

  async onApplicationBootstrap(): Promise<void> {
    if (process.env.APP_ENV === 'dev' || process.env.NODE_ENV === 'test') return;
    let methods: PaymentMethod[] = [];
    try {
      methods = await this.connection.rawConnection.getRepository(PaymentMethod).find();
    } catch (err: any) {
      Logger.warn(
        `PaymentsProductionGuard: could not list PaymentMethods (${err?.message}) — skipping dummy check`,
        loggerCtx,
      );
      return;
    }
    const offenders = methods.filter(
      (m) =>
        m.enabled !== false &&
        (m.handler as { code?: string })?.code === DUMMY_PAYMENT_HANDLER_CODE,
    );
    if (offenders.length > 0) {
      const detail = offenders.map((m) => `${m.code} (id=${m.id})`).join(', ');
      throw new Error(
        `Refusing to start: ${offenders.length} ENABLED PaymentMethod(s) use the dev-only dummy handler (${DUMMY_PAYMENT_HANDLER_CODE}): ${detail}. ` +
          `Remove or disable them via the Admin API before deploying.`,
      );
    }
  }
}

/**
 * R3 — one-time platform payments (Flow A) plus per-tenant payments (Flow B).
 *
 * Flow A uses platform Razorpay credentials and is reserved for tenant-admin
 * payments to Saa9vi. Flow B uses credentials resolved from the active tenant
 * Channel and is reserved for learner/customer payments to that tenant. The
 * two handlers and their credential sources remain strictly separate.
 */
@VendurePlugin({
  imports: [PluginCommonModule],
  entities: [PaymentWebhookEvent, TenantPaymentAccount],
  providers: [
    RazorpayOrdersClient,
    RazorpayCheckoutService,
    PaymentWebhookQueueService,
    PaymentsProductionGuard,
    PaymentOpsAlertService,
    TenantPaymentEncryptionService,
    TenantPaymentAccountService,
    TenantRazorpayOrdersClient,
    TenantRazorpayService,
  ],
  controllers: [RazorpayPaymentsWebhookController],
  shopApiExtensions: {
    schema: concatApiExtensions(
      razorpayShopApiExtensions,
      tenantRazorpayShopApiExtensions,
    ),
    resolvers: [RazorpayShopResolver, TenantRazorpayShopResolver],
  },
  adminApiExtensions: {
    schema: tenantPaymentAdminSchema,
    resolvers: [TenantPaymentAdminResolver],
  },
  dashboard: './dashboard/index.tsx',
  configuration: (config: RuntimeVendureConfig) => {
    config.authOptions.customPermissions.push(ManageTenantPaymentAccount);

    const handlers = config.paymentOptions.paymentMethodHandlers ?? [];
    const registered = new Set(handlers.map((handler) => handler.code));
    const nextHandlers = [...handlers];
    if (!registered.has(razorpayPaymentHandler.code)) {
      nextHandlers.push(razorpayPaymentHandler);
    }
    if (!registered.has(tenantRazorpayPaymentHandler.code)) {
      nextHandlers.push(tenantRazorpayPaymentHandler);
    }
    config.paymentOptions.paymentMethodHandlers = nextHandlers;
    return config;
  },
  compatibility: '^3.0.0',
})
export class PaymentsPlugin {}
