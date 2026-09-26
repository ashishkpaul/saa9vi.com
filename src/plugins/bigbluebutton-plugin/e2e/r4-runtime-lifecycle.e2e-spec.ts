/**
 * Slice 10 / R4 — runtime evidence for the commercial → payment → entitlement →
 * BBB → usage-ledger lifecycle.
 *
 * Infrastructure-gated: requires Postgres. Run:
 *   R4_E2E=true npx vitest run --config vitest.config.mts \
 *     src/plugins/bigbluebutton-plugin/e2e/r4-runtime-lifecycle.e2e-spec.ts
 *
 * WHAT THIS PROVES (see docs/implementation/saa9vi-comprehensive-integration-and-commercial-plan.md §3.10/§5.4)
 *
 * The shipped lifecycle has THREE separate writers with THREE different triggers.
 * There is no single chain from PaymentSettled to a subscription grant:
 *
 *   (A) PaymentSettled  → BbbOrderFulfillmentListener → BbbEntitlement(source='purchase')
 *       (order-fulfillment.listener.ts:37-45)             — NO capacity grant on this path
 *   (B) PaymentSettled → bbbOrderProcess.onTransitionEnd → automatic fulfilment →
 *       bbbFulfillmentHandler → BbbCapacityGrant(sourceType='order')
 *       (config/bbb-fulfillment.ts, Option A / R3 decision 1, 2026-09-26).
 *       The Admin addFulfillmentToOrder path still exists and is idempotent
 *       for an already-fulfilled order (asserted in R4-02).
 *   (C) SubscriptionRenewedEvent → BbbSubscriptionListener → BbbCapacityGrant(sourceType='subscription')
 *       (listeners/bbb-subscription.listener.ts:17-59)
 *
 * Every paid scenario here goes through ONE helper — checkoutAndExplicitlySettle() —
 * because `dummyPaymentHandler.automaticSettle` defaults to FALSE
 * (node_modules/@vendure/core/dist/config/payment/dummy-payment-method-handler.js:37,78),
 * so checkout alone stops at PaymentAuthorized and the PaymentSettled-derived
 * lifecycle never fires. The helper asserts an explicit Admin settlePayment and
 * that the returned Payment.state is actually "Settled" — not merely that the
 * mutation returned without a GraphQL error.
 *
 * FIXTURE RULE (plan §3.2)
 *   - Business/commercial state (tenant, admin, product, variant, customer,
 *     order, payment, settlement, fulfilment, entitlement, BbbOrganization,
 *     BbbServer, BbbCapacityGrant, session/template) → public GraphQL only.
 *   - ONE narrow carve-out: the BBB *meeting* fixture (ACTIVE + backdated
 *     provisionedAt + grantId) which no Admin mutation can construct —
 *     CreateBbbMeetingInput/UpdateBbbMeetingInput expose no state/provisionedAt/
 *     grantId. Any row created that way is labelled "service-layer fixture"
 *     in the assertions below. No direct SQL is used anywhere in this file.
 *   - The BBB outbound HTTP transport is stubbed by property replacement on the
 *     injected service (the existing precedent:
 *     bbb-meeting-concurrency.e2e-spec.ts:165-170, 330-334). Every application
 *     layer stays real: authorization, entitlement checks, role routing, join
 *     URL construction and the provisioning state machine.
 */

import 'reflect-metadata';
import 'dotenv/config';
import net from 'net';
import gql from 'graphql-tag';
import {
  createTestEnvironment,
  E2E_DEFAULT_CHANNEL_TOKEN,
  registerInitializer,
  testConfig,
} from '@vendure/testing';
import {
  Channel,
  DefaultLogger,
  dummyPaymentHandler,
  EventBus,
  LanguageCode,
  LogLevel,
  mergeConfig,
  PaymentMethodService,
  TransactionalConnection,
  Fulfillment,
} from '@vendure/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getSuperadminContext } from '@vendure/testing/lib/utils/get-superadmin-context';

import { TenantPlugin } from '../../tenant-plugin/tenant-plugin.plugin';
import { BigBlueButtonPlugin } from '../bigbluebutton.plugin';
import { CmsPlugin } from '../../cms/cms.plugin';
import { ReviewsPlugin } from '../../reviews/reviews-plugin';
import { SubscriptionPlugin } from '../../subscription/subscription.plugin';
import { SchemaPostgresInitializer } from '../../tenant-plugin/e2e/schema-postgres-initializer';
import { E2E_INITIAL_DATA } from '../../tenant-plugin/e2e/fixtures/e2e-initial-data';
import { BbbEntitlement } from '../entities/bbb-entitlement.entity';
import { BbbOrganization } from '../entities/bbb-organization.entity';
import { BbbCapacityGrant } from '../entities/bbb-capacity-grant.entity';
import { BbbUsageLedger } from '../entities/bbb-usage-ledger.entity';
import { BbbMeeting } from '../entities/bbb-meeting.entity';
import { BbbScheduledSession } from '../entities/bbb-scheduled-session.entity';
import { BbbServer } from '../entities/bbb-server.entity';
import { BbbProvisioningWorkerService } from '../services/bbb-provisioning-worker.service';
import { BbbMeetingService } from '../services/bbb-meeting.service';
import { BbbApiService } from '../services/bbb-api.service';
import { BbbReconciliationService } from '../services/bbb-reconciliation.service';
import { BbbEntitlementService } from '../services/bbb-entitlement.service';
import { SubscriptionRenewedEvent } from '../../subscription/events/subscription.events';
import { OrganizationSubscription } from '../../subscription/entities/organization-subscription.entity';
import { MEETING_STATE } from '../constants';

registerInitializer('postgres', new SchemaPostgresInitializer());

const R4_E2E = process.env.R4_E2E === 'true';

async function assertPostgres(): Promise<void> {
  const host = process.env.DB_HOST ?? '127.0.0.1';
  const port = Number(process.env.DB_PORT ?? 5432);
  await new Promise<void>((resolve, reject) => {
    const sock = net.connect(port, host);
    sock.once('connect', () => {
      sock.destroy();
      resolve();
    });
    sock.once('error', (err) => reject(err));
  });
}

export const R4_SCHEMA = 'e2e_r4_lifecycle';

const { server, adminClient, shopClient } = createTestEnvironment(
  mergeConfig(testConfig, {
    apiOptions: { port: 3092 },
    logger: new DefaultLogger({ level: LogLevel.Warn }),
    authOptions: { requireVerification: false },
    dbConnectionOptions: {
      type: 'postgres',
      host: process.env.DB_HOST ?? '127.0.0.1',
      port: Number(process.env.DB_PORT ?? 5432),
      database: process.env.DB_NAME ?? 'vendure',
      username: process.env.DB_USERNAME ?? 'vendure_user',
      password: process.env.DB_PASSWORD ?? '',
      // Isolated throwaway schema — never touches dev/production data.
      // `synchronize` is permitted HERE ONLY (plan §3.3); the production
      // migration path is untouched and no migration is added by R4.
      schema: R4_SCHEMA,
      synchronize: true,
    },
    paymentOptions: {
      paymentMethodHandlers: [dummyPaymentHandler],
    },
    plugins: [
      TenantPlugin,
      BigBlueButtonPlugin,
      CmsPlugin,
      ReviewsPlugin,
      SubscriptionPlugin.init({}) as any,
    ],
  }),
);

// ─── GraphQL documents ──────────────────────────────────────────────────────
// All business-state mutation below goes through these public surfaces.

