/**
 * Commission reconciliation surface — R3 (Phase 3B reconciliation gate).
 *
 * Consumer-level verification of the read-only reconciliation contract
 * (docs/implementation/commission-reconciliation.md §8):
 *
 *   R3.1 MATCH            — marketplace order + ledger row align exactly
 *   R3.2 MISSING          — marketplace order with its ledger row removed
 *   R3.3 REPLAYED_REF     — ref consumed by order A, replayed on order B (informational)
 *   R3.4 DIRECT excluded  — non-marketplace order is out of the expected population
 *   R3.5 ZERO_RATE        — 0% row with GMV > 0 => effective commission 0 (valid fact)
 *   R3.6 AMOUNT_MISMATCH  — corrupt only the stored amount (historical-row integrity)
 *   R3.7 CHANNEL_ISOLATION— both directions + SuperAdmin allChannels + tenant-admin clamp
 *
 * Every case drives the full path:
 *   Admin GraphQL  -> @Allow(MarketplaceCommissionRead)
 *                 -> MarketplaceCommissionReconciliationResolver
 *                 -> CommissionReconciliationService
 *                 -> PostgreSQL (Order + CommissionLedger)
 *
 * Infra-gated: requires Postgres. No Elasticsearch or Redis needed.
 *
 * Run:  RECONCILIATION_E2E=true npm run test:e2e:reconciliation
 *
 * Isolation: dedicated Postgres schema (e2e_commission). Each case provisions its
 * OWN fresh channel + marketplace order via the proven tenant fixture, so exact
 * counts are deterministic and order-independent — reconciliation never depends
 * on rows left behind by a previous test.
 *
 * Read-only invariant is asserted inline (R3.1 ledger snapshot; R3.6 stored
 * amount is NOT rewritten by reconciliation — observation, not repair).
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
  Administrator,
  Channel,
  DefaultLogger,
  LogLevel,
  NativeAuthenticationMethod,
  Order,
  PasswordCipher,
  PaymentMethodService,
  Permission,
  ProductService,
  ProductVariantService,
  Role,
  RoleService,
  TransactionalConnection,
  User,
  dummyPaymentHandler,
  mergeConfig,
} from '@vendure/core';
import { beforeAll, describe, expect, it } from 'vitest';
import { getSuperadminContext } from '@vendure/testing/lib/utils/get-superadmin-context';

import { TenantPlugin } from '../../tenant-plugin/tenant-plugin.plugin';
// registerNewTenant assigns TENANT_ADMIN_ROLE_PERMISSIONS which includes
// BBB/CMS/Reviews granular permissions — those plugins must be registered or
// RoleService rejects the role as invalid (error.permission-invalid).
import { BigBlueButtonPlugin } from '../../bigbluebutton-plugin';
import { CmsPlugin } from '../../cms/cms.plugin';
import { ReviewsPlugin } from '../../reviews/reviews-plugin';
import { MarketplaceIndexerPlugin } from '../marketplace-indexer.plugin';
import { SchemaPostgresInitializer } from '../../tenant-plugin/e2e/schema-postgres-initializer';
import { CommissionLedger } from '../entities/commission-ledger.entity';
import { CommissionReconciliationService } from '../services/commission-reconciliation.service';
import { MarketplaceAttributionService } from '../services/marketplace-attribution.service';

registerInitializer('postgres', new SchemaPostgresInitializer());

const RECONCILIATION_E2E = process.env.RECONCILIATION_E2E === 'true';

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
    apiOptions: { port: 3077 },
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
    plugins: [TenantPlugin, MarketplaceIndexerPlugin, BigBlueButtonPlugin, CmsPlugin, ReviewsPlugin],
  }),
);

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

async function createVariant(priceInPaise: number): Promise<{ variantId: string; productId: string }> {
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
  return { variantId: String(variant.id), productId: String(product.id) };
}

async function issueRef(resourceId: string, channelToken: string): Promise<string> {
  const attribution = server.app.get(MarketplaceAttributionService);
  return attribution.issueRef({
    resourceType: 'session',
    resourceId,
    channelId: channelToken,
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

// ---- R3: reconciliation surface (gated by RECONCILIATION_E2E) ----
const RECONCILE = gql`
  query Reconcile($allChannels: Boolean) {
    commissionReconciliation(allChannels: $allChannels) {
      channelId
      financials { commissionLedgerOrderCount marketplaceGmvInPaise commissionEarnedInPaise zeroRateRowCount effectiveCommissionPercent }
      reconciliation { marketplaceOrdersExpected ledgerRowsFound missingCount replayedRefCount amountMismatchCount orphanLedgerRowCount rateDriftCount }
    }
  }
`;

async function runRecon(allChannels?: boolean | null, channelToken?: string): Promise<any> {
  await adminClient.setChannelToken(channelToken ?? '');
  const r = await adminClient.query(RECONCILE, { allChannels: allChannels ?? null });
  return (r as any).commissionReconciliation;
}

/** Generic raw-TypeORM repo accessor (bypasses the Vendure ID strategy for direct row surgery). */
const rawRepo = (entity: any): any =>
  server.app.get(TransactionalConnection).rawConnection.getRepository(entity);

