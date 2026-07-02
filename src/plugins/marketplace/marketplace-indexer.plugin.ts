import { OnApplicationBootstrap } from '@nestjs/common';
import { PluginCommonModule, VendurePlugin } from '@vendure/core';
import { MarketplaceIndexerService } from './services/marketplace-indexer.service';
import { MarketplaceSearchResolver } from './api/marketplace-search.resolver';
import { MarketplaceAdminResolver } from './api/marketplace-admin.resolver';
import { MarketplaceEventListener } from './listeners/marketplace-event.listener';
import { shopApiExtensions, adminApiExtensions } from './api/marketplace-schema';

/**
 * MarketplaceIndexerPlugin — Phase 3 scaffold.
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
    MarketplaceEventListener,
  ],
  shopApiExtensions: {
    schema: shopApiExtensions,
    resolvers: [MarketplaceSearchResolver],
  },
  adminApiExtensions: {
    schema: adminApiExtensions,
    resolvers: [MarketplaceAdminResolver],
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