const REGISTER_CUSTOMER = gql`
  mutation RegisterCustomer($input: RegisterCustomerInput!) {
    registerCustomerAccount(input: $input) {
      ... on Success {
        success
      }
      ... on ErrorResult {
        errorCode
        message
      }
    }
  }
`;

const LOGIN = gql`
  mutation Login($emailAddress: String!, $password: String!) {
    login(username: $emailAddress, password: $password) {
      ... on CurrentUser {
        id
        identifier
      }
      ... on ErrorResult {
        errorCode
        message
      }
    }
  }
`;

const ACTIVE_CUSTOMER = gql`
  query ShopActiveCustomer {
    activeCustomer {
      id
      emailAddress
    }
  }
`;

const ADD_ITEM = gql`
  mutation AddItem($productVariantId: ID!, $quantity: Int!) {
    addItemToOrder(productVariantId: $productVariantId, quantity: $quantity) {
      ... on Order {
        id
        code
        state
      }
      ... on ErrorResult {
        errorCode
        message
      }
    }
  }
`;

const SET_SHIPPING_ADDRESS = gql`
  mutation SetAddress($input: CreateAddressInput!) {
    setOrderShippingAddress(input: $input) {
      ... on Order {
        id
        state
      }
      ... on ErrorResult {
        errorCode
        message
      }
    }
  }
`;

const ELIGIBLE_SHIPPING = gql`
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
      ... on Order {
        id
        state
      }
      ... on ErrorResult {
        errorCode
        message
      }
    }
  }
`;

const TRANSITION_TO_ARRANGING = gql`
  mutation TransitionArranging {
    transitionOrderToState(state: "ArrangingPayment") {
      ... on Order {
        id
        state
      }
      ... on ErrorResult {
        errorCode
        message
      }
    }
  }
`;

const ADD_PAYMENT = gql`
  mutation AddPayment($input: PaymentInput!) {
    addPaymentToOrder(input: $input) {
      ... on Order {
        id
        code
        state
      }
      ... on ErrorResult {
        errorCode
        message
      }
    }
  }
`;

/** Admin: resolve the payment id created by checkout. Never invented. */
const ADMIN_ORDER_PAYMENTS = gql`
  query AdminOrderPayments($id: ID!) {
    order(id: $id) {
      id
      code
      state
      payments {
        id
        state
        amount
        method
      }
    }
  }
`;

/**
 * The authoritative settlement mechanism. The response is asserted on the
 * returned Payment's `state` — NOT on the mere absence of a GraphQL error.
 */
const SETTLE_PAYMENT = gql`
  mutation SettlePayment($id: ID!) {
    settlePayment(id: $id) {
      ... on Payment {
        id
        state
        amount
      }
      ... on SettlePaymentError {
        errorCode
        message
      }
      ... on PaymentStateTransitionError {
        errorCode
        message
      }
      ... on OrderStateTransitionError {
        errorCode
        message
      }
    }
  }
`;

const CREATE_PRODUCT = gql`
  mutation CreateProduct($input: CreateProductInput!) {
    createProduct(input: $input) {
      id
      name
    }
  }
`;

const CREATE_PRODUCT_VARIANTS = gql`
  mutation CreateVariants($input: [CreateProductVariantInput!]!) {
    createProductVariants(input: $input) {
      id
      sku
      price
    }
  }
`;

const REGISTER_NEW_TENANT = gql`
  mutation RegisterNewTenant($input: RegisterTenantInput!) {
    registerNewTenant(input: $input) {
      channelId
      channelToken
      administratorId
    }
  }
`;

/** Public catalogue probe — used to seed the Free Basic plan idempotently. */
const AVAILABLE_PLANS = gql`
  query R4AvailablePlans {
    availableSubscriptionPlans {
      id
      slug
      name
    }
  }
`;

/** Admin: Free Basic must exist BEFORE tenant registration (ADR-044 §4). */
const CREATE_SUBSCRIPTION_PLAN = gql`
  mutation CreateSubscriptionPlan($input: SubscriptionPlanInput!) {
    createSubscriptionPlan(input: $input) {
      id
      slug
      isActive
    }
  }
`;

/** Admin: order lines, needed to fulfil explicitly. */
const ADMIN_ORDER_LINES = gql`
  query AdminOrderLines($id: ID!) {
    order(id: $id) {
      id
      state
      lines {
        id
        quantity
      }
    }
  }
`;

const CREATE_BBB_SERVER = gql`
  mutation CreateBbbServer($input: CreateBbbServerInput!) {
    createBbbServer(input: $input) {
      id
      name
      apiUrl
      enabled
      healthy
    }
  }
`;

const CREATE_BBB_ORGANIZATION = gql`
  mutation CreateBbbOrganization($input: CreateBbbOrganizationInput!) {
    createBbbOrganization(input: $input) {
      id
      channelId
      slug
      name
    }
  }
`;

const CREATE_BBB_SESSION_TEMPLATE = gql`
  mutation CreateBbbSessionTemplate($input: CreateBbbSessionTemplateInput!) {
    createBbbSessionTemplate(input: $input) {
      id
      name
      productVariantId
    }
  }
`;

const CREATE_SESSIONS_FROM_TEMPLATE = gql`
  mutation CreateSessions($templateId: ID!, $startTimes: [String!]!) {
    createSessionsFromTemplate(templateId: $templateId, startTimes: $startTimes) {
      id
      title
      status
      productVariantId
      startTime
      endTime
    }
  }
`;

const PUBLISH_BBB_SCHEDULED_SESSION = gql`
  mutation PublishSession($id: ID!) {
    publishBbbScheduledSession(id: $id) {
      id
      status
    }
  }
`;

const ADD_BBB_MEMBER = gql`
  mutation AddBbbMember($input: AddBbbMemberInput!) {
    addBbbMember(input: $input) {
      id
      role
      customerId
    }
  }
`;

const SHOP_START_SESSION = gql`
  mutation StartScheduledSession($sessionId: ID!) {
    startScheduledSession(sessionId: $sessionId) {
      id
      status
      activeMeetingId
      joinUrl
    }
  }
`;

const SHOP_JOIN_MEETING = gql`
  mutation BbbJoinMeeting($meetingId: ID!, $participantName: String!) {
    bbbJoinMeeting(meetingId: $meetingId, participantName: $participantName)
  }
`;

/** Channel-scoped read — works regardless of the meeting's lifecycle state. */
const MY_BBB_MEETINGS = gql`
  query MyBbbMeetings {
    myBbbMeetings {
      items {
        id
        title
      }
      totalItems
    }
  }
`;

const ADD_FULFILLMENT = gql`
  mutation AddFulfillment($input: FulfillOrderInput!) {
    addFulfillmentToOrder(input: $input) {
      ... on Fulfillment {
        id
        state
        method
      }
      ... on ErrorResult {
        errorCode
        message
      }
      ... on FulfillmentStateTransitionError {
        transitionError
        message
      }
      ... on CreateFulfillmentError {
        fulfillmentHandlerError
        message
      }
    }
  }
`;

// ─── Helpers ────────────────────────────────────────────────────────────────

/** GraphQL ids arrive encoded (T_<id>); raw DB rows use the decoded form. */
const decode = (id: unknown): string => String(id).replace(/^T_/, '');

function rawConn(): any {
  return server.app.get(TransactionalConnection).rawConnection;
}

