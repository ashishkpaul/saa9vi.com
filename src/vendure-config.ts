import {
  dummyPaymentHandler,
  DefaultSchedulerPlugin,
  DefaultSearchPlugin,
  VendureConfig,
  RedisCachePlugin,
} from "@vendure/core";
import {
  defaultEmailHandlers,
  EmailPlugin,
  FileBasedTemplateLoader,
} from "@vendure/email-plugin";
import { AssetServerPlugin } from "@vendure/asset-server-plugin";
import { DashboardPlugin } from "@vendure/dashboard/plugin";
import { GraphiqlPlugin } from "@vendure/graphiql-plugin";
import "dotenv/config";
import path from "path";
import { BullMQJobQueuePlugin } from "@vendure/job-queue-plugin/package/bullmq";
import { BigBlueButtonPlugin } from "./plugins/bigbluebutton-plugin";
import { domainChannelMiddleware } from "./plugins/tenant-plugin/config/domain-channel.middleware";
import { CmsPlugin } from "./plugins/cms/cms.plugin";
import { TenantPlugin } from "./plugins/tenant-plugin/tenant-plugin.plugin";
import { ReviewsPlugin } from "./plugins/reviews/reviews-plugin";
import { LoadSimulationPlugin } from "./plugins/load-simulation-plugin/load-simulation.plugin";
import { MarketplaceIndexerPlugin } from "./plugins/marketplace";
import { CustomerSuspensionPlugin } from './plugins/customer-suspension/customer-suspension.plugin';

const IS_DEV = process.env.APP_ENV === "dev";
const serverPort = +process.env.PORT || 3000;

