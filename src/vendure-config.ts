import {
  dummyPaymentHandler,
  DefaultSchedulerPlugin,
  DefaultSearchPlugin,
  DefaultJobQueuePlugin,
  VendureConfig,
  RedisCachePlugin,
} from "@vendure/core";
import {
  EmailPlugin,
} from "@vendure/email-plugin";
import {
  ChannelBasedTemplateLoader,
  customerEmailHandlers,
  sellerEmailHandlers,
} from "./email-services";
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
import { PlatformDashboardPlugin } from './plugins/platform-dashboard/platform-dashboard.plugin';
import { AdSpendLedgerImmutableSubscriber } from './plugins/marketplace/ad-spend-ledger-immutable.subscriber';
import { CommissionLedgerImmutableSubscriber } from './plugins/marketplace/commission-ledger-immutable.subscriber';
import { AdWalletLedgerImmutableSubscriber } from './plugins/marketplace/ad-wallet-ledger-immutable.subscriber';
import { SubscriptionPlugin } from './plugins/subscription/subscription.plugin';

/**
 * Security headers middleware enforcing HTTP header hardening for production safety.
 */
export const securityHeadersMiddleware = (req: any, res: any, next: any) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  // res.setHeader("X-Frame-Options", "SAMEORIGIN");
  res.setHeader("X-XSS-Protection", "1; mode=block");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "geolocation=(), camera=(), microphone=()");

  if (process.env.APP_ENV !== "dev") {
    res.setHeader(
      "Strict-Transport-Security",
      "max-age=31536000; includeSubDomains; preload"
    );
  }

  res.removeHeader("X-Powered-By");
  next();
};

const IS_DEV = process.env.APP_ENV === "dev";
const serverPort = 3000;

