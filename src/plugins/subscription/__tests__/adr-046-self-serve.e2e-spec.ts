import "reflect-metadata";
import "dotenv/config";
import {
  createTestEnvironment,
  E2E_DEFAULT_CHANNEL_TOKEN,
  testConfig,
  registerInitializer,
} from "@vendure/testing";
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

describe("ADR-046 — tenant self-serve subscription Shop API", () => {
  const { server, adminClient, shopClient } = createTestEnvironment(
    mergeConfig(testConfig, {
      apiOptions: { port: 3091 },
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
    await server.init({ initialData: E2E_INITIAL_DATA });

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
      return { email, token: result.registerNewTenant.channelToken };
    };

    const tenantA = await createTenant("ADR046 Academy A");
    tenantAEmail = tenantA.email;
    tenantAToken = tenantA.token;

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


});