function fail(label: string, payload: unknown): never {
  throw new Error(`${label}: ${JSON.stringify(payload)}`);
}

/** Re-encode a raw DB id for the GraphQL surface (TestingEntityIdStrategy). */
const encode = (id: unknown): string =>
  String(id).startsWith('T_') ? String(id) : `T_${id}`;

/**
 * Poll-until-true with a bounded timeout. The timeout error carries the last
 * observed value so a failure is diagnosable without re-running.
 * (Follows the G3 helper, bbb-usage-ledger.e2e-spec.ts:93-104.)
 */
async function waitFor<T>(
  probe: () => Promise<T>,
  pred: (v: T) => boolean,
  label: string,
  timeoutMs = 15_000,
  stepMs = 200,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let last = await probe();
  while (!pred(last)) {
    if (Date.now() > deadline) {
      throw new Error(
        `waitFor timed out after ${timeoutMs}ms waiting for ${label}; last observed = ${JSON.stringify(last)}`,
      );
    }
    await new Promise((r) => setTimeout(r, stepMs));
    last = await probe();
  }
  return last;
}

/**
 * Like waitFor, but the probe is allowed to return null/undefined and the
 * resolved value is narrowed to non-null — so callers never see
 * "possibly null" on a value the predicate already proved is present.
 */
async function waitForNotNull<T>(
  probe: () => Promise<T | null | undefined>,
  label: string,
  timeoutMs = 15_000,
  stepMs = 200,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let last = await probe();
  while (last == null) {
    if (Date.now() > deadline) {
      throw new Error(
        `waitForNotNull timed out after ${timeoutMs}ms waiting for ${label}`,
      );
    }
    await new Promise((r) => setTimeout(r, stepMs));
    last = await probe();
  }
  return last;
}

/**
 * Registers a customer on the currently-set Shop channel and logs them in.
 * Returns the RAW (decoded) customer id — the form persisted on
 * BbbEntitlement.customerId by BbbOrderFulfillmentListener.
 */
async function registerAndLoginCustomer(
  email: string,
  password: string,
): Promise<string> {
  const reg: any = await shopClient.query(REGISTER_CUSTOMER, {
    input: {
      emailAddress: email,
      firstName: 'R4',
      lastName: 'Learner',
      password,
    },
  });
  if (reg.registerCustomerAccount?.errorCode) {
    fail('registerCustomerAccount', reg.registerCustomerAccount);
  }
  const login: any = await shopClient.query(LOGIN, {
    emailAddress: email,
    password,
  });
  if (login.login?.errorCode || !login.login?.id) {
    fail('login', login.login);
  }
  const me: any = await shopClient.query(ACTIVE_CUSTOMER);
  if (!me.activeCustomer?.id) fail('activeCustomer', me);
  return decode(me.activeCustomer.id);
}

/** Creates the dummy payment method with automaticSettle EXPLICITLY false. */
async function createDummyPaymentMethod(automaticSettle: boolean): Promise<void> {
  const ctx = await getSuperadminContext(server.app);
  const pmService = server.app.get(PaymentMethodService);
  await pmService.create(ctx, {
    code: 'dummy-payment',
    enabled: true,
    handler: {
      code: 'dummy-payment-handler',
      // `automaticSettle` is a required boolean handler arg (default false).
      // R4 sets it explicitly so the Authorized → Settled step is ours.
      arguments: [
        { name: 'automaticSettle', value: automaticSettle ? 'true' : 'false' },
      ],
    },
    translations: [{ languageCode: LanguageCode.en, name: 'Dummy Payment' }],
  });
}

/** Product + variant via the Admin API (business state → GraphQL). */
async function createProductAndVariant(price: number): Promise<string> {
  const stamp = Date.now();
  const p: any = await adminClient.query(CREATE_PRODUCT, {
    input: {
      enabled: true,
      translations: [
        {
          languageCode: LanguageCode.en,
          name: `R4 Product ${stamp}`,
          slug: `r4-product-${stamp}`,
          description: 'Slice 10 R4 runtime evidence product',
        },
      ],
    },
  });
  if (!p.createProduct?.id) fail('createProduct', p);
  const v: any = await adminClient.query(CREATE_PRODUCT_VARIANTS, {
    input: [
      {
        productId: p.createProduct.id,
        enabled: true,
        sku: `R4-SKU-${stamp}`,
        price,
        stockOnHand: 100,
        translations: [
          { languageCode: LanguageCode.en, name: `R4 Variant ${stamp}` },
        ],
      },
    ],
  });
  const variant = v.createProductVariants?.[0];
  if (!variant?.id) fail('createProductVariants', v);
  return decode(variant.id);
}

/** BbbOrganization for the current (default) channel, via the Admin API. */
async function createOrganization(
  slugSuffix: string,
): Promise<{ id: string; channelId: string }> {
  const ctx = await getSuperadminContext(server.app);
  const channelId = String(ctx.channelId);
  const org: any = await adminClient.query(CREATE_BBB_ORGANIZATION, {
    input: {
      channelId,
      slug: `r4-org-${slugSuffix}-${Date.now()}`,
      name: `R4 Org ${slugSuffix} ${Date.now()}`,
      concurrentMeetingLimit: 5,
    },
  });
  if (!org.createBbbOrganization?.id) fail('createBbbOrganization', org);
  return { id: decode(org.createBbbOrganization.id), channelId };
}

/**
 * Session linked to `productVariantId` (the variant the learner buys), in
 * SCHEDULED status and inside its time window so it can be started.
 * Template → sessions is the ONLY GraphQL path that sets
 * BbbScheduledSession.productVariantId (see BbbScheduledSessionService:519).
 */
async function createScheduledSessionForVariant(
  organizationId: string,
  productVariantId: string,
): Promise<string> {
  const t: any = await adminClient.query(CREATE_BBB_SESSION_TEMPLATE, {
    input: {
      organizationId,
      name: `R4 Template ${Date.now()}`,
      defaultTitle: `R4 Live Class ${Date.now()}`,
      durationMinutes: 60,
      defaultVisibility: 'PUBLIC',
      productVariantId,
    },
  });
  if (!t.createBbbSessionTemplate?.id) fail('createBbbSessionTemplate', t);

  const startsAt = new Date(Date.now() - 5 * 60_000).toISOString();
  const s: any = await adminClient.query(CREATE_SESSIONS_FROM_TEMPLATE, {
    templateId: t.createBbbSessionTemplate.id,
    startTimes: [startsAt],
  });
  const session = s.createSessionsFromTemplate?.[0];
  if (!session?.id) fail('createSessionsFromTemplate', s);
  expect(session.productVariantId).toBeTruthy();

  const pub: any = await adminClient.query(PUBLISH_BBB_SCHEDULED_SESSION, {
    id: session.id,
  });
  if (!pub.publishBbbScheduledSession?.id) {
    fail('publishBbbScheduledSession', pub);
  }
  return decode(session.id);
}

async function entitlementFor(
  customerId: string,
  type: 'bbb_session' | 'bbb_room',
  resourceId: string,
): Promise<BbbEntitlement | null> {
  return rawConn()
    .getRepository(BbbEntitlement)
    .findOne({ where: { customerId, type, resourceId } });
}

async function orderState(orderId: string): Promise<string | null> {
  const row = await rawConn()
    .getRepository('Order')
    .findOne({ where: { id: decode(orderId) } });
  return row?.state ?? null;
}

