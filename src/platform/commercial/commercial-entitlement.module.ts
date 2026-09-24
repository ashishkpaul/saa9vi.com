import { Global, Module } from "@nestjs/common";
import { PluginCommonModule } from "@vendure/core";
import { CommercialEntitlementService } from "./commercial-entitlement.service";
import { TenantBusinessAccountService } from "./tenant-business-account.service";

/**
 * Platform module for the shared commercial entitlement policy
 * (ADR-042 marketplace listing, ADR-043 §2 white-label theming).
 *
 * Consumers import this module and inject `CommercialEntitlementService`
 * instead of re-querying OrganizationSubscription per plugin — the duplication
 * that `TenantCommercialEligibilityService`'s header explicitly warns against:
 *
 *   - TenantPlugin          → `canUseWhitelabel()` (window {trialing,active,past_due})
 *   - MarketplaceIndexerPlugin → `indexSession()` gate (window {active} ∪ past_due∧grace)
 *
 * `@Global()` follows the CustomerDeletionModule convention for platform
 * services that several independent plugins consume; each consumer still
 * declares the import explicitly so its DI graph is self-describing.
 *
 * PluginCommonModule is required to resolve TransactionalConnection in the
 * Vendure DI context.
 *
 * SCHEMA REQUIREMENT: the policy reads SubscriptionPlugin's entities, so any
 * configuration loading a consumer MUST register SubscriptionPlugin (same
 * requirement shape as TenantPlugin/BigBlueButtonPlugin for the marketplace
 * indexer — see MarketplaceIndexerPlugin's dependency note).
 */
@Global()
@Module({
  imports: [PluginCommonModule],
  providers: [CommercialEntitlementService, TenantBusinessAccountService],
  exports: [CommercialEntitlementService, TenantBusinessAccountService],
})
export class CommercialEntitlementModule {}
