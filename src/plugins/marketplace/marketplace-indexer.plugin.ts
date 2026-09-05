import { OnApplicationBootstrap } from '@nestjs/common';
import { PluginCommonModule, VendurePlugin, LanguageCode, SettingsStoreScopes } from '@vendure/core';
import { MarketplaceBaselineService } from './services/marketplace-baseline.service';
import { MarketplaceIndexerService } from './services/marketplace-indexer.service';
import { MarketplaceSearchResolver } from './api/marketplace-search.resolver';
import { MarketplaceAdminResolver } from './api/marketplace-admin.resolver';
import { MarketplaceEventListener } from './listeners/marketplace-event.listener';
import { MarketplaceIndexQueueService } from './services/marketplace-index-queue.service';
import { MarketplaceAdService } from './services/marketplace-ad.service';
import { BayesianRatingService } from './services/bayesian-rating.service';
import { MarketplaceAttributionService } from './services/marketplace-attribution.service';
import { CommissionLedgerService } from './services/commission-ledger.service';
import { AdWalletService } from './services/ad-wallet.service';
import { MarketplaceBannerService } from './services/marketplace-banner.service';
import { SponsoredBoostConfigService } from './services/sponsored-boost-config.service';
import { MarketplaceAdvertisingService } from './services/marketplace-advertising.service';
import { CommissionListener } from './listeners/commission.listener';
import { CommissionLedger } from './entities/commission-ledger.entity';
import { MarketplaceCommissionResolver } from './api/marketplace-commission.resolver';
import { MarketplaceAdCampaign } from './entities/marketplace-ad-campaign.entity';
import { AdSpendLedger } from './entities/ad-spend-ledger.entity';
import { AdWallet } from './entities/ad-wallet.entity';
import { AdWalletLedger } from './entities/ad-wallet-ledger.entity';
import { MarketplaceAdvertisingResolver } from './api/marketplace-advertising.resolver';
import { shopApiExtensions, adminApiExtensions } from './api/marketplace-schema';
import { BaselineRefreshQueueService } from './services/baseline-refresh-queue.service';
import { bayesianBaselineRefreshTask } from './jobs/bayesian-baseline-refresh.task';

/**
 * MarketplaceIndexerPlugin — Phase 3.
 *
 * Provides platform-level Elasticsearch indices for cross-tenant discovery:
 * - `saa9vi_marketplace_sessions` — public BbbScheduledSession listings
 * - `saa9vi_marketplace_instructors` — public InstructorProfile listings
 *
 * ⚠️ DEPENDENCY REQUIREMENTS (registration order is critical):
 * - **TenantPlugin** must be registered FIRST — this plugin queries
 *   `TenantProfile` and `InstructorProfile` via TransactionalConnection,
 *   which are TypeORM entities registered by TenantPlugin. If TenantPlugin
 *   is absent, TypeORM metadata resolution fails, cascading into a
 *   GraphQL schema-merge crash.
 * - **BigBlueButtonPlugin** must be registered FIRST — this plugin queries
 *   `BbbScheduledSession` via TransactionalConnection, a BBB entity.
 *   Same TypeORM metadata dependency applies.
 *
 * Key design rules (INV-009):
 * - ES indices are derived read projections. Authoritative data stays in Postgres.
 * - All commerce (checkout, entitlement) routes to the tenant's channel — INV-001 preserved.
 * - `marketplaceSearch` query is public (no channel token required).
 *
 * Index writes are triggered by:
 * - `InstructorProfileCreatedEvent` / `InstructorProfileUpdatedEvent` for instructor changes
 * - `SessionCreatedEvent` / `SessionUpdatedEvent` / `SessionStartedEvent` / `SessionCancelledEvent` for session lifecycle
 * - `ProductVariantEvent` / `ProductVariantPriceEvent` for session price changes
 * - `TenantProfileUpdatedEvent` for academy profile changes (bulk channel reindex)
 * - `ReviewApprovedEvent` / `ReviewRejectedEvent` / `ReviewHiddenEvent` for ranking changes
 *
 * Phase 3 additions (implemented):
 * - Sponsored listing bid-boost from MarketplaceAdCampaign entity ✅
 * - Bayesian rating from ReviewsPlugin aggregate ✅
 * - Price from ProductVariant.price ✅
 * - ProductVariantEvent subscription for session index updates ✅ (corrected 2026-09-04: handler was a logging stub; now resolves affected sessions via productVariantId and funnels through the canonical indexSession() F7 gate)
 * - BullMQ job queue for async index writes ✅
 * - Product.customFields.bbbSessionId and instructorProfileId populated ✅
 */
