import { Inject, OnApplicationBootstrap } from '@nestjs/common';
import { PluginCommonModule, VendurePlugin } from '@vendure/core';
import { CustomerDeletionModule } from '../../platform/customer-deletion/customer-deletion.module';
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
import { TenantProfileService } from './services/tenant-profile.service';
import { InstructorProfileService } from './services/instructor-profile.service';
import { MediaResourceService } from './services/media-resource.service';
import { InstructorIndexerService } from './services/instructor-indexer.service';
import { DomainChannelResolverService } from './services/domain-channel-resolver.service';
import { TenantDeletionService } from './services/tenant-deletion.service';
import { TenantRegistrationService } from './services/tenant-registration.service';
import { TenantRoleReconciliationService } from './services/tenant-role-reconciliation.service';
import { TenantAdminResolver } from './api/tenant-admin.resolver';
import { TenantShopResolver } from './api/tenant-shop.resolver';
import { adminApiExtensions, shopApiExtensions } from './api/api-extensions';

@VendurePlugin({
  compatibility: '^3.0.0',
  imports: [PluginCommonModule, CustomerDeletionModule],
  entities: [TenantProfile, InstructorProfile, MediaResource, TenantRegistrationLog],
  providers: [
    TenantProfileService,
    InstructorProfileService,
    MediaResourceService,
    InstructorIndexerService,
    DomainChannelResolverService,
    TenantDeletionService,
    TenantRegistrationService,
    TenantRoleReconciliationService,
  ],
  adminApiExtensions: {
    schema: adminApiExtensions,
    resolvers: [TenantAdminResolver],
  },
  shopApiExtensions: {
    schema: shopApiExtensions,
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
