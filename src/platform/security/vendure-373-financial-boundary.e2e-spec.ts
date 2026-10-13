/**
 * V1.0.7 — Vendure 3.7.3 cross-channel financial boundary (PERMANENT).
 *
 * Guards INV-001 (Channel=Tenant) against the IDOR class fixed in
 * Vendure 3.7.3 (GHSA-7qvr-c5vf-xxfh): Order payment, refund,
 * fulfillment and customer-note operations must throw when the target
 * entity is not visible in the caller's active channel.
 *
 * Shape mirrors bbb-channel-isolation.e2e-spec.ts:
 *   - two tenants (A + B) via registerNewTenant (Shop API)
 *   - Tenant A: shopper checkout → settled order w/ payment (dummy handler)
 *   - Tenant B admin, on Tenant B channel, attempts ops on A's IDs → MUST FAIL
 *   - Tenant A admin on Tenant A channel keeps working (control probes)
 *   - ELEVATED tenant-B actor (Read/UpdateAdministrator granted WITHIN tenant
 *     B via Admin API) probes the administrator surface → denial here is
 *     channel-scope enforcement, not bare permission denial
 *
 * Governance: no direct database writes — authentication is achieved with
 * authOptions.requireVerification=false (BUG-033 precedent), and the elevated
 * probe actor is created through createRole/createAdministrator mutations.
 *
 * Isolated Postgres schema (e2e_vendure_373_security) — never touches dev data.
 * Run: npx vitest run src/platform/security/vendure-373-financial-boundary.e2e-spec.ts
 */

import 'reflect-metadata';
import path from 'path';
import 'dotenv/config';
import gql from 'graphql-tag';
import {
  createTestEnvironment,
  E2E_DEFAULT_CHANNEL_TOKEN,
  registerInitializer,
  testConfig,
} from '@vendure/testing';
import { startOnFreePort } from '../../test-utils/free-port';
import { getSuperadminContext } from '@vendure/testing/lib/utils/get-superadmin-context';
import { SchemaPostgresInitializer } from '../../plugins/tenant-plugin/e2e/schema-postgres-initializer';
import { mergeConfig, dummyPaymentHandler } from '@vendure/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { TenantPlugin } from '../../plugins/tenant-plugin/tenant-plugin.plugin';
import { BigBlueButtonPlugin } from '../../plugins/bigbluebutton-plugin/bigbluebutton.plugin';
import { CmsPlugin } from '../../plugins/cms/cms.plugin';
import { ReviewsPlugin } from '../../plugins/reviews/reviews-plugin';
import { SubscriptionPlugin } from '../../plugins/subscription/subscription.plugin';
import { E2E_INITIAL_DATA } from '../../plugins/tenant-plugin/e2e/fixtures/e2e-initial-data';
import { createElevatedTenantAdmin, ElevatedTenantAdmin } from './elevated-tenant-admin';
import { verifyTenantAdminViaApi } from '../../plugins/tenant-plugin/e2e/fixtures/verify-tenant-admin';

registerInitializer('postgres', new SchemaPostgresInitializer());

// ─── GraphQL documents ─────────────────────────────────────────────────────

const REGISTER_NEW_TENANT = gql`
  mutation RegisterNewTenant($input: RegisterTenantInput!) {
    registerNewTenant(input: $input) {
      channelId
      channelToken
      administratorId
    }
  }
`;

const REGISTER_CUSTOMER = gql`
  mutation RegisterCustomer($input: RegisterCustomerInput!) {
    registerCustomerAccount(input: $input) {
      ... on Success { success }
      ... on ErrorResult { errorCode message }
    }
  }
`;

const ADD_ITEM = gql`
  mutation AddItem($productVariantId: ID!, $quantity: Int!) {
    addItemToOrder(productVariantId: $productVariantId, quantity: $quantity) {
      ... on Order { id }
      ... on ErrorResult { errorCode message }
    }
  }
`;

const SET_SHIPPING_ADDRESS = gql`
  mutation SetAddress($input: CreateAddressInput!) {
    setOrderShippingAddress(input: $input) {
      ... on Order { id }
      ... on ErrorResult { errorCode message }
    }
  }
`;

