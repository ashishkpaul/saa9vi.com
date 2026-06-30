import { OnApplicationBootstrap } from '@nestjs/common';
import { PluginCommonModule, VendurePlugin } from '@vendure/core';
import { MarketplaceIndexerService } from './services/marketplace-indexer.service';
import { MarketplaceSearchResolver } from './api/marketplace-search.resolver';
import { MarketplaceEventListener } from './listeners/marketplace-event.listener';
import { shopApiExtensions, adminApiExtensions } from './api/marketplace-schema';

/**
 * MarketplaceIndexerPlugin — Phase 3 scaffold.
 *
 * Provides platform-level Elasticsearch indices for cross-tenant discovery:
 * - `saa9vi_marketplace_sessions` — public BbbScheduledSession listings
 * - `saa9vi_marketplace_instructors` — public InstructorProfile listings
 *
 * Key design rules (INV-009):
 * - ES indices are derived read projections. Authoritative data stays in Postgres.
 * - All commerce (checkout, entitlement) routes to the tenant's channel — INV-001 preserved.
 * - `marketplaceSearch` query is public (no channel token required).
 *
 * Index writes are triggered by:
 * - `ProductVariantEvent` (Vendure EventBus) for session changes
 * - `InstructorProfileCreatedEvent` / `InstructorProfileUpdatedEvent` for instructor changes
 *
 * Phase 3 additions (not yet implemented):
 * - Sponsored listing bid-boost from MarketplaceAdCampaign
 * - Bayesian rating from ReviewsPlugin aggregate
 * - Price from ProductVariant.price
 * - BullMQ job queue for async index writes (currently inline in event handlers)
 */
@VendurePlugin({
  compatibility: '^3.0.0',
  imports: [PluginCommonModule],
  entities: [],
  providers: [
    MarketplaceIndexerService,
    MarketplaceSearchResolver,
    MarketplaceEventListener,
  ],
  shopApiExtensions: {
    schema: shopApiExtensions,
    resolvers: [MarketplaceSearchResolver],
  },
  adminApiExtensions: {
    schema: adminApiExtensions,
    resolvers: [MarketplaceSearchResolver],
  },
  configuration: (config) => {
    return config;
  },
})
export class MarketplaceIndexerPlugin implements OnApplicationBootstrap {
  constructor(
    private readonly indexerService: MarketplaceIndexerService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    // Ensure ES indices exist on startup (non-blocking)
    try {
      await this.indexerService.ensureIndicesExist();
    } catch (err: any) {
      // Non-fatal: app starts even if ES is unreachable
      console.warn(`MarketplaceIndexerPlugin: Elasticsearch unavailable — ${err.message}`);
    }
  }
}
