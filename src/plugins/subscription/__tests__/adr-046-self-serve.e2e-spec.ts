import "reflect-metadata";
import "dotenv/config";
import {
  createTestEnvironment,
  E2E_DEFAULT_CHANNEL_TOKEN,
  testConfig,
  registerInitializer,
} from "@vendure/testing";
import { startOnFreePort } from "../../../test-utils/free-port";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import gql from "graphql-tag";
import { Logger, mergeConfig } from "@vendure/core";
import { SchemaPostgresInitializer } from "../../tenant-plugin/e2e/schema-postgres-initializer";
import { TenantPlugin } from "../../tenant-plugin/tenant-plugin.plugin";
import { CmsPlugin } from "../../cms/cms.plugin";
import { ReviewsPlugin } from "../../reviews/reviews-plugin";
import { BigBlueButtonPlugin } from "../../bigbluebutton-plugin";
import { SubscriptionPlugin } from "../subscription.plugin";
import { E2E_INITIAL_DATA } from "../../tenant-plugin/e2e/fixtures/e2e-initial-data";
import { verifyTenantAdminViaApi } from "../../tenant-plugin/e2e/fixtures/verify-tenant-admin";
import { RazorpaySubscriptionProvider } from "../providers/razorpay/razorpay-subscription.provider";
import { TenantSelfServeSubscriptionCooldownService } from "../services/tenant-self-serve-subscription-cooldown.service";

registerInitializer("postgres", new SchemaPostgresInitializer());

const REGISTER_TENANT = gql`
  mutation RegisterNewTenant($input: RegisterTenantInput!) {
    registerNewTenant(input: $input) {
      channelId
      channelToken
      administratorId
    }
  }
`;

const CREATE_PLAN = gql`
  mutation CreateSubscriptionPlan($input: SubscriptionPlanInput!) {
    createSubscriptionPlan(input: $input) {
      id
      name
      slug
      providerPlanId
    }
  }
`;

const CREATE_CUSTOMER = gql`
  mutation RegisterCustomerAccount($input: RegisterCustomerInput!) {
    registerCustomerAccount(input: $input) {
      __typename
      ... on Success { success }
      ... on ErrorResult { errorCode message }
    }
  }
`;

const LOGIN = gql`
  mutation Login($username: String!, $password: String!) {
    login(username: $username, password: $password) {
      __typename
      ... on CurrentUser { id identifier }
      ... on ErrorResult { errorCode message }
    }
  }
`;

const CHANGE_PLAN = gql`
  mutation RequestMySubscriptionPlanChange($planId: ID!) {
    requestMySubscriptionPlanChange(planId: $planId) {
      subscription {
        plan { id name slug }
        status
        currentPeriodStart
        currentPeriodEnd
        cancelAtPeriodEnd
        cancelledAt
        marketplaceEligible
      }
      authorizationUrl
    }
  }
`;

const CANCEL = gql`
  mutation CancelMySubscription($atPeriodEnd: Boolean!) {
    cancelMySubscription(atPeriodEnd: $atPeriodEnd) {
      subscription {
        plan { id name slug }
        status
        currentPeriodStart
        currentPeriodEnd
        cancelAtPeriodEnd
        cancelledAt
        marketplaceEligible
      }
      authorizationUrl
    }
  }
`;

const ADMIN_SUBSCRIBE = gql`
  mutation SubscribeToPlan($channelId: String!, $planId: ID!) {
    subscribeToPlan(channelId: $channelId, planId: $planId) {
      id
      status
      plan { id slug }
    }
  }
`;

const ADMIN_CANCEL = gql`
  mutation CancelOrganizationSubscription($channelId: String!, $atPeriodEnd: Boolean!) {
    cancelOrganizationSubscription(channelId: $channelId, atPeriodEnd: $atPeriodEnd) {
      id
      status
      plan { id slug }
    }
  }
`;