/**
 * THE SETTLEMENT HELPER — every paid scenario must go through this.
 *
 * `dummyPaymentHandler.automaticSettle` defaults to FALSE, so checkout stops at
 * PaymentAuthorized and the PaymentSettled lifecycle never fires on its own.
 * This helper performs the explicit Admin settlePayment and asserts the
 * RESULTING business state (returned Payment.state === 'Settled' AND the order
 * actually reaching PaymentSettled) — never merely "no GraphQL error".
 *
 * @param assertEntitlementAbsentFor  When supplied, the entitlement is asserted
 *   ABSENT after the order is placed but BEFORE settlement. That is what makes
 *   the settlement → entitlement link CAUSAL rather than co-existence.
 */
async function checkoutAndExplicitlySettle(
  productVariantId: string,
  assertEntitlementAbsentFor?: {
    customerId: string;
    type: 'bbb_session' | 'bbb_room';
    resourceId: string;
  },
): Promise<{
  orderId: string;
  orderCode: string;
  paymentId: string;
  preSettlePaymentState: string;
  settleState: string;
}> {
  // 1. cart
  const add: any = await shopClient.query(ADD_ITEM, {
    productVariantId,
    quantity: 1,
  });
  if (add.addItemToOrder?.errorCode) fail('addItemToOrder', add.addItemToOrder);
  const orderId: string = add.addItemToOrder.id;

  // 2. address + 3. shipping method (required to reach ArrangingPayment)
  const addr: any = await shopClient.query(SET_SHIPPING_ADDRESS, {
    input: {
      fullName: 'R4 Learner',
      streetLine1: '1 Evidence Street',
      city: 'E2ECity',
      province: 'E2EState',
      postalCode: '123456',
      countryCode: 'IN',
    },
  });
  if (addr.setOrderShippingAddress?.errorCode) {
    fail('setOrderShippingAddress', addr.setOrderShippingAddress);
  }
  const sm: any = await shopClient.query(ELIGIBLE_SHIPPING);
  const method = sm.eligibleShippingMethods?.[0];
  if (!method?.id) fail('eligibleShippingMethods', sm);
  const setSm: any = await shopClient.query(SET_SHIPPING_METHOD, {
    ids: [method.id],
  });
  if (setSm.setOrderShippingMethod?.errorCode) {
    fail('setOrderShippingMethod', setSm.setOrderShippingMethod);
  }

  // 4. ArrangingPayment
  const trans: any = await shopClient.query(TRANSITION_TO_ARRANGING);
  if (trans.transitionOrderToState?.errorCode) {
    fail(
      'transitionOrderToState(ArrangingPayment)',
      trans.transitionOrderToState,
    );
  }

  // 5. CAUSALITY GUARD: nothing may have provisioned access yet.
  if (assertEntitlementAbsentFor) {
    const a = assertEntitlementAbsentFor;
    const pre = await entitlementFor(a.customerId, a.type, a.resourceId);
    if (pre) {
      throw new Error(
        `Causality violated: entitlement for ${a.type}/${a.resourceId} already existed BEFORE settlement (id=${pre.id})`,
      );
    }
  }

  // 6. Pay — NO automaticSettle. The order must stop at PaymentAuthorized.
  const pay: any = await shopClient.query(ADD_PAYMENT, {
    input: { method: 'dummy-payment', metadata: {} },
  });
  if (pay.addPaymentToOrder?.errorCode) {
    fail('addPaymentToOrder', pay.addPaymentToOrder);
  }
  const preSettlePaymentState: string = pay.addPaymentToOrder.state;
  if (preSettlePaymentState === 'PaymentSettled') {
    throw new Error(
      'Payment auto-settled: the PaymentMethod is configured with automaticSettle=true. ' +
        'R4 requires explicit settlement — fix the fixture, not the assertion.',
    );
  }

  // 7. Resolve the ACTUAL payment id from the order (never invented).
  const adminOrder: any = await adminClient.query(ADMIN_ORDER_PAYMENTS, {
    id: orderId,
  });
  const payment = adminOrder.order?.payments?.[0];
  if (!payment?.id) fail('admin order.payments[0]', adminOrder);
  const paymentId = decode(payment.id);
  if (payment.state !== 'Authorized') {
    throw new Error(
      `Expected payment state Authorized before settlement; got ${payment.state}`,
    );
  }

  // 8. EXPLICIT settlement — the authoritative step.
  const settle: any = await adminClient.query(SETTLE_PAYMENT, { id: paymentId });
  const settleState: string | undefined = settle.settlePayment?.state;

  // 9. Assert SUCCESS from the response body, not from the absence of errors.
  if (settleState !== 'Settled') {
    fail('settlePayment did not return a Settled Payment', settle.settlePayment);
  }

  // 10. Assert the settlement actually drove the order's state machine.
  const finalState = await waitFor(
    () => orderState(orderId),
    (s) => s === 'PaymentSettled',
    `order ${orderId} reaching PaymentSettled`,
  );

  const adminOrderAfter: any = await adminClient.query(ADMIN_ORDER_PAYMENTS, {
    id: orderId,
  });

  return {
    orderId: decode(orderId),
    orderCode: adminOrderAfter.order?.code ?? '',
    paymentId,
    preSettlePaymentState,
    settleState: settleState ?? finalState,
  };
}

/**
 * Installs the outbound BBB transport stub by property replacement on the
 * injected service — the existing in-repo precedent
 * (bbb-meeting-concurrency.e2e-spec.ts:165-170, 330-334).
 *
 * Only the external HTTP hop is replaced. The provisioning state machine, the
 * grant gate, BBB server selection, MeetingProvisionedEvent and the
 * BbbSessionProvisioningListener (session → LIVE) all run for real.
 *
 * MUST be installed BEFORE startScheduledSession: that mutation enqueues the
 * provisioning job via setImmediate, so the queued worker can otherwise reach
 * the real transport first and fail the meeting.
 */
async function installStubbedBbbTransport(): Promise<void> {
  // Inherit from the REAL service so buildJoinUrl()/decryptSecret()/checksum
  // generation keep working — only the two outbound HTTP hops are replaced.
  const real: any = server.app.get(BbbApiService);
  const stubbed: any = Object.create(real);
  stubbed.createMeeting = async () => ({
    internalMeetingID: `r4-internal-${Date.now()}`,
    meetingID: `r4-${Date.now()}`,
  });
  // validateMeetingExistsOnBbb() treats a truthy info as "still exists".
  // The real getMeetingInfo() returns null on ANY error, which blocks join-URL
  // generation entirely with no BBB container present (bbb-api.service.ts:246-252).
  stubbed.getMeetingInfo = async () => ({
    meetingID: 'r4-meeting',
    internalMeetingID: 'r4-internal-meeting',
    running: false,
    participantCount: 0,
    moderatorCount: 0,
    recording: false,
    startTime: 0,
    endTime: 0,
  });

  // Provisioning uses the worker's instance; join-URL validation uses
  // BbbMeetingService's instance. Both must be stubbed, or R4-05 fails with
  // "This meeting has already ended on the server."
  const worker: any = server.app.get(BbbProvisioningWorkerService);
  worker.bbbApiService = stubbed;
  const meetingService: any = server.app.get(BbbMeetingService);
  meetingService.bbbApiService = stubbed;
}