/** Provision a brand-new tenant channel via the proven registerNewTenant flow. */
async function provisionChannel(prefix: string): Promise<{ channelId: string; token: string }> {
  shopClient.setChannelToken(E2E_DEFAULT_CHANNEL_TOKEN);
  const email = `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@e2e.com`;
  const result = await shopClient.query(REGISTER_NEW_TENANT, {
    input: {
      businessName: `${prefix}-${Date.now()}`,
      firstName: 'E2E',
      lastName: 'Tenant',
      emailAddress: email,
      password: 'StrongP@ss1',
      timezone: 'Asia/Kolkata',
    },
  });
  const reg = (result as any).registerNewTenant;
  if (!reg || !reg.channelId) {
    throw new Error('provisionChannel failed: ' + JSON.stringify(result));
  }
  return { channelId: String(reg.channelId).replace(/^T_/, ''), token: reg.channelToken };
}

interface OrderInChannelOpts {
  gross?: number;
  variantId?: string;
  productId?: string;
  ref?: string;
  expectSource?: 'marketplace' | 'direct';
}

/** Place an order in the given channel, controlling classification state explicitly. */
async function orderInChannel(
  ch: { channelId: string; token: string },
  opts: OrderInChannelOpts = {},
): Promise<{ orderId: string; variantId: string }> {
  shopClient.setChannelToken(ch.token);
  await registerAndLoginCustomer();

  let variantId = opts.variantId;
  let productId = opts.productId;
  if (!variantId || !productId) {
    const v = await createVariant(opts.gross ?? 100000);
    variantId = v.variantId;
    productId = v.productId;
  }

  const ctx = await getSuperadminContext(server.app);
  await server.app.get(ProductService).assignProductsToChannel(ctx, {
    channelId: ch.channelId,
    productIds: [String(productId)],
  });

  const ref = opts.ref !== undefined
    ? opts.ref
    : opts.expectSource === 'direct'
      ? undefined
      : await issueRef(variantId, ch.token);

  const orderId = await placeOrder({ variantId, withRef: ref });
  const want = opts.expectSource ?? 'marketplace';
  await waitFor(() => readOrderSource(orderId), (s) => s === want);
  return { orderId, variantId };
}

/** Create a non-SuperAdmin administrator with the reconciliation read permission, scoped to one channel. */
async function createReconAdmin(
  ch: { channelId: string; token: string },
): Promise<{ email: string; password: string }> {
  const ctx = await getSuperadminContext(server.app);
  const conn = server.app.get(TransactionalConnection);
  const email = `recon-admin-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@e2e.com`;
  const password = 'StrongP@ss1';

  const role = await server.app.get(RoleService).create(ctx, {
    code: `recon-admin-${Date.now()}`,
    description: 'R3 reconciliation channel-scoped admin',
    // CrudPermissionDefinition generates operation-prefixed names:
    // ReadMarketplaceCommission (matches marketplaceCommissionPermission.Read).
    permissions: [Permission.Authenticated, 'ReadMarketplaceCommission'] as Permission[],
  });

  const roleRepo = conn.getRepository(ctx, Role);
  const roleEntity = await roleRepo.findOne({ where: { id: role.id }, relations: ['channels'] });
  const channelEntity = await conn.getRepository(ctx, Channel).findOne({ where: { id: ch.channelId } });
  if (!roleEntity || !channelEntity) {
    throw new Error('createReconAdmin: role or channel not found');
  }
  roleEntity.channels = [channelEntity];
  await roleRepo.save(roleEntity);

  const userRepo = conn.getRepository(ctx, User);
  const savedUser = await userRepo.save(userRepo.create({ identifier: email, verified: true }));

  const hashed = await server.app.get(PasswordCipher).hash(password);
  const nativeRepo = conn.getRepository(ctx, NativeAuthenticationMethod);
  const native = nativeRepo.create({ identifier: email, passwordHash: hashed });
  native.user = savedUser as any;
  await nativeRepo.save(native);

  const userWithRoles = await userRepo.findOne({ where: { id: savedUser.id }, relations: ['roles'] });
  if (userWithRoles) {
    userWithRoles.roles = [roleEntity];
    await userRepo.save(userWithRoles);
  }

  const adminRepo = conn.getRepository(ctx, Administrator);
  await adminRepo.save(adminRepo.create({
    firstName: 'Recon',
    lastName: 'Admin',
    emailAddress: email,
    user: savedUser,
  }));

  return { email, password };
}

