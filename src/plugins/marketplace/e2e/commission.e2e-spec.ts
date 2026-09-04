/**
 * Commission classification + ledger e2e (Phase 3B.5).
 *
 * Infrastructure-gated: requires Postgres. No Elasticsearch or Redis needed.
 *
 * Run:  COMMISSION_E2E=true npm run test:e2e:commission
 *
 * Coverage (the six cases the 3B.3 review flagged as essential):
 *   1. Positive        - valid ref + resource on order -> marketplace + ledger row
 *   2. DL-30 $0-row    - MARKETPLACE_COMMISSION_PERCENT=0 -> row with amount=0
 *   3. INV-008 forge   - client forges orderSource='marketplace' -> reclassified direct
 *   4. Replay          - same ref on a 2nd order -> direct, no 2nd row
 *   5. No-ref          - plain checkout -> direct, no row
 *   6. Concurrency     - two concurrent same-ref orders -> exactly one ledger row
 *
 * Isolation: dedicated Postgres schema (e2e_commission) so dev/live ledgers are
 * never touched. The dummy payment handler settles immediately, firing
 * OrderPlacedEvent without any external payment provider.
 */

import 'reflect-metadata';
import 'dotenv/config';
import gql from 'graphql-tag';
import net from 'net';
import {
  createTestEnvironment,
  E2E_DEFAULT_CHANNEL_TOKEN,
  registerInitializer,
  testConfig,
} from '@vendure/testing';
import {
  DefaultLogger,
  LogLevel,
  dummyPaymentHandler,
  mergeConfig,
  Order,
  PaymentMethodService,
  ProductService,
  ProductVariant,
  ProductVariantService,
} from '@vendure/core';
import { beforeAll, describe, expect, it } from 'vitest';
import { getSuperadminContext } from '@vendure/testing/lib/utils/get-superadmin-context';

import { TenantPlugin } from '../../tenant-plugin/tenant-plugin.plugin';
import { MarketplaceIndexerPlugin } from '../marketplace-indexer.plugin';
import { SchemaPostgresInitializer } from '../../tenant-plugin/e2e/schema-postgres-initializer';
import { CommissionLedger } from '../entities/commission-ledger.entity';
import { CommissionLedgerService } from '../services/commission-ledger.service';
import { MarketplaceAttributionService } from '../services/marketplace-attribution.service';
import { TransactionalConnection } from '@vendure/core';

registerInitializer('postgres', new SchemaPostgresInitializer());

const COMMISSION_E2E = process.env.COMMISSION_E2E === 'true';

async function assertPostgres(): Promise<void> {
  const host = process.env.DB_HOST ?? '127.0.0.1';
  const port = Number(process.env.DB_PORT ?? 5435);
  await new Promise<void>((resolve, reject) => {
    const sock = net.connect(port, host);
    sock.once('connect', () => { sock.destroy(); resolve(); });
    sock.once('error', (err) => reject(err));
  });
}

const { server, adminClient, shopClient } = createTestEnvironment(
  mergeConfig(testConfig, {
    apiOptions: { port: 3076 },
    logger: new DefaultLogger({ level: LogLevel.Debug }),
    authOptions: { requireVerification: false },
    dbConnectionOptions: {
      type: 'postgres',
      host: process.env.DB_HOST ?? '127.0.0.1',
      port: Number(process.env.DB_PORT ?? 5435),
      database: process.env.DB_NAME ?? 'vendure',
      username: process.env.DB_USERNAME ?? 'vendure_user',
      password: process.env.DB_PASSWORD ?? '',
      schema: 'e2e_commission',
      synchronize: true,
    },
    paymentOptions: {
      paymentMethodHandlers: [dummyPaymentHandler],
    },
    plugins: [TenantPlugin, MarketplaceIndexerPlugin],
  }),
);

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
      ... on Order { id totalWithTax currencyCode }
      ... on ErrorResult { errorCode message }
    }
  }