/** Fallback: drive provisioning directly when the queue is not running. */
async function provisionMeetingWithStubbedTransport(
  meetingId: string,
): Promise<void> {
  await installStubbedBbbTransport();
  const ctx = await getSuperadminContext(server.app);
  const worker: any = server.app.get(BbbProvisioningWorkerService);
  await worker.doProvisionMeeting(ctx, meetingId, 'r4-provisioning');
}

async function meetingState(meetingId: string): Promise<string | null> {
  const m = await rawConn()
    .getRepository(BbbMeeting)
    .findOne({ where: { id: decode(meetingId) } });
  return m?.state ?? null;
}

async function sessionStatus(sessionId: string): Promise<string | null> {
  const s = await rawConn()
    .getRepository(BbbScheduledSession)
    .findOne({ where: { id: decode(sessionId) } });
  return s?.status ?? null;
}

async function ledgerRowsFor(meetingId: string): Promise<BbbUsageLedger[]> {
  return rawConn()
    .getRepository(BbbUsageLedger)
    .find({
      where: { meeting: { id: decode(meetingId) } },
      // The `grant` relation must be loaded explicitly — the assertion is on
      // which grant was billed, not merely that a row exists.
      relations: ['grant', 'meeting'],
    });
}

async function grantsFor(
  organizationId: string,
  sourceType: string,
): Promise<BbbCapacityGrant[]> {
  return rawConn()
    .getRepository(BbbCapacityGrant)
    .find({
      where: { organization: { id: decode(organizationId) }, sourceType },
    });
}

async function reloadGrant(id: string): Promise<BbbCapacityGrant> {
  return rawConn()
    .getRepository(BbbCapacityGrant)
    .findOne({ where: { id: decode(id) } });
}

/**
 * §3.2 CARVE-OUT — service-layer meeting fixture.
 *
 * `consumeGrantHours()` refuses to bill anything shorter than
 * `fairBillingMinDurationMs` (default 120_000 = 2 min,
 * bbb-reconciliation.service.ts:60-62) and NO Admin mutation can set
 * `provisionedAt` (CreateBbbMeetingInput/UpdateBbbMeetingInput expose neither
 * `provisionedAt` nor `state`). Backdating it is therefore the only way to
 * exercise the real billing path deterministically. This is a repository write
 * on the meeting fixture only — the same sanctioned service-layer path used by
 * bbb-usage-ledger.e2e-spec.ts — and no SQL is issued.
 */
async function backdateProvisionedAt(
  meetingId: string,
  minutesAgo: number,
): Promise<void> {
  await rawConn()
    .getRepository(BbbMeeting)
    .update(decode(meetingId), {
      provisionedAt: new Date(Date.now() - minutesAgo * 60_000),
    });
}

// ─── Suite ──────────────────────────────────────────────────────────────────