const MY_SUBSCRIPTION = gql`
  query MySubscription {
    mySubscription {
      plan { id name slug }
      status
      currentPeriodStart
      currentPeriodEnd
      cancelAtPeriodEnd
      cancelledAt
      marketplaceEligible
    }
  }
`;

const PROVIDER_FIELD_PROBE = gql`
  query ProviderFieldProbe {
    mySubscription {
      providerShortUrl
    }
  }
`;

/**
 * Entities created inside the registration transaction come back with a
 * TRANSIENT Vendure id (`T_2`). That is not a valid integer for the raw-SQL
 * parameters in the Admin subscription service (`invalid input syntax for type
 * integer: "T_2"`), so the persisted id is recovered the same way
 * `r4-runtime-lifecycle.e2e-spec.ts` does.
 */
const decode = (id: unknown): string => String(id).replace(/^T_/, '');

describe("ADR-046 — tenant self-serve subscription Shop API", () => {
  const { server, adminClient, shopClient } = createTestEnvironment(
    mergeConfig(testConfig, {
      // Free port assigned by startOnFreePort() in beforeAll (test-utils/free-port).
      apiOptions: { port: 0 },
      authOptions: { requireVerification: false },
      dbConnectionOptions: {
        type: "postgres",
        host: process.env.DB_HOST ?? "localhost",
        port: Number(process.env.DB_PORT ?? 5432),
        database: process.env.DB_NAME ?? "vendure",
        username: process.env.DB_USERNAME ?? "vendure_user",
        password: process.env.DB_PASSWORD ?? "",
        schema: "e2e_adr046_self_serve",
        synchronize: true,
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

  const adminPassword = "StrongP@ss1";
  const learnerPassword = "LearnerP@ss1";
  let tenantAEmail: string;
  let tenantAChannelId: string;
  let tenantBEmail: string;
  let learnerEmail: string;
  let tenantAToken: string;
  let tenantBToken: string;
  let freePlanId: string;
  let paidPlanId: string;

  let createProviderCalls = 0;
  const cancelProvider = vi
    .spyOn(RazorpaySubscriptionProvider.prototype, "cancelSubscription")
    .mockResolvedValue();
  const createProvider = vi
    .spyOn(RazorpaySubscriptionProvider.prototype, "createSubscription")
    .mockImplementation(async (input) => ({
      providerSubscriptionId: `sub_mock_${++createProviderCalls}`,
      providerPlanId: input.planId,
      status: "created",
      shortUrl: `https://rzp.test/auth/${createProviderCalls}`,
    }));

  const loggerInfo = vi.spyOn(Logger, "info");

  beforeAll(async () => {
    await startOnFreePort({ server, adminClient, shopClient }, { initialData: E2E_INITIAL_DATA });

    // This E2E exercises the Shop contract while keeping Redis/provider
    // externalities deterministic. The cooldown unit itself is covered by the
    // pure service tests; here we prove the resolver invokes the seam and the
    // Shop mutation never bypasses the domain service.
    const cooldown = server.app.get(TenantSelfServeSubscriptionCooldownService);
    vi.spyOn(cooldown, "acquire").mockResolvedValue();

    adminClient.setChannelToken(E2E_DEFAULT_CHANNEL_TOKEN);
    await adminClient.asSuperAdmin();

    const free = await adminClient.query(CREATE_PLAN, {
      input: {
        name: "Free Basic",
        slug: "free-basic",
        description: "Provider-free test tier",
        monthlyPriceInPaise: 0,
        includedBbbMinutes: 60,
        maxStudents: 50,
        customDomainEnabled: false,
        whitelabelEnabled: false,
        marketplaceListingEnabled: false,
        isActive: true,
        sortOrder: 1,
      },
    });
    freePlanId = free.createSubscriptionPlan.id;

    const paid = await adminClient.query(CREATE_PLAN, {
      input: {
        name: "Growth ADR-046",
        slug: `growth-adr046-${Date.now()}`,
        description: "Provider-backed test tier",
        monthlyPriceInPaise: 19900,
        includedBbbMinutes: 600,
        maxStudents: 200,
        customDomainEnabled: true,
        whitelabelEnabled: true,
        marketplaceListingEnabled: true,
        isActive: true,
        sortOrder: 2,
        providerPlanId: "mock_razorpay_plan",
      },
    });
    paidPlanId = paid.createSubscriptionPlan.id;

    const createTenant = async (name: string) => {
      const email = `${name}-${Date.now()}@example.com`;
      shopClient.setChannelToken(E2E_DEFAULT_CHANNEL_TOKEN);
      const result = await shopClient.query(REGISTER_TENANT, {
        input: {
          businessName: name,
          firstName: "Tenant",
          lastName: "Admin",
          emailAddress: email,
          password: adminPassword,
          timezone: "Asia/Kolkata",
        },
      });
      // 3.7.3 login gate (GHSA-wr5h-x3x6-4h23): complete Phase 1.5
      // verification through the application API before any admin login —
      // login is refused while a pending token exists, even with
      // requireVerification=false. shopClient still targets the default
      // channel here (set above), so the public mutation routes correctly.
      await verifyTenantAdminViaApi(server, shopClient, email);
      return {
        email,
        token: result.registerNewTenant.channelToken,
        channelId: decode(result.registerNewTenant.channelId),
      };
    };

    const tenantA = await createTenant("ADR046 Academy A");
    tenantAEmail = tenantA.email;
    tenantAToken = tenantA.token;
    tenantAChannelId = tenantA.channelId;

    const tenantB = await createTenant("ADR046 Academy B");
    tenantBEmail = tenantB.email;
    tenantBToken = tenantB.token;

    // The Shop read/write API is channel-resolved. Register the learner in
    // tenant A's own channel through the Shop API, never through the database.
    learnerEmail = `adr046-learner-${Date.now()}@example.com`;
    shopClient.setChannelToken(tenantAToken);
    const learner = await shopClient.query(CREATE_CUSTOMER, {
      input: {
        firstName: "Learner",
        lastName: "A",
        emailAddress: learnerEmail,
        password: learnerPassword,
      },
    });
    expect(learner.registerCustomerAccount.__typename).toBe("Success");
  }, 120_000);

  afterAll(async () => {
    createProvider.mockRestore();
    cancelProvider.mockRestore();
    loggerInfo.mockRestore();
    await server.destroy();
  });

  it("exposes the two mutations without exposing provider fields", async () => {
    shopClient.setChannelToken(tenantAToken);
    await expect(shopClient.query(PROVIDER_FIELD_PROBE)).rejects.toThrow(
      /Cannot query field "providerShortUrl"/,
    );

    const result = await shopClient.query(LOGIN, {
      username: tenantAEmail,
      password: adminPassword,
    });
    expect(result.login.__typename).toBe("InvalidCredentialsError");

    // Tenant Administrators authenticate through the Admin API in this
    // Vendure setup; the resulting session is valid on the Shop surface.
    const adminLogin = await adminClient.asUserWithCredentials(
      tenantAEmail,
      adminPassword,
    );
    expect(adminLogin?.id).toBeTruthy();
  });

  it("refuses an authenticated learner at the ownership layer", async () => {
    const login = await shopClient.asUserWithCredentials(
      learnerEmail,
      learnerPassword,
    );
    expect(login?.id).toBeTruthy();
    shopClient.setChannelToken(tenantAToken);

    await expect(shopClient.query(CHANGE_PLAN, { planId: paidPlanId })).rejects.toThrow(
      /not currently authorized|permission/i,
    );
  });

  it("refuses a different-channel tenant Administrator", async () => {
    const login = await adminClient.asUserWithCredentials(
      tenantBEmail,
      adminPassword,
    );
    expect(login?.id).toBeTruthy();

    shopClient.setAuthToken(adminClient.getAuthToken());
    shopClient.setChannelToken(tenantAToken);

    await expect(shopClient.query(CHANGE_PLAN, { planId: paidPlanId })).rejects.toThrow(
      /not currently authorized|permission/i,
    );
  });

  it("allows same-channel tenant Admin and returns the transient provider authorization URL", async () => {
    const login = await adminClient.asUserWithCredentials(
      tenantAEmail,
      adminPassword,
    );
    expect(login?.id).toBeTruthy();

    shopClient.setAuthToken(adminClient.getAuthToken());
    shopClient.setChannelToken(tenantAToken);

    const result = await shopClient.query(CHANGE_PLAN, { planId: paidPlanId });
    expect(result.requestMySubscriptionPlanChange.authorizationUrl).toBe(
      "https://rzp.test/auth/1",
    );
    expect(result.requestMySubscriptionPlanChange.subscription.status).toBe(
      "pending_provider_auth",
    );
    expect(createProvider).toHaveBeenCalledTimes(1);

    const auditPayloads = loggerInfo.mock.calls
      .map((call) => String(call[0]))
      .filter((message) => message.includes("subscription.plan-change"));
    expect(
      auditPayloads.some((message) => message.includes('"actor":"tenant-self-serve"')),
    ).toBe(true);
  });

  it("same-plan retry returns authorizationUrl null and does not mint another provider subscription", async () => {
    const result = await shopClient.query(CHANGE_PLAN, { planId: paidPlanId });
    expect(result.requestMySubscriptionPlanChange.authorizationUrl).toBeNull();
    expect(createProvider).toHaveBeenCalledTimes(1);
  });

  it("keeps provider fields outside the MySubscription read contract after a provider-backed change", async () => {
    const result = await shopClient.query(MY_SUBSCRIPTION);
    expect(result.mySubscription?.status).toBe("pending_provider_auth");
    expect(JSON.stringify(result)).not.toContain("providerShortUrl");
    expect(JSON.stringify(result)).not.toContain("providerStatus");
    expect(JSON.stringify(result)).not.toContain("billingCustomerId");
  });

  it("allows platform SuperAdmin and records platform-superadmin provenance", async () => {
    adminClient.setChannelToken(E2E_DEFAULT_CHANNEL_TOKEN);
    await adminClient.asSuperAdmin();

    shopClient.setAuthToken(adminClient.getAuthToken());
    shopClient.setChannelToken(tenantAToken);

    const result = await shopClient.query(CHANGE_PLAN, { planId: paidPlanId });
    expect(result.requestMySubscriptionPlanChange.authorizationUrl).toBeNull();

    const auditPayloads = loggerInfo.mock.calls
      .map((call) => String(call[0]))
      .filter((message) => message.includes("subscription.plan-change"));
    expect(
      auditPayloads.some((message) => message.includes('"actor":"platform-superadmin"')),
    ).toBe(true);
  });

  it("cancels immediately through the Shop API and returns no authorization URL", async () => {
    const result = await shopClient.query(CANCEL, { atPeriodEnd: false });
    expect(result.cancelMySubscription.authorizationUrl).toBeNull();
    expect(result.cancelMySubscription.subscription.status).toBe("cancelled");
    expect(cancelProvider).toHaveBeenCalledWith(
      "sub_mock_1",
      { cancelAtCycleEnd: false },
    );
  });
  it("BUG-040: resolves the live row when a cancelled row coexists with it", async () => {
    // The previous test leaves sub_mock_1 cancelled. Re-subscribing creates a
    // second, live row for the same channel — the exact state allowed by the
    // partial unique index and previously exposed the unordered findOne bug.
    // `subscribeToPlan` / `cancelOrganizationSubscription` are SuperAdmin-only
    // Admin mutations — a tenant Administrator session is refused (found by
    // actually running this test, which had never been executed), so the
    // coexistence fixture is built with the same actor the acceptance harness
    // uses. The Shop reads below switch to the tenant's business-account
    // session, which is what the self-serve path is about.
    adminClient.setChannelToken(E2E_DEFAULT_CHANNEL_TOKEN);
    await adminClient.asSuperAdmin();

    const resubscribe = await adminClient.query(ADMIN_SUBSCRIBE, {
      channelId: tenantAChannelId,
      planId: paidPlanId,
    });

    const liveSubId = resubscribe.subscribeToPlan.id;
    expect(liveSubId).toBeTruthy();
    expect(resubscribe.subscribeToPlan.status).toBe("pending_provider_auth");
    expect(createProvider).toHaveBeenCalledTimes(2);

    // The Shop self-serve path must select the non-cancelled row, not the
    // older cancelled row. Changing the live paid row to provider-free also
    // exercises the corresponding binding lookup.
    // The Shop surface needs the tenant's own business-account session.
    await adminClient.asUserWithCredentials(tenantAEmail, adminPassword);
    adminClient.setChannelToken(tenantAToken);
    shopClient.setAuthToken(adminClient.getAuthToken());
    shopClient.setChannelToken(tenantAToken);

    // BUG-040 (read path): `mySubscription` is served by
    // CommercialEntitlementService.findChannelSubscription, which now uses the
    // same shared predicate as the mutations. With a cancelled row and a live
    // row coexisting it must report the LIVE row — that read path (and the
    // ADR-042 marketplace gate beside it) is the instance of BUG-040 the first
    // fix left behind.
    const readWithLiveRow = await shopClient.query(MY_SUBSCRIPTION);
    expect(readWithLiveRow.mySubscription.status).toBe("pending_provider_auth");
    expect(readWithLiveRow.mySubscription.plan.id).toBe(paidPlanId);

    const changed = await shopClient.query(CHANGE_PLAN, { planId: freePlanId });
    expect(changed.requestMySubscriptionPlanChange.subscription.status).toBe("active");
    expect(changed.requestMySubscriptionPlanChange.subscription.plan.id).toBe(freePlanId);
    expect(changed.requestMySubscriptionPlanChange.authorizationUrl).toBeNull();

    // Cancellation must target the same live row. The stale cancelled row has a
    // lower id; returning it would falsely report success while leaving the
    // actual live row active. Switched back to the SuperAdmin actor because the
    // Admin cancel mutation is SuperAdmin-only.
    adminClient.setChannelToken(E2E_DEFAULT_CHANNEL_TOKEN);
    await adminClient.asSuperAdmin();
    const cancelled = await adminClient.query(ADMIN_CANCEL, {
      channelId: tenantAChannelId,
      atPeriodEnd: false,
    });
    expect(cancelled.cancelOrganizationSubscription.id).toBe(liveSubId);
    expect(cancelled.cancelOrganizationSubscription.status).toBe("cancelled");
    expect(cancelProvider).toHaveBeenCalledTimes(2);

    // BUG-040 (read path, terminal fallback): a cancelled-only channel must
    // still report the terminal state — the fix must not turn "cancelled" into
    // "no subscription". Two cancelled rows now exist, so the fallback must
    // also be deterministic: the older row (sub_mock_1) is on the paid plan and
    // the row just cancelled is on the free plan.
    await adminClient.asUserWithCredentials(tenantAEmail, adminPassword);
    adminClient.setChannelToken(tenantAToken);
    shopClient.setAuthToken(adminClient.getAuthToken());
    shopClient.setChannelToken(tenantAToken);
    const readAfterCancel = await shopClient.query(MY_SUBSCRIPTION);
    expect(readAfterCancel.mySubscription.status).toBe("cancelled");
    expect(readAfterCancel.mySubscription.plan.id).toBe(freePlanId);
  });


});