describe('Commission reconciliation surface (R3)', () => {
  const d = RECONCILIATION_E2E ? describe : describe.skip;

  d('reconciliation cases', () => {
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
      // Set the default channel token BEFORE logging in as SuperAdmin —
      // asSuperAdmin() performs a login that needs a valid channel token
      // (same requirement documented in tenant-plugin.e2e-spec.ts).
      adminClient.setChannelToken(E2E_DEFAULT_CHANNEL_TOKEN);
      await adminClient.asSuperAdmin();

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
    }, 120000);

    it('R3.1 MATCH + exact count semantics (commissionLedgerOrderCount vs marketplaceOrdersExpected)', async () => {
      const ch = await provisionChannel('recon-match');
      await orderInChannel(ch, { gross: 100000, expectSource: 'marketplace' });
      const ledgerBefore = await readLedgerRows();

      const report = await runRecon(null, ch.token);

      expect(report.reconciliation.marketplaceOrdersExpected).toBe(1);
      expect(report.reconciliation.ledgerRowsFound).toBe(1);
      expect(report.financials.commissionLedgerOrderCount).toBe(1);
      expect(report.reconciliation.missingCount).toBe(0);
      expect(report.reconciliation.replayedRefCount).toBe(0);
      expect(report.reconciliation.amountMismatchCount).toBe(0);
      expect(report.reconciliation.orphanLedgerRowCount).toBe(0);

      // Financial aggregates are ledger-derived.
      expect(report.financials.marketplaceGmvInPaise).toBe(100000);
      expect(report.financials.commissionEarnedInPaise).toBe(0); // env rate = 0
      expect(report.financials.zeroRateRowCount).toBe(1);
      expect(report.financials.effectiveCommissionPercent).toBe(0); // GMV > 0 => 0%, not null

      // Read-only: reconciliation did not touch the ledger.
      expect(await readLedgerRows()).toEqual(ledgerBefore);
    });

    it('R3.2 MISSING — the financially dangerous class', async () => {
      const ch = await provisionChannel('recon-missing');
      const { orderId } = await orderInChannel(ch, { gross: 100000, expectSource: 'marketplace' });

      const rows = await readLedgerRows();
      const victim = rows.find((r) => r.orderId === orderId)!;
      await rawRepo(CommissionLedger).delete(victim.id);

      const report = await runRecon(null, ch.token);

      expect(report.reconciliation.marketplaceOrdersExpected).toBe(1);
      expect(report.reconciliation.ledgerRowsFound).toBe(0);
      expect(report.financials.commissionLedgerOrderCount).toBe(0);
      expect(report.reconciliation.missingCount).toBe(1);
    });

    it('R3.3 REPLAYED_REF — ref consumed by A, replayed on B (informational)', async () => {
      const ch = await provisionChannel('recon-replay');
      const v = await createVariant(100000);
      const ref = await issueRef(v.variantId, ch.token);

      await orderInChannel(ch, { variantId: v.variantId, productId: v.productId, ref, expectSource: 'marketplace' });
      await orderInChannel(ch, { variantId: v.variantId, productId: v.productId, ref, expectSource: 'direct' });

      const rows = await readLedgerRows();
      const rowsForRef = rows.filter((r) => r.marketplaceRef === ref);
      expect(rowsForRef).toHaveLength(1);

      const report = await runRecon(null, ch.token);
      expect(report.reconciliation.marketplaceOrdersExpected).toBe(1); // only A
      expect(report.reconciliation.ledgerRowsFound).toBe(1);
      expect(report.reconciliation.replayedRefCount).toBe(1);
    });

    it('R3.4 DIRECT excluded from the expected population', async () => {
      const ch = await provisionChannel('recon-direct');
      await orderInChannel(ch, { gross: 100000, expectSource: 'direct' });

      const report = await runRecon(null, ch.token);
      expect(report.reconciliation.marketplaceOrdersExpected).toBe(0);
      expect(report.reconciliation.ledgerRowsFound).toBe(0);
      expect(report.reconciliation.missingCount).toBe(0);
    });
    it('R3.5 ZERO_RATE — 0% row with GMV > 0 is a valid fact (effective 0, not null)', async () => {
      const ch = await provisionChannel('recon-zero');
      await orderInChannel(ch, { gross: 50000, expectSource: 'marketplace' });

      const report = await runRecon(null, ch.token);
      expect(report.financials.zeroRateRowCount).toBe(1);
      expect(report.financials.marketplaceGmvInPaise).toBe(50000);
      expect(report.financials.commissionEarnedInPaise).toBe(0);
      expect(report.financials.effectiveCommissionPercent).toBe(0);
      expect(report.reconciliation.amountMismatchCount).toBe(0);
      expect(report.reconciliation.missingCount).toBe(0);
    });

    it('R3.6 AMOUNT_MISMATCH — stored-row integrity, and reconciliation never rewrites it', async () => {
      const ch = await provisionChannel('recon-mismatch');
      const { orderId } = await orderInChannel(ch, { gross: 100000, expectSource: 'marketplace' });

      const rows = await readLedgerRows();
      const victim = rows.find((r) => r.orderId === orderId)!;
      await rawRepo(CommissionLedger).update(victim.id, { commissionAmountInPaise: 999 });

      const report = await runRecon(null, ch.token);
      expect(report.reconciliation.amountMismatchCount).toBe(1);

      // Read-only: the stored value was NOT rewritten by reconciliation.
      const after = (await readLedgerRows()).find((r) => r.orderId === orderId)!;
      expect(after.commissionAmountInPaise).toBe(999);
    });

    it('R3.7 CHANNEL_ISOLATION — both directions + SuperAdmin allChannels + tenant-admin clamp', async () => {
      // allChannels is global; baseline the report first so the exact delta
      // assertion is deterministic regardless of what earlier cases left behind.
      // NOTE: ledgerRowsFound baseline ≠ marketplaceOrdersExpected baseline —
      // R3.2 deliberately deleted a ledger row for a still-marketplace order,
      // so both counters must be baselined independently.
      const baselineReport = await runRecon(true);
      const baselineOrders = baselineReport.reconciliation.marketplaceOrdersExpected;
      const baselineLedger = baselineReport.reconciliation.ledgerRowsFound;

      const chA = await provisionChannel('recon-iso-a');
      const chB = await provisionChannel('recon-iso-b');
      await orderInChannel(chA, { gross: 100000, expectSource: 'marketplace' });
      await orderInChannel(chB, { gross: 200000, expectSource: 'marketplace' });

      // SuperAdmin scoped to channel A sees A only.
      const scopedA = await runRecon(null, chA.token);
      expect(scopedA.reconciliation.marketplaceOrdersExpected).toBe(1);
      expect(scopedA.reconciliation.ledgerRowsFound).toBe(1);

      // SuperAdmin scoped to channel B sees B only.
      const scopedB = await runRecon(null, chB.token);
      expect(scopedB.reconciliation.marketplaceOrdersExpected).toBe(1);
      expect(scopedB.reconciliation.ledgerRowsFound).toBe(1);

      // SuperAdmin allChannels:true sees A + B on top of the global baseline.
      const all = await runRecon(true);
      expect(all.reconciliation.marketplaceOrdersExpected).toBe(baselineOrders + 2);
      expect(all.reconciliation.ledgerRowsFound).toBe(baselineLedger + 2);

      // Channel A tenant admin with allChannels:true is CLAMPED to A (service-side).
      const adminA = await createReconAdmin(chA);
      await adminClient.asUserWithCredentials(adminA.email, adminA.password);
      const clamped = await runRecon(true, chA.token);
      expect(clamped.reconciliation.marketplaceOrdersExpected).toBe(1);
      expect(clamped.reconciliation.ledgerRowsFound).toBe(1);
    });
  });
});
