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
import { PaymentsPlugin } from './plugins/payments/payments.plugin';
// ADR-038: Razorpay is the sole recurring-billing provider. The former Juspay
// implementation was removed in 9a31beb and its legacy tables dropped in
// 466a4ef (ADR-040). Billing credentials are resolved eagerly at config time
// (this also executes during the Dashboard Vite build), so only the Razorpay
// provider is configured here.

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
const IS_TEST = process.env.NODE_ENV === "test";
// Commit 1 hygiene: dummyPaymentHandler is dev/test only. Production boot
// must fail if any PaymentMethod row still uses it (see PaymentsPlugin
// onApplicationBootstrap guard) — tenants use the platform Razorpay method.
const allowDummyPaymentHandler = IS_DEV || IS_TEST;
const serverPort = 3000;

export const config: VendureConfig = {
  // The SuperAdmin password / cookie secret below fall back to published
  // literals for `APP_ENV=dev` only. Non-dev startup calls
  // `assertProductionSecrets()` (src/platform/security/require-production-secrets.ts,
  // invoked from src/index.ts and src/index-worker.ts) which refuses to boot
  // when either is unset.
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

    // Login-CSRF protection. Vendure 3.7.3 defaults this to false and logs a
    // startup warning until it is enabled ("Login CSRF is possible ..."), because
    // `tokenMethod` includes `cookie`.
    //
    // Effect: Apollo rejects requests whose content-type is one a browser can
    // send cross-site without a preflight — `application/x-www-form-urlencoded`,
    // `multipart/form-data`, `text/plain`, and GET requests (which carry no
    // content-type) — unless they also carry `Apollo-Require-Preflight` or
    // `x-apollo-operation-name`. `application/json` is unaffected.
    //
    // Client audit before enabling (V1.0.9):
    //   - edu-frontend (nextjs-starter-vendure, src/lib/vendure/api.ts): every
    //     GraphQL request is a POST with `Content-Type: application/json`; no
    //     GET queries and no multipart uploads to the GraphQL APIs — unaffected.
    //   - @vendure/dashboard and @vendure/testing send the header natively.
    //   - Saa9vi's non-GraphQL controllers (e.g. POST /reviews-api/upload-asset)
    //     are outside the GraphQL module and are NOT covered by this option.
    //
    // Supersedes the "V1.0 keeps csrfPrevention:false ... V1.2 owns the rollout"
    // decision in docs/implementation/v1.0.1-vendure-373-upgrade-impact-assessment.md §5.
    csrfPrevention: true,

    // Trust proxy headers from Nginx (use true for AI Studio proxy chain)
    trustProxy: 1,

    // Enable permissive CORS for development to allow GraphiQL/Dashboard access via AI Studio proxy
    // Commit 3: production uses an explicit allow-list (STOREFRONT_URL +
    // ADMIN_URL, comma-separated supported). Dev keeps allow-all for the AI
    // Studio proxy. credentials:true with origin:true is allow-any + cookies
    // and must never ship to production.
    cors: IS_DEV
      ? {
          origin: (origin: any, callback: any) => callback(null, true),
          credentials: true,
        }
      : {
          origin: (origin: any, callback: any) => {
            if (!origin) return callback(null, true); // same-origin / curl
            const allowed = `${process.env.STOREFRONT_URL ?? ''},${process.env.ADMIN_URL ?? ''}`
              .split(',')
              .map((s) => s.trim().replace(/\/+$/, ''))
              .filter(Boolean);
            if (allowed.includes(String(origin).replace(/\/+$/, ''))) {
              return callback(null, true);
            }
            return callback(null, false);
          },
          credentials: true,
        },
    adminApiPlayground: IS_DEV,
    shopApiPlayground: IS_DEV,

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
      identifier: process.env.SUPERADMIN_USERNAME,
      password: process.env.SUPERADMIN_PASSWORD,
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
    // Commit 1: dummy stays registered for dev/test only (e2e suites create
    // their own dummy method rows; see tenant-plugin/e2e/fixtures).
    // In production the array is empty here — PaymentsPlugin appends the
    // Razorpay handler, and its bootstrap guard refuses to start if any
    // PaymentMethod row uses the dummy handler code.
    paymentMethodHandlers: allowDummyPaymentHandler ? [dummyPaymentHandler] : [],
  },
  // When adding or altering custom field definitions, the database will
  // need to be updated. See the "Migrations" section in README.md.
  customFields: {
    // bbbSessionId and instructorProfileId are Phase 3 prerequisite fields.
    // MarketplaceIndexerPlugin reads these to join Product → BbbScheduledSession
    // and Product → InstructorProfile when building the platform-level ES indices.
    // Must be set in BbbScheduledSessionService.create() when productVariantId is provided.
    // readonly:true + public:false → not writable via any GraphQL API (Admin or Shop),
    // still readable via Admin API output type, writable only via plugin TypeScript
    // (TransactionalConnection Product repository save). Same pattern as the
    // readonly Order fields in MarketplaceIndexerPlugin and Customer.status below.
    // No DB migration: readonly does not change column type/nullability.
    Product: [
      { name: 'bbbSessionId',        type: 'string' as const, nullable: true, public: false, readonly: true },
      { name: 'instructorProfileId', type: 'string' as const, nullable: true, public: false, readonly: true },
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
    ...(IS_DEV || process.env.NODE_ENV === 'test' ? [GraphiqlPlugin.init()] : []),
    AssetServerPlugin.init({
      route: "assets",
      assetUploadDir: path.join(__dirname, "../static/assets"),
      // Commit 3: production serves assets from ASSET_URL_PREFIX (CDN/origin).
      // The old inverted fallback handed production a localhost URL; dev keeps
      // the auto-guess. Boot refuses without it outside dev (see
      // assertProductionSecrets).
      assetUrlPrefix: IS_DEV ? undefined : process.env.ASSET_URL_PREFIX,
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
    EmailPlugin.init(
      IS_DEV || process.env.NODE_ENV === 'test'
        ? {
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
              verifyEmailAddressUrl: "http://localhost:8080/verify",
              passwordResetUrl: "http://localhost:8080/password-reset",
              changeEmailAddressUrl: "http://localhost:8080/verify-email-address-change",
            },
          }
        : {
            // Commit 3: production sends real mail over SMTP (env transport).
            // Boot refuses without SMTP_HOST outside dev. No mailbox route,
            // no file output — the devMode mailbox must never be public.
            transport: {
              type: 'smtp',
              host: process.env.SMTP_HOST,
              port: Number(process.env.SMTP_PORT ?? 587),
              auth: {
                user: process.env.SMTP_USER,
                pass: process.env.SMTP_PASS,
              },
            },
            handlers: [
              ...customerEmailHandlers,
              ...sellerEmailHandlers,
            ],
            templateLoader: new ChannelBasedTemplateLoader(
              path.join(__dirname, "../static/email/templates"),
            ),
            globalTemplateVars: {
              fromAddress: process.env.EMAIL_FROM_ADDRESS || '"Saa9vi" <noreply@saa9vi.com>',
              verifyEmailAddressUrl: process.env.STOREFRONT_URL ? `${process.env.STOREFRONT_URL}/verify` : "https://www.saa9vi.com/verify",
              passwordResetUrl: process.env.STOREFRONT_URL ? `${process.env.STOREFRONT_URL}/password-reset` : "https://www.saa9vi.com/password-reset",
              changeEmailAddressUrl: process.env.STOREFRONT_URL ? `${process.env.STOREFRONT_URL}/verify-email-address-change` : "https://www.saa9vi.com/verify-email-address-change",
            },
          },
    ),
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

      // ─── ADR-047 / Q2 metered rate (production-readiness item 1) ────────
      // Explicit platform rate in paise per learner-hour for `metered` orgs
      // that have no per-org rate. UNSET (dev) → the clearly-marked ₹20
      // PLACEHOLDER still applies; non-dev boot REFUSES to start without it
      // (assertProductionSecrets), so no production customer can ever be
      // billed a price nobody approved.
      defaultRatePaisePerLearnerHour:
        process.env.BBB_DEFAULT_RATE_PAISE_PER_LEARNER_HOUR != null &&
        process.env.BBB_DEFAULT_RATE_PAISE_PER_LEARNER_HOUR !== ""
          ? Number(process.env.BBB_DEFAULT_RATE_PAISE_PER_LEARNER_HOUR)
          : undefined,

      // ─── Public callback base (W3/W4 webhooks) ─────────────────────
      // Base for the BBB hook callback (`publicBaseUrl +
      // /bbb/webhook/<serverId>`). UNSET is fine in dev; non-dev boot
      // REFUSES without it (assertProductionSecrets /
      // BBB_PUBLIC_BASE_URL) and requires https:// (W4) because BBB
      // signs the REGISTERED URL — a guessed base fails every webhook
      // verification, a plaintext base exposes the auth material.
      publicBaseUrl: process.env.BBB_PUBLIC_BASE_URL || undefined,
      // Commit 3.5 — checksum algorithm.
      //
      // Default sha256 (verified live 2026-10-09: in-process probe
      // scripts/bbb/checksum-probe.ts signed getMeetings + hooks/list with
      // BOTH sha256 and sha1 against meeting.saa9vi.com — all four returned
      // HTTP 200 + <returncode>SUCCESS</returncode>). The server accepts the
      // full BBB 3.0 set (sha1/256/384/512); sha256 is the modern default.
      // The 1a8a38a 'sha1 … confirmed from hookChecksumAlgorithm in
      // default.yml' note described the bbb-webhooks VERIFY side, not an
      // outbound restriction — the probe proves outbound sha256 verifies.
      //
      // Code paths using THIS option: BbbApiService.buildChecksum (all
      // outbound API calls incl. getMeetings/create/join) and
      // BbbHooksService.ensureWebhook (hooks/create). Inbound webhook
      // verification is INDEPENDENT (workers/bbb-webhook-auth.ts infers
      // sha1/256/384/512 from the digest hex length). Override per server
      // when Commit 4 lands (nullable BbbServer.checksumAlgorithm).
      checksumAlgorithm: 'sha256',

      // ─── Scalability tuning from .env ──────────────────────────
      lockTtlSeconds: Number(process.env.BBB_LOCK_TTL_SECONDS ?? 30),
      lockHeartbeatIntervalMs: Number(
        process.env.BBB_LOCK_HEARTBEAT_INTERVAL_MS ?? 10000,
      ),
      // Production-readiness item 3: fail-CLOSED locking outside dev. An
      // explicit BBB_ROOM_LOCK_STRICT value always wins; otherwise a non-dev
      // deployment defaults to strict so a Redis blip can no longer let two
      // concurrent `bbbStartRoom` calls double-provision the same room.
      // E2E/dev never route through this file's plugin init without APP_ENV=dev.
      roomLockStrict:
        process.env.BBB_ROOM_LOCK_STRICT != null
          ? process.env.BBB_ROOM_LOCK_STRICT === "true"
          : !IS_DEV,
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
    // R3 — one-time commerce: registers `razorpayPaymentHandler` alongside the
    // dummy handler (which stays for dev + the existing e2e suites).
    PaymentsPlugin,
    SubscriptionPlugin.init({
        // ADR-038: Razorpay is the accepted recurring-billing provider. Explicit
        // selection is REQUIRED (fail-closed in production) — the plugin's
        // provider factory only accepts 'razorpay'.
        provider: 'razorpay',
        webhook: {
            // HMAC-SHA256 secret for X-Razorpay-Signature verification.
            // Fail-closed: when empty, the verifier rejects ALL webhook traffic.
            // Razorpay is the sole billing provider (ADR-038/ADR-040): there is
            // no legacy provider config to resolve.
            hmacSecret: process.env.RAZORPAY_WEBHOOK_SECRET ?? '',
        },
        // Plan §3.2 / slice 4: every self-serve registered tenant is activated on
        // this provider-free catalogue plan (no card, no trial clock, no
        // "no subscription" state). The plan row itself is created via
        // createSubscriptionPlan with providerPlanId left NULL; when it is absent
        // provisioning is skipped with a warning and registration still succeeds.
        freePlanSlug: process.env.FREE_PLAN_SLUG ?? 'free-basic',
    }),
],
};