@VendurePlugin({
  compatibility: '^3.0.0',
  imports: [PluginCommonModule],
  entities: [
    MarketplaceAdCampaign,
    AdSpendLedger,
    AdWallet,
    AdWalletLedger,
    CommissionLedger,
  ],
  providers: [
    MarketplaceIndexerService,
    MarketplaceEventListener,
    MarketplaceIndexQueueService,
    MarketplaceAdService,
    BayesianRatingService,
    MarketplaceBaselineService,
    MarketplaceAttributionService,
    CommissionLedgerService,
    AdWalletService,
    MarketplaceBannerService,
    SponsoredBoostConfigService,
    CommissionListener,
    MarketplaceAdvertisingService,
    BaselineRefreshQueueService,
  ],
  shopApiExtensions: {
    schema: shopApiExtensions,
    resolvers: [MarketplaceSearchResolver, MarketplaceCommissionResolver],
  },
  adminApiExtensions: {
    schema: adminApiExtensions,
    resolvers: [MarketplaceAdminResolver, MarketplaceAdvertisingResolver],
  },
  configuration: (config) => {
    // Order custom fields for Stream 2 commission attribution (ADR-021).
    // - orderSource: server-classified only (INV-008); client never writes it.
    // - marketplaceRef: attached ONLY via the dedicated applyMarketplaceReference mutation.
    //   Both are readonly:true so client GraphQL custom-field setters cannot write them;
    //   plugin TypeScript (resolver/listener) may still set them programmatically.

    config.customFields.Order ??= [];
    if (!config.customFields.Order.some((f) => f.name === 'orderSource')) {
    config.customFields.Order.push({
      name: 'orderSource',
      type: 'string',
      nullable: true,
      readonly: true,
      label: [{ languageCode: LanguageCode.en, value: 'Order Source (server-classified)' }],
      list: false,
    });
    }
    if (!config.customFields.Order.some((f) => f.name === 'marketplaceRef')) {
    config.customFields.Order.push({
      name: 'marketplaceRef',
      type: 'string',
      nullable: true,
      readonly: true,
      label: [{ languageCode: LanguageCode.en, value: 'Marketplace Referral' }],
      list: false,
    });
    }

    // Register Settings Store fields for the Bayesian baseline (3D.1a/3D.1b).
    config.settingsStoreFields ??= {};
    if (!config.settingsStoreFields['marketplace']) {
      config.settingsStoreFields['marketplace'] = [
        {
          name: 'bayesianGlobalMean',
          scope: SettingsStoreScopes.global,
        },
        {
          name: 'bayesianBaselineVersion',
          scope: SettingsStoreScopes.global,
        },
        {
          name: 'bayesianGlobalMeanComputedAt',
          scope: SettingsStoreScopes.global,
        },
        {
          name: 'bayesianRefreshGeneration',
          scope: SettingsStoreScopes.global,
        },
      ];
    }

    // Register the daily Bayesian baseline refresh ScheduledTask (3D.1b Step 6).
    // Vendure's ScheduledTask locks execution across instances (single run).
    const existingTaskIds = new Set(
      (config.schedulerOptions.tasks ?? []).map((t) => t.id),
    );
    if (!existingTaskIds.has(bayesianBaselineRefreshTask.id)) {
      config.schedulerOptions.tasks = [
        ...(config.schedulerOptions.tasks ?? []),
        bayesianBaselineRefreshTask,
      ];
    }

    return config;
  },
    dashboard: './dashboard/index.tsx',
})
export class MarketplaceIndexerPlugin implements OnApplicationBootstrap {
  constructor(
    private readonly indexerService: MarketplaceIndexerService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    // Ensure ES indices exist on startup (non-blocking)
    try {
      await this.indexerService.ensureIndicesExist();
      // Ensure existing indices have the baselineVersion mapping (3D.1b)
      await this.indexerService.ensureBaselineVersionMapping();
    } catch (err: any) {
      // Non-fatal: app starts even if ES is unreachable
      console.warn(`MarketplaceIndexerPlugin: Elasticsearch unavailable — ${err.message}`);
    }
  }
}
declare module '@vendure/core' {
  interface CustomOrderFields {
    orderSource?: 'marketplace' | 'referral' | 'direct' | null;
    marketplaceRef?: string | null;
  }
}