export const config: VendureConfig = {
apiOptions: {
    // NOTE: Do NOT set `hostname` to a bind address like "0.0.0.0" — the GraphiQL
    // plugin injects `window.GRAPHIQL_SETTINGS` with an absolute URL built from
    // this value (see @vendure/graphiql-plugin graphiql.service.js createApiUrl),
    // and browsers cannot connect to "0.0.0.0", producing "NetworkError when
    // attempting to fetch resource". Leaving it unset makes GraphiQL use a
    // RELATIVE API path, which is correct behind the nginx reverse proxy
    // (core.meeting.lan) as well as for direct localhost access.
    port: serverPort,
    adminApiPath: "admin-api",
    shopApiPath: "shop-api",

    // Trust proxy headers from Nginx (use true for AI Studio proxy chain)
    trustProxy: 1,

    // Enable permissive CORS for development to allow GraphiQL/Dashboard access via AI Studio proxy
    cors: {
      origin: (origin: any, callback: any) => callback(null, true),
      credentials: true,
    },
    adminApiPlayground: true,
    shopApiPlayground: true,

    middleware: [
      {
        // Enforce HTTP security headers hardening
        route: '*',
        handler: securityHeadersMiddleware,
      },
      {
        // Resolve custom domain → channel token via Redis (SEC-006)
        route: '*',
        handler: domainChannelMiddleware,
      },
      {
        // Root redirect to platform dashboard
        route: '/',
        handler: (req: any, res: any, next: any) => {
          if (req.originalUrl === '/' || req.path === '/') {
            return res.redirect('/dashboard');
          }
          next();
        },
      },
    ],

    // The following options are useful in development mode,
    // but are best turned off for production for security reasons.
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
      identifier: process.env.SUPERADMIN_USERNAME || "superadmin",
      password: process.env.SUPERADMIN_PASSWORD || "superadmin",
    },
    cookieOptions: {
      secret: process.env.COOKIE_SECRET || "cookie-secret-dev-fallback",
    },
  },
  dbConnectionOptions: {
    type: "postgres",
    synchronize: false,
    migrations: [path.join(__dirname, "./migrations/*.+(js|ts)")],
    // INV-010 service-boundary enforcement: AdSpendLedger is append-only.
    // Vendure registers TypeORM subscribers only from this array, so the
    // plugin-owned subscriber is wired here rather than in plugin providers.
    subscribers: [AdSpendLedgerImmutableSubscriber, CommissionLedgerImmutableSubscriber, AdWalletLedgerImmutableSubscriber],
    logging: false,
    database: process.env.DB_NAME || "vendure",
    schema: process.env.DB_SCHEMA || "public",
    host: process.env.DB_HOST || "localhost",
    port: +process.env.DB_PORT || 5432,
    username: process.env.DB_USERNAME || "postgres",
    password: process.env.DB_PASSWORD || "postgres",
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
    ...(process.env.REDIS_HOST
      ? [
          BullMQJobQueuePlugin.init({
            connection: {
              host: process.env.REDIS_HOST,
              port: Number(process.env.REDIS_PORT) || 6379,
              password: process.env.REDIS_PASSWORD || undefined,
              maxRetriesPerRequest: null,
            },
          }),
          RedisCachePlugin.init({
            redisOptions: {
              host: process.env.REDIS_HOST,
              port: Number(process.env.REDIS_PORT) || 6379,
              password: process.env.REDIS_PASSWORD || undefined,
            },
          }),
        ]
      : [DefaultJobQueuePlugin.init({})]),
    DefaultSearchPlugin.init({ bufferUpdates: false, indexStockStatus: true }),
    EmailPlugin.init({
      devMode: true,
      outputPath: path.join(__dirname, "../static/email/test-emails"),
      route: "mailbox",
      handlers: [
        ...customerEmailHandlers,
        ...sellerEmailHandlers,
      ],
      templateLoader: new ChannelBasedTemplateLoader(
        path.join(__dirname, "../static/email/templates"),
      ),
      globalTemplateVars: {
        fromAddress: process.env.EMAIL_FROM_ADDRESS || '"Saa9vi" <noreply@saa9vi.com>',
        verifyEmailAddressUrl: IS_DEV
          ? "http://localhost:8080/verify"
          : (process.env.STOREFRONT_URL ? `${process.env.STOREFRONT_URL}/verify` : "https://www.saa9vi.com/verify"),
        passwordResetUrl: IS_DEV
          ? "http://localhost:8080/password-reset"
          : (process.env.STOREFRONT_URL ? `${process.env.STOREFRONT_URL}/password-reset` : "https://www.saa9vi.com/password-reset"),
        changeEmailAddressUrl: IS_DEV
          ? "http://localhost:8080/verify-email-address-change"
          : (process.env.STOREFRONT_URL ? `${process.env.STOREFRONT_URL}/verify-email-address-change` : "https://www.saa9vi.com/verify-email-address-change"),
      },
    }),
    DashboardPlugin.init({
      route: "dashboard",
      appDir: path.join(__dirname, "../dist/dashboard"),
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

      // ─── Capacity Intelligence Load Estimation (CI-001) ─────────────
      // PILOS virtual-load ratios/weights. Defaults per ADR §6A CI-002.
      // Tune from first 2 weeks of BbbUsageLedger data (Phase 1.5 blocker).
      cameraRatio: Number(process.env.BBB_CAMERA_RATIO ?? 0.40),
      micRatio: Number(process.env.BBB_MIC_RATIO ?? 0.70),
      videoWeight: Number(process.env.BBB_VIDEO_WEIGHT ?? 3),
      micWeight: Number(process.env.BBB_MIC_WEIGHT ?? 2),
      listenerWeight: Number(process.env.BBB_LISTENER_WEIGHT ?? 1),
    }),
    CmsPlugin,
    ReviewsPlugin,
    LoadSimulationPlugin,
    MarketplaceIndexerPlugin,
    CustomerSuspensionPlugin.init({}),
    PlatformDashboardPlugin.init({}),
    SubscriptionPlugin.init({
        webhook: {
            // Fail-closed: empty values reject ALL webhook traffic (the auth
            // service never allows when unset — unlike the BuyLits reference).
            username: process.env.JUSPAY_WEBHOOK_USERNAME ?? '',
            password: process.env.JUSPAY_WEBHOOK_PASSWORD ?? '',
            hmacSecret: process.env.JUSPAY_WEBHOOK_HMAC_SECRET ?? '',
            hmacSecretVersion: process.env.JUSPAY_WEBHOOK_HMAC_SECRET_VERSION,
        },
    }),
],
};