export const config: VendureConfig = {
  apiOptions: {
    port: serverPort,
    adminApiPath: "admin-api",
    shopApiPath: "shop-api",
    trustProxy: IS_DEV ? false : 1,
    middleware: [
      {
        // Resolve custom domain → channel token via Redis (SEC-006)
        route: '*',
        handler: domainChannelMiddleware,
      },
    ],
    // The following options are useful in development mode,
    // but are best turned off for production for security
    // reasons.
    ...(IS_DEV
      ? {
          adminApiDebug: true,
          shopApiDebug: true,
        }
      : {}),
  },
  authOptions: {
    tokenMethod: ["bearer", "cookie"],
    superadminCredentials: {
      identifier: process.env.SUPERADMIN_USERNAME,
      password: process.env.SUPERADMIN_PASSWORD,
    },
    cookieOptions: {
      secret: process.env.COOKIE_SECRET,
    },
  },
  dbConnectionOptions: {
    type: "postgres",
    // See the README.md "Migrations" section for an explanation of
    // the `synchronize` and `migrations` options.
    synchronize: false,
    migrations: [path.join(__dirname, "./migrations/*.+(js|ts)")],
    logging: false,
    database: process.env.DB_NAME,
    schema: process.env.DB_SCHEMA,
    host: process.env.DB_HOST,
    port: +process.env.DB_PORT,
    username: process.env.DB_USERNAME,
    password: process.env.DB_PASSWORD,
  },
  paymentOptions: {
    paymentMethodHandlers: [dummyPaymentHandler],
  },
  // When adding or altering custom field definitions, the database will
  // need to be updated. See the "Migrations" section in README.md.
  customFields: {
    // bbbSessionId and instructorProfileId are Phase 3 prerequisite fields.
    // MarketplaceIndexerPlugin reads these to join Product → BbbScheduledSession
    // and Product → InstructorProfile when building the platform-level ES indices.
    // Must be set in BbbScheduledSessionService.create() when productVariantId is provided.
    Product: [
      { name: 'bbbSessionId',        type: 'string' as const, nullable: true, public: false },
      { name: 'instructorProfileId', type: 'string' as const, nullable: true, public: false },
    ],
    // Customer status field for platform-wide suspension (INV-014)
    Customer: [
      { name: 'status', type: 'string' as const, nullable: true, readonly: true },
    ],
    Article: [],
    Banner: [],
    Page: [],
  },
  plugins: [
    GraphiqlPlugin.init(),
    AssetServerPlugin.init({
      route: "assets",
      assetUploadDir: path.join(__dirname, "../static/assets"),
      // For local dev, the correct value for assetUrlPrefix should
      // be guessed correctly, but for production it will usually need
      // to be set manually to match your production url.
      assetUrlPrefix: IS_DEV ? undefined : "http://localhost:3000/assets/",
    }),
    DefaultSchedulerPlugin.init(),
    BullMQJobQueuePlugin.init({
      connection: {
        host: process.env.REDIS_HOST || "localhost",
        port: Number(process.env.REDIS_PORT) || 6379,
        password: process.env.REDIS_PASSWORD || undefined,
        maxRetriesPerRequest: null,
      },
    }),
    DefaultSearchPlugin.init({ bufferUpdates: false, indexStockStatus: true }),
    RedisCachePlugin.init({
      redisOptions: {
        host: process.env.REDIS_HOST || 'localhost',
        port: Number(process.env.REDIS_PORT) || 6379,
        password: process.env.REDIS_PASSWORD || undefined,
      },
    }),
    EmailPlugin.init({
      devMode: true,
      outputPath: path.join(__dirname, "../static/email/test-emails"),
      route: "mailbox",
      handlers: defaultEmailHandlers,
      templateLoader: new FileBasedTemplateLoader(
        path.join(__dirname, "../static/email/templates"),
      ),
      globalTemplateVars: {
        // The following variables will change depending on your storefront implementation.
        // Here we are assuming a storefront running at http://localhost:8080.
        fromAddress: '"example" <noreply@example.com>',
        verifyEmailAddressUrl: "http://localhost:8080/verify",
        passwordResetUrl: "http://localhost:8080/password-reset",
        changeEmailAddressUrl:
          "http://localhost:8080/verify-email-address-change",
      },
    }),
    DashboardPlugin.init({
      route: "dashboard",
      appDir: IS_DEV
        ? path.join(__dirname, "../dist/dashboard")
        : path.join(__dirname, "dashboard"),
    }),

    TenantPlugin,
    // BigBlueButtonPlugin - Meeting hosting, joining, and selling access
    // All timing/performance parameters can be configured via .env variables.
    // See BBB_* vars in .env for full reference.
    BigBlueButtonPlugin.init({
      meetingIdPrefix: "bbb",
      attendeeJoinUrlTtlSeconds: 86400,

      // ─── Scalability tuning from .env ──────────────────────────
      lockTtlSeconds: Number(process.env.BBB_LOCK_TTL_SECONDS ?? 30),
      lockHeartbeatIntervalMs: Number(
        process.env.BBB_LOCK_HEARTBEAT_INTERVAL_MS ?? 10000,
      ),
      roomLockStrict: process.env.BBB_ROOM_LOCK_STRICT === "true",
      provisionDebounceMs: Number(
        process.env.BBB_PROVISION_DEBOUNCE_MS ?? 15000,
      ),
      runtimeValidationTtlMs: Number(
        process.env.BBB_RUNTIME_VALIDATION_TTL_MS ?? 10000,
      ),
      maxAutoRetries: Number(process.env.BBB_MAX_AUTO_RETRIES ?? 3),
      meetingGracePeriodMs: Number(
        process.env.BBB_MEETING_GRACE_PERIOD_MS ?? 90000,
      ),
      stuckProvisioningTimeoutMs: Number(
        process.env.BBB_STUCK_PROVISIONING_TIMEOUT_MS ?? 300000,
      ),
      fairBillingMinDurationMs: Number(
        process.env.BBB_FAIR_BILLING_MIN_DURATION_MS ?? 120000,
      ),
      roomStaleTimeoutMs: Number(
        process.env.BBB_ROOM_STALE_TIMEOUT_MS ?? 300000,
      ),
      provisioningJobRetries: Number(
        process.env.BBB_PROVISIONING_JOB_RETRIES ?? 3,
      ),
      provisioningJobBackoffMs: Number(
        process.env.BBB_PROVISIONING_JOB_BACKOFF_MS ?? 5000,
      ),
    }),
    CmsPlugin,
    ReviewsPlugin,
    LoadSimulationPlugin,
    MarketplaceIndexerPlugin,
    CustomerSuspensionPlugin.init({}),
],
};