describe('Slice 10 — R4 runtime lifecycle evidence', () => {
  const d = R4_E2E ? describe : describe.skip;

  /**
   * The scenarios form ONE ordered chain on purpose: a paid purchase must
   * create the access entitlement (R4-01) and a commercial capacity grant
   * (R4-02) before a session can be provisioned (R4-04) and a learner can join
   * (R4-05). Splitting them across suites would destroy the very thing R4
   * exists to prove — that this is one connected runtime chain.
   */
  d('commercial → payment → entitlement → BBB → usage ledger', () => {
    let org: { id: string; channelId: string };
    let variantId: string;
    let sessionId: string;
    let learnerId: string;
    let learnerEmail: string;
    let trainerId: string;
    let trainerEmail: string;
    let order: {
      orderId: string;
      orderCode: string;
      paymentId: string;
      preSettlePaymentState: string;
      settleState: string;
    };
    let orderGrantId: string;
    let meetingId: string;
    let tenantBToken: string;
    let tenantBChannelId: string;
    let tenantBOrgId: string;

    beforeAll(async () => {
      await assertPostgres();
      await server.init({
        initialData: E2E_INITIAL_DATA,
        customerCount: 0,
      });

      await adminClient.asSuperAdmin();
      shopClient.setChannelToken(E2E_DEFAULT_CHANNEL_TOKEN);

      // automaticSettle EXPLICITLY false — settlement is ours to perform.
      await createDummyPaymentMethod(false);

      // Free Basic must exist BEFORE any registerNewTenant:
      // FreePlanProvisioningListener is fail-soft (ADR-044 §4) and silently
      // provisions nothing when the plan row is missing, which would leave
      // R4-03 with no OrganizationSubscription to renew.
      const catalogue: any = await shopClient.query(AVAILABLE_PLANS);
      const plans: any[] = catalogue.availableSubscriptionPlans ?? [];
      if (!plans.some((p) => p.slug === 'free-basic')) {
        const created: any = await adminClient.query(CREATE_SUBSCRIPTION_PLAN, {
          input: {
            name: 'Free Basic',
            slug: 'free-basic',
            description: 'Provider-free free tier',
            monthlyPriceInPaise: 0,
            includedBbbMinutes: 300,
            maxStudents: 50,
            customDomainEnabled: false,
            whitelabelEnabled: false,
            marketplaceListingEnabled: false,
            isActive: true,
          },
        });
        if (!created.createSubscriptionPlan?.id) {
          fail('createSubscriptionPlan', created);
        }
      }

      // One enabled/healthy BBB server so provisioning can select a target.
      const srv: any = await adminClient.query(CREATE_BBB_SERVER, {
        input: {
          name: `R4 Server ${Date.now()}`,
          apiUrl: 'http://localhost:1999/bigbluebutton/api',
          apiSecret: 'r4-test-secret',
          maxLoad: 100,
          capacity: 100,
        },
      });
      if (!srv.createBbbServer?.id) fail('createBbbServer', srv);
      expect(srv.createBbbServer.enabled).toBe(true);
      expect(srv.createBbbServer.healthy).toBe(true);

      org = await createOrganization('chain');
      variantId = await createProductAndVariant(250000);
      sessionId = await createScheduledSessionForVariant(org.id, variantId);

      // The trainer is a MODERATOR member of the org — startSession() requires
      // an active moderator membership (BbbScheduledSessionService:594-601).
      trainerEmail = `r4-trainer-${Date.now()}@example.com`;
      trainerId = await registerAndLoginCustomer(trainerEmail, 'R4Trainer@1');
      const member: any = await adminClient.query(ADD_BBB_MEMBER, {
        input: {
          organizationId: encode(org.id),
          customerId: encode(trainerId),
          role: 'trainer',
        },
      });
      if (!member.addBbbMember?.id) fail('addBbbMember', member);
      expect(member.addBbbMember.role).toBe('trainer');
    }, 180_000);

    afterAll(async () => {
      await server.destroy();
    });

    // ═══ R4-01 — paid checkout → EXPLICIT settle → entitlement ═════════════
    it('R4-01: paid checkout settles explicitly and thus creates the entitlement (causal)', async () => {
      // The learner is a Customer on the channel, created through the Shop API.
      learnerEmail = `r4-learner-${Date.now()}@example.com`;
      learnerId = await registerAndLoginCustomer(learnerEmail, 'R4Learner@1');

      order = await checkoutAndExplicitlySettle(variantId, {
        customerId: learnerId,
        type: 'bbb_session',
        resourceId: sessionId,
      });

      // 1. The order really was created and reached PaymentSettled.
      expect(order.orderCode).toMatch(/./);
      expect(await orderState(order.orderId)).toBe('PaymentSettled');

      // 2. The payment went through Authorized → Settled explicitly.
      expect(order.preSettlePaymentState).toBe('PaymentAuthorized');
      expect(order.settleState).toBe('Settled');

      // 3. PaymentSettled drove BbbOrderFulfillmentListener → entitlement,
      //    asynchronously (fire-and-forget `.catch()` in the listener).
      const ent = await waitForNotNull(
        () => entitlementFor(learnerId, 'bbb_session', sessionId),
        'BbbEntitlement created by BbbOrderFulfillmentListener',
      );

      // 4. The entitlement carries the commercial provenance model.
      expect(ent.type).toBe('bbb_session');
      expect(ent.resourceId).toBe(sessionId);
      expect(ent.customerId).toBe(learnerId);
      expect(ent.source).toBe('purchase');
      expect(String(ent.channelId)).toBe(String(org.channelId));

      // 5. Two writers, two triggers, ONE transition: the entitlement came from
      //    the PaymentSettled listener, while the capacity grant came from the
      //    automatic fulfilment that same transition triggered (Option A, R3
      //    decision 1, 2026-09-26). Before Option A this grant did not exist at
      //    all — the listener never wrote one, and the manual path could be dead
      //    without any test noticing (BUG-038).
      const orderGrantsAfterSettle = await waitFor(
        () => grantsFor(org.id, 'order'),
        (g) => g.length === 1,
        'BbbCapacityGrant(sourceType="order") produced automatically on PaymentSettled',
      );
      expect(orderGrantsAfterSettle[0].orderLineId).toBeTruthy();

      // eslint-disable-next-line no-console
      console.log(
        `[R4-01 EVIDENCE] order=${order.orderId} code=${order.orderCode} payment=${order.paymentId} ` +
          `preSettle=${order.preSettlePaymentState} settle=${order.settleState} ` +
          `entitlement=${ent.id} source=${ent.source} channel=${ent.channelId} session=${sessionId} ` +
          `autoGrant=${orderGrantsAfterSettle[0].id}`,
      );
    }, 120_000);

    // ═══ R4-02 — AUTOMATIC fulfilment → capacity grant (Option A) ═══════════
    it('R4-02: PaymentSettled auto-fulfillment writes BbbCapacityGrant(sourceType="order")', async () => {
      // R3 decision 1 (Option A, 2026-09-26): R4-01's settlement already ran the
      // automatic path, so no Admin call takes part here. That is the point of
      // the decision — before it this grant had no automatic producer at all.
      const grants = await waitFor(
        () => grantsFor(org.id, 'order'),
        (g) => g.length === 1,
        'BbbCapacityGrant(sourceType="order") from the automatic fulfillment path',
      );
      orderGrantId = String(grants[0].id);

      const linesRes: any = await adminClient.query(ADMIN_ORDER_LINES, {
        id: encode(order.orderId),
      });
      const line = linesRes.order?.lines?.[0];
      if (!line?.id) fail('order.lines[0]', linesRes);

      // `sourceType` is the entity default — the handler does not set it.
      expect(grants[0].sourceType).toBe('order');
      expect(grants[0].orderLineId).toBe(decode(line.id));
      expect(grants[0].grantedMinutes).toBe(600); // handler default 10h × 60

      // The fulfillment itself exists and was written by THIS handler.
      const fulfillments = await rawConn()
        .getRepository(Fulfillment)
        .createQueryBuilder('f')
        .leftJoin('f.orders', 'o')
        .where('o.id = :id', { id: decode(order.orderId) })
        .getMany();
      expect(fulfillments).toHaveLength(1);
      expect(fulfillments[0].handlerCode).toBe('bbb-access-fulfillment');

      // A redundant manual fulfilment must not double-grant: Vendure core's
      // remaining-quantity guard rejects the redundant line quantity (returning
      // ItemsAlreadyFulfilledError / undefined fulfillment id), preventing the
      // handler from being invoked a second time. Handler-level orderLineId
      // deduplication provides defense-in-depth.
      const again: any = await adminClient.query(ADD_FULFILLMENT, {
        input: {
          lines: [{ orderLineId: line.id, quantity: 1 }],
          handler: {
            code: 'bbb-access-fulfillment',
            arguments: [
              { name: 'grantedHours', value: '10' },
              { name: 'validityDays', value: '30' },
            ],
          },
        },
      });
      expect(again.addFulfillmentToOrder?.id).toBeUndefined();
      expect(await grantsFor(org.id, 'order')).toHaveLength(1);

      // The entitlement (R4-01) and this grant are DIFFERENT writers on
      // DIFFERENT triggers — the §2 topology, asserted rather than assumed.
      const ents = await rawConn()
        .getRepository(BbbEntitlement)
        .find({ where: { customerId: learnerId } });
      expect(ents).toHaveLength(1);

      // eslint-disable-next-line no-console
      console.log(
        `[R4-02 EVIDENCE] grant=${orderGrantId} sourceType=${grants[0].sourceType} ` +
          `grantedMinutes=${grants[0].grantedMinutes} orderLineId=${grants[0].orderLineId} ` +
          `fulfillment=${fulfillments[0].id} trigger=PaymentSettled(automatic, Option A)`,
      );
    }, 120_000);

    // ═══ R4-04 — provisioning selects the commercial grant ═════════════════
    it('R4-04: provisioning selects the "order" grant (not overhead); meeting ACTIVE + session LIVE', async () => {
      // Install the transport stub FIRST: startScheduledSession enqueues the
      // provisioning job immediately (setImmediate), so the stub must already
      // be in place before the queued worker can reach the real transport.
      await installStubbedBbbTransport();

      // Only a moderator may start a session.
      await shopClient.asUserWithCredentials(trainerEmail, 'R4Trainer@1');
      const started: any = await shopClient.query(SHOP_START_SESSION, {
        sessionId: encode(sessionId),
      });
      if (!started.startScheduledSession?.activeMeetingId) {
        fail('startScheduledSession', started.startScheduledSession);
      }
      meetingId = decode(started.startScheduledSession.activeMeetingId);
      expect(await meetingState(meetingId)).toBe(MEETING_STATE.PENDING);

      const pollUntilActive = async (timeoutMs: number): Promise<boolean> => {
        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
          if ((await meetingState(meetingId)) === MEETING_STATE.ACTIVE) {
            return true;
          }
          await new Promise((r) => setTimeout(r, 200));
        }
        return (await meetingState(meetingId)) === MEETING_STATE.ACTIVE;
      };

      // Prefer the real queued provisioning job; fall back to the direct
      // worker drive (approved §7) if the queue does not process it here.
      if (!(await pollUntilActive(8_000))) {
        await provisionMeetingWithStubbedTransport(meetingId);
      }
      await waitFor(
        () => meetingState(meetingId),
        (s) => s === MEETING_STATE.ACTIVE,
        `meeting ${meetingId} reaching Active`,
      );
      // MeetingProvisionedEvent → BbbSessionProvisioningListener (real listener).
      await waitFor(
        () => sessionStatus(sessionId),
        (s) => s === 'LIVE',
        'session reaching LIVE via BbbSessionProvisioningListener',
      );

      // Immutable grant linkage: provisioning selected the COMMERCIAL grant.
      // This is BUG-036's rule in action — internal_overhead can never serve a
      // tenant session, so without R4-02 this would have thrown
      // PROVISIONING_NO_GRANT_ERROR.
      const meeting = await rawConn()
        .getRepository(BbbMeeting)
        .findOne({ where: { id: meetingId } });
      expect(String(meeting.grantId)).toBe(orderGrantId);

      // eslint-disable-next-line no-console
      console.log(
        `[R4-04 EVIDENCE] meeting=${meetingId} state=${await meetingState(meetingId)} ` +
          `session=${sessionId} status=${await sessionStatus(sessionId)} grantId=${meeting.grantId}`,
      );
    }, 120_000);

    // ═══ R4-05 — authorized join ═══════════════════════════════════════════
    it('R4-05: entitled learner obtains a usable attendee join URL', async () => {
      await shopClient.asUserWithCredentials(learnerEmail, 'R4Learner@1');
      const res: any = await shopClient.query(SHOP_JOIN_MEETING, {
        meetingId: encode(meetingId),
        participantName: 'R4 Learner',
      });
      const url: string = res.bbbJoinMeeting;
      expect(typeof url).toBe('string');
      expect(url).toContain('/api/join?');
      expect(url).toContain('meetingID=');
      expect(url).toContain('checksum=');
      expect(url).toContain('password=');

      // eslint-disable-next-line no-console
      console.log(
        `[R4-05 EVIDENCE] attendee join URL obtained (BBB password redacted) = ${url.replace(/password=[^&]*/, 'password=***')}`,
      );
    }, 120_000);

    // ═══ R4-06 — authenticated but not entitled ════════════════════════════
    it('R4-06: authenticated but UNentitled learner is refused by the entitlement gate', async () => {
      const outsiderEmail = `r4-outsider-${Date.now()}@example.com`;
      await registerAndLoginCustomer(outsiderEmail, 'R4Outsider@1');

      // Capture the rejection so this scenario emits runtime evidence and so we
      // can prove WHICH gate refused us. The message here ("do not have
      // access") comes from the entitlement check, whereas R4-07's anonymous
      // caller is stopped earlier by @Allow(Authenticated) ("not currently
      // authorized") — the two denials are therefore provably distinct layers.
      const err: any = await shopClient
        .query(SHOP_JOIN_MEETING, {
          meetingId: encode(meetingId),
          participantName: 'Outsider',
        })
        .then(
          () => null,
          (e: unknown) => e,
        );

      expect(err).toBeTruthy();
      expect(String(err?.message)).toMatch(/do not have access/i);
      // Anti-regression: the refusal must NOT be the @Allow gate's message.
      expect(String(err?.message)).not.toMatch(/not currently authorized/i);

      // eslint-disable-next-line no-console
      console.log(
        `[R4-06 EVIDENCE] authenticated-but-unentitled join REJECTED at the entitlement gate: ${String(
          err?.message,
        )
          .split('\n')[0]
          .trim()}`,
      );
    }, 120_000);

    // ═══ R4-07 — anonymous ═════════════════════════════════════════════════
    it('R4-07: anonymous caller is refused by the @Allow gate (distinct from R4-06)', async () => {
      await shopClient.asAnonymousUser();
      // Capture the actual rejection (rather than `.rejects.toThrow`) so this
      // scenario emits runtime evidence like the other nine tests, and so we
      // can assert WHICH layer refused us: the @Allow(Authenticated) gate, not
      // the per-tenant entitlement/channel-access boundary exercised by R4-06
      // and R4-10. The throw itself remains the assertion.
      const err: any = await shopClient
        .query(SHOP_JOIN_MEETING, {
          meetingId: encode(meetingId),
          participantName: 'Anonymous',
        })
        .then(
          () => null,
          (e: unknown) => e,
        );

      expect(err).toBeTruthy();
      expect(String(err?.message)).toMatch(
        /not currently authorized|permission|forbidden/i,
      );

      console.log(
        `[R4-07 EVIDENCE] anonymous join REJECTED at the @Allow(Authenticated) gate (no entitlement lookup attempted): ${String(
          err?.message,
        )
          .split('\n')[0]
          .trim()}`,
      );
    }, 120_000);

    // ═══ R4-08 — usage ledger ══════════════════════════════════════════════
    it('R4-08: completion writes exactly ONE immutable usage-ledger fact bound to the "order" grant', async () => {
      const ctx = await getSuperadminContext(server.app);
      const meetingService = server.app.get(BbbMeetingService);

      // Service-layer fixture (§3.2 carve-out) — see backdateProvisionedAt().
      await backdateProvisionedAt(meetingId, 10);

      const completed = await meetingService.completeMeetingLifecycle(
        ctx,
        meetingId,
        { source: 'manual' },
      );
      expect(completed.state).toBe(MEETING_STATE.COMPLETED);

      const rows = await waitFor(
        () => ledgerRowsFor(meetingId),
        (r) => r.length === 1,
        'exactly one BbbUsageLedger row',
      );

      // The ledger is bound to the meeting's PERSISTED grant — the commercial
      // one from R4-02, never a recomputed "current" grant.
      expect(String(rows[0].grant.id)).toBe(orderGrantId);

      const persisted = await rawConn()
        .getRepository(BbbMeeting)
        .findOne({ where: { id: meetingId } });
      const expected = Math.max(
        1,
        Math.ceil(
          ((persisted.completedAt ?? new Date()).getTime() -
            new Date(persisted.provisionedAt).getTime()) /
            60_000,
        ),
      );
      expect(rows[0].consumedMinutes).toBe(expected);

      const grant = await reloadGrant(orderGrantId);
      expect(grant.consumedMinutes).toBe(expected);

      // Session leaves LIVE — MeetingCompletedEvent → BbbSessionProvisioningListener.
      await waitFor(
        () => sessionStatus(sessionId),
        (s) => s === 'FINISHED',
        'session reaching FINISHED',
      );

      // eslint-disable-next-line no-console
      console.log(
        `[R4-08 EVIDENCE] meeting=${meetingId} ledgerRows=${rows.length} ` +
          `consumedMinutes=${rows[0].consumedMinutes} grant=${orderGrantId} ` +
          `grant.consumedMinutes=${grant.consumedMinutes} session=${await sessionStatus(sessionId)}`,
      );
    }, 120_000);

    // ═══ R4-09 — replay / idempotency (mandatory) ══════════════════════════
    it('R4-09: replaying the same (meetingId, grantId) never double-bills', async () => {
      const ctx = await getSuperadminContext(server.app);
      const meetingService = server.app.get(BbbMeetingService);
      const recon = server.app.get(BbbReconciliationService);

      const before = (await reloadGrant(orderGrantId)).consumedMinutes;
      expect(before).toBeGreaterThan(0);

      // (a) SEQUENTIAL replay of the whole completion path.
      await meetingService.completeMeetingLifecycle(ctx, meetingId, {
        source: 'manual',
      });
      expect(await ledgerRowsFor(meetingId)).toHaveLength(1);
      expect((await reloadGrant(orderGrantId)).consumedMinutes).toBe(before);

      // (b) CONCURRENT replay — the database write is the idempotency
      // decision (INSERT … ON CONFLICT (meetingId, grantId) DO NOTHING +
      // RETURNING), never a check-then-insert.
      const persisted = await rawConn()
        .getRepository(BbbMeeting)
        .findOneOrFail({ where: { id: meetingId } });
      const results = await Promise.allSettled(
        Array.from({ length: 6 }, () => recon.consumeGrantHours(ctx, persisted)),
      );
      for (const r of results) {
        expect(r.status).toBe('fulfilled');
      }

      // Assertions are against RESULTING BUSINESS STATE, not call counts.
      expect(await ledgerRowsFor(meetingId)).toHaveLength(1);
      expect((await reloadGrant(orderGrantId)).consumedMinutes).toBe(before);

      // eslint-disable-next-line no-console
      console.log(
        `[R4-09 EVIDENCE] sequential+6way-concurrent replay → ledgerRows=1 ` +
          `grant.consumedMinutes=${before} (unchanged after 7 replays)`,
      );
    }, 120_000);

    // ═══ R4-10 — tenant/channel isolation ══════════════════════════════════
    it('R4-10: a tenant-B customer cannot reach tenant A\'s meeting or entitlement', async () => {
      const stamp = Date.now();

      // Register a REAL second tenant through the Shop API — its own channel,
      // org and subscription come from the production provisioning listeners.
      const reg: any = await shopClient.query(REGISTER_NEW_TENANT, {
        input: {
          businessName: `R4 Tenant B ${stamp}`,
          firstName: 'B',
          lastName: 'Admin',
          emailAddress: `r4-tenant-b-${stamp}@example.com`,
          password: 'R4TenantB@1',
          timezone: 'Asia/Kolkata',
        },
      });
      if (!reg.registerNewTenant?.channelToken) fail('registerNewTenant', reg);
      tenantBToken = reg.registerNewTenant.channelToken;
      tenantBChannelId = decode(reg.registerNewTenant.channelId);

      const orgB = await waitForNotNull<BbbOrganization>(
        () =>
          rawConn()
            .getRepository(BbbOrganization)
            .findOne({ where: { channelId: tenantBChannelId } }),
        'BbbOrganization provisioned for tenant B',
      );
      tenantBOrgId = String(orgB.id);
      expect(tenantBOrgId).not.toBe(org.id);

      // A customer ON tenant B's channel.
      const customerBEmail = `r4-customer-b-${stamp}@example.com`;
      shopClient.setChannelToken(tenantBToken);
      const customerBId = await registerAndLoginCustomer(
        customerBEmail,
        'R4CustomerB@1',
      );

      // CONTROL: the session really is authenticated on tenant B's channel,
      // so the rejection below can only come from the authorization layer —
      // not from the @Allow(Authenticated) gate. Without this control the
      // denial would be indistinguishable from R4-07 (anonymous).
      const control: any = await shopClient.query(ACTIVE_CUSTOMER);
      expect(control.activeCustomer?.id).toBeTruthy();

      // (1) Cross-tenant JOIN → refused at the channel-access boundary.
      // assertMeetingAccess() throws ForbiddenError when
      // org.channelId !== ctx.channelId (bbb-channel-access.service.ts:177-179).
      await expect(
        shopClient.query(SHOP_JOIN_MEETING, {
          meetingId: encode(meetingId),
          participantName: 'Tenant B Learner',
        }),
      ).rejects.toThrow(/not currently authorized|forbidden/i);

      // (2) tenant B's customer holds no entitlement for tenant A's session.
      const customerBEntitlements = await rawConn()
        .getRepository(BbbEntitlement)
        .find({ where: { customerId: customerBId, resourceId: sessionId } });
      expect(customerBEntitlements).toHaveLength(0);

      // (3) Allowed direction: tenant A's learner can still READ tenant A's
      // meeting. Asserted through the channel-scoped Shop query rather than a
      // join, because R4-08 may already have completed the meeting (a join
      // would then legitimately fail the isActive guard, proving nothing).
      shopClient.setChannelToken(E2E_DEFAULT_CHANNEL_TOKEN);
      await shopClient.asUserWithCredentials(learnerEmail, 'R4Learner@1');
      const mineA: any = await shopClient.query(MY_BBB_MEETINGS);
      const idsA = (mineA.myBbbMeetings?.items ?? []).map((m: any) =>
        decode(m.id),
      );
      expect(idsA).toContain(decode(meetingId));

      // …and tenant B's view of the SAME meeting is empty.
      shopClient.setChannelToken(tenantBToken);
      await shopClient.asUserWithCredentials(
        customerBEmail,
        'R4CustomerB@1',
      );
      const mineB: any = await shopClient.query(MY_BBB_MEETINGS);
      const idsB = (mineB.myBbbMeetings?.items ?? []).map((m: any) =>
        decode(m.id),
      );
      expect(idsB).not.toContain(decode(meetingId));

      // (4) Billing stayed bound to tenant A's grant (also asserted in R4-08).
      expect(String((await ledgerRowsFor(meetingId))[0].grant.id)).toBe(
        orderGrantId,
      );

      // eslint-disable-next-line no-console
      console.log(
        `[R4-10 EVIDENCE] tenantB channel=${tenantBChannelId} org=${tenantBOrgId} ` +
          `customerB=${customerBId} → cross-tenant join FORBIDDEN; entitlements=0; ` +
          `tenantA learner still joins; ledger grant=${orderGrantId}`,
      );
    }, 120_000);

    // ═══ R4-03 — subscription-originated capacity grant (topology path C) ══
    it('R4-03: SubscriptionRenewedEvent writes BbbCapacityGrant(sourceType="subscription")', async () => {
      const ctx = await getSuperadminContext(server.app);
      const eventBus = server.app.get(EventBus);

      // The REAL subscription row created by FreePlanProvisioningListener.
      const sub = await rawConn()
        .getRepository(OrganizationSubscription)
        .findOne({ where: { channelId: tenantBChannelId } });
      if (!sub) fail('OrganizationSubscription for tenant B', null);

      const periodStart = new Date(Date.now() - 30 * 86_400_000);
      const periodEnd = new Date(Date.now() + 30 * 86_400_000);
      const granted = 900;

      eventBus.publish(
        new SubscriptionRenewedEvent(
          ctx,
          sub,
          tenantBChannelId,
          periodStart,
          periodEnd,
          granted,
        ),
      );

      // Slice 6 (ADR-045) may have already provisioned a 60-minute daily allowance
      // grant for tenant B. The renewal event creates an additional period grant
      // with grantedMinutes === granted (900).
      const grants = await waitFor(
        () => grantsFor(tenantBOrgId, 'subscription'),
        (g) => g.some((grant) => grant.grantedMinutes === granted),
        'BbbCapacityGrant(sourceType="subscription") with 900 minutes from BbbSubscriptionListener',
      );

      const periodGrant = grants.find((g) => g.grantedMinutes === granted)!;
      expect(periodGrant.sourceType).toBe('subscription');
      expect(periodGrant.grantedMinutes).toBe(granted);
      expect(String(periodGrant.validFrom)).toBe(String(periodStart));
      expect(String(periodGrant.validUntil)).toBe(String(periodEnd));
      expect(periodGrant.isUnbounded).toBe(false);

      // Canonical model only — the legacy RecurringCapacityGrant entity must
      // not exist as a product/runtime table.
      const tables = await rawConn().query(
        `SELECT tablename FROM pg_tables WHERE schemaname NOT IN ('pg_catalog','information_schema')`,
      );
      const names = tables.map((t: any) => t.tablename);
      expect(names.some((n: string) => /recurring_capacity/i.test(n))).toBe(
        false,
      );

      // eslint-disable-next-line no-console
      console.log(
        `[R4-03 EVIDENCE] grant=${grants[0].id} sourceType=${grants[0].sourceType} ` +
          `grantedMinutes=${grants[0].grantedMinutes} org=${tenantBOrgId} ` +
          `channel=${tenantBChannelId} recurringCapacityGrantTable=absent`,
      );
    }, 120_000);
  });
});
