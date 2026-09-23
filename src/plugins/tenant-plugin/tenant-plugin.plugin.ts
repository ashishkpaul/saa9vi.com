import { Inject, OnApplicationBootstrap } from '@nestjs/common';
import { PluginCommonModule, VendurePlugin } from '@vendure/core';
import { CustomerDeletionModule } from '../../platform/customer-deletion/customer-deletion.module';
import { CommercialEntitlementModule } from '../../platform/commercial/commercial-entitlement.module';
import { CustomerDeletionService } from '../../platform/customer-deletion/customer-deletion.service';
import {
  tenantProfilePermission,
  instructorProfilePermission,
  mediaResourcePermission,
} from './constants';
import { TenantProfile } from './entities/tenant-profile.entity';
import { InstructorProfile } from './entities/instructor-profile.entity';
import { MediaResource } from './entities/media-resource.entity';
import { TenantRegistrationLog } from './entities/tenant-registration-log.entity';
import { TenantTheme } from './entities/tenant-theme.entity';
import { TenantProfileService } from './services/tenant-profile.service';
import { InstructorProfileService } from './services/instructor-profile.service';
import { MediaResourceService } from './services/media-resource.service';
import { InstructorIndexerService } from './services/instructor-indexer.service';
import { DomainChannelResolverService } from './services/domain-channel-resolver.service';
import { TenantDeletionService } from './services/tenant-deletion.service';
import { TenantRegistrationService } from './services/tenant-registration.service';
import { TenantRoleReconciliationService } from './services/tenant-role-reconciliation.service';
import { TenantThemeService } from './services/tenant-theme.service';
import { TenantCommercialEligibilityService } from './services/tenant-commercial-eligibility.service';
import { TenantAdminResolver } from './api/tenant-admin.resolver';
import { TenantShopResolver } from './api/tenant-shop.resolver';
import { adminApiExtensions, shopApiExtensions, themeAdminExtensions, themeShopExtensions } from './api/api-extensions';
import { DocumentNode, Kind } from 'graphql';

/**
 * Concatenates multiple GraphQL schema-extension documents into a single
 * DocumentNode WITHOUT merging/redefining types. Unlike `mergeTypeDefs`,
 * this preserves `extend type Query` / `extend type Mutation` as extension
 * definitions, which is required by Vendure's schema-extension mechanism
 * (mergeTypeDefs converts them into full `type Query` definitions, causing
 * "Cannot define a new schema within a schema extension").
 */
function concatApiExtensions(...docs: DocumentNode[]): DocumentNode {
  return {
    kind: Kind.DOCUMENT,
    definitions: docs.flatMap((doc) => doc.definitions),
  };
}

@VendurePlugin({
  compatibility: '^3.0.0',
  imports: [PluginCommonModule, CustomerDeletionModule, CommercialEntitlementModule],
  entities: [TenantProfile, InstructorProfile, MediaResource, TenantRegistrationLog, TenantTheme],
  providers: [
    TenantProfileService,
    InstructorProfileService,
    MediaResourceService,
    InstructorIndexerService,
    DomainChannelResolverService,
    TenantDeletionService,
    TenantRegistrationService,
    TenantRoleReconciliationService,
    TenantThemeService,
    TenantCommercialEligibilityService,
  ],
  adminApiExtensions: {
    schema: concatApiExtensions(adminApiExtensions, themeAdminExtensions),
    resolvers: [TenantAdminResolver],
  },
  shopApiExtensions: {
    schema: concatApiExtensions(shopApiExtensions, themeShopExtensions),
    resolvers: [TenantShopResolver],
  },
  dashboard: './dashboard/index.tsx',
  configuration: (config) => {
    config.authOptions.customPermissions.push(
      tenantProfilePermission,
      instructorProfilePermission,
      mediaResourcePermission,
    );
    return config;
  },
})
export class TenantPlugin implements OnApplicationBootstrap {
  constructor(
    private readonly tenantDeletionService: TenantDeletionService,
    @Inject(CustomerDeletionService)
    private readonly customerDeletionService: CustomerDeletionService,
  ) {}

  async onApplicationBootstrap() {
    this.customerDeletionService.registerChannelScopedHandler(
      'tenant-plugin',
      (ctx, customerId, channelId) =>
        this.tenantDeletionService.removeFromChannel(ctx, customerId, channelId),
    );
    this.customerDeletionService.registerFullDeleteHandler(
      'tenant-plugin',
      (ctx, customerId) =>
        this.tenantDeletionService.fullDelete(ctx, customerId),
    );
  }
}
