import { PluginCommonModule, VendurePlugin } from '@vendure/core';
import {
  tenantProfilePermission,
  instructorProfilePermission,
  mediaResourcePermission,
} from './constants';
import { TenantProfile } from './entities/tenant-profile.entity';
import { InstructorProfile } from './entities/instructor-profile.entity';
import { MediaResource } from './entities/media-resource.entity';
import { TenantProfileService } from './services/tenant-profile.service';
import { InstructorProfileService } from './services/instructor-profile.service';
import { MediaResourceService } from './services/media-resource.service';
import { InstructorIndexerService } from './services/instructor-indexer.service';
import { TenantAdminResolver } from './api/tenant-admin.resolver';
import { TenantShopResolver } from './api/tenant-shop.resolver';
import { adminApiExtensions, shopApiExtensions } from './api/api-extensions';

@VendurePlugin({
  compatibility: '^3.0.0',
  imports: [PluginCommonModule],
  entities: [TenantProfile, InstructorProfile, MediaResource],
  providers: [
    TenantProfileService,
    InstructorProfileService,
    MediaResourceService,
    InstructorIndexerService,
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
export class TenantPlugin {}