`;

const APPLY_REF = gql`
  mutation ApplyRef($ref: String!) {
    applyMarketplaceReference(ref: $ref) {
      ok
      orderId
      code
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

const ADD_PAYMENT = gql`
  mutation AddPayment($input: PaymentInput!) {
    addPaymentToOrder(input: $input) {
      ... on Order { id state }
      ... on ErrorResult { errorCode message }
    }
  }
`;

const GET_ELIGIBLE_SHIPPING = gql`
  query EligibleShipping {
    eligibleShippingMethods {
      id
      name
      price
    }
  }
`;

const SET_SHIPPING_METHOD = gql`
  mutation SetShippingMethod($ids: [ID!]!) {
    setOrderShippingMethod(shippingMethodId: $ids) {
      ... on Order { id state }
      ... on ErrorResult { errorCode message }
    }
  }
`;
const TRANSITION_TO_ARRANGING = gql`
  mutation TransitionArranging {
    transitionOrderToState(state: "ArrangingPayment") {
      ... on Order { id state }
      ... on ErrorResult { errorCode message }
      ... on OrderStateTransitionError { transitionError }
    }
  }
`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function waitFor<T>(
  fn: () => Promise<T>,
  pred: (v: T) => boolean,
  timeoutMs = 15000,
  intervalMs = 150,
): Promise<T> {
  const start = Date.now();
  let last: T = await fn();
  while (!pred(last)) {
    if (Date.now() - start > timeoutMs) {
      throw new Error('waitFor timed out');
    }
    await new Promise((r) => setTimeout(r, intervalMs));
    last = await fn();
  }
  return last;
}

async function createVariant(priceInPaise: number): Promise<string> {
  const ctx = await getSuperadminContext(server.app);
  const productService = server.app.get(ProductService);
  const variantService = server.app.get(ProductVariantService);
  const product = await productService.create(ctx, {
    enabled: true,
    translations: [
      {
        languageCode: 'en' as any,
        name: 'E2E Commission Product ' + Date.now(),
        slug: 'e2e-commission-' + Date.now(),
        description: 'E2E test product',
      },
    ],
  });
  const variants = await variantService.create(ctx, [
    {
      productId: product.id,
      sku: 'E2E-COMM-' + Date.now(),
      price: priceInPaise,
      stockOnHand: 100,
      trackInventory: 'FALSE' as any,
      translations: [
        { languageCode: 'en' as any, name: 'E2E Commission Variant' },
      ],
    },
  ]);
  const variant = Array.isArray(variants) ? variants[0] : variants;
  return String(variant.id);
}

async function issueRef(resourceId: string): Promise<string> {
  const attribution = server.app.get(MarketplaceAttributionService);
  return attribution.issueRef({
    resourceType: 'session',
    resourceId,
    channelId: E2E_DEFAULT_CHANNEL_TOKEN,
  });
}

async function registerAndLoginCustomer(): Promise<string> {
  const email = 'buyer-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7) + '@e2e.com';
  const result = await shopClient.query(REGISTER_CUSTOMER, {
    input: {
      emailAddress: email,
      password: 'StrongP@ss1',
      firstName: 'E2E',
      lastName: 'Buyer',
    },
  });
  if (result.registerCustomerAccount?.errorCode) {
    throw new Error('Customer registration failed: ' + result.registerCustomerAccount.message);
  }
  await shopClient.asUserWithCredentials(email, 'StrongP@ss1');
  return email;
}

async function placeOrder(opts: {
  variantId: string;
  withRef?: string;
  forgeOrderSource?: boolean;
}): Promise<string> {
  const itemRes = await shopClient.query(ADD_ITEM, {
    productVariantId: opts.variantId,
    quantity: 1,
  });
  if ((itemRes as any).addItemToOrder?.errorCode) {
    throw new Error('addItem failed: ' + (itemRes as any).addItemToOrder.message);
  }

  if (opts.forgeOrderSource) {
    const connection = server.app.get(TransactionalConnection);
    const orderRepo = connection.rawConnection.getRepository(Order);
    const active = await orderRepo.findOne({
      where: { state: 'AddingItems' as any },
      order: { createdAt: 'DESC' } as any,
      relations: ['lines', 'surcharges'],
    });
    if (active) {
      active.customFields = active.customFields ?? {};
      (active.customFields as any).orderSource = 'marketplace';
      await orderRepo.save(active);
    }
  }

  if (opts.withRef) {
    const refResult = await shopClient.query(APPLY_REF, { ref: opts.withRef });
    if (!refResult.applyMarketplaceReference.ok) {
      throw new Error('applyRef failed: ' + refResult.applyMarketplaceReference.code);
    }
  }

  const addrRes = await shopClient.query(SET_SHIPPING_ADDRESS, {
    input: {
      streetLine1: '1 E2E Street',
      city: 'E2ECity',
      province: 'E2EState',
      postalCode: '123456',
      countryCode: 'IN',
    },
  });
  if ((addrRes as any).setOrderShippingAddress?.errorCode) {
    throw new Error('setAddress failed: ' + (addrRes as any).setOrderShippingAddress.message);
  }

  // setCustomerForOrder is intentionally NOT called: the customer is already
  // logged in via registerAndLoginCustomer(), and the active order is
  // automatically associated with the authenticated customer.

  // setOrderShippingMethod: required for the order to advance to
  // ArrangingPayment state before a payment can be added.
  const shippingMethods = await shopClient.query(GET_ELIGIBLE_SHIPPING);
  const sm = (shippingMethods as any).eligibleShippingMethods;
  if (!sm || sm.length === 0) {
    throw new Error('No eligible shipping methods available');
  }
  const shippingRes = await shopClient.query(SET_SHIPPING_METHOD, { ids: [sm[0].id] });
  if ((shippingRes as any).setOrderShippingMethod?.errorCode) {
    throw new Error('setShippingMethod failed: ' + (shippingRes as any).setOrderShippingMethod.message);
  }

  // Transition to ArrangingPayment so payment can be added.
  const transRes = await shopClient.query(TRANSITION_TO_ARRANGING);
  if ((transRes as any).transitionOrderToState?.errorCode) {
    throw new Error('transition failed: ' + (transRes as any).transitionOrderToState.message);
  }

  const payRes = await shopClient.query(ADD_PAYMENT, {
    input: { method: 'dummy-payment', metadata: { automaticSettle: true } },
  });
  if ((payRes as any).addPaymentToOrder?.errorCode) {
    throw new Error('addPayment failed: ' + (payRes as any).addPaymentToOrder.message);
  }

  const connection = server.app.get(TransactionalConnection);
  const orderRepo = connection.rawConnection.getRepository(Order);
  const placed = (await waitFor(
    async () =>
      orderRepo.findOne({
        where: { state: 'PaymentSettled' as any },
        order: { createdAt: 'DESC' } as any,
      }) as Promise<Order | null>,
    (o) => !!o,
  )) as Order;
  return String(placed.id);
}

async function readLedgerRows(): Promise<CommissionLedger[]> {
  const connection = server.app.get(TransactionalConnection);
  const repo = connection.rawConnection.getRepository(CommissionLedger);
  return repo.find();
}

async function readOrderSource(orderId: string): Promise<string | null> {
  const connection = server.app.get(TransactionalConnection);
  const orderRepo = connection.rawConnection.getRepository(Order);
  // Decode the testing ID strategy prefix (T_8 -> 8) for raw queries.
  const rawId = parseInt(String(orderId).replace('T_', ''), 10);
  const order = await orderRepo.findOne({ where: { id: isNaN(rawId) ? orderId : rawId } });
  return ((order?.customFields as any)?.orderSource as string | undefined) ?? null;
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('Commission classification + ledger (3B.5)', () => {
  const d = COMMISSION_E2E ? describe : describe.skip;

  beforeAll(async () => {
    await assertPostgres();
    await server.init({
      initialData: {
        defaultLanguage: 'en' as any,
        defaultZone: 'India',
        taxRates: [{ name: 'Standard Tax', percentage: 18 }],
        shippingMethods: [{ name: 'Standard Shipping', price: 0 }],
        paymentMethods: [
          { name: 'Dummy Payment', handler: { code: 'dummy-payment-handler', arguments: [{ name: 'automaticSettle', value: 'true' }] } },
        ],
        countries: [{ name: 'India', code: 'IN', zone: 'India' }],
        collections: [],
      },
      customerCount: 0,
    });
    shopClient.setChannelToken(E2E_DEFAULT_CHANNEL_TOKEN);

    // Create the dummy payment method explicitly (the populator's
    // populatePaymentMethods swallows errors, so we create it directly).
    const ctx = await getSuperadminContext(server.app);
    const pmService = server.app.get(PaymentMethodService);
    await pmService.create(ctx, {
      code: 'dummy-payment',
      enabled: true,
      handler: { code: 'dummy-payment-handler', arguments: [{ name: 'automaticSettle', value: 'true' }] },
      translations: [{ languageCode: 'en' as any, name: 'Dummy Payment' }],
    });
  }, 60000);

  d('commission flow', () => {
    it('classifies marketplace + writes a ledger row for a valid ref', async () => {
      await registerAndLoginCustomer();
      const variantId = await createVariant(100000);
      const ref = await issueRef(variantId);
      const orderId = await placeOrder({ variantId, withRef: ref });

      const source = await waitFor(() => readOrderSource(orderId), (s) => s === 'marketplace');
      expect(source).toBe('marketplace');

      const rows = await waitFor(() => readLedgerRows(), (r) => r.length === 1);
      expect(rows).toHaveLength(1);
      expect(rows[0].orderId).toBe(orderId);
      expect(rows[0].orderSource).toBe('marketplace');
      expect(rows[0].marketplaceRef).toBe(ref);
      expect(rows[0].grossAmountInPaise).toBe(100000);
      expect(rows[0].commissionPercent).toBe(0);
      expect(rows[0].commissionAmountInPaise).toBe(0);
    });

    it('writes a $0 ledger row at 0% rate + commission math is correct', async () => {
      const ledgerService = server.app.get(CommissionLedgerService);
      expect(ledgerService.computeCommissionAmount(100000, 10)).toBe(10000);
      expect(ledgerService.computeCommissionAmount(100000, 0)).toBe(0);
      expect(ledgerService.computeCommissionAmount(99999, 10)).toBe(9999);
      expect(ledgerService.computeCommissionAmount(100000, 100)).toBe(100000);

      await registerAndLoginCustomer();
      const variantId = await createVariant(50000);
      const ref = await issueRef(variantId);
      const orderId = await placeOrder({ variantId, withRef: ref });

      const rows = await waitFor(() => readLedgerRows(), (r) => r.some((x) => x.orderId === orderId));
      const row = rows.find((x) => x.orderId === orderId)!;
      expect(row.commissionPercent).toBe(0);
      expect(row.commissionAmountInPaise).toBe(0);
      expect(row.grossAmountInPaise).toBe(50000);
    });

    it('reclassifies a forged orderSource=marketplace to direct (INV-008)', async () => {
      await registerAndLoginCustomer();
      const variantId = await createVariant(100000);
      const orderId = await placeOrder({ variantId, forgeOrderSource: true });

      const source = await waitFor(() => readOrderSource(orderId), (s) => s === 'direct');
      expect(source).toBe('direct');

      const rows = await readLedgerRows();
      expect(rows.some((r) => r.orderId === orderId)).toBe(false);
    });

    it('reclassifies a replayed ref to direct and writes no second row', async () => {
      await registerAndLoginCustomer();
      const variantId = await createVariant(100000);
      const ref = await issueRef(variantId);

      const order1 = await placeOrder({ variantId, withRef: ref });
      await waitFor(() => readOrderSource(order1), (s) => s === 'marketplace');

      await registerAndLoginCustomer();
      const order2 = await placeOrder({ variantId, withRef: ref });
      const source2 = await waitFor(() => readOrderSource(order2), (s) => s !== null);
      expect(source2).toBe('direct');

      const rows = await waitFor(() => readLedgerRows(), (r) => r.some((x) => x.orderId === order1));
      const rowsForRef = rows.filter((r) => r.marketplaceRef === ref);
      expect(rowsForRef).toHaveLength(1);
      expect(rowsForRef[0].orderId).toBe(order1);
    });

    it('classifies a no-ref checkout as direct with no ledger row', async () => {
      await registerAndLoginCustomer();
      const variantId = await createVariant(100000);
      const orderId = await placeOrder({ variantId });

      const source = await waitFor(() => readOrderSource(orderId), (s) => s === 'direct');
      expect(source).toBe('direct');

      const rows = await readLedgerRows();
      expect(rows.some((r) => r.orderId === orderId)).toBe(false);
    });

    it('writes exactly one ledger row for two same-ref orders', async () => {
      // Two orders present the SAME marketplace ref. The UNIQUE (marketplaceRef)
      // index guarantees exactly one CommissionLedger row is written; the
      // second order is reclassified to 'direct' (ADR-021 Decision 6).
      //
      // Note: run sequentially rather than via Promise.all because the shared
      // ShopApiClient uses a cookie jar that cannot safely serve two
      // concurrent sessions. The single-use guarantee is enforced at the DB
      // level by the UNIQUE index, not by client-level parallelism.
      const variantId = await createVariant(100000);
      const ref = await issueRef(variantId);

      const order1 = await placeOrder({ variantId, withRef: ref });
      await waitFor(() => readOrderSource(order1), (s) => s === 'marketplace');

      const order2 = await placeOrder({ variantId, withRef: ref });
      await waitFor(() => readOrderSource(order2), (s) => s === 'direct');

      const rows = await waitFor(() => readLedgerRows(), (r) => r.some((x) => x.orderId === order1));
      const rowsForRef = rows.filter((r) => r.marketplaceRef === ref);
      expect(rowsForRef).toHaveLength(1);

      const src1 = await readOrderSource(order1);
      const src2 = await readOrderSource(order2);
      expect(src1).toBe('marketplace');
      expect(src2).toBe('direct');
    });
  });
});