const GET_ELIGIBLE_SHIPPING = gql`
  query EligibleShipping {
    eligibleShippingMethods { id }
  }
`;

const SET_SHIPPING_METHOD = gql`
  mutation SetShippingMethod($ids: [ID!]!) {
    setOrderShippingMethod(shippingMethodId: $ids) {
      ... on Order { id }
      ... on ErrorResult { errorCode message }
    }
  }
`;

const TRANSITION_TO_ARRANGING = gql`
  mutation TransitionArranging {
    transitionOrderToState(state: "ArrangingPayment") {
      ... on Order { id state }
      ... on ErrorResult { errorCode message }
    }
  }
`;

const SHOP_ADD_PAYMENT = gql`
  mutation ShopAddPayment($input: PaymentInput!) {
    addPaymentToOrder(input: $input) {
      ... on Order { id state }
      ... on ErrorResult { errorCode message }
    }
  }
`;

// ─── Admin probes: Tenant B admin runs these against Tenant A ids ──────────

const ADMIN_ORDER = gql`
  query AdminOrder($id: ID!) {
    order(id: $id) { id code state }
  }
`;

const ADMIN_ADD_MANUAL_PAYMENT = gql`
  mutation AdminAddManualPayment($orderId: ID!) {
    addManualPaymentToOrder(orderId: $orderId, input: { method: "dummy-payment", metadata: {} }) {
      ... on Order { id }
      ... on ManualPaymentStateError { errorCode message }
      ... on ErrorResult { errorCode message }
    }
  }
`;

const ADMIN_TRANSITION_PAYMENT = gql`
  mutation AdminTransitionPayment($id: ID!) {
    transitionPaymentToState(id: $id, state: "Settled") {
      ... on Payment { id state }
      ... on PaymentStateTransitionError { errorCode message }
      ... on ErrorResult { errorCode message }
    }
  }
`;

const ADMIN_CREATE_REFUND = gql`
  mutation AdminCreateRefund($input: RefundOrderInput!) {
    refundOrder(input: $input) {
      ... on Refund { id state }
      ... on RefundOrderStateError { errorCode message }
      ... on ErrorResult { errorCode message }
    }
  }
`;

const ADMIN_TRANSITION_FULFILLMENT = gql`
  mutation AdminTransitionFulfillment($id: ID!) {
    transitionFulfillmentToState(id: $id, state: "Shipped") {
      ... on Fulfillment { id state }
      ... on FulfillmentStateTransitionError { errorCode message }
      ... on ErrorResult { errorCode message }
    }
  }
`;

const ADMIN_ADD_NOTE_TO_ORDER = gql`
  mutation AdminAddNoteToOrder($input: AddNoteToOrderInput!) {
    addNoteToOrder(input: $input) {
      id code
    }
  }
`;

const ADMIN_ADD_NOTE_TO_CUSTOMER = gql`
  mutation AdminAddNoteToCustomer($input: AddNoteToCustomerInput!) {
    addNoteToCustomer(input: $input) {
      id emailAddress
    }
  }
`;

const ADMIN_ADMINISTRATORS = gql`
  query AdminAdministrators {
    administrators { items { id emailAddress } totalItems }
  }
`;

const UPDATE_ADMINISTRATOR = gql`
  mutation UpdateAdminProbe($input: UpdateAdministratorInput!) {
    updateAdministrator(input: $input) { id emailAddress firstName lastName }
  }
`;

const ADMIN_ORDER_PAYMENTS = gql`
  query AdminOrderPayments($id: ID!) {
    order(id: $id) {
      id
      payments { id state }
      fulfillments { id state }
      customer { id }
    }
  }
`;

// ─── Suite ─────────────────────────────────────────────────────────────────

describe('Vendure 3.7.3 cross-channel financial boundary (INV-001)', () => {
  const { server, adminClient, shopClient } = createTestEnvironment(
    mergeConfig(testConfig, {
      // Free port assigned by startOnFreePort() in beforeAll (test-utils/free-port).
      apiOptions: { port: 0 },
      authOptions: { requireVerification: false },
      dbConnectionOptions: {
        type: 'postgres',
        host: process.env.DB_HOST ?? 'localhost',
        port: Number(process.env.DB_PORT ?? 5432),
        database: process.env.DB_NAME ?? 'vendure',
        username: process.env.DB_USERNAME ?? 'vendure_user',
        password: process.env.DB_PASSWORD ?? '',
        schema: 'e2e_vendure_373_security',
        synchronize: true,
      },
      paymentOptions: { paymentMethodHandlers: [dummyPaymentHandler] },
      plugins: [
        TenantPlugin,
        BigBlueButtonPlugin,
        CmsPlugin,
        ReviewsPlugin,
        SubscriptionPlugin.init({}) as any,
      ],
    }),
  );

  let tenantAEmail: string;
  let tenantAPassword = 'StrongP@ssA1';
  let tenantAToken: string;
  let tenantAAdminId: string;
  let tenantBEmail: string;
  let tenantBPassword = 'StrongP@ssB1';
  let tenantBToken: string;
  let tenantBChannelId: string;
  // Elevated probe actors: the same permission set scoped to DIFFERENT
  // channels. elevatedB/elevatedBPeer live on channel B; elevatedDefault
  // carries identical permissions on the DEFAULT channel. Denials against
  // elevatedDefault from elevatedB are therefore attributable purely to
  // channel scope — both sides hold the permission.
  let elevatedB: ElevatedTenantAdmin;
  let elevatedBPeer: ElevatedTenantAdmin;
  let elevatedDefault: ElevatedTenantAdmin;
  let defaultChannelId: string;

  let orderAId: string;
  let paymentAId: string;
  let fulfillmentAId: string | null = null;
  let customerAId: string;

  // Cross-channel denial helper: the op must either throw (channel guard)
  // or return an ErrorResult — never a successful entity payload.
  async function expectCrossChannelDenied(
    label: string,
    run: () => Promise<any>,
  ): Promise<void> {
    let result: any = null;
    let threw: any = null;
    try {
      result = await run();
    } catch (err) {
      threw = err;
    }
    if (threw) return; // channel guard threw — desired
    const payload = result ? Object.values(result)[0] as any : null;
    if (!payload) return; // null/empty — denied
    if (payload?.errorCode || payload?.transitionError) return; // ErrorResult — denied
    if (payload?.id) {
      throw new Error(`${label}: CROSS-CHANNEL OP SUCCEEDED (id=${payload.id}) — boundary violated`);
    }
  }

  beforeAll(async () => {
    await startOnFreePort({ server, adminClient, shopClient }, {
      initialData: E2E_INITIAL_DATA,
      productsCsvPath: path.join(
        __dirname,
        '../../plugins/tenant-plugin/e2e/fixtures/e2e-products.csv',
      ),
      customerCount: 2,
    });
  }, 120_000);

  afterAll(async () => {
    await server.destroy();
  });

  describe('tenant bootstrap', () => {
    beforeAll(() => {
      shopClient.setChannelToken(E2E_DEFAULT_CHANNEL_TOKEN);
    });

    it('registers tenant A', async () => {
      tenantAEmail = `v373-a-${Date.now()}@example.com`;
      const result = await shopClient.query(REGISTER_NEW_TENANT, {
        input: {
          businessName: 'V373 Academy A',
          firstName: 'A',
          lastName: 'Admin',
          emailAddress: tenantAEmail,
          password: tenantAPassword,
          timezone: 'Asia/Kolkata',
        },
      });
      expect(result.registerNewTenant.channelToken).toMatch(/^tok_/);
      tenantAToken = result.registerNewTenant.channelToken;
      tenantAAdminId = result.registerNewTenant.administratorId;
      // Phase 1.5 verification through the application API (no DB writes):
      // required on 3.7.3 — login is refused while a pending token exists.
      await verifyTenantAdminViaApi(server, shopClient, tenantAEmail);
    });

    it('registers tenant B', async () => {
      tenantBEmail = `v373-b-${Date.now()}@example.com`;
      const result = await shopClient.query(REGISTER_NEW_TENANT, {
        input: {
          businessName: 'V373 Academy B',
          firstName: 'B',
          lastName: 'Admin',
          emailAddress: tenantBEmail,
          password: tenantBPassword,
          timezone: 'Asia/Kolkata',
        },
      });
      expect(result.registerNewTenant.channelToken).not.toEqual(tenantAToken);
      tenantBToken = result.registerNewTenant.channelToken;
      tenantBChannelId = result.registerNewTenant.channelId;
      // Phase 1.5 verification through the application API (no DB writes).
      await verifyTenantAdminViaApi(server, shopClient, tenantBEmail);
    });
  });

  describe('elevated probe actors bootstrap (Admin API only — no DB writes)', () => {
    it('creates channel-scoped admins holding Read/UpdateAdministrator', async () => {
      await adminClient.asSuperAdmin();

      const { channels }: any = await adminClient.query(gql`
        query DefaultChannel { channels { items { id token } } }
      `);
      const def = (channels.items as any[]).find(
        (c: any) => c.token === E2E_DEFAULT_CHANNEL_TOKEN,
      );
      expect(def).toBeTruthy();
      defaultChannelId = def.id;

      elevatedB = await createElevatedTenantAdmin(adminClient, tenantBChannelId, 'tenant-b', [
        'ReadAdministrator',
        'UpdateAdministrator',
      ]);
      elevatedBPeer = await createElevatedTenantAdmin(adminClient, tenantBChannelId, 'tenant-b-peer', [
        'ReadAdministrator',
        'UpdateAdministrator',
      ]);
      elevatedDefault = await createElevatedTenantAdmin(adminClient, defaultChannelId, 'default', [
        'ReadAdministrator',
        'UpdateAdministrator',
      ]);
      expect(elevatedB.administratorId).toBeTruthy();
      expect(elevatedBPeer.administratorId).toBeTruthy();
      expect(elevatedDefault.administratorId).toBeTruthy();
      expect(elevatedB.administratorId).not.toEqual(elevatedDefault.administratorId);
    });
  });

  describe('tenant A shopper checkout (settled order + payment)', () => {
    it('places and settles an order on tenant A channel', async () => {
      // Shop as anonymous on tenant A channel; default-channel product is
      // auto-provisioned to new channels (autoProvisionChannelResources).
      shopClient.setChannelToken(tenantAToken);
      const custEmail = `v373-buyer-${Date.now()}@example.com`;
      const reg: any = await shopClient.query(REGISTER_CUSTOMER, {
        input: {
          emailAddress: custEmail,
          password: 'BuyerP@ss1',
          firstName: 'V373',
          lastName: 'Buyer',
        },
      });
      expect(reg.registerCustomerAccount?.errorCode ?? null).toBeNull();
      await shopClient.asUserWithCredentials(custEmail, 'BuyerP@ss1');
      shopClient.setChannelToken(tenantAToken);

      // Create a variant directly on the tenant A channel via services
      // (avoids shop search plugin + cross-channel visibility questions).
      const { ProductService, ProductVariantService } = await import('@vendure/core');
      const superCtx: any = await getSuperadminContext(server.app);
      const productService = server.app.get(ProductService);
      const variantService = server.app.get(ProductVariantService);
      const createdProduct = await productService.create(superCtx, {
        enabled: true,
        translations: [
          {
            languageCode: 'en' as any,
            name: 'V373 Product ' + Date.now(),
            slug: 'v373-' + Date.now(),
            description: 'V373 boundary product',
          },
        ],
      });
      const { ChannelService, PaymentMethodService } = await import('@vendure/core');
      const channelService = server.app.get(ChannelService);
      const tenantChannel: any = await channelService.getChannelFromToken(tenantAToken);
      const pmService = server.app.get(PaymentMethodService);
      const { items: existingPms } = await pmService.findAll(superCtx);
      let pm = existingPms.find((m: any) => m.code === 'dummy-payment');
      if (!pm) {
        pm = await pmService.create(superCtx, {
          code: 'dummy-payment',
          enabled: true,
          handler: {
            code: 'dummy-payment-handler',
            arguments: [{ name: 'automaticSettle', value: 'true' }],
          },
          translations: [{ languageCode: 'en' as any, name: 'Dummy Payment' }],
        });
      }
      await pmService.assignPaymentMethodsToChannel(superCtx, {
        channelId: tenantChannel.id,
        paymentMethodIds: [pm.id],
      });
      const variants = await variantService.create(
        superCtx,
        [
          {
            productId: createdProduct.id,
            sku: 'V373-' + Date.now(),
            price: 50000,
            stockOnHand: 100,
            trackInventory: 'FALSE' as any,
            translations: [{ languageCode: 'en' as any, name: 'V373 Variant' }],
          },
        ],
      );
      const createdVariant: any = Array.isArray(variants) ? variants[0] : variants;
      await channelService.assignToChannels(superCtx, 'Product' as any, createdProduct.id, [
        tenantChannel.id,
      ]);
      await channelService.assignToChannels(superCtx, 'ProductVariant' as any, createdVariant.id, [
        tenantChannel.id,
      ]);
      const variantId: string = String(createdVariant.id);

      const add: any = await shopClient.query(ADD_ITEM, { productVariantId: variantId, quantity: 1 });
      expect(add.addItemToOrder?.errorCode ?? null).toBeNull();

      const addr: any = await shopClient.query(SET_SHIPPING_ADDRESS, {
        input: {
          fullName: 'V373 Buyer',
          streetLine1: '1 Boundary Street',
          city: 'E2ECity',
          postalCode: '123456',
          countryCode: 'IN',
        },
      });
      expect(addr.setOrderShippingAddress?.errorCode ?? null).toBeNull();

      const sm: any = await shopClient.query(GET_ELIGIBLE_SHIPPING);
      expect(sm.eligibleShippingMethods.length).toBeGreaterThan(0);
      const setSm: any = await shopClient.query(SET_SHIPPING_METHOD, {
        ids: [sm.eligibleShippingMethods[0].id],
      });
      expect(setSm.setOrderShippingMethod?.errorCode ?? null).toBeNull();

      const trans: any = await shopClient.query(TRANSITION_TO_ARRANGING);
      expect(trans.transitionOrderToState?.errorCode ?? null).toBeNull();

      const pay: any = await shopClient.query(SHOP_ADD_PAYMENT, {
        input: { method: 'dummy-payment', metadata: { automaticSettle: true } },
      });
      expect(pay.addPaymentToOrder?.errorCode ?? null).toBeNull();
      orderAId = pay.addPaymentToOrder.id;
      expect(orderAId).toBeTruthy();
    });

    it('tenant A admin reads its own order/payments (control)', async () => {
      await adminClient.asUserWithCredentials(tenantAEmail, tenantAPassword);
      adminClient.setChannelToken(tenantAToken);
      const { order }: any = await adminClient.query(ADMIN_ORDER_PAYMENTS, { id: orderAId } as any);
      expect(order?.id).toBeTruthy();
      expect(order.payments.length).toBeGreaterThan(0);
      paymentAId = order.payments[0].id;
      fulfillmentAId = order.fulfillments?.[0]?.id ?? null;
      customerAId = order.customer?.id;
      expect(customerAId).toBeTruthy();
    });
  });

  describe('tenant B admin on tenant A ids — MUST FAIL', () => {
    beforeAll(async () => {
      await adminClient.asUserWithCredentials(tenantBEmail, tenantBPassword);
      adminClient.setChannelToken(tenantBToken);
    });

    it('cannot read tenant A order', async () => {
      await expectCrossChannelDenied('order read', () =>
        adminClient.query(ADMIN_ORDER, { id: orderAId }),
      );
    });

    it('cannot addManualPaymentToOrder on tenant A order', async () => {
      await expectCrossChannelDenied('addManualPayment', () =>
        adminClient.query(ADMIN_ADD_MANUAL_PAYMENT, { orderId: orderAId }),
      );
    });

    it('cannot transitionPaymentToState on tenant A payment', async () => {
      await expectCrossChannelDenied('transitionPayment', () =>
        adminClient.query(ADMIN_TRANSITION_PAYMENT, { id: paymentAId }),
      );
    });

    it('cannot refundOrder on tenant A order', async () => {
      await expectCrossChannelDenied('refundOrder', () =>
        adminClient.query(ADMIN_CREATE_REFUND, {
          input: {
            lines: [],
            shipping: 0,
            adjustment: 0,
            paymentId: paymentAId,
            reason: 'cross-channel probe',
          },
        }),
      );
    });

    it('cannot transitionFulfillmentToState (skipped when no fulfillment)', async () => {
      if (!fulfillmentAId) return;
      await expectCrossChannelDenied('transitionFulfillment', () =>
        adminClient.query(ADMIN_TRANSITION_FULFILLMENT, { id: fulfillmentAId }),
      );
    });

    it('cannot addNoteToOrder on tenant A order', async () => {
      await expectCrossChannelDenied('addNoteToOrder', () =>
        adminClient.query(ADMIN_ADD_NOTE_TO_ORDER, { input: { id: orderAId, note: 'cross-channel probe', isPublic: false } }),
      );
    });

    it('cannot addNoteToCustomer on tenant A customer', async () => {
      await expectCrossChannelDenied('addNoteToCustomer', () =>
        adminClient.query(ADMIN_ADD_NOTE_TO_CUSTOMER, { input: { id: customerAId, note: 'cross-channel probe', isPublic: false } }),
      );
    });
  });

  describe('elevated tenant-B actor — administrator surface (channel scope ≠ permission denial)', () => {
    // The actor HOLDS ReadAdministrator + UpdateAdministrator on channel B
    // (granted via createRole/createAdministrator). Denials below therefore
    // evidence Vendure 3.7.3's channel-scope visibility rule
    // (activeUserHasPermissionsOfRoles) or Saa9vi INV-016 — NOT the
    // permission guard rejecting an unprivileged caller.
    beforeAll(async () => {
      await adminClient.asUserWithCredentials(elevatedB.email, elevatedB.password);
      adminClient.setChannelToken(tenantBToken);
    });

    it('administrators query SUCCEEDS (permission held) and excludes tenant A + superadmin', async () => {
      const { administrators }: any = await adminClient.query(ADMIN_ADMINISTRATORS);
      const emails: string[] = (administrators?.items ?? []).map((a: any) => a.emailAddress);
      // Positive controls — the permission is genuinely effective on channel B:
      expect(emails).toContain(elevatedB.email);
      expect(emails).toContain(elevatedBPeer.email);
      expect(emails).toContain(tenantBEmail);
      // Channel scope — INV-016 + 3.7.3 core scoping:
      expect(emails).not.toContain(tenantAEmail);
      expect(emails).not.toContain('superadmin');
    });

    it('control: updateAdministrator on a peer admin in channel B succeeds', async () => {
      const { updateAdministrator }: any = await adminClient.query(UPDATE_ADMINISTRATOR, {
        input: { id: elevatedBPeer.administratorId, firstName: 'PeerB' },
      });
      expect(updateAdministrator?.id).toBeTruthy();
    });

    it('updateAdministrator on tenant A admin MUST FAIL (cross-channel)', async () => {
      await expectCrossChannelDenied('updateAdministrator → tenant A admin', () =>
        adminClient.query(UPDATE_ADMINISTRATOR, {
          input: { id: tenantAAdminId, firstName: 'Hacked' },
        }),
      );
    });

    it('updateAdministrator on default-channel elevated admin MUST FAIL (same permissions, other channel → pure channel scope)', async () => {
      await expectCrossChannelDenied('updateAdministrator → default-channel elevated', () =>
        adminClient.query(UPDATE_ADMINISTRATOR, {
          input: { id: elevatedDefault.administratorId, firstName: 'Hacked' },
        }),
      );
    });
  });

  describe('tenant A admin control — own-channel ops keep working', () => {
    beforeAll(async () => {
      await adminClient.asUserWithCredentials(tenantAEmail, tenantAPassword);
      adminClient.setChannelToken(tenantAToken);
    });

    it('adds a note to its own order', async () => {
      const { addNoteToOrder }: any = await adminClient.query(ADMIN_ADD_NOTE_TO_ORDER, {
        input: { id: orderAId, note: 'cross-channel probe', isPublic: false },
      });
      expect(addNoteToOrder?.id).toBeTruthy();
    });
  });
});
